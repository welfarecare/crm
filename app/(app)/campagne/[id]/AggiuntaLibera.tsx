"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Trovata = { id: string; ragione_sociale: string; comune: string | null; piva: string | null; telefono: string | null; non_chiamare: boolean };

export default function AggiuntaLibera({ campagnaId, cercaArchivio, comune }: { campagnaId: string; cercaArchivio: boolean; comune: string }) {
  const router = useRouter();
  const [testo, setTesto] = useState("");
  const [trovate, setTrovate] = useState<Trovata[] | null>(null);
  const [aggiunte, setAggiunte] = useState<Set<string>>(new Set());
  const [nuova, setNuova] = useState(false);
  const [f, setF] = useState({ ragione_sociale: "", telefono: "", piva: "", comune, email: "" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function cerca(e: React.FormEvent) {
    e.preventDefault();
    if (testo.trim().length < 2) return;
    const { data, error } = await createClient().rpc("cerca_aziende_archivio", { p_testo: testo.trim() });
    if (error) return setMsg({ ok: false, t: error.message });
    setTrovate((data ?? []) as Trovata[]);
  }

  async function aggiungi(id: string) {
    const { error } = await createClient().rpc("aggiungi_a_campagna", { p_campagna: campagnaId, p_azienda: id });
    if (error) return setMsg({ ok: false, t: error.message });
    setAggiunte(new Set(aggiunte).add(id));
    setMsg({ ok: true, t: "Aggiunta alla lista." });
    router.refresh();
  }

  async function crea(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await createClient().rpc("crea_azienda_in_campagna", { p_campagna: campagnaId, p_dati: f });
    if (error) return setMsg({ ok: false, t: error.message });
    setMsg({ ok: true, t: `${f.ragione_sociale} aggiunta alla lista.` });
    setF({ ragione_sociale: "", telefono: "", piva: "", comune, email: "" });
    setNuova(false);
    router.refresh();
  }

  return (
    <section className="card p-5 flex flex-col gap-3">
      <h2 className="font-semibold">Aggiunta libera</h2>
      {cercaArchivio && (
        <>
          <form onSubmit={cerca} autoComplete="off" className="flex gap-2">
            <label className="sr-only" htmlFor="cerca-arch">Cerca nell&apos;archivio</label>
            <input id="cerca-arch" placeholder="Cerca nell'archivio: nome, P.IVA, telefono" value={testo} onChange={(e) => setTesto(e.target.value)} />
            <button className="btn">Cerca</button>
          </form>
          {trovate && (
            <ul className="flex flex-col gap-2 text-sm">
              {trovate.length === 0 && <li className="text-text-secondary">Nessun risultato.</li>}
              {trovate.map((t) => (
                <li key={t.id} className="flex justify-between gap-2 items-center">
                  <span>{t.ragione_sociale}<span className="text-text-secondary"> · {t.comune ?? "—"}</span></span>
                  {t.non_chiamare ? <span className="tag tag-red">non chiamare</span> : aggiunte.has(t.id) ? <span className="tag tag-blue">aggiunta</span> : (
                    <button className="btn btn-sm" onClick={() => aggiungi(t.id)}>Aggiungi</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {!nuova ? (
        <button className="btn self-start" onClick={() => setNuova(true)}>+ Nuova azienda a mano</button>
      ) : (
        <form onSubmit={crea} autoComplete="off" className="flex flex-col gap-2.5 border-t border-border pt-3">
          {(
            [["ragione_sociale", "Ragione sociale"], ["telefono", "Telefono"], ["piva", "P.IVA"], ["comune", "Comune"], ["email", "Mail"]] as const
          ).map(([k, l]) => (
            <div key={k}><label className="label" htmlFor={`n-${k}`}>{l}</label><input id={`n-${k}`} required={k === "ragione_sociale"} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
          ))}
          <p className="text-xs text-text-secondary">Se la P.IVA esiste già in archivio, viene collegata quella esistente.</p>
          <div className="flex gap-2"><button className="btn btn-primary">Aggiungi</button><button type="button" className="btn" onClick={() => setNuova(false)}>Annulla</button></div>
        </form>
      )}
      {msg && <div className={`avviso ${msg.ok ? "avviso-ok" : "avviso-err"}`}>{msg.t}</div>}
    </section>
  );
}
