"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ESITI,
  ESITO_LABEL,
  MOTIVI_NON_INTERESSATO,
  ESITO_CONTRATTO_LABEL,
  type EsitoChiamata,
} from "@/lib/types";
import { dataOra, giornoOra, isoDaLocale, messaggioErrore, numero, ora } from "@/lib/format";
import { disponibilita, inviaAlCalendario } from "@/lib/calendarioAzioni";

type Azienda = {
  id: string;
  ragione_sociale: string;
  piva: string | null;
  telefono: string | null;
  email: string | null;
  sito: string | null;
  indirizzo: string | null;
  comune: string | null;
  provincia: string | null;
  settore: string | null;
  dipendenti: number | null;
  note: string | null;
};
type Referente = { id: string; nome: string; ruolo: string | null; telefono: string | null; email: string | null };
type Corrente = {
  id: string;
  stato: string;
  tentativi: number;
  prossimo_richiamo: string | null;
  ultimo_esito: EsitoChiamata | null;
  azienda: Azienda;
};
type Storico = {
  quando: string;
  campagna: string;
  testo: string;
  chi: string;
};
type StatoCoda = { totale: number; lavorate: number; chiamate_oggi: number; appuntamenti_oggi: number };
type InCoda = { azienda_id: string; ragione_sociale: string; stato: string; tentativi: number; prossimo_richiamo: string | null };

const oggiStr = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" });

export default function CodaClient({
  campagne,
  campagnaId,
  incaricati,
}: {
  campagne: { id: string; nome: string }[];
  campagnaId: string;
  incaricati: { id: string; nome: string; zona: string | null }[];
}) {
  const [supabase] = useState(() => createClient());
  const router = useRouter();

  const [caricamento, setCaricamento] = useState(true);
  const [corrente, setCorrente] = useState<Corrente | null>(null);
  const [referenti, setReferenti] = useState<Referente[]>([]);
  const [storico, setStorico] = useState<Storico[]>([]);
  const [statoCoda, setStatoCoda] = useState<StatoCoda | null>(null);
  const [inCoda, setInCoda] = useState<InCoda[]>([]);
  const [errore, setErrore] = useState<string | null>(null);
  const [salvataggio, setSalvataggio] = useState(false);

  // form
  const [esito, setEsito] = useState<EsitoChiamata | null>(null);
  const [note, setNote] = useState("");
  const [motivo, setMotivo] = useState("");
  const [richiamoData, setRichiamoData] = useState("");
  const [richiamoOra, setRichiamoOra] = useState("");
  const [incaricato, setIncaricato] = useState("");
  const [appData, setAppData] = useState("");
  const [appOra, setAppOra] = useState("");
  const [durata, setDurata] = useState(60);
  const [modalita, setModalita] = useState("presenza");
  const [referenteApp, setReferenteApp] = useState("");
  const [noteIncaricato, setNoteIncaricato] = useState("");
  const [impegni, setImpegni] = useState<{ inizio: string; fine: string }[]>([]);
  const [daGoogle, setDaGoogle] = useState(false);
  const [avvisoCal, setAvvisoCal] = useState<string | null>(null);
  const [caricoOrari, setCaricoOrari] = useState(false);
  const [adesso, setAdesso] = useState(0);
  const [invitaAzienda, setInvitaAzienda] = useState(true);
  const [esitoSalvataggio, setEsitoSalvataggio] = useState<{ ok: boolean; t: string } | null>(null);

  const resetForm = () => {
    setEsito(null);
    setNote("");
    setMotivo("");
    setRichiamoData("");
    setRichiamoOra("");
    setAppData("");
    setAppOra("");
    setDurata(60);
    setModalita("presenza");
    setReferenteApp("");
    setNoteIncaricato("");
    setImpegni([]);
    setAvvisoCal(null);
    setInvitaAzienda(true);
  };

  const aggiornaContorno = useCallback(async () => {
    const [s, c] = await Promise.all([
      supabase.rpc("stato_coda", { p_campagna: campagnaId }),
      supabase.rpc("anteprima_coda", { p_campagna: campagnaId, p_limite: 5 }),
    ]);
    if (s.data) setStatoCoda(s.data as StatoCoda);
    if (c.data) setInCoda(c.data as InCoda[]);
  }, [campagnaId, supabase]);

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(null);
    try {
      const { data: id, error } = await supabase.rpc("prossima_azienda", { p_campagna: campagnaId });
      if (error) throw error;
      if (!id) {
        setCorrente(null);
        setReferenti([]);
        setStorico([]);
        await aggiornaContorno();
        return;
      }
      const { data: ca, error: e2 } = await supabase
        .from("campagna_aziende")
        .select("id, stato, tentativi, prossimo_richiamo, ultimo_esito, azienda:aziende(*)")
        .eq("id", id)
        .single();
      if (e2) throw e2;
      const c = ca as unknown as Corrente;
      setCorrente(c);

      const [r, ch, ap] = await Promise.all([
        supabase.from("referenti").select("id, nome, ruolo, telefono, email").eq("azienda_id", c.azienda.id).eq("attivo", true).order("created_at"),
        supabase
          .from("chiamate")
          .select("esito, note, motivo, created_at, campagna:campagne(comune, edizione), operatore:profili(nome)")
          .eq("azienda_id", c.azienda.id)
          .order("created_at", { ascending: false })
          .limit(15),
        supabase
          .from("appuntamenti")
          .select("inizio, esito_incontro, esito_contratto, campagna:campagne(comune, edizione), incaricato:profili!appuntamenti_incaricato_id_fkey(nome)")
          .eq("azienda_id", c.azienda.id)
          .order("inizio", { ascending: false })
          .limit(10),
      ]);
      setReferenti((r.data ?? []) as Referente[]);
      type Ch = { esito: EsitoChiamata; note: string | null; motivo: string | null; created_at: string; campagna: { comune: string; edizione: string } | null; operatore: { nome: string } | null };
      type Ap = { inizio: string; esito_incontro: string | null; esito_contratto: keyof typeof ESITO_CONTRATTO_LABEL | null; campagna: { comune: string; edizione: string } | null; incaricato: { nome: string } | null };
      const righe: Storico[] = [
        ...((ch.data ?? []) as unknown as Ch[]).map((x) => ({
          quando: x.created_at,
          campagna: x.campagna ? `${x.campagna.comune} ${x.campagna.edizione}` : "",
          testo: ESITO_LABEL[x.esito] + (x.motivo ? ` · ${x.motivo}` : "") + (x.note ? ` — “${x.note}”` : ""),
          chi: x.operatore?.nome ?? "",
        })),
        ...((ap.data ?? []) as unknown as Ap[]).map((x) => ({
          quando: x.inizio,
          campagna: x.campagna ? `${x.campagna.comune} ${x.campagna.edizione}` : "",
          testo:
            "Incontro" +
            (x.esito_incontro ? ` ${x.esito_incontro.replace("_", " ")}` : " fissato") +
            (x.esito_contratto ? ` · contratto: ${ESITO_CONTRATTO_LABEL[x.esito_contratto].toLowerCase()}` : ""),
          chi: x.incaricato?.nome ?? "",
        })),
      ].sort((a, b) => b.quando.localeCompare(a.quando));
      setStorico(righe);
      await aggiornaContorno();
    } catch (e) {
      setErrore(messaggioErrore(e));
    } finally {
      setCaricamento(false);
    }
  }, [campagnaId, supabase, aggiornaContorno]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    carica();
  }, [carica]);

  // orari occupati dell'incaricato nel giorno scelto (Google Calendar + CRM)
  useEffect(() => {
    if (esito !== "appuntamento" || !incaricato || !appData) return;
    let attivo = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCaricoOrari(true);
    disponibilita(incaricato, appData)
      .then((r) => {
        if (!attivo) return;
        setAdesso(Date.now());
        setImpegni(r.occupato);
        setDaGoogle(r.google);
        setAvvisoCal(r.avviso ?? null);
      })
      .catch((e) => attivo && setAvvisoCal(messaggioErrore(e)))
      .finally(() => attivo && setCaricoOrari(false));
    return () => {
      attivo = false;
    };
  }, [esito, incaricato, appData]);

  // orari di partenza liberi, ogni 30 minuti dalle 8:30 alle 18:00
  const orariLiberi = (() => {
    if (!appData) return [] as string[];
    const out: string[] = [];
    for (let m = 8 * 60 + 30; m <= 18 * 60; m += 30) {
      const hhmm = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const i = new Date(isoDaLocale(appData, hhmm)).getTime();
      const f = i + durata * 60000;
      if (i < adesso + 30 * 60000) continue;
      const libero = !impegni.some((x) => new Date(x.inizio).getTime() < f && new Date(x.fine).getTime() > i);
      if (libero) out.push(hhmm);
    }
    return out;
  })();

  const infoEsito = ESITI.find((e) => e.value === esito);

  async function salva() {
    if (!corrente || !esito) return;
    setErrore(null);

    let richiamo: string | null = null;
    if (richiamoData) richiamo = isoDaLocale(richiamoData, richiamoOra || "09:00");
    if (infoEsito?.serveData && !richiamo) return setErrore("Indica quando richiamare.");
    if (infoEsito?.serveMotivo && !motivo) return setErrore("Scegli il motivo.");

    let app: Record<string, string> | null = null;
    if (esito === "appuntamento") {
      if (!incaricato || !appData || !appOra) return setErrore("Scegli incaricato, giorno e ora dell'appuntamento.");
      const inizio = isoDaLocale(appData, appOra);
      const fine = new Date(new Date(inizio).getTime() + durata * 60000).toISOString();
      app = { incaricato_id: incaricato, inizio, fine, modalita, referente_id: referenteApp, note: noteIncaricato };
    }

    setSalvataggio(true);
    setEsitoSalvataggio(null);
    const { data: chiamataId, error } = await supabase.rpc("registra_chiamata", {
      p_ca: corrente.id,
      p_esito: esito,
      p_note: note,
      p_motivo: motivo,
      p_richiamo: richiamo,
      p_app: app,
    });
    if (error) {
      setSalvataggio(false);
      return setErrore(error.message);
    }
    if (esito === "appuntamento") {
      const r = await inviaAlCalendario({ chiamataId: chiamataId as string, invitaAzienda });
      setEsitoSalvataggio({ ok: r.ok, t: r.ok ? `Appuntamento fissato. ${r.messaggio}` : r.messaggio });
    }
    setSalvataggio(false);
    resetForm();
    carica();
  }

  async function salta() {
    if (!corrente) return;
    await supabase.rpc("salta_azienda", { p_ca: corrente.id });
    resetForm();
    carica();
  }

  const a = corrente?.azienda;

  return (
    <div className="flex flex-col gap-5">
      {/* intestazione */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-64">
          <label htmlFor="campagna" className="k">Campagna attiva</label>
          <select
            id="campagna"
            className="!text-lg !font-semibold"
            value={campagnaId}
            onChange={(e) => router.push(`/coda?c=${e.target.value}`)}
          >
            {campagne.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>
        {statoCoda && (
          <div className="flex gap-6 text-sm text-text-secondary">
            <div><strong className="block text-xl text-foreground">{numero(statoCoda.chiamate_oggi)}</strong>tue chiamate oggi</div>
            <div><strong className="block text-xl text-foreground">{numero(statoCoda.appuntamenti_oggi)}</strong>appuntamenti oggi</div>
            <div><strong className="block text-xl text-foreground">{numero(statoCoda.lavorate)} / {numero(statoCoda.totale)}</strong>lista lavorata</div>
          </div>
        )}
      </div>

      {errore && <div className="avviso avviso-err">{errore}</div>}
      {esitoSalvataggio && (
        <div className={`avviso ${esitoSalvataggio.ok ? "avviso-ok" : "avviso-warn"} flex justify-between gap-3`}>
          <span>{esitoSalvataggio.t}</span>
          <button className="text-sm underline" onClick={() => setEsitoSalvataggio(null)}>Chiudi</button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* azienda corrente */}
        <section className="card p-5 md:p-6 lg:col-span-2 flex flex-col gap-5 min-w-0">
          {caricamento && <p className="text-text-secondary">Carico la prossima azienda…</p>}

          {!caricamento && !corrente && (
            <div className="flex flex-col gap-2">
              <h1 className="text-xl font-semibold">Coda finita per ora</h1>
              <p className="text-sm text-text-secondary">
                Non ci sono aziende da chiamare adesso. Quelle da ritentare o da richiamare torneranno in coda all&apos;orario previsto.
              </p>
              <button className="btn self-start" onClick={carica}>Ricontrolla</button>
            </div>
          )}

          {!caricamento && corrente && a && (
            <>
              <div className="flex flex-wrap justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    {corrente.stato === "richiamare" && (
                      <span className="tag tag-warn">Richiamo fissato · {dataOra(corrente.prossimo_richiamo)}</span>
                    )}
                    {corrente.tentativi > 0 && <span className="tag">{corrente.tentativi + 1}° tentativo</span>}
                    {corrente.ultimo_esito && <span className="tag">Ultimo esito: {ESITO_LABEL[corrente.ultimo_esito]}</span>}
                  </div>
                  <h1 className="text-2xl font-semibold mt-2 break-words">{a.ragione_sociale}</h1>
                  <div className="text-sm text-text-secondary">
                    {[a.comune && `${a.comune}${a.provincia ? ` (${a.provincia})` : ""}`, a.settore, a.dipendenti && `${a.dipendenti} dipendenti`, a.piva && `P.IVA ${a.piva}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <Link href={`/aziende/${a.id}`} target="_blank" className="text-sm self-start text-accent-text">
                  Apri scheda completa ↗
                </Link>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-surface-muted p-4">
                  <div className="k">Telefono</div>
                  {a.telefono ? (
                    <a href={`tel:${a.telefono}`} className="text-2xl font-semibold tracking-wide text-foreground no-underline">{a.telefono}</a>
                  ) : (
                    <div className="text-text-secondary">Nessun numero</div>
                  )}
                  {(a.email || a.sito) && (
                    <div className="text-sm text-text-secondary mt-1 break-all">{[a.email, a.sito].filter(Boolean).join(" · ")}</div>
                  )}
                </div>
                <div className="rounded-xl bg-surface-muted p-4">
                  <div className="k">Referenti</div>
                  {referenti.length === 0 && <div className="text-sm text-text-secondary">Nessun referente salvato</div>}
                  {referenti.map((r) => (
                    <div key={r.id} className="text-sm">
                      <strong>{r.nome}</strong>{r.ruolo ? ` · ${r.ruolo}` : ""}
                      {(r.telefono || r.email) && <div className="text-text-secondary break-all">{[r.telefono, r.email].filter(Boolean).join(" · ")}</div>}
                    </div>
                  ))}
                </div>
              </div>
              {a.note && <div className="avviso avviso-warn">Nota sull&apos;azienda: {a.note}</div>}

              {/* esiti */}
              <div>
                <div className="label">Esito chiamata</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                  {ESITI.map((e) => {
                    const sel = esito === e.value;
                    return (
                      <button
                        key={e.value}
                        type="button"
                        aria-pressed={sel}
                        onClick={() => setEsito(e.value)}
                        className={`btn !justify-start text-left ${
                          sel ? "btn-primary" : e.tono === "pericolo" ? "btn-danger" : e.tono === "primario" ? "!border-accent-text !text-accent-text font-semibold" : ""
                        }`}
                      >
                        {e.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* dettagli in base all'esito */}
              {(infoEsito?.serveData || infoEsito?.dataFacoltativa) && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="rd">Richiamare il {infoEsito?.dataFacoltativa && <span className="font-normal text-text-secondary">(facoltativo{esito === "mail_inviata" ? ", altrimenti tra 7 giorni" : ""})</span>}</label>
                    <input id="rd" type="date" min={oggiStr()} value={richiamoData} onChange={(e) => setRichiamoData(e.target.value)} />
                  </div>
                  <div>
                    <label className="label" htmlFor="ro">Ora</label>
                    <input id="ro" type="time" value={richiamoOra} onChange={(e) => setRichiamoOra(e.target.value)} />
                  </div>
                </div>
              )}
              {infoEsito?.serveMotivo && (
                <div>
                  <label className="label" htmlFor="mot">Motivo</label>
                  <select id="mot" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                    <option value="">Scegli…</option>
                    {MOTIVI_NON_INTERESSATO.map((m) => <option key={m}>{m}</option>)}
                  </select>
                </div>
              )}
              {esito === "da_non_chiamare" && (
                <div className="avviso avviso-warn">L&apos;azienda verrà esclusa da tutte le campagne, anche future.</div>
              )}

              {esito === "appuntamento" && (
                <div className="rounded-xl border border-accent/40 bg-accent-bg/40 p-4 flex flex-col gap-3">
                  <div className="font-semibold">Dati dell&apos;appuntamento</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label" htmlFor="inc">Incaricato</label>
                      <select id="inc" value={incaricato} onChange={(e) => setIncaricato(e.target.value)}>
                        <option value="">Scegli…</option>
                        {incaricati.map((i) => (
                          <option key={i.id} value={i.id}>{i.nome}{i.zona ? ` · ${i.zona}` : ""}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="mod">Modalità</label>
                      <select id="mod" value={modalita} onChange={(e) => setModalita(e.target.value)}>
                        <option value="presenza">In presenza (sede azienda)</option>
                        <option value="video">Videochiamata</option>
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="ad">Giorno</label>
                      <input id="ad" type="date" min={oggiStr()} value={appData} onChange={(e) => setAppData(e.target.value)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label" htmlFor="ao">Ora</label>
                        <input id="ao" type="time" step={900} value={appOra} onChange={(e) => setAppOra(e.target.value)} />
                      </div>
                      <div>
                        <label className="label" htmlFor="du">Durata</label>
                        <select id="du" value={durata} onChange={(e) => setDurata(Number(e.target.value))}>
                          <option value={30}>30 min</option>
                          <option value={60}>1 ora</option>
                          <option value={90}>1 ora e ½</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="label" htmlFor="ref">Con chi</label>
                      <select id="ref" value={referenteApp} onChange={(e) => setReferenteApp(e.target.value)}>
                        <option value="">—</option>
                        {referenti.map((r) => <option key={r.id} value={r.id}>{r.nome}{r.ruolo ? ` · ${r.ruolo}` : ""}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label" htmlFor="ni">Note per l&apos;incaricato</label>
                      <input id="ni" value={noteIncaricato} onChange={(e) => setNoteIncaricato(e.target.value)} />
                    </div>
                  </div>
                  {incaricato && appData && (
                    <div className="flex flex-col gap-2">
                      <div className="text-sm font-semibold">
                        Orari liberi{daGoogle ? " (dal Google Calendar dell'incaricato)" : ""}
                      </div>
                      {caricoOrari ? (
                        <p className="text-sm text-text-secondary">Controllo il calendario…</p>
                      ) : orariLiberi.length === 0 ? (
                        <p className="text-sm text-text-secondary">Nessun orario libero in questo giorno: prova un altro giorno o scrivi l&apos;ora a mano.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {orariLiberi.map((o) => (
                            <button key={o} type="button" aria-pressed={appOra === o} onClick={() => setAppOra(o)} className={`btn btn-sm ${appOra === o ? "btn-primary" : ""}`}>{o}</button>
                          ))}
                        </div>
                      )}
                      {impegni.length > 0 && (
                        <p className="text-xs text-text-secondary">Occupato: {impegni.map((i) => `${ora(i.inizio)}–${ora(i.fine)}`).join(", ")}</p>
                      )}
                      {avvisoCal && <div className="avviso avviso-warn text-sm">Calendario non leggibile: {avvisoCal}. Vedi solo gli appuntamenti del CRM.</div>}
                    </div>
                  )}
                  {(referenti.find((r) => r.id === referenteApp)?.email || corrente?.azienda.email) && (
                    <label className="flex gap-2 items-start text-sm">
                      <input type="checkbox" checked={invitaAzienda} onChange={(e) => setInvitaAzienda(e.target.checked)} />
                      <span>Manda l&apos;invito anche a {referenti.find((r) => r.id === referenteApp)?.email || corrente?.azienda.email}</span>
                    </label>
                  )}
                </div>
              )}

              <div>
                <label className="label" htmlFor="note">Note della chiamata</label>
                <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Cosa ti hanno detto, chi hai sentito…" />
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button className="btn" onClick={salta} disabled={salvataggio}>Salta (ritorna tra un&apos;ora)</button>
                <button className="btn btn-dark" onClick={salva} disabled={!esito || salvataggio}>
                  {salvataggio ? "Salvo…" : "Salva e passa alla prossima"}
                </button>
              </div>
            </>
          )}
        </section>

        {/* colonna destra */}
        <div className="flex flex-col gap-5 min-w-0">
          <section className="card p-5">
            <h2 className="font-semibold mb-3 text-[15px]">Storico con questa azienda</h2>
            {storico.length === 0 && <p className="text-sm text-text-secondary">Nessun contatto precedente.</p>}
            <ol className="flex flex-col gap-3 text-sm">
              {storico.map((s, i) => (
                <li key={i}>
                  <div className="text-xs text-text-secondary">{giornoOra(s.quando)} · {s.campagna}{s.chi ? ` · ${s.chi}` : ""}</div>
                  <div>{s.testo}</div>
                </li>
              ))}
            </ol>
          </section>
          <section className="card p-5">
            <h2 className="font-semibold mb-3 text-[15px]">Prossime in coda</h2>
            {inCoda.length === 0 && <p className="text-sm text-text-secondary">—</p>}
            <ol className="list-decimal pl-5 flex flex-col gap-2 text-sm">
              {inCoda.map((x) => (
                <li key={x.azienda_id}>
                  {x.ragione_sociale}{" "}
                  {x.stato === "richiamare" ? (
                    <span className="tag tag-warn">richiamo {giornoOra(x.prossimo_richiamo)}</span>
                  ) : x.tentativi === 0 ? (
                    <span className="tag">nuova</span>
                  ) : (
                    <span className="tag">{x.tentativi + 1}° tentativo</span>
                  )}
                </li>
              ))}
            </ol>
            <p className="text-xs text-text-secondary mt-3">Ordine: richiami fissati → aziende nuove → ritentativi.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
