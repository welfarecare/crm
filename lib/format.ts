const TZ = "Europe/Rome";

export function dataOra(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", {
    timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export function data(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("it-IT", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function giornoOra(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("it-IT", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function ora(d: string | Date | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("it-IT", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
}

export function numero(n: number | null | undefined) {
  return (n ?? 0).toLocaleString("it-IT");
}

export function nomeCampagna(c: { comune: string; edizione: string }) {
  return `${c.comune} · ${c.edizione}`;
}

/** Converte data e ora scritte nel browser (ora italiana locale) in ISO */
export function isoDaLocale(dataStr: string, oraStr: string) {
  return new Date(`${dataStr}T${oraStr}`).toISOString();
}

export function messaggioErrore(e: unknown) {
  if (e && typeof e === "object" && "message" in e) return String((e as { message: string }).message);
  return "Errore imprevisto";
}
