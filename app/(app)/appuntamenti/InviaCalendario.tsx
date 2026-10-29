"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { inviaAlCalendario } from "@/lib/calendarioAzioni";

export default function InviaCalendario({ id }: { id: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-1.5">
      <button
        className="btn btn-sm self-start"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await inviaAlCalendario({ appuntamentoId: id, invitaAzienda: false });
            setMsg({ ok: r.ok, t: r.messaggio });
            if (r.ok) router.refresh();
          })
        }
      >
        {pending ? "Invio…" : "Scrivi nel calendario dell'incaricato"}
      </button>
      {msg && <div className={`avviso text-sm ${msg.ok ? "avviso-ok" : "avviso-warn"}`}>{msg.t}</div>}
    </div>
  );
}
