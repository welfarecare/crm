"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Voce = { href: string; label: string };

export default function Sidebar({ voci, nome, ruolo }: { voci: Voce[]; nome: string; ruolo: string }) {
  const path = usePathname();
  const router = useRouter();

  async function esci() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <nav
      aria-label="Menu principale"
      className="bg-surface border-b md:border-b-0 md:border-r border-border md:w-60 md:min-h-screen md:sticky md:top-0 md:h-screen flex md:flex-col gap-1 p-3 md:p-4 overflow-x-auto"
    >
      <Link href="/" className="hidden md:flex flex-col gap-1.5 px-3 pb-5 pt-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-welfarecare.svg" alt="WelfareCare" width={150} height={22} />
        <span className="text-xs text-text-secondary tracking-wide">CRM Telemarketing</span>
      </Link>
      {voci.map((v) => {
        const attiva = path === v.href || path.startsWith(v.href + "/");
        return (
          <Link
            key={v.href}
            href={v.href}
            className={`whitespace-nowrap rounded-lg px-3 py-2.5 text-sm ${
              attiva ? "bg-accent-bg text-accent-text font-semibold" : "text-foreground/80 hover:bg-surface-muted"
            } ${v.href === "/controllo" ? "md:mt-3" : ""}`}
          >
            {v.label}
          </Link>
        );
      })}
      <div className="md:mt-auto flex md:flex-col gap-2 md:px-3 md:pt-4 items-center md:items-start ml-auto md:ml-0">
        <Link href="/profilo" className="text-sm leading-tight whitespace-nowrap">
          <span className="text-xs text-text-secondary hidden md:block">{ruolo}</span>
          <strong>{nome || "Profilo"}</strong>
        </Link>
        <button onClick={esci} className="btn btn-sm btn-danger">Esci</button>
      </div>
    </nav>
  );
}
