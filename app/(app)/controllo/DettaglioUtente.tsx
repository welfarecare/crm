"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PERMESSI_LABEL, RUOLO_LABEL, STATO_CAMPAGNA_LABEL, type Permessi, type Profilo, type Ruolo, type StatoCampagna } from "@/lib/types";
import { azzeraDoppiaVerifica, impostaAttivo, nuovaPassword, salvaUtente } from "./azioni";

export default function DettaglioUtente({
  utente, sonoIo, campagne, assegnate,
}: {
  utente: Profilo;
  sonoIo: boolean;
  campagne: { id: string; nome: string; stato: string }[];
  assegnate: string[];
}) {
  const router = useRouter();
  const [nome, setNome] = useState(utente.nome);
  const [ruolo, setRuolo] = useState<Ruolo>(utente.ruolo);
  const [zona, setZona] = useState(utente.zona ?? "");
  const [permessi, setPermessi] = useState<Permessi>({ ...PERMESSI_DEFAULT, ...utente.permessi });
  const [scelte, setScelte] = useState<Set<string>>(new Set(assegnate));
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();

  const vedeTutto = ruolo === "admin" || ruolo === "direzione";

  function salva() {
    start(async () => {
      const r = await salvaUtente(utente.id, { nome, ruolo, zona, permessi, campagne: [...scelte] });
      setMsg(r.ok ? { ok: true, t: "Salvato." } : { ok: false, t: r.errore });
      if (r.ok) router.refresh();
    });
  }
  function attiva(v: boolean) {
    if (!v && !confirm(`Disattivare ${utente.nome || utente.email}? Perderà subito l'accesso.`)) return;
    start(async () => {
      const r = await impostaAttivo(utente.id, v, utente.nome || utente.email);
      setMsg(r.ok ? { ok: true, t: v ? "Utente riattivato." : "Utente disattivato." } : { ok: false, t: r.errore });
      if (r.ok) router.refresh();
    });
  }
  function azzeraMfa() {
    if (!confirm("Azzerare la doppia verifica? Al prossimo accesso dovrà configurarla di nuovo con il telefono.")) return;
    start(async () => {
      const r = await azzeraDoppiaVerifica(utente.id, utente.nome || utente.email);
      setMsg(r.ok ? { ok: true, t: "Doppia verifica azzerata." } : { ok: false, t: r.errore });
    });
  }
  function cambiaPw() {
    start(async () => {
      const r = await nuovaPassword(utente.id, pw, utente.nome || utente.email);
      setMsg(r.ok ? { ok: true, t: "Nuova password impostata: comunicala a voce." } : { ok: false, t: r.errore });
      if (r.ok) setPw("");
    });
  }

  return (
    <section className="card p-5 flex flex-col gap-4">
      <div>
        <div className="k">Utente selezionato</div>
        <h2 className="text-lg font-semibold">{utente.nome || utente.email}{!utente.attivo && <span className="tag ml-2">Disattivato</span>}</h2>
        <div className="text-sm text-text-secondary">{utente.email}</div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="label" htmlFor="u-nome">Nome</label><input id="u-nome" value={nome} onChange={(e) => setNome(e.target.value)} /></div>
        <div>
          <label className="label" htmlFor="u-ruolo">Ruolo</label>
          <select id="u-ruolo" value={ruolo} disabled={sonoIo} onChange={(e) => setRuolo(e.target.value as Ruolo)}>
            {(Object.keys(RUOLO_LABEL) as Ruolo[]).map((r) => <option key={r} value={r}>{RUOLO_LABEL[r]}</option>)}
          </select>
        </div>
        {ruolo === "incaricato" && (
          <div className="col-span-2"><label className="label" htmlFor="u-zona">Zona</label><input id="u-zona" value={zona} onChange={(e) => setZona(e.target.value)} placeholder="es. Treviso ovest" /></div>
        )}
      </div>

      <div>
        <div className="label !mb-0.5">Campagne che può vedere</div>
        {vedeTutto ? (
          <p className="text-sm text-text-secondary">{RUOLO_LABEL[ruolo]}: vede tutte le campagne{ruolo === "direzione" ? " in sola lettura" : ""}.</p>
        ) : (
          <>
            <p className="text-xs text-text-secondary mb-1.5">
              {ruolo === "incaricato" ? "L'incaricato vede comunque i propri appuntamenti; qui puoi dargli anche la visione di intere campagne." : "Vede solo aziende, chiamate e appuntamenti di queste campagne."}
            </p>
            <div className="flex flex-col gap-1.5 max-h-56 overflow-auto">
              {campagne.map((c) => (
                <label key={c.id} className="flex gap-2 items-center text-sm">
                  <input type="checkbox" checked={scelte.has(c.id)} onChange={(e) => { const n = new Set(scelte); if (e.target.checked) n.add(c.id); else n.delete(c.id); setScelte(n); }} />
                  {c.nome} <span className="tag">{STATO_CAMPAGNA_LABEL[c.stato as StatoCampagna]}</span>
                </label>
              ))}
              {campagne.length === 0 && <span className="text-sm text-text-secondary">Nessuna campagna creata.</span>}
            </div>
          </>
        )}
      </div>

      {ruolo !== "admin" && ruolo !== "direzione" && (
        <div>
          <div className="label">Funzioni sbloccate</div>
          <div className="flex flex-col">
            {PERMESSI_LABEL.map((pl) => (
              <label key={pl.key} className="flex justify-between items-center gap-3 py-2 border-b border-surface-muted text-sm">
                <span>
                  {pl.label}
                  {pl.fase && <span className="tag ml-2">{pl.fase}</span>}
                  {pl.nota && <span className="block text-xs text-text-secondary">{pl.nota}</span>}
                </span>
                <input type="checkbox" role="switch" checked={!!permessi[pl.key]} onChange={(e) => setPermessi({ ...permessi, [pl.key]: e.target.checked })} />
              </label>
            ))}
          </div>
        </div>
      )}

      {msg && <div className={`avviso ${msg.ok ? "avviso-ok" : "avviso-err"}`}>{msg.t}</div>}
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={salva} disabled={pending}>Salva</button>
        {!sonoIo && (utente.attivo
          ? <button className="btn btn-danger" onClick={() => attiva(false)} disabled={pending}>Disattiva utente</button>
          : <button className="btn" onClick={() => attiva(true)} disabled={pending}>Riattiva utente</button>)}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-text-secondary">Imposta una nuova password</summary>
        <div className="flex gap-2 mt-2">
          <label className="sr-only" htmlFor="u-pw">Nuova password</label>
          <input id="u-pw" type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="almeno 12 caratteri" />
          <button className="btn" onClick={cambiaPw} disabled={pending || pw.length < 12}>Imposta</button>
        </div>
      </details>
      {!sonoIo && (
        <button className="btn btn-sm self-start" onClick={azzeraMfa} disabled={pending}>
          Azzera doppia verifica (telefono perso o cambiato)
        </button>
      )}
    </section>
  );
}

const PERMESSI_DEFAULT: Permessi = { importare: false, creare_campagne: false, gemini_lanciare: false, gemini_approvare: false, report: false, esportare: false };
