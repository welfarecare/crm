// Periodi in ora italiana, calcolati correttamente anche sul server (che lavora in UTC)
const TZ = "Europe/Rome";

function offsetMinuti(d: Date) {
  const parti = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d);
  const v = (t: string) => Number(parti.find((p) => p.type === t)?.value);
  const comeUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"));
  return (comeUtc - d.getTime()) / 60000;
}

/** mezzanotte italiana del giorno indicato */
export function mezzanotteRoma(anno: number, mese: number, giorno: number) {
  const guess = new Date(Date.UTC(anno, mese - 1, giorno));
  return new Date(guess.getTime() - offsetMinuti(guess) * 60000);
}

export function oggiRoma() {
  const [a, m, g] = new Date().toLocaleDateString("sv-SE", { timeZone: TZ }).split("-").map(Number);
  return { a, m, g };
}

export type Periodo = "mese" | "4sett" | "trim" | "anno" | "date";
export const PERIODI: { id: Periodo; label: string }[] = [
  { id: "mese", label: "Questo mese" },
  { id: "4sett", label: "Ultime 4 settimane" },
  { id: "trim", label: "Ultimi 3 mesi" },
  { id: "anno", label: "Quest'anno" },
  { id: "date", label: "Date a scelta" },
];

export function calcolaPeriodo(p: Periodo, da?: string, a?: string): { da: Date; a: Date; daStr: string; aStr: string } {
  const o = oggiRoma();
  const domani = mezzanotteRoma(o.a, o.m, o.g + 1);
  let inizio: Date;
  let fine = domani;
  switch (p) {
    case "4sett": inizio = mezzanotteRoma(o.a, o.m, o.g - 27); break;
    case "trim": inizio = mezzanotteRoma(o.a, o.m - 2, 1); break;
    case "anno": inizio = mezzanotteRoma(o.a, 1, 1); break;
    case "date": {
      const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
      if (ok(da) && ok(a)) {
        const [y1, m1, d1] = da!.split("-").map(Number);
        const [y2, m2, d2] = a!.split("-").map(Number);
        inizio = mezzanotteRoma(y1, m1, d1);
        fine = mezzanotteRoma(y2, m2, d2 + 1);
      } else inizio = mezzanotteRoma(o.a, o.m, 1);
      break;
    }
    default: inizio = mezzanotteRoma(o.a, o.m, 1);
  }
  const fmt = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: TZ });
  return { da: inizio, a: fine, daStr: fmt(inizio), aStr: fmt(new Date(fine.getTime() - 1)) };
}
