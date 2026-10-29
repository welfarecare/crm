import "server-only";
import { createClient } from "@supabase/supabase-js";

// Client con chiave di servizio: SOLO lato server, solo per il Centro di controllo.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Manca SUPABASE_SERVICE_ROLE_KEY nelle variabili di Vercel");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
