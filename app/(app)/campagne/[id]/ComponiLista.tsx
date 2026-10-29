"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { numero } from "@/lib/format";

type Esito = {
  candidate: number; aggiunte: number; gia_in_lista: number;
  escluse_non_chiamare: number; escluse_chiuse: number; escluse_contratti: number; escluse_non_interessati: number;
};

export default function ComponiLista({ campagnaId, comune, altre }: { campagnaId: string; comune: string; altre: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [comuni, setComuni] = useState<string[]>([comune]);
  const [nuovoComune, setNuovoComune] = useState("");
  const [daCampagna, setDaCampagna] = useState("");
  const [escludiContratti, setEscludiContratti] = useState(true);
  const [mesi, setMesi] = useState(18);
  const [anteprima, setAnteprima] = useState<Esito | null>(null);
  const [fatto, setFatto] = useState<Esito | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function aggiungiComune() {
    const v = nuovoComune.trim();
    if (v && !comuni.some((c) => c.toLowerCase() === v.toLowerCase())) setComuni([...comuni, v]);
    setNuovoComune("");
    setAnteprima(null);
  }

  async function esegui(prova: boolean) {
    setBusy(true);
    setErrore(null);
    const { data, error } = await createClient().rpc("componi_campagna", {
      p_campagna: campagnaId,
      p_comuni: comuni,
      p_da_campagna: daCampagna || null,
      p_escludi_contratti: escludiContratti,
      p_mesi_non_interessati: mesi,
      p_anteprima: prova,
    });
    setBusy(false);
    if (error) return setErrore(error.message);
    if (prova) setAnteprima(data as Esito);
    else {
      setFatto(data as Esito);
      setAnteprima(null);
      router.refresh();
    }
  }

  const cambia = <T,>(f: (v: T) => void) => (v: T) => { f(v); setAnteprima(null); setFatto(null); };

  return (
    <section className="card p-5 flex flex-col gap-3">
      <h2 className="font-semibold">Componi la lista</h2>
      <div>
        <label className="label" htmlFor="dac">Riprendi da un&apos;edizione precedente</label>
        <select id="dac" value={daCampagna} onChange={(e) => cambia(setDaCampagna)(e.target.value)}>
          <option value="">— nessuna —</option>
          {altre.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>
      </div>
      <div>
        <div className="label">Aziende con sede in</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {comuni.map((c) => (
            <span key={c} className="tag tag-blue !text-sm">
              {c}{" "}
              <button type="button" aria-label={`Togli ${c}`} className="ml-1 font-bold" onClick={() => cambia(setComuni)(comuni.filter((x) => x !== c))}>×</button>
            </span>
          ))}
          {comuni.length === 0 && <span className="text-sm text-text-secondary">nessun comune</span>}
        </div>
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="nc">Aggiungi comune limitrofo</label>
          <input id="nc" placeholder="Aggiungi comune limitrofo" value={nuovoComune} onChange={(e) => setNuovoComune(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); aggiungiComune(); } }} />
          <button type="button" className="btn" onClick={aggiungiComune}>+</button>
        </div>
      </div>
      <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={escludiContratti} onChange={(e) => cambia(setEscludiContratti)(e.target.checked)} /> Escludi chi ha già firmato un contratto</label>
      <div className="flex gap-2 items-center text-sm">
        <label htmlFor="mesi">Escludi “non interessati” degli ultimi</label>
        <input id="mesi" type="number" min={0} max={60} className="!w-20" value={mesi} onChange={(e) => cambia(setMesi)(Number(e.target.value))} /> mesi
      </div>
      <p className="text-xs text-text-secondary">Sempre escluse: aziende “da non chiamare”, chiuse o con numero errato.</p>

      {errore && <div className="avviso avviso-err">{errore}</div>}
      {anteprima && (
        <div className="rounded-lg bg-surface-muted p-3 text-sm">
          <strong>{numero(anteprima.aggiunte)} aziende</strong> verranno aggiunte
          {anteprima.gia_in_lista > 0 && ` (${numero(anteprima.gia_in_lista)} sono già in lista)`}.
          <div className="text-text-secondary mt-1">
            Escluse: {numero(anteprima.escluse_non_chiamare)} da non chiamare, {numero(anteprima.escluse_chiuse)} chiuse o numero errato,{" "}
            {numero(anteprima.escluse_contratti)} con contratto, {numero(anteprima.escluse_non_interessati)} non interessate di recente.
          </div>
        </div>
      )}
      {fatto && <div className="avviso avviso-ok">Aggiunte {numero(fatto.aggiunte)} aziende alla lista.</div>}
      <div className="flex gap-2 flex-wrap">
        <button className="btn" disabled={busy || (comuni.length === 0 && !daCampagna)} onClick={() => esegui(true)}>Calcola anteprima</button>
        {anteprima && anteprima.aggiunte > 0 && (
          <button className="btn btn-primary" disabled={busy} onClick={() => esegui(false)}>Aggiungi {numero(anteprima.aggiunte)} aziende</button>
        )}
      </div>
    </section>
  );
}
