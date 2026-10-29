import { redirect } from "next/navigation";
import { getProfilo, livelloMfa, RUOLI_MFA } from "@/lib/auth";
import SicurezzaClient from "./SicurezzaClient";

export default async function SicurezzaPage() {
  const p = await getProfilo();
  if (!p) redirect("/login?disattivato=1");
  const l = await livelloMfa();
  if (l.attuale === "aal2") redirect("/profilo");
  return <SicurezzaClient obbligatoria={RUOLI_MFA.includes(p.ruolo)} configurata={l.possibile === "aal2"} nome={p.nome} />;
}
