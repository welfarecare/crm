"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function GestioneCampagna({
  id, comune, edizione, note, puoEliminare,
}: { id: string; comune: string; edizione: string; note: string | null; puoEliminare: boolean }) {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [f, setF] = useState({ comune, edizione, note: note ?? "" });
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function apri() {
    setF({ comune, edizione, note: note ?? "" });
    setErrore(null);
    setAperto(true);
  }

  async function salva(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrore(null);
    const { error } = await createClient().rpc("modifica_campagna", {
      p_campagna: id, p_comune: f.comune, p_edizione: f.edizione, p_note: f.note,
    });
    setBusy(false);
    if (error) return setErrore(error.message);
    setAperto(false);
    router.refresh();
  }

  async function elimina() {
    if (!confirm(`Eliminare definitivamente la campagna ${comune} · ${edizione}?\n\nLe aziende restano in archivio; si perdono solo la lista e le assegnazioni.`)) return;
    setBusy(true);
    setErrore(null);
    const { error } = await createClient().rpc("elimina_campagna", { p_campagna: id });
    setBusy(false);
    if (error) { setAperto(true); return setErrore(error.message); }
    router.push("/campagne");
    router.refresh();
  }

  if (!aperto) {
    return <button className="btn" onClick={apri}>Modifica</button>;
  }

  return (
    <div className="fixed inset-0 z-20 bg-foreground/40 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Modifica campagna">
      <form onSubmit={salva} autoComplete="off" className="card w-full max-w-md p-6 flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Modifica campagna</h2>
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <div><label className="label" htmlFor="m-com">Comune</label><input id="m-com" required value={f.comune} onChange={(e) => setF({ ...f, comune: e.target.value })} /></div>
          <div><label className="label" htmlFor="m-ed">Edizione</label><input id="m-ed" required value={f.edizione} onChange={(e) => setF({ ...f, edizione: e.target.value })} /></div>
        </div>
        <div><label className="label" htmlFor="m-note">Note</label><textarea id="m-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
        {errore && <div className="avviso avviso-err">{errore}</div>}
        <div className="flex flex-wrap gap-2 justify-between">
          <div className="flex gap-2">
            <button className="btn btn-primary" disabled={busy}>Salva</button>
            <button type="button" className="btn" onClick={() => setAperto(false)}>Annulla</button>
          </div>
          {puoEliminare && <button type="button" className="btn btn-danger" onClick={elimina} disabled={busy}>Elimina campagna</button>}
        </div>
        {puoEliminare && (
          <p className="text-xs text-text-secondary">Si può eliminare solo una campagna in cui non ci sono ancora chiamate né appuntamenti. Le altre si mettono “Chiusa”, così lo storico resta.</p>
        )}
      </form>
    </div>
  );
}
