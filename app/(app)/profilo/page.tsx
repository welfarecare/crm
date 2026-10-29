import Link from "next/link";
import { richiediProfilo, livelloMfa, RUOLI_MFA } from "@/lib/auth";
import { RUOLO_LABEL } from "@/lib/types";
import CambiaPassword from "./CambiaPassword";

export default async function ProfiloPage() {
  const p = await richiediProfilo();
  const mfa = await livelloMfa();
  return (
    <div className="max-w-lg flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Il mio profilo</h1>
      <section className="card p-5 text-sm flex flex-col gap-2">
        <div><span className="k">Nome</span><div>{p.nome || "—"}</div></div>
        <div><span className="k">Email</span><div>{p.email}</div></div>
        <div><span className="k">Ruolo</span><div>{RUOLO_LABEL[p.ruolo]}</div></div>
      </section>
      <section className="card p-5 text-sm flex flex-col gap-2">
        <h2 className="font-semibold">Doppia verifica</h2>
        {mfa.possibile === "aal2" ? (
          <p>Attiva: all&apos;accesso ti chiediamo il codice dall&apos;app sul telefono.</p>
        ) : (
          <>
            <p className="text-text-secondary">
              {RUOLI_MFA.includes(p.ruolo) ? "Obbligatoria per il tuo ruolo." : "Facoltativa, ma consigliata: protegge il tuo account anche se qualcuno scopre la password."}
            </p>
            <Link href="/sicurezza" className="btn self-start">Attiva la doppia verifica</Link>
          </>
        )}
      </section>
      <CambiaPassword />
    </div>
  );
}
