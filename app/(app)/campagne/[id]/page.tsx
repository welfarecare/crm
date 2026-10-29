import Link from "next/link";
import { notFound } from "next/navigation";
import { richiediProfilo, puo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { giornoOra, nomeCampagna, numero } from "@/lib/format";
import { ESITO_LABEL, STATO_CA_LABEL, type EsitoChiamata, type StatoCampagna, type StatoInCampagna } from "@/lib/types";
import StatoSelect from "./StatoSelect";
import GestioneCampagna from "./GestioneCampagna";
import ComponiLista from "./ComponiLista";
import AggiuntaLibera from "./AggiuntaLibera";

const PER_PAGINA = 50;

export default async function CampagnaPage({ params, searchParams }: PageProps<"/campagne/[id]">) {
  const p = await richiediProfilo(["admin", "direzione", "operatore"]);
  const { id } = await params;
  const sp = await searchParams;
  const filtro = (Object.keys(STATO_CA_LABEL).includes(String(sp.s)) ? String(sp.s) : "") as StatoInCampagna | "";
  const pagina = Math.max(1, Number(sp.p ?? 1) || 1);
  const supabase = await createClient();

  const { data: c } = await supabase.from("campagne").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();

  let q = supabase
    .from("campagna_aziende")
    .select("id, stato, tentativi, ultimo_esito, ultimo_contatto_at, prossimo_richiamo, azienda:aziende(id, ragione_sociale, comune, telefono)", { count: "exact" })
    .eq("campagna_id", id)
    .order("ultimo_contatto_at", { ascending: false, nullsFirst: false })
    .range((pagina - 1) * PER_PAGINA, pagina * PER_PAGINA - 1);
  if (filtro) q = q.eq("stato", filtro);

  const [{ data: conteggi }, { data: righe, count }, { data: altre }, { data: assegnati }] = await Promise.all([
    supabase.rpc("conteggi_campagna", { p_campagna: id }),
    q,
    supabase.from("campagne").select("id, comune, edizione").neq("id", id).order("edizione", { ascending: false }),
    p.ruolo === "admin"
      ? supabase.from("campagne_assegnazioni").select("utente:profili(nome, ruolo)").eq("campagna_id", id)
      : Promise.resolve({ data: [] }),
  ]);

  const cnt = new Map(((conteggi ?? []) as { stato: StatoInCampagna; quante: number }[]).map((x) => [x.stato, Number(x.quante)]));
  const totale = [...cnt.values()].reduce((a, b) => a + b, 0);
  type R = { id: string; stato: StatoInCampagna; tentativi: number; ultimo_esito: EsitoChiamata | null; ultimo_contatto_at: string | null; prossimo_richiamo: string | null; azienda: { id: string; ragione_sociale: string; comune: string | null; telefono: string | null } | null };
  const elenco = (righe ?? []) as unknown as R[];
  const pagine = Math.max(1, Math.ceil((count ?? 0) / PER_PAGINA));
  const componi = puo(p, "creare_campagne") && p.ruolo !== "direzione";
  const link = (o: { s?: string; p?: number }) => `/campagne/${id}?${new URLSearchParams({ s: o.s ?? filtro, p: String(o.p ?? 1) })}`;
  type Ass = { utente: { nome: string; ruolo: string } | null };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <Link href="/campagne" className="text-sm">← Campagne</Link>
          <h1 className="text-2xl md:text-3xl font-semibold mt-1">{nomeCampagna(c)}</h1>
          {c.note && <p className="text-sm text-text-secondary">{c.note}</p>}
          {p.ruolo === "admin" && (
            <p className="text-sm text-text-secondary mt-1">
              Assegnata a: {((assegnati ?? []) as unknown as Ass[]).map((a) => a.utente?.nome).filter(Boolean).join(", ") || "nessuno"} ·{" "}
              <Link href="/controllo">gestisci</Link>
            </p>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {componi ? (
            <>
              <GestioneCampagna id={id} comune={c.comune} edizione={c.edizione} note={c.note} puoEliminare={p.ruolo === "admin"} />
              <StatoSelect id={id} stato={c.stato as StatoCampagna} />
            </>
          ) : null}
          {c.stato === "in_corso" && (p.ruolo === "admin" || p.ruolo === "operatore") && <Link className="btn btn-primary" href={`/coda?c=${id}`}>Apri la coda</Link>}
        </div>
      </div>

      <section className="card p-4 flex flex-wrap gap-2">
        <Link href={link({ s: "" })} className={`tag !text-sm !px-3 !py-1.5 no-underline ${!filtro ? "!bg-foreground !text-white" : ""}`}>Tutte ({numero(totale)})</Link>
        {(Object.keys(STATO_CA_LABEL) as StatoInCampagna[]).map((s) => (
          <Link key={s} href={link({ s })} className={`tag !text-sm !px-3 !py-1.5 no-underline ${filtro === s ? "!bg-foreground !text-white" : ""}`}>
            {STATO_CA_LABEL[s]} ({numero(cnt.get(s) ?? 0)})
          </Link>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card overflow-x-auto lg:col-span-2">
          <table className="tabella">
            <thead><tr><th>Azienda</th><th>Comune</th><th>Stato</th><th>Ultimo esito</th><th>Tentativi</th></tr></thead>
            <tbody>
              {elenco.map((r) => (
                <tr key={r.id}>
                  <td>{r.azienda ? <Link href={`/aziende/${r.azienda.id}`}>{r.azienda.ragione_sociale}</Link> : "—"}</td>
                  <td>{r.azienda?.comune ?? "—"}</td>
                  <td>
                    <span className={`tag ${r.stato === "appuntamento" ? "tag-blue" : r.stato === "richiamare" ? "tag-warn" : ""}`}>{STATO_CA_LABEL[r.stato]}</span>
                    {r.stato === "richiamare" && <div className="text-xs text-text-secondary mt-1">{giornoOra(r.prossimo_richiamo)}</div>}
                  </td>
                  <td>{r.ultimo_esito ? ESITO_LABEL[r.ultimo_esito] : "—"}{r.ultimo_contatto_at && <div className="text-xs text-text-secondary">{giornoOra(r.ultimo_contatto_at)}</div>}</td>
                  <td>{r.tentativi}</td>
                </tr>
              ))}
              {elenco.length === 0 && <tr><td colSpan={5} className="text-text-secondary">Nessuna azienda{filtro ? " in questo stato" : " in lista: componi la lista o importa un file"}.</td></tr>}
            </tbody>
          </table>
          {pagine > 1 && (
            <div className="flex justify-end gap-2 items-center p-3 text-sm text-text-secondary">
              {pagina > 1 && <Link className="btn btn-sm" href={link({ p: pagina - 1 })}>←</Link>}
              Pagina {pagina} di {pagine}
              {pagina < pagine && <Link className="btn btn-sm" href={link({ p: pagina + 1 })}>→</Link>}
            </div>
          )}
        </section>

        <div className="flex flex-col gap-5 min-w-0">
          {componi && <ComponiLista campagnaId={id} comune={c.comune} altre={(altre ?? []).map((a) => ({ id: a.id, nome: nomeCampagna(a) }))} />}
          {(p.ruolo === "admin" || p.ruolo === "operatore") && <AggiuntaLibera campagnaId={id} cercaArchivio={componi} comune={c.comune} />}
          {puo(p, "importare") && p.ruolo !== "direzione" && (
            <Link href={`/import?c=${id}`} className="btn">Importa un file in questa campagna</Link>
          )}
        </div>
      </div>
    </div>
  );
}
