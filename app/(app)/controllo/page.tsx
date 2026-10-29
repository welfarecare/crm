import Link from "next/link";
import { richiediProfilo } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { giornoOra, nomeCampagna, numero } from "@/lib/format";
import { RUOLO_LABEL, type Profilo } from "@/lib/types";
import DettaglioUtente from "./DettaglioUtente";
import NuovoUtente from "./NuovoUtente";

const LIMITE_GRATUITO = 500 * 1024 * 1024;

export default async function ControlloPage({ searchParams }: PageProps<"/controllo">) {
  const me = await richiediProfilo(["admin"]);
  const sp = await searchParams;
  const supabase = await createClient();

  const [{ data: utenti }, { data: campagne }, { data: assegnazioni }, { data: sistema }, { data: registro }] = await Promise.all([
    supabase.from("profili").select("*").order("attivo", { ascending: false }).order("ruolo").order("nome"),
    supabase.from("campagne").select("id, comune, edizione, stato").order("stato").order("comune"),
    supabase.from("campagne_assegnazioni").select("campagna_id, utente_id"),
    supabase.rpc("stato_sistema"),
    supabase.from("registro_attivita").select("azione, created_at, utente:profili(nome)").order("created_at", { ascending: false }).limit(40),
  ]);

  const lista = (utenti ?? []) as Profilo[];
  const camp = campagne ?? [];
  const nomeC = new Map(camp.map((c) => [c.id, nomeCampagna(c)]));
  const perUtente = new Map<string, string[]>();
  (assegnazioni ?? []).forEach((a) => perUtente.set(a.utente_id, [...(perUtente.get(a.utente_id) ?? []), a.campagna_id]));
  const sel = lista.find((u) => u.id === sp.u) ?? null;
  const s = sistema as { db_bytes: number; aziende: number; chiamate: number; appuntamenti: number } | null;
  const percento = s ? Math.round((s.db_bytes / LIMITE_GRATUITO) * 100) : 0;
  type Reg = { azione: string; created_at: string; utente: { nome: string } | null };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold">Centro di controllo</h1>
        <p className="text-sm text-text-secondary">Visibile solo all&apos;amministratore.</p>
      </div>

      <section className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="k">Database (piano gratuito: 500 MB)</div>
          <div className="text-xl font-semibold">{s ? `${(s.db_bytes / 1024 / 1024).toFixed(0)} MB` : "—"}</div>
          <div className="h-2 rounded-full bg-surface-muted mt-2 overflow-hidden"><div className={`h-full ${percento >= 70 ? "bg-danger" : "bg-accent"}`} style={{ width: `${Math.min(100, percento)}%` }} /></div>
          {percento >= 70 && <div className="text-xs text-danger-text mt-1">Oltre il 70%: è il momento di passare a Supabase Pro.</div>}
        </div>
        <div className="card p-4"><div className="k">Aziende in archivio</div><div className="text-xl font-semibold">{numero(s?.aziende)}</div></div>
        <div className="card p-4"><div className="k">Chiamate registrate</div><div className="text-xl font-semibold">{numero(s?.chiamate)}</div></div>
        <div className="card p-4"><div className="k">Appuntamenti</div><div className="text-xl font-semibold">{numero(s?.appuntamenti)}</div></div>
      </section>

      <div className="grid gap-5 xl:grid-cols-5">
        <section className="card xl:col-span-3 overflow-x-auto self-start">
          <div className="flex justify-between items-center p-4 pb-1"><h2 className="font-semibold">Utenti</h2></div>
          <table className="tabella">
            <thead><tr><th>Nome</th><th>Ruolo</th><th>Campagne</th><th>Stato</th></tr></thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.id} className={sel?.id === u.id ? "bg-accent-bg" : ""}>
                  <td><Link href={`/controllo?u=${u.id}`}>{u.nome || u.email}</Link><div className="text-xs text-text-secondary">{u.email}</div></td>
                  <td>{RUOLO_LABEL[u.ruolo]}{u.zona ? <div className="text-xs text-text-secondary">{u.zona}</div> : null}</td>
                  <td className="text-sm">
                    {u.ruolo === "admin" || u.ruolo === "direzione" ? <span className="text-text-secondary">Tutte</span> :
                      (perUtente.get(u.id) ?? []).map((c) => nomeC.get(c)).filter(Boolean).join(", ") || <span className="text-text-secondary">nessuna</span>}
                  </td>
                  <td>{u.attivo ? <span className="tag tag-blue">Attivo</span> : <span className="tag">Disattivato</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-text-secondary p-4 pt-2">Disattivare un utente blocca subito l&apos;accesso; tutto lo storico che ha registrato resta.</p>
        </section>

        <div className="xl:col-span-2 flex flex-col gap-5">
          {sel ? (
            <DettaglioUtente
              key={sel.id}
              utente={sel}
              sonoIo={sel.id === me.id}
              campagne={camp.map((c) => ({ id: c.id, nome: nomeCampagna(c), stato: c.stato }))}
              assegnate={perUtente.get(sel.id) ?? []}
            />
          ) : (
            <div className="card p-5 text-sm text-text-secondary">Seleziona un utente per modificarne ruolo, campagne e funzioni.</div>
          )}
          <NuovoUtente />
        </div>
      </div>

      <section className="card p-5 overflow-x-auto">
        <h2 className="font-semibold mb-2">Registro attività</h2>
        <table className="tabella">
          <tbody>
            {((registro ?? []) as unknown as Reg[]).map((r, i) => (
              <tr key={i}><td className="text-text-secondary whitespace-nowrap w-44">{giornoOra(r.created_at)}</td><td><strong>{r.utente?.nome ?? "—"}</strong> {r.azione}</td></tr>
            ))}
            {(registro ?? []).length === 0 && <tr><td className="text-text-secondary">Ancora nessuna attività.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
