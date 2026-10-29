"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfilo, livelloMfa } from "@/lib/auth";
import type { Permessi, Ruolo } from "@/lib/types";

type Esito = { ok: true; id?: string } | { ok: false; errore: string };

async function soloAdmin() {
  const p = await getProfilo();
  if (!p || p.ruolo !== "admin") throw new Error("Solo l'amministratore può farlo");
  if ((await livelloMfa()).attuale !== "aal2") throw new Error("Serve la doppia verifica: esci e rientra con il codice dal telefono");
  return p;
}

async function registra(azione: string) {
  const sb = await createClient();
  await sb.rpc("registra_attivita", { p_azione: azione });
}

export async function creaUtente(dati: { email: string; nome: string; ruolo: Ruolo; password: string; zona: string }): Promise<Esito> {
  try {
    await soloAdmin();
    if (dati.password.length < 12) return { ok: false, errore: "La password temporanea deve avere almeno 12 caratteri." };
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.createUser({
      email: dati.email.trim().toLowerCase(),
      password: dati.password,
      email_confirm: true,
      user_metadata: { nome: dati.nome.trim(), ruolo: dati.ruolo },
    });
    if (error) return { ok: false, errore: error.message.includes("already") ? "Esiste già un utente con questa email." : error.message };
    if (dati.zona.trim()) {
      const sb = await createClient();
      await sb.from("profili").update({ zona: dati.zona.trim() }).eq("id", data.user.id);
    }
    await registra(`ha creato l'utente ${dati.nome.trim()} (${dati.ruolo})`);
    revalidatePath("/controllo");
    return { ok: true, id: data.user.id };
  } catch (e) {
    return { ok: false, errore: (e as Error).message };
  }
}

export async function salvaUtente(
  id: string,
  dati: { nome: string; ruolo: Ruolo; zona: string; permessi: Permessi; campagne: string[] }
): Promise<Esito> {
  try {
    const me = await soloAdmin();
    if (id === me.id && dati.ruolo !== "admin") return { ok: false, errore: "Non puoi toglierti il ruolo di amministratore da solo." };
    const sb = await createClient();
    const { error } = await sb.from("profili").update({ nome: dati.nome.trim(), ruolo: dati.ruolo, zona: dati.zona.trim() || null, permessi: dati.permessi }).eq("id", id);
    if (error) return { ok: false, errore: error.message };

    const { data: attuali } = await sb.from("campagne_assegnazioni").select("campagna_id").eq("utente_id", id);
    const prima = new Set((attuali ?? []).map((a) => a.campagna_id as string));
    const dopo = new Set(dati.campagne);
    const da_togliere = [...prima].filter((c) => !dopo.has(c));
    const da_aggiungere = [...dopo].filter((c) => !prima.has(c));
    if (da_togliere.length) {
      const { error: e1 } = await sb.from("campagne_assegnazioni").delete().eq("utente_id", id).in("campagna_id", da_togliere);
      if (e1) return { ok: false, errore: e1.message };
    }
    if (da_aggiungere.length) {
      const { error: e2 } = await sb.from("campagne_assegnazioni").insert(da_aggiungere.map((c) => ({ campagna_id: c, utente_id: id })));
      if (e2) return { ok: false, errore: e2.message };
    }
    if (da_togliere.length || da_aggiungere.length) {
      const { data: nomi } = await sb.from("campagne").select("id, comune, edizione").in("id", [...da_togliere, ...da_aggiungere]);
      const n = (cid: string) => { const c = nomi?.find((x) => x.id === cid); return c ? `${c.comune} ${c.edizione}` : cid; };
      const parti = [
        da_aggiungere.length ? `assegnato ${da_aggiungere.map(n).join(", ")}` : "",
        da_togliere.length ? `tolto ${da_togliere.map(n).join(", ")}` : "",
      ].filter(Boolean);
      await registra(`ha ${parti.join(" e ")} a ${dati.nome.trim()}`);
    }
    await registra(`ha aggiornato ruolo e permessi di ${dati.nome.trim()}`);
    revalidatePath("/controllo");
    return { ok: true };
  } catch (e) {
    return { ok: false, errore: (e as Error).message };
  }
}

export async function impostaAttivo(id: string, attivo: boolean, nome: string): Promise<Esito> {
  try {
    const me = await soloAdmin();
    if (id === me.id) return { ok: false, errore: "Non puoi disattivare te stesso." };
    const admin = createAdminClient();
    const { error: eBan } = await admin.auth.admin.updateUserById(id, { ban_duration: attivo ? "none" : "876000h" });
    if (eBan) return { ok: false, errore: eBan.message };
    const sb = await createClient();
    const { error } = await sb.from("profili").update({ attivo }).eq("id", id);
    if (error) return { ok: false, errore: error.message };
    // rilascia eventuali aziende bloccate nella coda
    if (!attivo) await admin.from("campagna_aziende").update({ bloccata_da: null, bloccata_at: null }).eq("bloccata_da", id);
    await registra(`ha ${attivo ? "riattivato" : "disattivato"} ${nome}`);
    revalidatePath("/controllo");
    return { ok: true };
  } catch (e) {
    return { ok: false, errore: (e as Error).message };
  }
}

export async function nuovaPassword(id: string, password: string, nome: string): Promise<Esito> {
  try {
    await soloAdmin();
    if (password.length < 12) return { ok: false, errore: "Almeno 12 caratteri." };
    const { error } = await createAdminClient().auth.admin.updateUserById(id, { password });
    if (error) return { ok: false, errore: error.message };
    await registra(`ha impostato una nuova password per ${nome}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, errore: (e as Error).message };
  }
}

export async function azzeraDoppiaVerifica(id: string, nome: string): Promise<Esito> {
  try {
    await soloAdmin();
    const admin = createAdminClient();
    const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: id });
    if (error) return { ok: false, errore: error.message };
    for (const f of data.factors) {
      const { error: e } = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: id });
      if (e) return { ok: false, errore: e.message };
    }
    await registra(`ha azzerato la doppia verifica di ${nome}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, errore: (e as Error).message };
  }
}
