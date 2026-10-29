import Link from "next/link";
import { richiediProfilo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { numero } from "@/lib/format";
import { STATO_AZIENDA_LABEL } from "@/lib/types";

const PER_PAGINA = 50;

export default async function AziendePage({ searchParams }: PageProps<"/aziende">) {
  await richiediProfilo(["admin", "direzione", "operatore"]);
  const sp = await searchParams;
  const q = String(sp.q ?? "").replace(/[,()%*\\]/g, " ").trim();
  const comune = String(sp.comune ?? "").replace(/[,()%*\\]/g, " ").trim();
  const pagina = Math.max(1, Number(sp.p ?? 1) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("aziende")
    .select("id, ragione_sociale, comune, provincia, telefono, piva, stato, non_chiamare", { count: "exact" })
    .order("ragione_sociale")
    .range((pagina - 1) * PER_PAGINA, pagina * PER_PAGINA - 1);
  if (q) {
    const cifre = q.replace(/\D/g, "");
    const filtri = [`ragione_sociale.ilike.%${q}%`];
    if (cifre.length >= 4) filtri.push(`piva_norm.ilike.%${cifre}%`, `telefono_norm.ilike.%${cifre}%`);
    query = query.or(filtri.join(","));
  }
  if (comune) query = query.ilike("comune", `%${comune}%`);
  const { data, count, error } = await query;
  const totale = count ?? 0;
  const pagine = Math.max(1, Math.ceil(totale / PER_PAGINA));

  const link = (p: number) => `/aziende?${new URLSearchParams({ q, comune, p: String(p) })}`;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold">Aziende</h1>
      <form className="card p-4 grid gap-3 sm:grid-cols-[2fr_1fr_auto] items-end">
        <div><label className="label" htmlFor="q">Cerca</label><input id="q" name="q" defaultValue={q} placeholder="Ragione sociale, P.IVA o telefono" /></div>
        <div><label className="label" htmlFor="comune">Comune</label><input id="comune" name="comune" defaultValue={comune} /></div>
        <button className="btn btn-primary">Cerca</button>
      </form>
      {error && <div className="avviso avviso-err">{error.message}</div>}
      <section className="card overflow-x-auto">
        <table className="tabella">
          <thead><tr><th>Ragione sociale</th><th>Comune</th><th>Telefono</th><th>P.IVA</th><th>Stato</th></tr></thead>
          <tbody>
            {(data ?? []).map((a) => (
              <tr key={a.id}>
                <td><Link href={`/aziende/${a.id}`}>{a.ragione_sociale}</Link></td>
                <td>{a.comune}{a.provincia ? ` (${a.provincia})` : ""}</td>
                <td className="whitespace-nowrap">{a.telefono ?? "—"}</td>
                <td>{a.piva ?? "—"}</td>
                <td>
                  {a.non_chiamare ? <span className="tag tag-red">Da non chiamare</span> : (
                    <span className={`tag ${a.stato === "attiva" ? "tag-blue" : a.stato === "sconosciuto" ? "" : "tag-warn"}`}>
                      {STATO_AZIENDA_LABEL[a.stato as keyof typeof STATO_AZIENDA_LABEL]}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {(data ?? []).length === 0 && <tr><td colSpan={5} className="text-text-secondary">Nessuna azienda trovata.</td></tr>}
          </tbody>
        </table>
      </section>
      <div className="flex items-center justify-between text-sm text-text-secondary">
        <span>{numero(totale)} aziende</span>
        <div className="flex gap-2 items-center">
          {pagina > 1 && <Link className="btn btn-sm" href={link(pagina - 1)}>← Precedenti</Link>}
          <span>Pagina {pagina} di {pagine}</span>
          {pagina < pagine && <Link className="btn btn-sm" href={link(pagina + 1)}>Successive →</Link>}
        </div>
      </div>
    </div>
  );
}
