import "server-only";
import crypto from "node:crypto";

// Google Calendar tramite account di servizio con delega a livello di dominio
// (Google Workspace welfarecare.org). Il CRM agisce "come" l'incaricato, solo sul suo calendario.
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events.owned",
  "https://www.googleapis.com/auth/calendar.freebusy",
].join(" ");

export function calendarioAttivo() {
  return !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY);
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

const cacheToken = new Map<string, { token: string; scade: number }>();

async function token(utente: string) {
  const c = cacheToken.get(utente);
  if (c && c.scade > Date.now() + 60_000) return c.token;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL!;
  const chiave = process.env.GOOGLE_PRIVATE_KEY!.replace(/\\n/g, "\n");
  const ora = Math.floor(Date.now() / 1000);
  const testa = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64url(JSON.stringify({ iss: email, scope: SCOPES, aud: "https://oauth2.googleapis.com/token", iat: ora, exp: ora + 3600, sub: utente }));
  const firma = b64url(crypto.sign("RSA-SHA256", Buffer.from(`${testa}.${corpo}`), chiave));

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${testa}.${corpo}.${firma}` }),
    cache: "no-store",
  });
  const j = await res.json();
  if (!res.ok) {
    if (j.error === "unauthorized_client") throw new Error("Google non ha ancora autorizzato il CRM (delega a livello di dominio non configurata o permessi mancanti).");
    if (j.error === "invalid_grant") throw new Error(`L'account ${utente} non esiste nel Google Workspace aziendale.`);
    throw new Error(`Google: ${j.error_description ?? j.error ?? res.status}`);
  }
  cacheToken.set(utente, { token: j.access_token, scade: Date.now() + j.expires_in * 1000 });
  return j.access_token as string;
}

async function api(utente: string, percorso: string, init?: RequestInit) {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${percorso}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token(utente)}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 204) return null;
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Calendar: ${j?.error?.message ?? res.status}`);
  return j;
}

/** Intervalli occupati nel calendario principale dell'utente */
export async function occupato(utente: string, da: Date, a: Date): Promise<{ inizio: string; fine: string }[]> {
  const j = await api(utente, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: da.toISOString(), timeMax: a.toISOString(), timeZone: "Europe/Rome", items: [{ id: utente }] }),
  });
  const cal = j?.calendars?.[utente];
  if (cal?.errors?.length) throw new Error(`Calendario di ${utente} non leggibile (${cal.errors[0].reason})`);
  return (cal?.busy ?? []).map((b: { start: string; end: string }) => ({ inizio: b.start, fine: b.end }));
}

export type Evento = {
  titolo: string;
  luogo?: string;
  descrizione: string;
  inizio: string;
  fine: string;
  video: boolean;
  invitati?: string[];
};

/** Crea l'evento nel calendario dell'utente; restituisce id e link */
export async function creaEvento(utente: string, e: Evento): Promise<{ id: string; link?: string; meet?: string }> {
  const corpo: Record<string, unknown> = {
    summary: e.titolo,
    location: e.luogo,
    description: e.descrizione,
    start: { dateTime: e.inizio, timeZone: "Europe/Rome" },
    end: { dateTime: e.fine, timeZone: "Europe/Rome" },
    attendees: (e.invitati ?? []).map((email) => ({ email })),
    reminders: { useDefault: true },
  };
  if (e.video) corpo.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
  const q = new URLSearchParams({ sendUpdates: e.invitati?.length ? "all" : "none", conferenceDataVersion: e.video ? "1" : "0" });
  const j = await api(utente, `/calendars/primary/events?${q}`, { method: "POST", body: JSON.stringify(corpo) });
  return { id: j.id, link: j.htmlLink, meet: j.hangoutLink };
}

export async function eliminaEvento(utente: string, id: string, avvisaInvitati: boolean) {
  await api(utente, `/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=${avvisaInvitati ? "all" : "none"}`, { method: "DELETE" });
}
