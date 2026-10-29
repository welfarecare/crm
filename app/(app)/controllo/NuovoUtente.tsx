"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RUOLO_LABEL, type Ruolo } from "@/lib/types";
import { creaUtente } from "./azioni";

function passwordCasuale() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const a = new Uint32Array(14);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => c[n % c.length]).join("");
}

export default function NuovoUtente() {
  const router = useRouter();
  const [aperto, setAperto] = useState(false);
  const [f, setF] = useState({ email: "", nome: "", ruolo: "operatore" as Ruolo, password: "", zona: "" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();

  if (!aperto) {
    return <button className="btn btn-primary self-start" onClick={() => { setAperto(true); setF({ ...f, password: passwordCasuale() }); }}>+ Nuovo utente</button>;
  }

  function crea(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await creaUtente(f);
      if (!r.ok) return setMsg({ ok: false, t: r.errore });
      setMsg({ ok: true, t: `Utente creato. Comunica a voce email e password temporanea: ${f.password}` });
      router.push(`/controllo?u=${r.id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={crea} className="card p-5 flex flex-col gap-3">
      <h2 className="font-semibold">Nuovo utente</h2>
      <div><label className="label" htmlFor="n-nome">Nome</label><input id="n-nome" required value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} /></div>
      <div><label className="label" htmlFor="n-email">Email</label><input id="n-email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div>
        <label className="label" htmlFor="n-ruolo">Ruolo</label>
        <select id="n-ruolo" value={f.ruolo} onChange={(e) => setF({ ...f, ruolo: e.target.value as Ruolo })}>
          {(Object.keys(RUOLO_LABEL) as Ruolo[]).map((r) => <option key={r} value={r}>{RUOLO_LABEL[r]}</option>)}
        </select>
      </div>
      {f.ruolo === "incaricato" && <div><label className="label" htmlFor="n-zona">Zona</label><input id="n-zona" value={f.zona} onChange={(e) => setF({ ...f, zona: e.target.value })} /></div>}
      <div>
        <label className="label" htmlFor="n-pw">Password temporanea</label>
        <input id="n-pw" type="text" autoComplete="off" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
        <p className="text-xs text-text-secondary mt-1">L&apos;utente potrà cambiarla dal suo profilo.</p>
      </div>
      {msg && <div className={`avviso ${msg.ok ? "avviso-ok" : "avviso-err"}`}>{msg.t}</div>}
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={pending}>Crea utente</button>
        <button type="button" className="btn" onClick={() => setAperto(false)}>Chiudi</button>
      </div>
    </form>
  );
}
