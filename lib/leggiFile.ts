// Lettura "intelligente" di CSV ed Excel nel browser.
// Ogni operatore ha il suo formato: l'import trova da solo la riga dei titoli,
// riconosce le colonne (dal titolo o dal contenuto) e pulisce i valori.

export type FileLetto = { righe: string[][] }; // tutte le righe non vuote, così come sono

export async function leggiFile(file: File): Promise<FileLetto> {
  const nome = file.name.toLowerCase();
  if (nome.endsWith(".csv") || nome.endsWith(".txt")) return leggiCsv(file);
  if (nome.endsWith(".xlsx")) return leggiXlsx(file);
  if (nome.endsWith(".xls")) throw new Error("Il formato .xls (vecchio Excel) non è supportato: apri il file e salvalo come .xlsx o .csv.");
  throw new Error("Formato non supportato: usa .xlsx o .csv");
}

async function leggiCsv(file: File): Promise<FileLetto> {
  const Papa = (await import("papaparse")).default;
  const res = Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy" });
  const righe = res.data.map((r) => r.map(pulisciCella)).filter((r) => r.some((c) => c !== ""));
  if (righe.length === 0) throw new Error("Il file è vuoto");
  return { righe };
}

async function leggiXlsx(file: File): Promise<FileLetto> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  // il foglio con più righe compilate
  let migliore: string[][] = [];
  for (const ws of wb.worksheets) {
    const righe: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const valori: string[] = [];
      for (let c = 1; c <= ws.columnCount; c++) valori.push(pulisciCella(testoCella(row.getCell(c))));
      if (valori.some((v) => v !== "")) righe.push(valori);
    });
    if (righe.length > migliore.length) migliore = righe;
  }
  if (migliore.length === 0) throw new Error("Il file non contiene dati");
  return { righe: migliore };
}

function testoCella(cell: { value: unknown; text?: string }): string {
  const v = cell.value as unknown;
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: unknown; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.text != null) return typeof o.text === "string" ? o.text : String((o.text as { richText?: { text: string }[] }).richText?.map((t) => t.text).join("") ?? "");
    if (o.result != null) return String(o.result);
    if (o.hyperlink) return o.hyperlink;
  }
  return String(cell.text ?? "");
}

function pulisciCella(s: unknown) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Campi del CRM
// ---------------------------------------------------------------------------
export const CAMPI_IMPORT: { k: string; label: string; sinonimi: string[] }[] = [
  { k: "ragione_sociale", label: "Ragione sociale", sinonimi: ["ragione sociale", "denominazione", "nome azienda", "azienda", "aziende", "societa", "impresa", "ditta", "cliente", "company"] },
  { k: "piva", label: "P.IVA", sinonimi: ["partita iva", "p iva", "piva", "p iva cf", "vat", "codice fiscale"] },
  { k: "telefono", label: "Telefono", sinonimi: ["telefoni verificati", "telefono", "telefoni", "tel", "phone", "centralino", "numero di telefono", "recapito"] },
  { k: "email", label: "Mail", sinonimi: ["email", "e mail", "mail", "pec", "indirizzo email"] },
  { k: "sito", label: "Sito", sinonimi: ["sito", "sito web", "web", "website", "url"] },
  { k: "indirizzo", label: "Indirizzo", sinonimi: ["indirizzo completo", "indirizzo", "sede legale", "sede operativa", "address"] },
  { k: "comune", label: "Comune", sinonimi: ["comune", "citta", "localita", "city"] },
  { k: "provincia", label: "Provincia", sinonimi: ["provincia", "prov"] },
  { k: "cap", label: "CAP", sinonimi: ["cap", "zip"] },
  { k: "settore", label: "Settore", sinonimi: ["settore", "ateco", "codice ateco", "attivita", "categoria"] },
  { k: "dipendenti", label: "Dipendenti", sinonimi: ["dipendenti", "n dipendenti", "addetti", "employees"] },
  { k: "referente", label: "Referente (nome e ruolo)", sinonimi: ["titolare amministratore", "titolare amministatore", "titolare", "amministratore", "referente", "contatto", "persona di riferimento", "responsabile", "chi ho sentito", "interlocutore", "nominativo", "persona"] },
  { k: "note", label: "Note", sinonimi: ["note", "nota", "commenti", "commento", "osservazioni", "esito", "appunti", "quando richiamare", "richiamare", "promemoria", "info"] },
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** il sinonimo più lungo contenuto nel titolo vince */
function campoDaTitolo(titolo: string): { k: string; forza: number } | null {
  const t = ` ${norm(titolo)} `;
  if (t.trim() === "") return null;
  let migliore: { k: string; forza: number } | null = null;
  for (const c of CAMPI_IMPORT) {
    for (const s of c.sinonimi) {
      const n = norm(s);
      if (t.includes(` ${n} `) && (!migliore || n.length > migliore.forza)) migliore = { k: c.k, forza: n.length };
    }
  }
  return migliore;
}

// ---------------------------------------------------------------------------
// Riconoscimento dal contenuto
// ---------------------------------------------------------------------------
const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const RE_TEL = /\+?\d(?:[\s.\-]?\d){5,12}/g;
const RE_INDIRIZZO = /^(via|viale|v\.le|piazza|p\.zza|piazzale|corso|c\.so|strada|str\.|s\.s\.|ss |localita|località|loc\.|largo|vicolo|borgo|contrada|frazione)\b/i;
const RE_FORMA = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|s\.?s\.?d\.?|societ[aà]|soc\.|coop|cooperativa|onlus|studio|group|gruppo)\b/i;

function quota(valori: string[], test: (v: string) => boolean) {
  const pieni = valori.filter((v) => v !== "");
  if (pieni.length === 0) return 0;
  return pieni.filter(test).length / pieni.length;
}

function sembraTelefono(v: string) {
  const m = v.match(RE_TEL);
  return !!m && m.some((x) => { const d = x.replace(/\D/g, ""); return d.length >= 6 && d.length <= 13 && /^(\+?39)?[03]/.test(d); });
}

// ---------------------------------------------------------------------------
// Analisi completa del file
// ---------------------------------------------------------------------------
export type Analisi = {
  rigaTitoli: number; // indice in righe (-1 = file senza titoli)
  titoli: string[];
  dati: string[][];
  mappa: string[]; // per colonna: chiave campo o ""
};

export function analizza(righe: string[][]): Analisi {
  const nCol = Math.max(...righe.map((r) => r.length));
  // 1) riga dei titoli: quella (tra le prime 30) con più titoli riconosciuti
  let rigaTitoli = -1;
  let punteggio = 0;
  righe.slice(0, 30).forEach((r, i) => {
    const pieni = r.filter((c) => c !== "").length;
    if (pieni < 2) return;
    const conNumeri = r.filter((c) => (c.match(/\d/g) ?? []).length >= 5).length;
    const p = r.filter((c) => campoDaTitolo(c)).length - conNumeri;
    if (p > punteggio) { punteggio = p; rigaTitoli = i; }
  });
  if (punteggio < 2) rigaTitoli = -1;

  const titoli = Array.from({ length: nCol }, (_, i) => (rigaTitoli >= 0 ? righe[rigaTitoli][i] : "") || `Colonna ${i + 1}`);
  let dati = (rigaTitoli >= 0 ? righe.slice(rigaTitoli + 1) : righe).map((r) => Array.from({ length: nCol }, (_, i) => r[i] ?? ""));

  // 2) dai titoli
  const mappa: string[] = Array(nCol).fill("");
  const usati = new Set<string>();
  if (rigaTitoli >= 0) {
    const candidati = titoli.map((t, i) => ({ i, m: campoDaTitolo(t) })).filter((x) => x.m).sort((a, b) => b.m!.forza - a.m!.forza);
    for (const { i, m } of candidati) {
      if (m!.k === "note" || !usati.has(m!.k)) { mappa[i] = m!.k; if (m!.k !== "note") usati.add(m!.k); }
    }
  }

  // 3) dal contenuto, per le colonne non riconosciute
  const campione = dati.slice(0, 80);
  const colonna = (i: number) => campione.map((r) => r[i]);
  const prova = (k: string, test: (v: string) => boolean, soglia: number) => {
    if (usati.has(k)) return;
    let best = -1, bestQ = soglia;
    for (let i = 0; i < nCol; i++) {
      if (mappa[i]) continue;
      const q = quota(colonna(i), test);
      if (q >= bestQ) { best = i; bestQ = q; }
    }
    if (best >= 0) { mappa[best] = k; usati.add(k); }
  };
  prova("email", (v) => RE_EMAIL.test(v), 0.5);
  prova("telefono", sembraTelefono, 0.5);
  // P.IVA: 11 cifre senza spazi (o 9-10 se Excel ha perso gli zeri iniziali)
  prova("piva", (v) => /^\d{11}$/.test(v) || (/^\d{9,10}$/.test(v) && !/^[03]/.test(v)), 0.6);
  // i link nei fogli sono spesso schede di elenchi (Visurissima, reteimprese…): il sito si prende solo dal titolo
  prova("indirizzo", (v) => RE_INDIRIZZO.test(v), 0.4);
  if (!usati.has("ragione_sociale")) {
    prova("ragione_sociale", (v) => RE_FORMA.test(v), 0.3);
    if (!usati.has("ragione_sociale")) {
      // prima colonna di testo quasi sempre compilata
      const i = Array.from({ length: nCol }, (_, j) => j).find((j) => !mappa[j] && quota(colonna(j), (v) => /[a-z]/i.test(v)) > 0.8);
      if (i !== undefined) { mappa[i] = "ragione_sociale"; usati.add("ragione_sociale"); }
    }
  }
  // colonne di testo libero rimaste: diventano note (le informazioni non si perdono)
  for (let i = 0; i < nCol; i++) {
    if (mappa[i]) continue;
    const pieni = colonna(i).filter((v) => v !== "");
    const media = pieni.reduce((a, v) => a + v.length, 0) / Math.max(1, pieni.length);
    if (pieni.length >= 2 && media >= 15) mappa[i] = "note";
  }

  // 4) tolgo le righe senza ragione sociale (legende, totali, righe vuote)
  const iRs = mappa.indexOf("ragione_sociale");
  if (iRs >= 0) dati = dati.filter((r) => r[iRs] && /[a-z]/i.test(r[iRs]));
  return { rigaTitoli, titoli, dati, mappa };
}

// ---------------------------------------------------------------------------
// Pulizia di una riga → oggetto pronto per il database
// ---------------------------------------------------------------------------
export type RigaPulita = Record<string, string>;

export function pulisciRiga(r: string[], mappa: string[], comuneDefault: string): RigaPulita {
  const o: RigaPulita = {};
  const note: string[] = [];
  const aggiungi = (k: string, v: string) => { if (v) o[k] = o[k] ? `${o[k]} ${v}` : v; };

  mappa.forEach((k, i) => {
    const v = (r[i] ?? "").trim();
    if (!k || !v) return;
    if (k === "note") note.push(v);
    else aggiungi(k, v);
  });

  if (o.ragione_sociale) o.ragione_sociale = o.ragione_sociale.replace(/\s+/g, " ").trim();

  // telefono: primo numero valido; gli altri e le scritte finiscono nelle note
  if (o.telefono) {
    const numeri = (o.telefono.match(RE_TEL) ?? []).map((x) => x.trim()).filter((x) => x.replace(/\D/g, "").length >= 6);
    const resto = o.telefono.replace(RE_TEL, "").replace(/[\/;,\-]+/g, " ").replace(/\s+/g, " ").trim();
    if (numeri.length) o.telefono = numeri[0];
    else delete o.telefono;
    if (numeri.length > 1) note.push(`Altri numeri: ${numeri.slice(1).join(", ")}`);
    if (resto && /[a-z]/i.test(resto)) note.push(`Telefono: ${resto}`);
  }

  // mail: dalla colonna mail, altrimenti la prima trovata in qualsiasi cella
  if (o.email) {
    const m = o.email.match(RE_EMAIL);
    if (m) o.email = m[0]; else delete o.email;
  }
  if (!o.email) {
    const m = r.join(" ").match(RE_EMAIL);
    if (m) o.email = m[0];
  }

  // referente: "Mario Rossi (Titolare)" → nome + ruolo
  if (o.referente) {
    const t = o.referente.trim();
    const m = t.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (m && m[1]) { o.referente_nome = m[1].trim(); o.referente_ruolo = m[2].trim(); }
    else o.referente_nome = t;
    delete o.referente;
  }

  if (o.piva) o.piva = o.piva.replace(/\D/g, "") || "";
  if (!o.piva) delete o.piva;
  if (!o.comune && comuneDefault) o.comune = comuneDefault;
  if (note.length) o.note = note.join(" · ").slice(0, 2000);
  return o;
}
