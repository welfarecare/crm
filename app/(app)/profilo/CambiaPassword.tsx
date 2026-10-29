"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function CambiaPassword() {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function salva(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 10) return setMsg({ ok: false, t: "Usa almeno 10 caratteri." });
    if (pw !== pw2) return setMsg({ ok: false, t: "Le due password non coincidono." });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password: pw });
    setBusy(false);
    setMsg(error ? { ok: false, t: error.message } : { ok: true, t: "Password aggiornata." });
    if (!error) { setPw(""); setPw2(""); }
  }

  return (
    <form onSubmit={salva} className="card p-5 flex flex-col gap-3">
      <h2 className="font-semibold">Cambia password</h2>
      <div><label className="label" htmlFor="pw">Nuova password</label><input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div>
      <div><label className="label" htmlFor="pw2">Ripeti</label><input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></div>
      {msg && <div className={`avviso ${msg.ok ? "avviso-ok" : "avviso-err"}`}>{msg.t}</div>}
      <button className="btn btn-primary self-start" disabled={busy}>Salva</button>
    </form>
  );
}
