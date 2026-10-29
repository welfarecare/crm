import { richiediProfilo } from "@/lib/auth";
import { RUOLO_LABEL } from "@/lib/types";
import CambiaPassword from "./CambiaPassword";

export default async function ProfiloPage() {
  const p = await richiediProfilo();
  return (
    <div className="max-w-lg flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Il mio profilo</h1>
      <section className="card p-5 text-sm flex flex-col gap-2">
        <div><span className="k">Nome</span><div>{p.nome || "—"}</div></div>
        <div><span className="k">Email</span><div>{p.email}</div></div>
        <div><span className="k">Ruolo</span><div>{RUOLO_LABEL[p.ruolo]}</div></div>
      </section>
      <CambiaPassword />
    </div>
  );
}
