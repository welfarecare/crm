"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CAMPI_IMPORT, indovinaMappatura, leggiFile, type Tabella } from "@/lib/leggiFile";
import { messaggioErrore, numero } from "@/lib/format";

type Riepilogo = {
  nuove: number; aggiornate: number; doppioni: number; non_chiamare: number; scartate: number; in_campagna: number;
  elenco_doppioni: { nel_file: string; telefono: string; gia_presente: string; azienda_id: string }[];
};
const VUOTO: Riepilogo = { nuove: 0, aggiornate: 0, doppioni: 0, non_chiamare: 0, scartate: 0, in_campagna: 0, elenco_doppioni: [] };
const LOTTO = 500;
const PILOTA = 200;

function somma(a: Riepilogo, b: Riepilogo): Riepilogo {
  return {
    nuove: a.nuove + b.nuove, aggiornate: a.aggiornate + b.aggiornate, doppioni: a.doppioni + b.doppioni,
    non_chiamare: a.non_chiamare + b.non_chiamare, scartate: a.scartate + b.scartate, in_campagna: a.in_campagna + b.in_campagna,
    elenco_doppioni: [...a.elenco_doppioni, ...b.elenco_doppioni].slice(0, 300),
  };
}

const chiaveMappa = (h: string[]) => `wc-mappatura:${h.join("|")}`;

export default function ImportClient({ campagne, campagnaIniziale }: { campagne: { id: string; nome: string }[]; campagnaIniziale: string }) {
  const [supabase] = useState(() => createClient());
  const [file, setFile] = useState<File | null>(null);
  const [tab, setTab] = useState<Tabella | null>(null);
  const [mappa, setMappa] = useState<string[]>([]);
  const [fonte, setFonte] = useState("");
  const [campagna, setCampagna] = useState(campagnaIniziale);
  const [pilota, setPilota] = useState(true);
  const [includiDoppioni, setIncludiDoppioni] = useState(false);
  const [anteprima, setAnteprima] = useState<Riepilogo | null>(null);
  const [risultato, setRisultato] = useState<Riepilogo | null>(null);
  const [avanzamento, setAvanzamento] = useState<{ fatti: number; tot: number } | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function scegliFile(f: File | null) {
    setErrore(null); setAnteprima(null); setRisultato(null); setTab(null);
    setFile(f);
    if (!f) return;
    try {
      setBusy(true);
      const t = await leggiFile(f);
      setTab(t);
      let m = indovinaMappatura(t.intestazioni);
      try {
        const salvata = localStorage.getItem(chiaveMappa(t.intestazioni));
        if (salvata) m = JSON.parse(salvata);
      } catch { /* niente */ }
      setMappa(m);
      setFonte(f.name.replace(/\.(xlsx|csv|txt)$/i, ""));
    } catch (e) {
      setErrore(messaggioErrore(e));
    } finally {
      setBusy(false);
    }
  }

  function righeDaInviare(): Record<string, string>[] {
    if (!tab) return [];
    const sorgente = pilota ? tab.righe.slice(0, PILOTA) : tab.righe;
    return sorgente.map((r) => {
      const o: Record<string, string> = {};
      mappa.forEach((campo, i) => {
        if (!campo) return;
        const v = (r[i] ?? "").trim();
        if (v) o[campo] = o[campo] ? `${o[campo]} ${v}` : v;
      });
      return o;
    });
  }

  async function esegui(prova: boolean) {
    if (!tab) return;
    if (!mappa.includes("ragione_sociale")) return setErrore("Abbina almeno la colonna della ragione sociale.");
    setErrore(null); setBusy(true);
    try {
      localStorage.setItem(chiaveMappa(tab.intestazioni), JSON.stringify(mappa));
    } catch { /* niente */ }
    try {
      const righe = righeDaInviare();
      let fonteId: string | null = null;
      if (!prova) {
        const { data, error } = await supabase.rpc("crea_fonte", { p_nome: fonte.trim() || file?.name || "Import" });
        if (error) throw error;
        fonteId = data as string;
      }
      let tot = VUOTO;
      setAvanzamento({ fatti: 0, tot: righe.length });
      for (let i = 0; i < righe.length; i += LOTTO) {
        const { data, error } = await supabase.rpc("importa_aziende", {
          p_righe: righe.slice(i, i + LOTTO),
          p_fonte: fonteId,
          p_campagna: campagna || null,
          p_anteprima: prova,
          p_includi_doppioni: includiDoppioni,
        });
        if (error) throw error;
        tot = somma(tot, data as Riepilogo);
        setAvanzamento({ fatti: Math.min(i + LOTTO, righe.length), tot: righe.length });
      }
      if (prova) setAnteprima(tot);
      else {
        setRisultato(tot);
        setAnteprima(null);
        const nomeC = campagne.find((c) => c.id === campagna)?.nome;
        await supabase.rpc("registra_attivita", {
          p_azione: `ha importato ${righe.length} righe da “${file?.name}” (${tot.nuove} nuove, ${tot.aggiornate} aggiornate${nomeC ? `, in ${nomeC}` : ""})`,
        });
      }
    } catch (e) {
      setErrore(messaggioErrore(e));
    } finally {
      setBusy(false);
      setAvanzamento(null);
    }
  }

  const resetRisultati = () => { setAnteprima(null); setRisultato(null); };
  const quante = tab ? (pilota ? Math.min(PILOTA, tab.righe.length) : tab.righe.length) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/campagne" className="text-sm">← Campagne</Link>
        <h1 className="text-2xl font-semibold mt-1">Importa lista</h1>
        <p className="text-sm text-text-secondary">File Excel (.xlsx) o CSV. Le aziende già in archivio (stessa P.IVA) vengono completate, non duplicate.</p>
      </div>

      <section className="card p-5 flex flex-col gap-3">
        <label className="label" htmlFor="file">1 · Scegli il file</label>
        <input id="file" type="file" accept=".xlsx,.csv,.txt" onChange={(e) => scegliFile(e.target.files?.[0] ?? null)} />
        {tab && <p className="text-sm text-text-secondary">{file?.name} · {numero(tab.righe.length)} righe · {tab.intestazioni.length} colonne</p>}
      </section>

      {errore && <div className="avviso avviso-err">{errore}</div>}

      {tab && (
        <div className="grid gap-5 lg:grid-cols-5">
          <section className="card lg:col-span-3 overflow-x-auto">
            <div className="p-4 pb-0 font-semibold">2 · Abbina le colonne</div>
            <table className="tabella">
              <thead><tr><th>Colonna nel file</th><th>Esempio</th><th>Campo nel CRM</th></tr></thead>
              <tbody>
                {tab.intestazioni.map((h, i) => (
                  <tr key={i}>
                    <td>{h}</td>
                    <td className="text-text-secondary max-w-48 truncate">{tab.righe.find((r) => r[i])?.[i] ?? "—"}</td>
                    <td>
                      <label className="sr-only" htmlFor={`m-${i}`}>Campo per {h}</label>
                      <select id={`m-${i}`} value={mappa[i] ?? ""} onChange={(e) => { const m = [...mappa]; m[i] = e.target.value; setMappa(m); resetRisultati(); }}>
                        <option value="">Non importare</option>
                        {CAMPI_IMPORT.map((c) => <option key={c.k} value={c.k}>{c.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-text-secondary p-4 pt-1">L&apos;abbinamento viene ricordato per i prossimi file con le stesse colonne.</p>
          </section>

          <section className="card p-5 lg:col-span-2 flex flex-col gap-4 self-start">
            <div className="font-semibold">3 · Controlla e importa</div>
            <div><label className="label" htmlFor="fonte">Nome della fonte</label><input id="fonte" value={fonte} onChange={(e) => setFonte(e.target.value)} placeholder="es. Banca dati fornitore X, ott 2026" /></div>
            <div>
              <label className="label" htmlFor="camp">Aggiungi anche alla campagna</label>
              <select id="camp" value={campagna} onChange={(e) => { setCampagna(e.target.value); resetRisultati(); }}>
                <option value="">— solo in archivio —</option>
                {campagne.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <fieldset className="border border-border rounded-lg p-3 flex flex-col gap-2 text-sm">
              <legend className="text-[13px] font-semibold px-1">Quanto importare</legend>
              <label className="flex gap-2"><input type="radio" name="q" checked={pilota} onChange={() => { setPilota(true); resetRisultati(); }} /> Prova pilota: prime {Math.min(PILOTA, tab.righe.length)} righe</label>
              <label className="flex gap-2"><input type="radio" name="q" checked={!pilota} onChange={() => { setPilota(false); resetRisultati(); }} /> Tutto il file ({numero(tab.righe.length)} righe)</label>
            </fieldset>
            <label className="flex gap-2 text-sm items-start"><input type="checkbox" checked={includiDoppioni} onChange={(e) => { setIncludiDoppioni(e.target.checked); resetRisultati(); }} /> Importa comunque i possibili doppioni (stesso telefono, P.IVA diversa o assente)</label>

            {avanzamento && (
              <div>
                <div className="h-2 rounded-full bg-surface-muted overflow-hidden"><div className="h-full bg-accent" style={{ width: `${(avanzamento.fatti / Math.max(1, avanzamento.tot)) * 100}%` }} /></div>
                <div className="text-xs text-text-secondary mt-1">{numero(avanzamento.fatti)} / {numero(avanzamento.tot)}</div>
              </div>
            )}

            {(anteprima || risultato) && <Riassunto r={(risultato ?? anteprima)!} finale={!!risultato} campagna={!!campagna} />}

            <div className="flex gap-2 flex-wrap">
              {!risultato && <button className="btn" disabled={busy} onClick={() => esegui(true)}>Controlla {numero(quante)} righe</button>}
              {anteprima && !risultato && (
                <button className="btn btn-primary" disabled={busy} onClick={() => esegui(false)}>Importa {numero(quante)} righe</button>
              )}
              {risultato && pilota && tab.righe.length > PILOTA && (
                <button className="btn" onClick={() => { setPilota(false); resetRisultati(); }}>Passa al file completo</button>
              )}
            </div>
            {risultato && pilota && tab.righe.length > PILOTA && (
              <p className="text-xs text-text-secondary">Le righe già importate nel pilota non verranno duplicate.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Riassunto({ r, finale, campagna }: { r: Riepilogo; finale: boolean; campagna: boolean }) {
  return (
    <div className={`rounded-lg p-3 text-sm ${finale ? "bg-accent-bg text-accent-text" : "bg-surface-muted"}`}>
      <div className="font-semibold mb-1">{finale ? "Import completato" : "Anteprima del controllo"}</div>
      <ul className="flex flex-col gap-0.5">
        <li>Aziende nuove: <strong>{numero(r.nuove)}</strong></li>
        <li>Già presenti (stessa P.IVA), completate: <strong>{numero(r.aggiornate)}</strong></li>
        <li>Possibili doppioni saltati: <strong>{numero(r.doppioni)}</strong></li>
        <li>Su lista “da non chiamare”, saltate: <strong>{numero(r.non_chiamare)}</strong></li>
        <li>Righe senza ragione sociale: <strong>{numero(r.scartate)}</strong></li>
        {campagna && <li>Aggiunte alla campagna: <strong>{numero(r.in_campagna)}</strong></li>}
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
