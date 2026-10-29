"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ESITO_CONTRATTO_LABEL, ESITO_INCONTRO_LABEL } from "@/lib/types";

type Inc = keyof typeof ESITO_INCONTRO_LABEL;
type Con = keyof typeof ESITO_CONTRATTO_LABEL;

export default function EsitoForm({ id, iniziale }: { id: string; iniziale: { incontro: Inc | null; contratto: Con | null; note: string | null } }) {
  const router = useRouter();
  const [aperto, setAperto] = useState(!iniziale.incontro);
  const [incontro, setIncontro] = useState<Inc | null>(iniziale.incontro);
  const [contratto, setContratto] = useState<Con | null>(iniziale.contratto);
  const [note, setNote] = useState(iniziale.note ?? "");
  const [errore, setErrore] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!aperto) {
    return <button className="btn btn-sm self-start" onClick={() => setAperto(true)}>Modifica esito</button>;
  }

  async function salva() {
    if (!incontro) return setErrore("Scegli com'è andato l'incontro.");
    if (incontro === "svolto" && !contratto) return setErrore("Indica l'esito del contratto.");
    setBusy(true);
    const { error } = await createClient().rpc("salva_esito_appuntamento", {
      p_app: id, p_incontro: incontro, p_contratto: incontro === "svolto" ? contratto : null, p_note: note,
    });
    setBusy(false);
    if (error) return setErrore(error.message);
    setAperto(false);
    router.refresh();
  }

  const scelta = (sel: boolean) => `btn btn-sm flex-1 ${sel ? "btn-primary" : ""}`;

  return (
    <div className="border-t border-border pt-3 mt-1 flex flex-col gap-2">
      <div className="text-sm font-semibold">Com&apos;è andato?</div>
      <div className="flex gap-2">
        {(Object.keys(ESITO_INCONTRO_LABEL) as Inc[]).map((k) => (
          <button key={k} type="button" aria-pressed={incontro === k} className={scelta(incontro === k)} onClick={() => setIncontro(k)}>{ESITO_INCONTRO_LABEL[k]}</button>
        ))}
      </div>
      {incontro === "svolto" && (
        <>
          <div className="text-sm font-semibold">Contratto</div>
          <div className="flex gap-2">
            {(Object.keys(ESITO_CONTRATTO_LABEL) as Con[]).map((k) => (
              <button key={k} type="button" aria-pressed={contratto === k} className={scelta(contratto === k)} onClick={() => setContratto(k)}>{ESITO_CONTRATTO_LABEL[k]}</button>
            ))}
          </div>
        </>
      )}
      <label className="label !mb-0" htmlFor={`n-${id}`}>Note</label>
      <textarea id={`n-${id}`} value={note} onChange={(e) => setNote(e.target.value)} className="!min-h-16" />
      {errore && <div className="avviso avviso-err">{errore}</div>}
      <button className="btn btn-dark self-start" onClick={salva} disabled={busy}>Salva esito</button>
    </div>
  );
}
