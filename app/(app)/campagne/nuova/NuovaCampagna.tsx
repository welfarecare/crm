"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function NuovaCampagna() {
  const router = useRouter();
  const [comune, setComune] = useState("");
  const [edizione, setEdizione] = useState(String(new Date().getFullYear() + 1));
  const [note, setNote] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function crea(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrore(null);
    const { data, error } = await createClient().rpc("crea_campagna", { p_comune: comune, p_edizione: edizione, p_note: note });
    setBusy(false);
    if (error) return setErrore(error.message);
    router.push(`/campagne/${data}`);
  }

  return (
    <form onSubmit={crea} className="max-w-lg flex flex-col gap-4">
      <Link href="/campagne" className="text-sm">← Campagne</Link>
      <h1 className="text-2xl font-semibold">Nuova campagna</h1>
      <div className="card p-5 flex flex-col gap-4">
        <div className="grid grid-cols-[2fr_1fr] gap-3">
          <div><label className="label" htmlFor="com">Comune</label><input id="com" required value={comune} onChange={(e) => setComune(e.target.value)} /></div>
          <div><label className="label" htmlFor="ed">Edizione</label><input id="ed" required value={edizione} onChange={(e) => setEdizione(e.target.value)} /></div>
        </div>
        <div><label className="label" htmlFor="note">Note</label><textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        {errore && <div className="avviso avviso-err">{errore}</div>}
        <button className="btn btn-primary self-start" disabled={busy}>Crea e componi la lista</button>
      </div>
    </form>
  );
}
