"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Configurazione = { factorId: string; qr: string; segreto: string };

export default function SicurezzaClient({ obbligatoria, configurata, nome }: { obbligatoria: boolean; configurata: boolean; nome: string }) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [factorId, setFactorId] = useState<string | null>(null);
  const [conf, setConf] = useState<Configurazione | null>(null);
  const [codice, setCodice] = useState("");
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // se la doppia verifica è già configurata, recupero il fattore da verificare
  useEffect(() => {
    if (!configurata) return;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const f = data?.totp?.[0];
      if (f) setFactorId(f.id);
    });
  }, [configurata, supabase]);

  async function inizia() {
    setBusy(true);
    setErrore(null);
    // elimino eventuali configurazioni lasciate a metà
    const { data: elenco } = await supabase.auth.mfa.listFactors();
    for (const f of elenco?.all ?? []) {
      if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: `Telefono ${new Date().toLocaleDateString("it-IT")}`,
      issuer: "WelfareCare CRM",
    });
    setBusy(false);
    if (error) return setErrore(error.message);
    setConf({ factorId: data.id, qr: data.totp.qr_code, segreto: data.totp.secret });
  }

  async function verifica(e: React.FormEvent) {
    e.preventDefault();
    const id = conf?.factorId ?? factorId;
    if (!id) return;
    setBusy(true);
    setErrore(null);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code: codice.replace(/\s/g, "") });
    setBusy(false);
    if (error) {
      setCodice("");
      return setErrore("Codice non valido o scaduto. Riprova con quello che vedi adesso nell'app.");
    }
    router.replace("/");
    router.refresh();
  }

  async function esci() {
    await supabase.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  const campoCodice = (
    <form onSubmit={verifica} className="flex flex-col gap-3">
      <div>
        <label className="label" htmlFor="codice">Codice di 6 cifre</label>
        <input
          id="codice"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
          value={codice}
          onChange={(e) => setCodice(e.target.value)}
          className="!text-2xl !tracking-[0.3em] text-center"
        />
      </div>
      {errore && <div className="avviso avviso-err">{errore}</div>}
      <button className="btn btn-primary" disabled={busy || codice.replace(/\s/g, "").length !== 6}>Verifica</button>
    </form>
  );

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-8 flex flex-col gap-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-welfarecare.svg" alt="WelfareCare" width={170} height={25} />

        {configurata ? (
          <>
            <div>
              <h1 className="text-xl font-semibold">Codice di accesso</h1>
              <p className="text-sm text-text-secondary">Apri l&apos;app di autenticazione sul telefono e scrivi il codice di “WelfareCare CRM”.</p>
            </div>
            {campoCodice}
            <p className="text-xs text-text-secondary">Telefono perso o cambiato? Chiedi all&apos;amministratore di azzerare la doppia verifica.</p>
          </>
        ) : !conf ? (
          <>
            <div>
              <h1 className="text-xl font-semibold">Attiva la doppia verifica</h1>
              <p className="text-sm text-text-secondary mt-1">
                {obbligatoria
                  ? `Ciao${nome ? ` ${nome}` : ""}, per il tuo ruolo è obbligatoria: senza, l'app non mostra alcun dato.`
                  : "Protegge il tuo account anche se qualcuno scopre la password."}
              </p>
            </div>
            <ol className="text-sm list-decimal pl-5 flex flex-col gap-1.5">
              <li>Installa sul telefono un&apos;app di autenticazione gratuita: <strong>Google Authenticator</strong> o <strong>Microsoft Authenticator</strong>.</li>
              <li>Premi “Inizia” e inquadra il codice QR con l&apos;app.</li>
              <li>Scrivi qui il codice di 6 cifre che compare.</li>
            </ol>
            {errore && <div className="avviso avviso-err">{errore}</div>}
            <button className="btn btn-primary" onClick={inizia} disabled={busy}>Inizia</button>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-xl font-semibold">Inquadra il codice QR</h1>
              <p className="text-sm text-text-secondary">Nell&apos;app premi “+” e scegli “Scansiona codice QR”.</p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={conf.qr} alt="Codice QR per l'app di autenticazione" width={200} height={200} className="self-center bg-white p-2 rounded-lg border border-border" />
            <details className="text-sm">
              <summary className="cursor-pointer text-text-secondary">Non riesci a inquadrarlo? Inserisci la chiave a mano</summary>
              <code className="block mt-2 p-2 bg-surface-muted rounded break-all select-all">{conf.segreto}</code>
            </details>
            {campoCodice}
          </>
        )}

        <button className="btn btn-sm self-start" onClick={esci}>Esci</button>
      </div>
    </main>
  );
}
