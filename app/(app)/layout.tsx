import Sidebar from "@/components/Sidebar";
import { redirect } from "next/navigation";
import { richiediProfilo, puo, serveVerifica } from "@/lib/auth";
import { RUOLO_LABEL } from "@/lib/types";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const p = await richiediProfilo();
  if (await serveVerifica(p)) redirect("/sicurezza");

  const voci: { href: string; label: string }[] = [];
  if (p.ruolo === "operatore" || p.ruolo === "admin") voci.push({ href: "/coda", label: "Coda chiamate" });
  voci.push({ href: "/appuntamenti", label: p.ruolo === "incaricato" ? "I miei appuntamenti" : "Appuntamenti" });
  if (p.ruolo !== "incaricato") {
    voci.push({ href: "/campagne", label: "Campagne" });
    voci.push({ href: "/aziende", label: "Aziende" });
  }
  if (puo(p, "importare") && p.ruolo !== "direzione" && p.ruolo !== "incaricato") voci.push({ href: "/import", label: "Importa lista" });
  if (p.ruolo === "admin") voci.push({ href: "/controllo", label: "Centro di controllo" });

  return (
    <div className="md:flex min-h-screen">
      <Sidebar voci={voci} nome={p.nome} ruolo={RUOLO_LABEL[p.ruolo]} />
      <main className="flex-1 min-w-0 p-4 md:p-8">{children}</main>
    </div>
  );
}
