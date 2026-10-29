import Link from "next/link";
import { richiediProfilo, puo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { numero } from "@/lib/format";
import { STATO_CAMPAGNA_LABEL, type StatoCampagna } from "@/lib/types";

export default async function CampagnePage() {
  const p = await richiediProfilo(["admin", "direzione", "operatore"]);
  const supabase = await createClient();
  const [{ data: campagne }, { data: stat }] = await Promise.all([
    supabase.from("campagne").select("id, comune, edizione, stato").order("stato").order("comune").order("edizione", { ascending: false }),
    supabase.rpc("statistiche_campagne"),
  ]);
  const s = new Map(((stat ?? []) as { campagna_id: string; totale: number; lavorate: number; appuntamenti: number; contratti: number }[]).map((x) => [x.campagna_id, x]));
  const ordine: Record<StatoCampagna, number> = { in_corso: 0, preparazione: 1, chiusa: 2 };
  const elenco = (campagne ?? []).sort((a, b) => ordine[a.stato as StatoCampagna] - ordine[b.stato as StatoCampagna]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <h1 className="text-2xl font-semibold">Campagne</h1>
        <div className="flex gap-2">
          {puo(p, "importare") && p.ruolo !== "direzione" && <Link className="btn" href="/import">Importa lista</Link>}
          {puo(p, "creare_campagne") && p.ruolo !== "direzione" && <Link className="btn btn-primary" href="/campagne/nuova">+ Nuova campagna</Link>}
        </div>
      </div>
      <section className="card overflow-x-auto">
        <table className="tabella">
          <thead><tr><th>Comune · edizione</th><th>Aziende</th><th>Lavorate</th><th>Appuntamenti</th><th>Contratti</th><th>Stato</th></tr></thead>
          <tbody>
            {elenco.map((c) => {
              const x = s.get(c.id);
              return (
                <tr key={c.id}>
                  <td><Link href={`/campagne/${c.id}`}>{c.comune} · {c.edizione}</Link></td>
                  <td>{numero(x?.totale)}</td>
                  <td>{numero(x?.lavorate)}</td>
                  <td>{numero(x?.appuntamenti)}</td>
                  <td>{numero(x?.contratti)}</td>
                  <td><span className={`tag ${c.stato === "in_corso" ? "tag-blue" : ""}`}>{STATO_CAMPAGNA_LABEL[c.stato as StatoCampagna]}</span></td>
                </tr>
              );
            })}
            {elenco.length === 0 && (
              <tr><td colSpan={6} className="text-text-secondary">Nessuna campagna{p.ruolo === "operatore" ? " assegnata a te" : ""}.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
