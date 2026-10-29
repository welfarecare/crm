import { redirect } from "next/navigation";
import { getProfilo, homePerRuolo } from "@/lib/auth";

export default async function Home() {
  const p = await getProfilo();
  if (!p) redirect("/login?disattivato=1");
  redirect(homePerRuolo(p.ruolo));
}
