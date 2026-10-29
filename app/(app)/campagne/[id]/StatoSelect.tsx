"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { STATO_CAMPAGNA_LABEL, type StatoCampagna } from "@/lib/types";

export default function StatoSelect({ id, stato }: { id: string; stato: StatoCampagna }) {
  const router = useRouter();
  const [v, setV] = useState(stato);
  async function cambia(n: StatoCampagna) {
    setV(n);
    const { error } = await createClient().from("campagne").update({ stato: n }).eq("id", id);
    if (error) { alert(error.message); setV(stato); return; }
    router.refresh();
  }
  return (
    <div>
      <label className="sr-only" htmlFor="stato-c">Stato campagna</label>
      <select id="stato-c" value={v} onChange={(e) => cambia(e.target.value as StatoCampagna)} className="!w-auto">
        {(Object.keys(STATO_CAMPAGNA_LABEL) as StatoCampagna[]).map((s) => <option key={s} value={s}>{STATO_CAMPAGNA_LABEL[s]}</option>)}
      </select>
    </div>
  );
}
