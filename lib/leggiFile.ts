// Legge CSV o Excel nel browser e restituisce intestazioni + righe come testo.
export type Tabella = { intestazioni: string[]; righe: string[][] };

export async function leggiFile(file: File): Promise<Tabella> {
  const nome = file.name.toLowerCase();
  if (nome.endsWith(".csv") || nome.endsWith(".txt")) return leggiCsv(file);
  if (nome.endsWith(".xlsx")) return leggiXlsx(file);
  if (nome.endsWith(".xls")) throw new Error("Il formato .xls (vecchio Excel) non è supportato: apri il file in Excel e salvalo come .xlsx o .csv.");
  throw new Error("Formato non supportato: usa .xlsx o .csv");
}

async function leggiCsv(file: File): Promise<Tabella> {
  const Papa = (await import("papaparse")).default;
  const testo = await file.text();
  const res = Papa.parse<string[]>(testo, { skipEmptyLines: "greedy" });
  const tutte = res.data.map((r) => r.map((c) => String(c ?? "").trim()));
  if (tutte.length === 0) throw new Error("Il file è vuoto");
  return { intestazioni: tutte[0].map((h, i) => h || `Colonna ${i + 1}`), righe: tutte.slice(1) };
}

async function leggiXlsx(file: File): Promise<Tabella> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("Il file non contiene fogli");
  const righe: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const valori: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) valori.push(testoCella(row.getCell(c)));
    if (valori.some((v) => v !== "")) righe.push(valori);
  });
  if (righe.length === 0) throw new Error("Il foglio è vuoto");
  return { intestazioni: righe[0].map((h, i) => h || `Colonna ${i + 1}`), righe: righe.slice(1) };
}

function testoCella(cell: { value: unknown; text?: string }): string {
  const v = cell.value as unknown;
  if (v == null) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "string") return v.trim();
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((t) => t.text).join("").trim();
    if (o.text) return String(o.text).trim();
    if (o.result != null) return String(o.result).trim();
  }
  return String(cell.text ?? "").trim();
}

// Campi del CRM e parole con cui di solito compaiono nelle intestazioni
export const CAMPI_IMPORT: { k: string; label: string; sinonimi: string[] }[] = [
  { k: "ragione_sociale", label: "Ragione sociale", sinonimi: ["ragione sociale", "ragione_sociale", "denominazione", "azienda", "nome azienda", "societa", "società", "impresa", "company", "nome"] },
  { k: "piva", label: "P.IVA", sinonimi: ["piva", "p.iva", "p iva", "partita iva", "partita_iva", "vat", "codice fiscale", "cf"] },
  { k: "telefono", label: "Telefono centralino", sinonimi: ["telefono", "tel", "phone", "telefono 1", "centralino", "numero"] },
  { k: "email", label: "Mail generica", sinonimi: ["email", "e-mail", "mail", "pec"] },
  { k: "sito", label: "Sito", sinonimi: ["sito", "web", "sito web", "website", "url"] },
  { k: "indirizzo", label: "Indirizzo", sinonimi: ["indirizzo", "via", "address", "sede"] },
  { k: "comune", label: "Comune", sinonimi: ["comune", "città", "citta", "localita", "località", "city"] },
  { k: "provincia", label: "Provincia", sinonimi: ["provincia", "prov", "pr"] },
  { k: "cap", label: "CAP", sinonimi: ["cap", "zip"] },
  { k: "settore", label: "Settore (ATECO)", sinonimi: ["settore", "ateco", "codice ateco", "attività", "attivita", "categoria"] },
  { k: "dipendenti", label: "Numero dipendenti", sinonimi: ["dipendenti", "n dipendenti", "n_dip", "addetti", "employees"] },
  { k: "referente_nome", label: "Referente: nome", sinonimi: ["referente", "contatto", "nome referente", "titolare"] },
  { k: "referente_ruolo", label: "Referente: ruolo", sinonimi: ["ruolo", "qualifica", "carica"] },
  { k: "referente_telefono", label: "Referente: telefono", sinonimi: ["cellulare", "telefono referente", "mobile"] },
  { k: "referente_email", label: "Referente: mail", sinonimi: ["email referente", "mail referente"] },
  { k: "note", label: "Note", sinonimi: ["note", "notes"] },
];

const pulisci = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[_.\-]+/g, " ").replace(/\s+/g, " ").trim();

export function indovinaMappatura(intestazioni: string[]): string[] {
  const usati = new Set<string>();
  return intestazioni.map((h) => {
    const p = pulisci(h);
    const trovato = CAMPI_IMPORT.find((c) => !usati.has(c.k) && c.sinonimi.some((s) => pulisci(s) === p))
      ?? CAMPI_IMPORT.find((c) => !usati.has(c.k) && c.sinonimi.some((s) => pulisci(s).length > 3 && p.includes(pulisci(s))));
    if (trovato) { usati.add(trovato.k); return trovato.k; }
    return "";
  });
}
