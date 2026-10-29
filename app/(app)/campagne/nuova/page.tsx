import { redirect } from "next/navigation";
import { richiediProfilo, puo } from "@/lib/auth";
import NuovaCampagna from "./NuovaCampagna";

export default async function NuovaCampagnaPage() {
  const p = await richiediProfilo(["admin", "operatore"]);
  if (!puo(p, "creare_campagne")) redirect("/campagne");
  return <NuovaCampagna />;
}
