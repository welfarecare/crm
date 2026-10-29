import { redirect } from "next/navigation";
import { richiediProfilo, puo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { nomeCampagna } from "@/lib/format";
import ImportClient from "./ImportClient";

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const p = await richiediProfilo(["admin", "operatore"]);
  if (!puo(p, "importare")) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("campagne").select("id, comune, edizione").neq("stato", "chiusa").order("comune");
  return (
    <ImportClient
      campagne={(data ?? []).map((c) => ({ id: c.id, nome: nomeCampagna(c), comune: c.comune }))}
      campagnaIniziale={typeof sp.c === "string" ? sp.c : ""}
    />
  );
}
