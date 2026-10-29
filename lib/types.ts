export type Ruolo = "admin" | "direzione" | "operatore" | "incaricato";

export type Permessi = {
  importare: boolean;
  creare_campagne: boolean;
  gemini_lanciare: boolean;
  gemini_approvare: boolean;
  report: boolean;
  esportare: boolean;
};

export type Profilo = {
  id: string;
  email: string;
  nome: string;
  ruolo: Ruolo;
  attivo: boolean;
  permessi: Permessi;
  zona: string | null;
};

export const RUOLO_LABEL: Record<Ruolo, string> = {
  admin: "Amministratore",
  direzione: "Direzione",
  operatore: "Operatore",
  incaricato: "Incaricato",
};

export const PERMESSI_LABEL: { key: keyof Permessi; label: string; nota?: string; fase?: string }[] = [
  { key: "importare", label: "Importare liste" },
  { key: "creare_campagne", label: "Creare e comporre campagne" },
  { key: "gemini_lanciare", label: "Lanciare Gemini su una lista", fase: "tappa 3" },
  { key: "gemini_approvare", label: "Approvare proposte Gemini", fase: "tappa 3" },
  { key: "report", label: "Vedere i report", fase: "tappa 3" },
  { key: "esportare", label: "Esportare dati (Excel)", nota: "Consigliato solo per l'amministratore" },
];

export type EsitoChiamata =
  | "appuntamento" | "richiamare" | "non_risponde" | "occupato" | "segreteria"
  | "mail_inviata" | "non_interessato" | "referente_cambiato" | "numero_errato"
  | "azienda_chiusa" | "gia_cliente" | "da_non_chiamare";

export const ESITI: { value: EsitoChiamata; label: string; tono?: "primario" | "pericolo"; serveData?: boolean; dataFacoltativa?: boolean; serveMotivo?: boolean }[] = [
  { value: "appuntamento", label: "Appuntamento fissato", tono: "primario" },
  { value: "richiamare", label: "Richiamare…", serveData: true },
  { value: "non_risponde", label: "Non risponde" },
  { value: "mail_inviata", label: "Mail informativa inviata", dataFacoltativa: true },
  { value: "non_interessato", label: "Non interessato…", serveMotivo: true },
  { value: "referente_cambiato", label: "Referente cambiato", dataFacoltativa: true },
  { value: "numero_errato", label: "Numero errato" },
  { value: "azienda_chiusa", label: "Azienda chiusa" },
  { value: "gia_cliente", label: "Già cliente / partner" },
  { value: "segreteria", label: "Segreteria / filtro" },
  { value: "occupato", label: "Occupato" },
  { value: "da_non_chiamare", label: "Da non chiamare", tono: "pericolo" },
];

export const ESITO_LABEL: Record<EsitoChiamata, string> = Object.fromEntries(
  ESITI.map((e) => [e.value, e.label.replace("…", "")])
) as Record<EsitoChiamata, string>;

export const MOTIVI_NON_INTERESSATO = [
  "Ha già un fornitore welfare",
  "Nessun budget",
  "Azienda troppo piccola",
  "Non è il momento",
  "Altro (vedi note)",
];

export type StatoInCampagna = "da_chiamare" | "richiamare" | "appuntamento" | "chiusa_negativa" | "esclusa";
export const STATO_CA_LABEL: Record<StatoInCampagna, string> = {
  da_chiamare: "Da chiamare",
  richiamare: "Richiamare",
  appuntamento: "Appuntamento",
  chiusa_negativa: "Chiusa (negativa)",
  esclusa: "Esclusa",
};

export type StatoCampagna = "preparazione" | "in_corso" | "chiusa";
export const STATO_CAMPAGNA_LABEL: Record<StatoCampagna, string> = {
  preparazione: "In preparazione",
  in_corso: "In corso",
  chiusa: "Chiusa",
};

export const ESITO_INCONTRO_LABEL = { svolto: "Svolto", rimandato: "Rimandato", non_svolto: "Non svolto" } as const;
export const ESITO_CONTRATTO_LABEL = { firmato: "Firmato", in_trattativa: "In trattativa", no: "No" } as const;

export const STATO_AZIENDA_LABEL = {
  sconosciuto: "Da verificare",
  attiva: "Attiva",
  chiusa: "Chiusa",
  numero_errato: "Numero errato",
} as const;
