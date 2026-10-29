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

// Ruoli per cui la doppia verifica è obbligatoria (lo controlla anche il database)
export const RUOLI_MFA: Ruolo[] = ["admin", "direzione"];

export const livelloMfa = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return { attuale: data?.currentLevel ?? "aal1", possibile: data?.nextLevel ?? "aal1" };
});

/** true se l'utente deve ancora inserire il codice dal telefono */
export async function serveVerifica(p: Profilo) {
  const l = await livelloMfa();
  if (l.attuale === "aal2") return false;
  return RUOLI_MFA.includes(p.ruolo) || l.possibile === "aal2";
}

export function puo(p: Profilo, permesso: keyof Permessi) {
  return p.ruolo === "admin" || !!p.permessi?.[permesso];
}

export function homePerRuolo(r: Ruolo) {
  switch (r) {
    case "incaricato":
      return "/appuntamenti";
    case "direzione":
      return "/andamento";
    default:
      return "/coda";
  }
}
