import Link from "next/link";
import { notFound } from "next/navigation";
import { richiediProfilo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { data as fData, giornoOra, nomeCampagna } from "@/lib/format";
import {
  ESITO_CONTRATTO_LABEL,
  ESITO_INCONTRO_LABEL,
  ESITO_LABEL,
  STATO_AZIENDA_LABEL,
  STATO_CA_LABEL,
  type EsitoChiamata,
  type StatoInCampagna,
} from "@/lib/types";
import Anagrafica from "./Anagrafica";
import Referenti from "./Referenti";

type Evento = { quando: string; testo: string; chi: string };

export default async function AziendaPage({ params }: PageProps<"/aziende/[id]">) {
  const p = await richiediProfilo(["admin", "direzione", "operatore"]);
  const { id } = await params;
  const supabase = await createClient();

  const { data: a } = await supabase.from("aziende").select("*, fonte:fonti_liste(nome)").eq("id", id).maybeSingle();
  if (!a) notFound();

  const [ref, ca, ch, ap, mod] = await Promise.all([
    supabase.from("referenti").select("*").eq("azienda_id", id).order("attivo", { ascending: false }).order("created_at"),
    supabase.from("campagna_aziende").select("campagna_id, stato, tentativi, campagna:campagne(comune, edizione, created_at)").eq("azienda_id", id),
    supabase.from("chiamate").select("campagna_id, esito, motivo, note, created_at, operatore:profili(nome)").eq("azienda_id", id).order("created_at", { ascending: false }),
    supabase
      .from("appuntamenti")
      .select("campagna_id, inizio, esito_incontro, esito_contratto, esito_note, annullato, incaricato:profili!appuntamenti_incaricato_id_fkey(nome)")
      .eq("azienda_id", id)
      .order("inizio", { ascending: false }),
    supabase.from("modifiche_aziende").select("campo, valore_vecchio, valore_nuovo, fonte, created_at, utente:profili(nome)").eq("azienda_id", id).order("created_at", { ascending: false }).limit(30),
  ]);

  type CA = { campagna_id: string; stato: StatoInCampagna; tentativi: number; campagna: { comune: string; edizione: string; created_at: string } | null };
  type CH = { campagna_id: string; esito: EsitoChiamata; motivo: string | null; note: string | null; created_at: string; operatore: { nome: string } | null };
  type AP = { campagna_id: string; inizio: string; esito_incontro: keyof typeof ESITO_INCONTRO_LABEL | null; esito_contratto: keyof typeof ESITO_CONTRATTO_LABEL | null; esito_note: string | null; annullato: boolean; incaricato: { nome: string } | null };
  type MOD = { campo: string; valore_vecchio: string | null; valore_nuovo: string | null; fonte: string; created_at: string; utente: { nome: string } | null };

  const campagne = ((ca.data ?? []) as unknown as CA[]).sort((x, y) => (y.campagna?.edizione ?? "").localeCompare(x.campagna?.edizione ?? ""));
  const chiamate = (ch.data ?? []) as unknown as CH[];
  const appuntamenti = (ap.data ?? []) as unknown as AP[];
  const modifiche = (mod.data ?? []) as unknown as MOD[];

  const eventiPer = (cid: string): Evento[] =>
    [
      ...chiamate.filter((c) => c.campagna_id === cid).map((c) => ({
        quando: c.created_at,
        testo: ESITO_LABEL[c.esito] + (c.motivo ? ` · ${c.motivo}` : "") + (c.note ? ` — “${c.note}”` : ""),
        chi: c.operatore?.nome ?? "",
      })),
      ...appuntamenti.filter((x) => x.campagna_id === cid).map((x) => ({
        quando: x.inizio,
        testo:
          (x.annullato ? "Appuntamento annullato" : "Appuntamento") +
          (x.esito_incontro ? ` · ${ESITO_INCONTRO_LABEL[x.esito_incontro].toLowerCase()}` : "") +
          (x.esito_contratto ? ` · contratto ${ESITO_CONTRATTO_LABEL[x.esito_contratto].toLowerCase()}` : "") +
          (x.esito_note ? ` — “${x.esito_note}”` : ""),
        chi: x.incaricato?.nome ?? "",
      })),
    ].sort((u, v) => v.quando.localeCompare(u.quando));

  const scrive = p.ruolo === "admin" || p.ruolo === "operatore";
  const fonte = (a as { fonte?: { nome: string } | null }).fonte;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/aziende" className="text-sm">← Aziende</Link>
        <h1 className="text-2xl md:text-3xl font-semibold mt-1">{a.ragione_sociale}</h1>
        <div className="flex flex-wrap gap-2 mt-2">
          {a.non_chiamare ? <span className="tag tag-red">Da non chiamare{a.non_chiamare_motivo ? ` · ${a.non_chiamare_motivo}` : ""}</span> : (
            <span className={`tag ${a.stato === "attiva" ? "tag-blue" : a.stato === "sconosciuto" ? "" : "tag-warn"}`}>{STATO_AZIENDA_LABEL[a.stato as keyof typeof STATO_AZIENDA_LABEL]}</span>
          )}
          {fonte && <span className="tag">Fonte: {fonte.nome}</span>}
          <span className="tag">Inserita il {fData(a.created_at)}</span>
          {a.verificata_at && <span className="tag">Verificata il {fData(a.verificata_at)}</span>}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-5 min-w-0">
          <Anagrafica azienda={a} modificabile={scrive} />
          <Referenti aziendaId={a.id} referenti={ref.data ?? []} modificabile={scrive} />
        </div>

        <section className="card p-5 min-w-0">
          <h2 className="font-semibold mb-4">Storico per edizione</h2>
          {campagne.length === 0 && <p className="text-sm text-text-secondary">Non è ancora in nessuna campagna che puoi vedere.</p>}
          <div className="flex flex-col gap-5">
            {campagne.map((c) => {
              const ev = eventiPer(c.campagna_id);
              return (
                <div key={c.campagna_id}>
                  <div className="font-semibold text-sm">
                    {c.campagna ? nomeCampagna(c.campagna) : "—"} <span className="tag">{STATO_CA_LABEL[c.stato]}</span>
                  </div>
                  {ev.length === 0 ? (
                    <div className="text-sm text-text-secondary mt-1">Non ancora chiamata</div>
                  ) : (
                    <ul className="mt-1.5 flex flex-col gap-1.5 text-sm">
                      {ev.map((e, i) => (
                        <li key={i}><span className="text-text-secondary text-xs">{giornoOra(e.quando)}{e.chi ? ` · ${e.chi}` : ""}</span><br />{e.testo}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="card p-5 min-w-0">
          <h2 className="font-semibold mb-1">Cronologia modifiche</h2>
          <p className="text-xs text-text-secondary mb-3">Ogni cambio ai dati resta registrato, con chi l&apos;ha fatto.</p>
          {modifiche.length === 0 && <p className="text-sm text-text-secondary">Nessuna modifica.</p>}
          <ul className="flex flex-col gap-2 text-sm">
            {modifiche.map((m, i) => (
              <li key={i}>
                <span className="text-xs text-text-secondary">{giornoOra(m.created_at)} · {m.utente?.nome ?? "sistema"} · {m.fonte}</span><br />
                <strong>{m.campo}</strong>: <span className="line-through text-text-secondary">{m.valore_vecchio || "vuoto"}</span> → {m.valore_nuovo || "vuoto"}
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-secondary mt-4">Le proposte di aggiornamento di Gemini arriveranno qui nella tappa 3.</p>
        </section>
      </div>
    </div>
  );
}
