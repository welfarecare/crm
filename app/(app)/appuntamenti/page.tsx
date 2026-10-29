import Link from "next/link";
import { richiediProfilo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { giornoOra, nomeCampagna } from "@/lib/format";
import { ESITO_CONTRATTO_LABEL, ESITO_INCONTRO_LABEL } from "@/lib/types";
import EsitoForm from "./EsitoForm";
import InviaCalendario from "./InviaCalendario";
import { calendarioAttivo } from "@/lib/google";

type Riga = {
  id: string;
  inizio: string;
  fine: string;
  modalita: string;
  note: string | null;
  esito_incontro: keyof typeof ESITO_INCONTRO_LABEL | null;
  esito_contratto: keyof typeof ESITO_CONTRATTO_LABEL | null;
  esito_note: string | null;
  google_event_id: string | null;
  meet_link: string | null;
  azienda: { id: string; ragione_sociale: string; indirizzo: string | null; comune: string | null; telefono: string | null } | null;
  referente: { nome: string; ruolo: string | null; telefono: string | null } | null;
  incaricato: { nome: string } | null;
  operatore: { nome: string } | null;
  campagna: { comune: string; edizione: string } | null;
};

const VISTE = [
  { id: "prossimi", label: "Prossimi" },
  { id: "da_compilare", label: "Esito da compilare" },
  { id: "passati", label: "Conclusi" },
] as const;

export default async function AppuntamentiPage({ searchParams }: PageProps<"/appuntamenti">) {
  const p = await richiediProfilo();
  const sp = await searchParams;
  const vista = (VISTE.find((v) => v.id === sp.v)?.id ?? "prossimi") as (typeof VISTE)[number]["id"];
  const supabase = await createClient();
  const adesso = new Date().toISOString();

  const base = () => {
    let q = supabase
      .from("appuntamenti")
      .select(
        "id, inizio, fine, modalita, note, esito_incontro, esito_contratto, esito_note, google_event_id, meet_link, " +
          "azienda:aziende(id, ragione_sociale, indirizzo, comune, telefono), " +
          "referente:referenti(nome, ruolo, telefono), " +
          "incaricato:profili!appuntamenti_incaricato_id_fkey(nome), " +
          "operatore:profili!appuntamenti_operatore_id_fkey(nome), " +
          "campagna:campagne(comune, edizione)"
      )
      .eq("annullato", false);
    if (p.ruolo === "incaricato") q = q.eq("incaricato_id", p.id);
    return q;
  };

  let query = base();
  if (vista === "prossimi") query = query.gte("fine", adesso).order("inizio", { ascending: true });
  if (vista === "da_compilare") query = query.lt("fine", adesso).is("esito_incontro", null).order("inizio", { ascending: true });
  if (vista === "passati") query = query.not("esito_incontro", "is", null).order("inizio", { ascending: false });
  const { data } = await query.limit(100);
  const righe = (data ?? []) as unknown as Riga[];

  let qc = supabase
    .from("appuntamenti")
    .select("id", { count: "exact", head: true })
    .eq("annullato", false)
    .lt("fine", adesso)
    .is("esito_incontro", null);
  if (p.ruolo === "incaricato") qc = qc.eq("incaricato_id", p.id);
  const { count: daCompilare } = await qc;

  const puoCompilare = p.ruolo !== "direzione";
  const calendario = calendarioAttivo();

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <h1 className="text-2xl font-semibold">{p.ruolo === "incaricato" ? "I miei appuntamenti" : "Appuntamenti"}</h1>
      <div className="flex flex-wrap gap-2">
        {VISTE.map((v) => (
          <Link
            key={v.id}
            href={`/appuntamenti?v=${v.id}`}
            className={`tag !text-sm !px-3 !py-1.5 no-underline ${vista === v.id ? "!bg-foreground !text-white" : ""} ${
              v.id === "da_compilare" && (daCompilare ?? 0) > 0 && vista !== v.id ? "tag-red" : ""
            }`}
          >
            {v.label}
            {v.id === "da_compilare" && (daCompilare ?? 0) > 0 ? ` (${daCompilare})` : ""}
          </Link>
        ))}
      </div>

      {righe.length === 0 && <div className="card p-6 text-sm text-text-secondary">Nessun appuntamento in questa vista.</div>}

      <div className="flex flex-col gap-3">
        {righe.map((r) => {
          const mancante = vista === "da_compilare";
          return (
            <article key={r.id} className={`card p-4 md:p-5 flex flex-col gap-2 ${mancante ? "!border-danger-text/40 border-2" : ""}`}>
              <div className={`text-xs font-semibold ${mancante ? "text-danger-text" : "text-accent-text"}`}>
                {giornoOra(r.inizio)} · {r.modalita === "video" ? "videochiamata" : "in presenza"}
                {mancante ? " · esito mancante" : ""}
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <h2 className="text-lg font-semibold">
                  {r.azienda ? <Link href={`/aziende/${r.azienda.id}`} className="text-foreground no-underline">{r.azienda.ragione_sociale}</Link> : "—"}
                </h2>
                <span className="text-xs text-text-secondary">
                  {r.campagna ? nomeCampagna(r.campagna) : ""}
                  {p.ruolo !== "incaricato" && r.incaricato ? ` · ${r.incaricato.nome}` : ""}
                </span>
              </div>
              <div className="text-sm text-text-secondary">
                {[r.azienda?.indirizzo, r.azienda?.comune].filter(Boolean).join(", ")}
                {r.referente && <div>Con: {r.referente.nome}{r.referente.ruolo ? ` · ${r.referente.ruolo}` : ""}{r.referente.telefono ? ` · ${r.referente.telefono}` : ""}</div>}
              </div>
              {r.note && <div className="text-sm bg-surface-muted rounded-lg p-3">“{r.note}”{r.operatore ? ` — ${r.operatore.nome}` : ""}</div>}
              <div className="flex flex-wrap gap-2">
                {r.azienda?.indirizzo && r.modalita !== "video" && (
                  <a className="btn btn-sm" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.azienda.ragione_sociale} ${r.azienda.indirizzo} ${r.azienda.comune ?? ""}`)}`}>Naviga</a>
                )}
                {r.azienda?.telefono && <a className="btn btn-sm" href={`tel:${r.azienda.telefono}`}>Chiama</a>}
                {r.meet_link && <a className="btn btn-sm" target="_blank" rel="noreferrer" href={r.meet_link}>Apri Meet</a>}
                {r.google_event_id && <span className="tag tag-blue self-center">Nel calendario</span>}
              </div>
              {!r.google_event_id && calendario && (p.ruolo === "admin" || p.ruolo === "operatore") && new Date(r.fine) > new Date() && (
                <InviaCalendario id={r.id} />
              )}
              {r.esito_incontro && (
                <div className="text-sm">
                  <span className="tag tag-blue">{ESITO_INCONTRO_LABEL[r.esito_incontro]}</span>{" "}
                  {r.esito_contratto && <span className="tag">Contratto: {ESITO_CONTRATTO_LABEL[r.esito_contratto]}</span>}
                  {r.esito_note && <span className="text-text-secondary"> · {r.esito_note}</span>}
                </div>
              )}
              {puoCompilare && new Date(r.inizio) <= new Date() && (
                <EsitoForm id={r.id} iniziale={{ incontro: r.esito_incontro, contratto: r.esito_contratto, note: r.esito_note }} />
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
