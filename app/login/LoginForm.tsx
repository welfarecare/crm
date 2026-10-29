"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginForm({ disattivato }: { disattivato: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errore, setErrore] = useState<string | null>(
    disattivato ? "Il tuo accesso non è attivo. Contatta l'amministratore." : null
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (disattivato) createClient().auth.signOut();
  }, [disattivato]);

  async function accedi(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrore(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setErrore("Email o password non corretti.");
      setBusy(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={accedi} className="card w-full max-w-sm p-8 flex flex-col gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-welfarecare.svg" alt="WelfareCare" width={180} height={26} />
        <div>
          <h1 className="text-xl font-semibold">CRM Telemarketing</h1>
          <p className="text-sm text-text-secondary">Accedi con le credenziali ricevute.</p>
        </div>
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {errore && <div className="avviso avviso-err">{errore}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Accesso…" : "Accedi"}
        </button>
      </form>
    </main>
  );
}
