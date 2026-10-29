"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CAMPI_IMPORT, analizza, leggiFile, pulisciRiga, type Analisi } from "@/lib/leggiFile";
import { messaggioErrore, numero } from "@/lib/format";

type Riepilogo = {
  nuove: number; aggiornate: number; doppioni: number; non_chiamare: number; scartate: number; in_campagna: number;
  elenco_doppioni: { nel_file: string; telefono: string; gia_presente: string; azienda_id: string }[];
};
type Campagna = { id: string; nome: string; comune: string };

const VUOTO: Riepilogo = { nuove: 0, aggiornate: 0, doppioni: 0, non_chiamare: 0, scartate: 0, in_campagna: 0, elenco_doppioni: [] };
const LOTTO = 500;
const PILOTA = 200;
const SOGLIA_PILOTA = 500; // sotto questa soglia si importa tutto il file

const somma = (a: Riepilogo, b: Riepilogo): Riepilogo => ({
  nuove: a.nuove + b.nuove, aggiornate: a.aggiornate + b.aggiornate, doppioni: a.doppioni + b.doppioni,
  non_chiamare: a.non_chiamare + b.non_chiamare, scartate: a.scartate + b.scartate, in_campagna: a.in_campagna + b.in_campagna,
  elenco_doppioni: [...a.elenco_doppioni, ...b.elenco_doppioni].slice(0, 300),
});
const chiaveMappa = (t: string[]) => `wc-mappatura-v2:${t.join("|")}`;
const etichetta = (k: string) => CAMPI_IMPORT.find((c) => c.k === k)?.label ?? k;

export default function ImportClient({ campagne, campagnaIniziale }: { campagne: Campagna[]; campagnaIniziale: string }) {
  const [supabase] = useState(() => createClient());
  const [inputKey, setInputKey] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [an, setAn] = useState<Analisi | null>(null);
  const [mappa, setMappa] = useState<string[]>([]);
  const [campagna, setCampagna] = useState(campagnaIniziale);
  const [comune, setComune] = useState(campagne.find((c) => c.id === campagnaIniziale)?.comune ?? "");
  const [pilota, setPilota] = useState(false);
  const [includiDoppioni, setIncludiDoppioni] = useState(false);
  const [anteprima, setAnteprima] = useState<Riepilogo | null>(null);
  const [risultato, setRisultato] = useState<Riepilogo | null>(null);
  const [avanzamento, setAvanzamento] = useState<{ fatti: number; tot: number } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const righe = (a: Analisi | null, m: string[], com: string, pil: boolean) =>
    a ? (pil ? a.dati.slice(0, PILOTA) : a.dati).map((r) => pulisciRiga(r, m, com.trim())).filter((r) => r.ragione_sociale) : [];

  async function esegui(prova: boolean, opz?: { a?: Analisi; m?: string[]; com?: string; pil?: boolean; camp?: string; dop?: boolean }) {
    const a = opz?.a ?? an;
    const m = opz?.m ?? mappa;
    const com = opz?.com ?? comune;
    const pil = opz?.pil ?? pilota;
    const camp = opz?.camp ?? campagna;
    const dop = opz?.dop ?? includiDoppioni;
    if (!a) return;
    if (!m.includes("ragione_sociale")) { setAnteprima(null); return setErrore("Non trovo la colonna con il nome dell'azienda: indicala in “Modifica abbinamento”."); }
    setErrore(null);
    setBusy(true);
    try {
      const dati = righe(a, m, com, pil);
      let fonteId: string | null = null;
      if (!prova) {
        const { data, error } = await supabase.rpc("crea_fonte", { p_nome: file?.name.replace(/\.(xlsx|csv|txt)$/i, "") || "Import" });
        if (error) throw error;
        fonteId = data as string;
      }
      let tot = VUOTO;
      if (!prova) setAvanzamento({ fatti: 0, tot: dati.length });
      for (let i = 0; i < dati.length; i += LOTTO) {
        const { data, error } = await supabase.rpc("importa_aziende", {
          p_righe: dati.slice(i, i + LOTTO), p_fonte: fonteId, p_campagna: camp || null, p_anteprima: prova, p_includi_doppioni: dop,
        });
        if (error) throw error;
        tot = somma(tot, data as Riepilogo);
        if (!prova) setAvanzamento({ fatti: Math.min(i + LOTTO, dati.length), tot: dati.length });
      }
      if (prova) setAnteprima(tot);
      else {
        setRisultato(tot);
        setAnteprima(null);
        const nomeC = campagne.find((c) => c.id === camp)?.nome;
        await supabase.rpc("registra_attivita", {
          p_azione: `ha importato “${file?.name}”: ${tot.nuove} nuove, ${tot.aggiornate} già presenti${nomeC ? `, in ${nomeC}` : ""}`,
        });
      }
    } catch (e) {
      setErrore(messaggioErrore(e));
    } finally {
      setBusy(false);
      setAvanzamento(null);
    }
  }

  async function scegliFile(f: File | null) {
    setErrore(null); setAnteprima(null); setRisultato(null); setAn(null);
    setFile(f);
    if (!f) return;
    setBusy(true);
    try {
      const a = analizza((await leggiFile(f)).righe);
      let m = a.mappa;
      try {
        const salvata = localStorage.getItem(chiaveMappa(a.titoli));
        if (salvata) { const s = JSON.parse(salvata) as string[]; if (s.length === m.length) m = s; }
      } catch { /* niente */ }
      if (a.dati.length === 0) throw new Error("Non ho trovato righe con il nome di un'azienda.");
      const pil = a.dati.length > SOGLIA_PILOTA;
      setAn(a); setMappa(m); setPilota(pil);
      setBusy(false);
      await esegui(true, { a, m, pil });
    } catch (e) {
      setErrore(messaggioErrore(e));
      setBusy(false);
    }
  }

  function cambiaMappa(i: number, v: string) {
    const m = [...mappa];
    if (v && v !== "note") m.forEach((x, j) => { if (x === v) m[j] = ""; }); // un campo per colonna (tranne note)
    m[i] = v;
    setMappa(m);
    try { if (an) localStorage.setItem(chiaveMappa(an.titoli), JSON.stringify(m)); } catch { /* niente */ }
    esegui(true, { m });
  }

  function cambiaCampagna(id: string) {
    setCampagna(id);
    const c = campagne.find((x) => x.id === id);
    const com = c?.comune ?? comune;
    if (c) setComune(com);
    esegui(true, { camp: id, com });
  }

  function ricomincia() {
    setFile(null); setAn(null); setMappa([]); setAnteprima(null); setRisultato(null); setErrore(null);
    setInputKey((k) => k + 1);
  }

  const esempio = an ? righe(an, mappa, comune, false).slice(0, 8) : [];
  const quante = an ? (pilota ? Math.min(PILOTA, an.dati.length) : an.dati.length) : 0;
  const nomeCampagna = campagne.find((c) => c.id === campagna)?.nome;

  return (
    <div className="flex flex-col gap-5 max-w-6xl">
      <div>
        <Link href="/campagne" className="text-sm">← Campagne</Link>
        <h1 className="text-2xl font-semibold mt-1">Importa lista</h1>
        <p className="text-sm text-text-secondary">Qualsiasi foglio Excel o CSV: titoli, legende e colonne in più vengono riconosciuti da soli.</p>
      </div>

      <section className="card p-5 grid gap-4 md:grid-cols-3 items-end">
        <div>
          <label className="label" htmlFor="camp">Campagna</label>
          <select id="camp" value={campagna} disabled={busy} onChange={(e) => cambiaCampagna(e.target.value)}>
            <option value="">— solo in archivio —</option>
            {campagne.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="com">Comune per le aziende senza comune</label>
          <input id="com" value={comune} disabled={busy} onChange={(e) => setComune(e.target.value)} onBlur={() => an && esegui(true)} placeholder="es. Tarcento" />
        </div>
        <div>
          <label className="label" htmlFor="file">File</label>
          <input key={inputKey} id="file" type="file" accept=".xlsx,.csv,.txt" disabled={busy} onChange={(e) => scegliFile(e.target.files?.[0] ?? null)} />
        </div>
      </section>

      {errore && <div className="avviso avviso-err">{errore}</div>}
      {busy && !an && <p className="text-text-secondary">Leggo il file…</p>}

      {an && !risultato && (
        <>
          <section className="card p-5 flex flex-col gap-3">
            <div className="flex flex-wrap justify-between gap-3 items-baseline">
              <h2 className="font-semibold text-lg">Ho trovato {numero(an.dati.length)} aziende</h2>
              <span className="text-sm text-text-secondary">
                {an.rigaTitoli >= 0 ? `Titoli alla riga ${an.rigaTitoli + 1} del foglio (dati senza righe vuote)` : "Il file non ha titoli: colonne riconosciute dal contenuto"}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[...new Set(mappa.filter(Boolean))].map((k) => <span key={k} className="tag tag-blue">{etichetta(k)}</span>)}
            </div>
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="tabella">
                <thead><tr><th>Azienda</th><th>Telefono</th><th>Referente</th><th>Indirizzo · Comune</th><th>Note</th></tr></thead>
                <tbody>
                  {esempio.map((r, i) => (
                    <tr key={i}>
                      <td className="font-medium">{r.ragione_sociale}</td>
                      <td className="whitespace-nowrap">{r.telefono ?? <span className="text-text-muted">—</span>}</td>
                      <td>{r.referente_nome ?? "—"}{r.referente_ruolo ? <span className="text-text-secondary"> · {r.referente_ruolo}</span> : null}</td>
                      <td>{[r.indirizzo, r.comune].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="text-text-secondary max-w-72 truncate" title={r.note}>{[r.email, r.note].filter(Boolean).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-text-secondary">Prime {esempio.length} righe, come entreranno nel CRM. Le colonne non riconosciute ma con testo finiscono nelle note dell&apos;azienda.</p>

            <details className="text-sm">
              <summary className="cursor-pointer text-accent-text">Modifica abbinamento delle colonne</summary>
              <div className="overflow-x-auto mt-2">
                <table className="tabella">
                  <thead><tr><th>Colonna nel file</th><th>Esempio</th><th>Diventa</th></tr></thead>
                  <tbody>
                    {an.titoli.map((t, i) => (
                      <tr key={i}>
                        <td>{t}</td>
                        <td className="text-text-secondary max-w-56 truncate">{an.dati.find((r) => r[i])?.[i] ?? "—"}</td>
                        <td className="min-w-52">
                          <label className="sr-only" htmlFor={`m-${i}`}>Campo per {t}</label>
                          <select id={`m-${i}`} value={mappa[i] ?? ""} disabled={busy} onChange={(e) => cambiaMappa(i, e.target.value)}>
                            <option value="">Non importare</option>
                            {CAMPI_IMPORT.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-text-secondary mt-2">Le tue correzioni vengono ricordate per i file con le stesse colonne.</p>
              </div>
            </details>
          </section>

          <section className="card p-5 flex flex-col gap-4">
            <h2 className="font-semibold">Controllo con l&apos;archivio</h2>
            {busy && !avanzamento && <p className="text-sm text-text-secondary">Controllo i doppioni…</p>}
            {anteprima && !busy && <Riassunto r={anteprima} finale={false} campagna={nomeCampagna} />}
            {an.dati.length > SOGLIA_PILOTA && (
              <fieldset className="flex flex-wrap gap-4 text-sm">
                <legend className="sr-only">Quanto importare</legend>
                <label className="flex gap-2"><input type="radio" name="q" checked={pilota} disabled={busy} onChange={() => { setPilota(true); esegui(true, { pil: true }); }} /> Prova pilota: prime {PILOTA}</label>
                <label className="flex gap-2"><input type="radio" name="q" checked={!pilota} disabled={busy} onChange={() => { setPilota(false); esegui(true, { pil: false }); }} /> Tutto il file ({numero(an.dati.length)})</label>
              </fieldset>
            )}
            {(anteprima?.doppioni ?? 0) > 0 && (
              <label className="flex gap-2 text-sm items-start">
                <input type="checkbox" checked={includiDoppioni} disabled={busy} onChange={(e) => { setIncludiDoppioni(e.target.checked); esegui(true, { dop: e.target.checked }); }} />
                Importa comunque i possibili doppioni (stesso telefono e nome simile ad aziende già presenti)
              </label>
            )}
            {avanzamento && (
              <div>
                <div className="h-2 rounded-full bg-surface-muted overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(avanzamento.fatti / Math.max(1, avanzamento.tot)) * 100}%` }} /></div>
                <div className="text-xs text-text-secondary mt-1">Importo… {numero(avanzamento.fatti)} / {numero(avanzamento.tot)}</div>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button className="btn btn-primary" disabled={busy || !anteprima || anteprima.nuove + anteprima.aggiornate === 0} onClick={() => esegui(false)}>
                Importa {numero(quante)} righe{nomeCampagna ? ` in ${nomeCampagna}` : ""}
              </button>
              <button className="btn" disabled={busy} onClick={ricomincia}>Annulla</button>
            </div>
          </section>
        </>
      )}

      {risultato && (
        <section className="card p-5 flex flex-col gap-4">
          <Riassunto r={risultato} finale campagna={nomeCampagna} />
          <div className="flex gap-2 flex-wrap">
            {campagna && <Link className="btn btn-primary" href={`/campagne/${campagna}`}>Apri la campagna</Link>}
            {pilota && an && an.dati.length > PILOTA && (
              <button className="btn" onClick={() => { setRisultato(null); setPilota(false); esegui(true, { pil: false }); }}>Importa il resto del file</button>
            )}
            <button className="btn" onClick={ricomincia}>Importa un altro file</button>
          </div>
        </section>
      )}
    </div>
  );
}

function Riassunto({ r, finale, campagna }: { r: Riepilogo; finale: boolean; campagna?: string }) {
  return (
    <div className={`rounded-lg p-4 text-sm ${finale ? "bg-accent-bg text-accent-text" : "bg-surface-muted"}`}>
      <div className="font-semibold mb-1.5">{finale ? "Import completato" : "Cosa succederà"}</div>
      <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
        <li>Aziende nuove: <strong>{numero(r.nuove)}</strong></li>
        <li>Già in archivio (completate): <strong>{numero(r.aggiornate)}</strong></li>
        {campagna && <li>Aggiunte a {campagna}: <strong>{numero(r.in_campagna)}</strong></li>}
        {r.doppioni > 0 && <li>Possibili doppioni saltati: <strong>{numero(r.doppioni)}</strong></li>}
        {r.non_chiamare > 0 && <li>Su lista “da non chiamare”: <strong>{numero(r.non_chiamare)}</strong></li>}
      </ul>
      {r.elenco_doppioni.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer">Vedi i possibili doppioni</summary>
          <ul className="mt-1 flex flex-col gap-1 max-h-60 overflow-auto">
            {r.elenco_doppioni.map((d, i) => (
              <li key={i}>“{d.nel_file}” ({d.telefono}) → già presente come <Link href={`/aziende/${d.azienda_id}`} target="_blank">{d.gia_presente}</Link></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
