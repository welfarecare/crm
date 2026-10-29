"use server";

import { createClient } from "@/lib/supabase/server";
import { getProfilo } from "@/lib/auth";
import { calendarioAttivo, creaEvento, occupato } from "@/lib/google";

type Intervallo = { inizio: string; fine: string };
const SITO = process.env.NEXT_PUBLIC_SITE_URL ?? "https://crm.welfarecare.org";

async function soloChiFissaAppuntamenti() {
  const p = await getProfilo();
  if (!p || (p.ruolo !== "admin" && p.ruolo !== "operatore")) throw new Error("Non autorizzato");
  return p;
}

/** Orari occupati di un incaricato in un giorno: Google Calendar + appuntamenti del CRM */
export async function disponibilita(incaricatoId: string, giorno: string): Promise<{ google: boolean; occupato: Intervallo[]; avviso?: string }> {
  await soloChiFissaAppuntamenti();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) throw new Error("Giorno non valido");
  const supabase = await createClient();
  const [{ data: inc }, { data: crm }] = await Promise.all([
    supabase.from("profili").select("email, ruolo, attivo").eq("id", incaricatoId).maybeSingle(),
    supabase.rpc("impegni_incaricato", { p_incaricato: incaricatoId, p_giorno: giorno }),
  ]);
  const elenco: Intervallo[] = ((crm ?? []) as Intervallo[]).map((x) => ({ inizio: x.inizio, fine: x.fine }));
  if (!inc || inc.ruolo !== "incaricato" || !inc.attivo) throw new Error("Incaricato non valido");
  if (!calendarioAttivo()) return { google: false, occupato: elenco };

  // finestra larga attorno al giorno (copre ora legale e solare); i calcoli fini li fa la schermata
  const base = new Date(`${giorno}T00:00:00Z`).getTime();
  const daIso = new Date(base - 3 * 3600_000);
  const aIso = new Date(base + 27 * 3600_000);
  try {
    const g = await occupato(inc.email, daIso, aIso);
    return { google: true, occupato: [...elenco, ...g] };
  } catch (e) {
    return { google: false, occupato: elenco, avviso: (e as Error).message };
  }
}

/** Scrive nel calendario dell'incaricato l'appuntamento nato da una chiamata */
export async function inviaAlCalendario(opz: { chiamataId?: string; appuntamentoId?: string; invitaAzienda: boolean }): Promise<{ ok: boolean; messaggio: string }> {
  try {
    await soloChiFissaAppuntamenti();
    if (!calendarioAttivo()) return { ok: false, messaggio: "Il calendario Google non è ancora collegato: l'appuntamento è salvato solo nel CRM." };
    const supabase = await createClient();
    let q = supabase
      .from("appuntamenti")
      .select(
        "id, inizio, fine, modalita, note, google_event_id, " +
          "azienda:aziende(id, ragione_sociale, indirizzo, comune, telefono, email), " +
          "referente:referenti(nome, ruolo, telefono, email), " +
          "incaricato:profili!appuntamenti_incaricato_id_fkey(email, nome), " +
          "operatore:profili!appuntamenti_operatore_id_fkey(nome)"
      );
    q = opz.appuntamentoId ? q.eq("id", opz.appuntamentoId) : q.eq("chiamata_id", opz.chiamataId!);
    const { data, error } = await q.maybeSingle();
    if (error || !data) return { ok: false, messaggio: "Appuntamento non trovato." };
    type A = {
      id: string; inizio: string; fine: string; modalita: string; note: string | null; google_event_id: string | null;
      azienda: { id: string; ragione_sociale: string; indirizzo: string | null; comune: string | null; telefono: string | null; email: string | null } | null;
      referente: { nome: string; ruolo: string | null; telefono: string | null; email: string | null } | null;
      incaricato: { email: string; nome: string } | null;
      operatore: { nome: string } | null;
    };
    const a = data as unknown as A;
    if (a.google_event_id) return { ok: true, messaggio: "Già presente nel calendario." };
    if (!a.incaricato || !a.azienda) return { ok: false, messaggio: "Dati dell'appuntamento incompleti." };

    const video = a.modalita === "video";
    const invitato = opz.invitaAzienda ? a.referente?.email || a.azienda.email : null;
    const righe = [
      `Azienda: ${a.azienda.ragione_sociale}`,
      a.referente ? `Referente: ${a.referente.nome}${a.referente.ruolo ? ` (${a.referente.ruolo})` : ""}${a.referente.telefono ? ` · ${a.referente.telefono}` : ""}` : "",
      a.azienda.telefono ? `Telefono azienda: ${a.azienda.telefono}` : "",
      a.note ? `Note: ${a.note}` : "",
      a.operatore ? `Fissato da: ${a.operatore.nome}` : "",
      "",
      `Scheda nel CRM: ${SITO}/aziende/${a.azienda.id}`,
    ].filter((r, i, arr) => r !== "" || (i > 0 && arr[i - 1] !== ""));

    const ev = await creaEvento(a.incaricato.email, {
      titolo: `WelfareCare · ${a.azienda.ragione_sociale}`,
      luogo: video ? "Videochiamata (Google Meet)" : [a.azienda.indirizzo, a.azienda.comune].filter(Boolean).join(", ") || undefined,
      descrizione: righe.join("\n"),
      inizio: a.inizio,
      fine: a.fine,
      video,
      invitati: invitato ? [invitato] : [],
    });

    const { error: e2 } = await supabase.from("appuntamenti").update({ google_event_id: ev.id, meet_link: ev.meet ?? null }).eq("id", a.id);
    if (e2) return { ok: false, messaggio: `Evento creato, ma non sono riuscito a salvarne il riferimento: ${e2.message}` };
    return {
      ok: true,
      messaggio: `Scritto nel calendario di ${a.incaricato.nome || a.incaricato.email}${invitato ? `, invito inviato a ${invitato}` : ""}${ev.meet ? " · link Meet creato" : ""}.`,
    };
  } catch (e) {
    return { ok: false, messaggio: `Appuntamento salvato nel CRM, ma non nel calendario: ${(e as Error).message}` };
  }
}
