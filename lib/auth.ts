import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profilo, Ruolo, Permessi } from "@/lib/types";

export const getProfilo = cache(async (): Promise<Profilo | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profili").select("*").eq("id", user.id).single();
  if (!data || !data.attivo) return null;
  return data as Profilo;
});

export async function richiediProfilo(ruoli?: Ruolo[]) {
  const p = await getProfilo();
  if (!p) redirect("/login?disattivato=1");
  if (ruoli && !ruoli.includes(p.ruolo)) redirect("/");
  return p;
}

export function puo(p: Profilo, permesso: keyof Permessi) {
  return p.ruolo === "admin" || !!p.permessi?.[permesso];
}

export function homePerRuolo(r: Ruolo) {
  switch (r) {
    case "incaricato":
      return "/appuntamenti";
    case "direzione":
      return "/campagne";
    default:
      return "/coda";
  }
}
