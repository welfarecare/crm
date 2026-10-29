"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const CAMPI: { k: string; label: string; tipo?: string }[] = [
  { k: "ragione_sociale", label: "Ragione sociale" },
  { k: "piva", label: "P.IVA" },
  { k: "telefono", label: "Telefono centralino", tipo: "tel" },
  { k: "email", label: "Mail generica", tipo: "email" },
  { k: "sito", label: "Sito" },
  { k: "indirizzo", label: "Indirizzo" },
  { k: "comune", label: "Comune" },
  { k: "provincia", label: "Provincia" },
  { k: "cap", label: "CAP" },
  { k: "settore", label: "Settore" },
  { k: "dipendenti", label: "Dipendenti", tipo: "number" },
  { k: "note", label: "Note" },
];

type A = Record<string, unknown> & { id: string; non_chiamare: boolean };

export default function Anagrafica({ azienda, modificabile }: { azienda: A; modificabile: boolean }) {
  const router = useRouter();
  const [modifica, setModifica] = useState(false);
  const [valori, setValori] = useState<Record<string, string>>(
    Object.fromEntries(CAMPI.map((c) => [c.k, azienda[c.k] == null ? "" : String(azienda[c.k])]))
  );
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function salva() {
    setBusy(true);
    setErrore(null);
    const dati: Record<string, string | number | null> = {};
    for (const c of CAMPI) {
      const v = valori[c.k].trim();
      dati[c.k] = v === "" ? null : c.tipo === "number" ? Number(v.replace(/\D/g, "")) || null : v;
    }
    if (!dati.ragione_sociale) { setBusy(false); return setErrore("La ragione sociale è obbligatoria."); }
    const { error } = await createClient().from("aziende").update(dati).eq("id", azienda.id);
    setBusy(false);
    if (error) return setErrore(error.message.includes("aziende_piva_unica") ? "Esiste già un'altra azienda con questa P.IVA." : error.message);
    setModifica(false);
    router.refresh();
  }

  async function nonChiamare(v: boolean) {
    const motivo = v ? window.prompt("Motivo (facoltativo):") ?? "" : null;
    const { error } = await createClient().from("aziende").update({ non_chiamare: v, non_chiamare_motivo: v ? motivo || "Indicato manualmente" : null }).eq("id", azienda.id);
    if (error) return setErrore(error.message);
    router.refresh();
  }

  return (
    <section className="card p-5">
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">Anagrafica</h2>
        {modificabile && !modifica && <button className="btn btn-sm" onClick={() => setModifica(true)}>Modifica</button>}
      </div>
      {!modifica ? (
        <dl className="text-sm flex flex-col gap-2.5">
          {CAMPI.map((c) => (
            <div key={c.k}>
              <dt className="k">{c.label}</dt>
              <dd className="break-words">
                {c.k === "telefono" && valori[c.k] ? <a href={`tel:${valori[c.k]}`}>{valori[c.k]}</a> :
                  c.k === "sito" && valori[c.k] ? <a href={valori[c.k].startsWith("http") ? valori[c.k] : `https://${valori[c.k]}`} target="_blank" rel="noreferrer">{valori[c.k]}</a> :
                  valori[c.k] || "—"}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="flex flex-col gap-3">
          {CAMPI.map((c) => (
            <div key={c.k}>
              <label className="label" htmlFor={`f-${c.k}`}>{c.label}</label>
              {c.k === "note" ? (
                <textarea id={`f-${c.k}`} value={valori[c.k]} onChange={(e) => setValori({ ...valori, [c.k]: e.target.value })} />
              ) : (
                <input id={`f-${c.k}`} type={c.tipo ?? "text"} value={valori[c.k]} onChange={(e) => setValori({ ...valori, [c.k]: e.target.value })} />
              )}
            </div>
          ))}
          {errore && <div className="avviso avviso-err">{errore}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={salva} disabled={busy}>Salva</button>
            <button className="btn" onClick={() => setModifica(false)}>Annulla</button>
          </div>
        </div>
      )}
      {modificabile && !modifica && (
        <div className="mt-4 pt-3 border-t border-border">
          {azienda.non_chiamare ? (
            <button className="btn btn-sm" onClick={() => nonChiamare(false)}>Togli da “non chiamare”</button>
          ) : (
            <button className="btn btn-sm btn-danger" onClick={() => nonChiamare(true)}>Segna “da non chiamare”</button>
          )}
          {errore && !modifica && <div className="avviso avviso-err mt-2">{errore}</div>}
        </div>
      )}
    </section>
  );
}
