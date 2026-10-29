"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type R = { id: string; nome: string; ruolo: string | null; telefono: string | null; email: string | null; note: string | null; attivo: boolean };
const VUOTO = { nome: "", ruolo: "", telefono: "", email: "", note: "" };

export default function Referenti({ aziendaId, referenti, modificabile }: { aziendaId: string; referenti: R[]; modificabile: boolean }) {
  const router = useRouter();
  const [inModifica, setInModifica] = useState<string | null>(null); // id o "nuovo"
  const [f, setF] = useState(VUOTO);
  const [errore, setErrore] = useState<string | null>(null);

  function apri(r?: R) {
    setErrore(null);
    setInModifica(r ? r.id : "nuovo");
    setF(r ? { nome: r.nome, ruolo: r.ruolo ?? "", telefono: r.telefono ?? "", email: r.email ?? "", note: r.note ?? "" } : VUOTO);
  }

  async function salva() {
    if (!f.nome.trim()) return setErrore("Il nome è obbligatorio.");
    const dati = { nome: f.nome.trim(), ruolo: f.ruolo || null, telefono: f.telefono || null, email: f.email || null, note: f.note || null };
    const sb = createClient();
    const { error } = inModifica === "nuovo"
      ? await sb.from("referenti").insert({ ...dati, azienda_id: aziendaId })
      : await sb.from("referenti").update(dati).eq("id", inModifica!);
    if (error) return setErrore(error.message);
    setInModifica(null);
    setF(VUOTO);
    router.refresh();
  }

  async function attiva(r: R, v: boolean) {
    await createClient().from("referenti").update({ attivo: v }).eq("id", r.id);
    router.refresh();
  }

  return (
    <section className="card p-5">
      <h2 className="font-semibold mb-3">Referenti</h2>
      <div className="flex flex-col gap-2.5">
        {referenti.length === 0 && <p className="text-sm text-text-secondary">Nessun referente.</p>}
        {referenti.map((r) => (
          <div key={r.id} className={`border border-border rounded-lg p-3 text-sm ${r.attivo ? "" : "opacity-60"}`}>
            <div className="flex justify-between gap-2">
              <div><strong>{r.nome}</strong>{r.ruolo ? ` · ${r.ruolo}` : ""}{!r.attivo && <span className="tag ml-2">non più in azienda</span>}</div>
              {modificabile && (
                <div className="flex gap-1">
                  <button className="btn btn-sm" onClick={() => apri(r)}>Modifica</button>
                  <button className="btn btn-sm" onClick={() => attiva(r, !r.attivo)}>{r.attivo ? "Non c'è più" : "Riattiva"}</button>
                </div>
              )}
            </div>
            {(r.telefono || r.email) && <div className="text-text-secondary break-all">{[r.telefono, r.email].filter(Boolean).join(" · ")}</div>}
            {r.note && <div className="text-text-secondary">{r.note}</div>}
          </div>
        ))}
      </div>
      {modificabile && !inModifica && <button className="btn btn-sm mt-3" onClick={() => apri()}>+ Aggiungi referente</button>}
      {inModifica && (
        <div className="mt-3 flex flex-col gap-2.5 border-t border-border pt-3">
          {(["nome", "ruolo", "telefono", "email", "note"] as const).map((k) => (
            <div key={k}>
              <label className="label" htmlFor={`r-${k}`}>{k[0].toUpperCase() + k.slice(1)}</label>
              <input id={`r-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </div>
          ))}
          {errore && <div className="avviso avviso-err">{errore}</div>}
          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={salva}>Salva</button>
            <button className="btn" onClick={() => setInModifica(null)}>Annulla</button>
          </div>
        </div>
      )}
    </section>
  );
}
