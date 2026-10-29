import Link from "next/link";
import { richiediProfilo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { calcolaPeriodo, PERIODI, type Periodo } from "@/lib/periodo";
import { giornoOra, nomeCampagna, numero } from "@/lib/format";

type Inc = {
  incaricato_id: string; nome: string; zona: string | null; attivo: boolean;
  ricevuti: number; svolti: number; rimandati: number; non_svolti: number;
  contratti: number; trattativa: number; no_contratto: number; mancanti: number; prossimi7: number;
};
type Op = { operatore_id: string; nome: string; giorni_attivi: number; chiamate: number; utili: number; appuntamenti: number; passati: number; svolti: number; contratti: number };
type Sett = { settimana: string; ricevuti: number; svolti: number; contratti: number };
type App = {
  id: string; inizio: string; fine: string; modalita: string;
  esito_incontro: string | null; esito_contratto: string | null; esito_note: string | null;
  campagna: { comune: string; edizione: string } | null;
  azienda: { id: string; ragione_sociale: string } | null;
};

const perc = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
const n = (x: unknown) => Number(x ?? 0);

export default async function AndamentoPage({ searchParams }: PageProps<"/andamento">) {
  await richiediProfilo(["admin", "direzione"]);
  const sp = await searchParams;
  const periodo = (PERIODI.find((p) => p.id === sp.p)?.id ?? "mese") as Periodo;
  const r = calcolaPeriodo(periodo, String(sp.da ?? ""), String(sp.a ?? ""));
  const campagna = typeof sp.c === "string" && sp.c ? sp.c : null;
  const supabase = await createClient();

  const [{ data: incData }, { data: opData }, { data: campagne }] = await Promise.all([
    supabase.rpc("andamento_incaricati", { p_da: r.da.toISOString(), p_a: r.a.toISOString(), p_campagna: campagna }),
    supabase.rpc("andamento_operatori", { p_da: r.da.toISOString(), p_a: r.a.toISOString(), p_campagna: campagna }),
    supabase.from("campagne").select("id, comune, edizione").order("comune").order("edizione", { ascending: false }),
  ]);

  const incaricati = ((incData ?? []) as Inc[])
    .map((x) => ({ ...x, ricevuti: n(x.ricevuti), svolti: n(x.svolti), rimandati: n(x.rimandati), non_svolti: n(x.non_svolti), contratti: n(x.contratti), trattativa: n(x.trattativa), no_contratto: n(x.no_contratto), mancanti: n(x.mancanti), prossimi7: n(x.prossimi7) }))
    .sort((a, b) => b.contratti - a.contratti || b.svolti - a.svolti || a.nome.localeCompare(b.nome));
  const operatori = ((opData ?? []) as Op[]).map((x) => ({ ...x, giorni_attivi: n(x.giorni_attivi), chiamate: n(x.chiamate), utili: n(x.utili), appuntamenti: n(x.appuntamenti), passati: n(x.passati), svolti: n(x.svolti), contratti: n(x.contratti) }))
    .sort((a, b) => b.contratti - a.contratti || b.appuntamenti - a.appuntamenti);

  const tot = incaricati.reduce(
    (t, x) => ({ ricevuti: t.ricevuti + x.ricevuti, svolti: t.svolti + x.svolti, contratti: t.contratti + x.contratti, trattativa: t.trattativa + x.trattativa, mancanti: t.mancanti + x.mancanti }),
    { ricevuti: 0, svolti: 0, contratti: 0, trattativa: 0, mancanti: 0 }
  );

  const selId = (typeof sp.i === "string" && incaricati.some((x) => x.incaricato_id === sp.i) ? sp.i : incaricati[0]?.incaricato_id) ?? null;
  const sel = incaricati.find((x) => x.incaricato_id === selId) ?? null;

  let settimane: Sett[] = [];
  let periodoApp: App[] = [];
  let mancanti: App[] = [];
  let prossimi: App[] = [];
  let emailSel: string | null = null;
  if (sel) {
    const campi = "id, inizio, fine, modalita, esito_incontro, esito_contratto, esito_note, campagna:campagne(comune, edizione), azienda:aziende(id, ragione_sociale)";
    const adesso = new Date().toISOString();
    let qPeriodo = supabase.from("appuntamenti").select(campi).eq("incaricato_id", sel.incaricato_id).eq("annullato", false).gte("inizio", r.da.toISOString()).lt("inizio", r.a.toISOString());
    let qMancanti = supabase.from("appuntamenti").select(campi).eq("incaricato_id", sel.incaricato_id).eq("annullato", false).is("esito_incontro", null).lt("fine", adesso);
    let qProssimi = supabase.from("appuntamenti").select(campi).eq("incaricato_id", sel.incaricato_id).eq("annullato", false).gte("inizio", adesso);
    if (campagna) {
      qPeriodo = qPeriodo.eq("campagna_id", campagna);
      qMancanti = qMancanti.eq("campagna_id", campagna);
      qProssimi = qProssimi.eq("campagna_id", campagna);
    }
    const [s, pa, ma, pr, em] = await Promise.all([
      supabase.rpc("andamento_settimane", { p_incaricato: sel.incaricato_id, p_settimane: 8, p_campagna: campagna }),
      qPeriodo.limit(1000),
      qMancanti.order("inizio").limit(20),
      qProssimi.order("inizio").limit(8),
      supabase.from("profili").select("email").eq("id", sel.incaricato_id).maybeSingle(),
    ]);
    settimane = ((s.data ?? []) as Sett[]).map((x) => ({ ...x, ricevuti: n(x.ricevuti), svolti: n(x.svolti), contratti: n(x.contratti) }));
    periodoApp = (pa.data ?? []) as unknown as App[];
    mancanti = (ma.data ?? []) as unknown as App[];
    prossimi = (pr.data ?? []) as unknown as App[];
    emailSel = em.data?.email ?? null;
  }

  // per campagna (incaricato selezionato)
  const perCampagna = new Map<string, { ricevuti: number; svolti: number; contratti: number }>();
  for (const a of periodoApp) {
    const k = a.campagna ? nomeCampagna(a.campagna) : "—";
    const v = perCampagna.get(k) ?? { ricevuti: 0, svolti: 0, contratti: 0 };
    v.ricevuti++;
    if (a.esito_incontro === "svolto") v.svolti++;
    if (a.esito_contratto === "firmato") v.contratti++;
    perCampagna.set(k, v);
  }
  const motivi = periodoApp.filter((a) => a.esito_contratto === "no" && a.esito_note).map((a) => ({ azienda: a.azienda?.ragione_sociale ?? "", nota: a.esito_note! }));
  const maxSett = Math.max(1, ...settimane.map((x) => x.ricevuti));

  const qs = (o: Record<string, string | null | undefined>) => {
    const base: Record<string, string> = { p: periodo };
    if (periodo === "date") { base.da = r.daStr; base.a = r.aStr; }
    if (campagna) base.c = campagna;
    if (selId) base.i = selId;
    for (const [k, v] of Object.entries(o)) { if (v) base[k] = v; else delete base[k]; }
    return `/andamento?${new URLSearchParams(base)}`;
  };

  const promemoria = emailSel && mancanti.length
    ? `mailto:${emailSel}?subject=${encodeURIComponent("Esiti appuntamenti da compilare")}&body=${encodeURIComponent(
        `Ciao ${sel?.nome ?? ""},\nnel CRM mancano ancora gli esiti di questi appuntamenti:\n\n${mancanti.map((m) => `- ${m.azienda?.ragione_sociale} (${giornoOra(m.inizio)})`).join("\n")}\n\nLi trovi in "I miei appuntamenti" → "Esito da compilare".\nGrazie!`
      )}`
    : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Andamento agenti</h1>
          <p className="text-sm text-text-secondary">Dal {r.daStr.split("-").reverse().join("/")} al {r.aStr.split("-").reverse().join("/")}{campagna ? ` · ${campagne?.find((c) => c.id === campagna) ? nomeCampagna(campagne.find((c) => c.id === campagna)!) : ""}` : " · tutte le campagne"}</p>
        </div>
        <form className="flex flex-wrap gap-2 items-end" action="/andamento">
          <div>
            <label className="sr-only" htmlFor="p">Periodo</label>
            <select id="p" name="p" defaultValue={periodo} className="!w-auto">
              {PERIODI.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="flex gap-1 items-center text-sm">
            <label className="sr-only" htmlFor="da">Dal</label>
            <input id="da" name="da" type="date" defaultValue={r.daStr} className="!w-auto" />
            <label className="sr-only" htmlFor="a">Al</label>
            <input id="a" name="a" type="date" defaultValue={r.aStr} className="!w-auto" />
          </div>
          <div>
            <label className="sr-only" htmlFor="c">Campagna</label>
            <select id="c" name="c" defaultValue={campagna ?? ""} className="!w-auto">
              <option value="">Tutte le campagne</option>
              {(campagne ?? []).map((c) => <option key={c.id} value={c.id}>{nomeCampagna(c)}</option>)}
            </select>
          </div>
          <button className="btn btn-primary">Aggiorna</button>
        </form>
      </div>
      <p className="text-xs text-text-secondary -mt-3">Le date a scelta valgono quando il periodo è “Date a scelta”.</p>

      <section className="card p-5 grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi v={numero(tot.ricevuti)} l="appuntamenti nel periodo" />
        <Kpi v={numero(tot.svolti)} l="svolti" />
        <Kpi v={numero(tot.contratti)} l="contratti firmati" />
        <Kpi v={perc(tot.contratti, tot.svolti) == null ? "—" : `${perc(tot.contratti, tot.svolti)}%`} l="chiusura (contratti / svolti)" />
        <Kpi v={numero(tot.trattativa)} l="in trattativa" />
        <Kpi v={numero(tot.mancanti)} l="esiti non compilati" rosso={tot.mancanti > 0} />
      </section>

      <section className="card overflow-x-auto">
        <div className="flex justify-between items-baseline px-4 pt-4 pb-1 gap-2 flex-wrap">
          <h2 className="font-semibold">Incaricati</h2>
          <span className="text-xs text-text-secondary">Clicca un nome per il dettaglio</span>
        </div>
        <table className="tabella">
          <thead><tr><th>Incaricato</th><th>Zona</th><th>Ricevuti</th><th>Svolti</th><th>Rimandati / non svolti</th><th>Contratti</th><th>In trattativa</th><th>% chiusura</th><th>Esiti mancanti</th><th>Prossimi 7 gg</th></tr></thead>
          <tbody>
            {incaricati.map((x) => {
              const pc = perc(x.contratti, x.svolti);
              return (
                <tr key={x.incaricato_id} className={x.incaricato_id === selId ? "bg-accent-bg" : ""}>
                  <td><Link href={qs({ i: x.incaricato_id })} className={x.incaricato_id === selId ? "font-semibold" : ""}>{x.nome || "—"}</Link>{!x.attivo && <span className="tag ml-2">disattivato</span>}</td>
                  <td>{x.zona ?? "—"}</td>
                  <td>{x.ricevuti}</td>
                  <td>{x.svolti}</td>
                  <td>{x.rimandati} / {x.non_svolti}</td>
                  <td><strong>{x.contratti}</strong></td>
                  <td>{x.trattativa}</td>
                  <td>
                    {pc == null ? "—" : (
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 rounded-full bg-surface-muted overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pc}%` }} /></div>{pc}%
                      </div>
                    )}
                  </td>
                  <td>{x.mancanti > 0 ? <span className="tag tag-red">{x.mancanti}</span> : 0}</td>
                  <td>{x.prossimi7}</td>
                </tr>
              );
            })}
            {incaricati.length === 0 && <tr><td colSpan={10} className="text-text-secondary">Nessun incaricato o nessun appuntamento nel periodo.</td></tr>}
          </tbody>
        </table>
      </section>

      {sel && (
        <div className="grid gap-5 lg:grid-cols-5">
          <section className="card p-5 lg:col-span-3 flex flex-col gap-4 min-w-0">
            <div className="flex justify-between items-baseline flex-wrap gap-2">
              <h2 className="font-semibold">{sel.nome} · ultime 8 settimane</h2>
              <div className="flex gap-4 text-xs text-text-secondary">
                <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#9ccbe3] align-middle" /> appuntamenti</span>
                <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-accent-text align-middle" /> contratti</span>
              </div>
            </div>
            <div className="flex gap-2 items-end h-40" role="img" aria-label={`Appuntamenti e contratti per settimana di ${sel.nome}`}>
              {settimane.map((w) => (
                <div key={w.settimana} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                  <div className="text-[11px] text-text-secondary">{w.ricevuti > 0 ? `${w.contratti}/${w.ricevuti}` : ""}</div>
                  <div className="w-full max-w-9 flex flex-col justify-end rounded-t overflow-hidden" style={{ height: `${(w.ricevuti / maxSett) * 100}%`, minHeight: w.ricevuti ? 4 : 0 }}>
                    <div className="bg-accent-text" style={{ height: `${w.ricevuti ? (w.contratti / w.ricevuti) * 100 : 0}%` }} />
                    <div className="bg-[#9ccbe3] flex-1" />
                  </div>
                  <div className="text-[11px] text-text-secondary whitespace-nowrap">{w.settimana.slice(8, 10)}/{w.settimana.slice(5, 7)}</div>
                </div>
              ))}
            </div>
            <table className="tabella">
              <thead><tr><th>Per campagna (periodo scelto)</th><th>Ricevuti</th><th>Svolti</th><th>Contratti</th><th>% chiusura</th></tr></thead>
              <tbody>
                {[...perCampagna.entries()].map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td>{v.ricevuti}</td><td>{v.svolti}</td><td>{v.contratti}</td><td>{perc(v.contratti, v.svolti) == null ? "—" : `${perc(v.contratti, v.svolti)}%`}</td></tr>
                ))}
                {perCampagna.size === 0 && <tr><td colSpan={5} className="text-text-secondary">Nessun appuntamento nel periodo.</td></tr>}
              </tbody>
            </table>
          </section>

          <div className="lg:col-span-2 flex flex-col gap-5 min-w-0">
            <section className="card p-5">
              <h2 className="font-semibold mb-2">Esiti da compilare</h2>
              {mancanti.length === 0 ? <p className="text-sm text-text-secondary">Tutto compilato.</p> : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {mancanti.map((m) => (
                    <li key={m.id}><span className="tag tag-red mr-1">{giornoOra(m.inizio)}</span> {m.azienda?.ragione_sociale}</li>
                  ))}
                </ul>
              )}
              {promemoria && <a href={promemoria} className="btn btn-sm mt-3">Manda un promemoria a {sel.nome}</a>}
            </section>
            <section className="card p-5">
              <h2 className="font-semibold mb-2">Prossimi appuntamenti</h2>
              {prossimi.length === 0 ? <p className="text-sm text-text-secondary">Nessuno in programma.</p> : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {prossimi.map((m) => (
                    <li key={m.id}><span className="text-text-secondary">{giornoOra(m.inizio)}</span> · {m.azienda ? <Link href={`/aziende/${m.azienda.id}`}>{m.azienda.ragione_sociale}</Link> : "—"}{m.modalita === "video" && <span className="tag ml-1">video</span>}</li>
                  ))}
                </ul>
              )}
            </section>
            <section className="card p-5">
              <h2 className="font-semibold mb-2">Perché non firmano</h2>
              {motivi.length === 0 ? <p className="text-sm text-text-secondary">Nessuna nota sui contratti non firmati nel periodo.</p> : (
                <ul className="flex flex-col gap-1.5 text-sm">
                  {motivi.slice(0, 10).map((m, i) => <li key={i}><strong>{m.azienda}</strong>: <span className="text-text-secondary">{m.nota}</span></li>)}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      <section className="card overflow-x-auto">
        <h2 className="font-semibold px-4 pt-4 pb-1">Operatori telefonici</h2>
        <table className="tabella">
          <thead><tr><th>Operatore</th><th>Giorni attivi</th><th>Chiamate</th><th>Chiamate / giorno</th><th>Contatti utili</th><th>Appuntamenti fissati</th><th>Chiamate per appuntamento</th><th>Poi svolti</th><th>Contratti generati</th></tr></thead>
          <tbody>
            {operatori.map((o) => (
              <tr key={o.operatore_id}>
                <td>{o.nome}</td>
                <td>{o.giorni_attivi}</td>
                <td>{numero(o.chiamate)}</td>
                <td>{o.giorni_attivi ? Math.round(o.chiamate / o.giorni_attivi) : "—"}</td>
                <td>{numero(o.utili)}</td>
                <td>{o.appuntamenti}</td>
                <td>{o.appuntamenti ? Math.round(o.chiamate / o.appuntamenti) : "—"}</td>
                <td>{perc(o.svolti, o.passati) == null ? "—" : `${perc(o.svolti, o.passati)}%`}</td>
                <td><strong>{o.contratti}</strong></td>
              </tr>
            ))}
            {operatori.length === 0 && <tr><td colSpan={9} className="text-text-secondary">Nessuna chiamata nel periodo.</td></tr>}
          </tbody>
        </table>
        <p className="text-xs text-text-secondary px-4 pb-4 pt-2">
          “Contatti utili”: chiamate con una risposta (esclusi non risponde, occupato, segreteria, numero errato). “Poi svolti”: tra gli appuntamenti già passati.
          “Contratti generati”: firmati dagli incaricati su appuntamenti fissati da quell&apos;operatore.
        </p>
      </section>
    </div>
  );
}

function Kpi({ v, l, rosso }: { v: string; l: string; rosso?: boolean }) {
  return (
    <div className="text-sm text-text-secondary">
      <strong className={`block text-2xl font-semibold ${rosso ? "text-danger-text" : "text-foreground"}`}>{v}</strong>
      {l}
    </div>
  );
}
