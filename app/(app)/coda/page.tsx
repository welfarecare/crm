import Link from "next/link";
import { richiediProfilo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { nomeCampagna } from "@/lib/format";
import CodaClient from "./CodaClient";

export default async function CodaPage({ searchParams }: PageProps<"/coda">) {
  await richiediProfilo(["admin", "operatore"]);
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: campagne } = await supabase
    .from("campagne")
    .select("id, comune, edizione")
    .eq("stato", "in_corso")
    .order("comune");

  const { data: incaricati } = await supabase
    .from("profili")
    .select("id, nome, zona")
    .eq("ruolo", "incaricato")
    .eq("attivo", true)
    .order("nome");

  if (!campagne || campagne.length === 0) {
    return (
      <div className="max-w-xl flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Coda chiamate</h1>
        <div className="card p-6 text-sm text-text-secondary">
          Nessuna campagna in corso assegnata a te. Quando l&apos;amministratore te ne assegna una, la trovi qui.
          <div className="mt-3"><Link href="/campagne">Vai alle campagne</Link></div>
        </div>
      </div>
    );
  }

  const scelta = campagne.find((c) => c.id === sp.c) ?? campagne[0];

  return (
    <CodaClient
      key={scelta.id}
      campagne={campagne.map((c) => ({ id: c.id, nome: nomeCampagna(c) }))}
      campagnaId={scelta.id}
      incaricati={incaricati ?? []}
    />
  );
}
