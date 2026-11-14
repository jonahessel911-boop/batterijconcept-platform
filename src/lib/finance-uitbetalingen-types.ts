/** Client-safe types/labels voor Finance (geen Node/fs-imports). */

export type FinanceCategorie =
  | "adviseur"
  | "installatie_partner"
  | "edergy"
  | "inkoop"
  | "operations"
  | "overig";

export type FinanceBron =
  | "adviseur_creditfactuur"
  | "partner_creditfactuur"
  | "edergy_factuur"
  | "inkoop_project"
  | "manual";

export type FinanceStatus =
  | "concept"
  | "te_goedkeuren"
  | "goedgekeurd"
  | "in_behandeling"
  | "betaald"
  | "mislukt"
  | "geannuleerd";

export type FinanceBetaling = {
  id: string;
  categorie: FinanceCategorie;
  bron: FinanceBron;
  bron_id: string;
  begunstigde: string;
  iban: string | null;
  omschrijving: string;
  referentie: string | null;
  bedrag_ex_btw: number | null;
  bedrag_inc_btw: number;
  status: FinanceStatus;
  goedgekeurd_op: string | null;
  betaald_op: string | null;
  bunq_payment_id: string | null;
  foutmelding: string | null;
  /** true = rij bestaat in finance_uitbetalingen */
  tracked: boolean;
  link?: string | null;
};

export const FINANCE_CATEGORIE_LABEL: Record<FinanceCategorie, string> = {
  adviseur: "Adviseur",
  installatie_partner: "Installatiepartner",
  edergy: "Edergy",
  inkoop: "Inkoop product",
  operations: "Operations",
  overig: "Overig",
};

export const FINANCE_STATUS_LABEL: Record<FinanceStatus, string> = {
  concept: "Concept",
  te_goedkeuren: "Te goedkeuren",
  goedgekeurd: "Goedgekeurd",
  in_behandeling: "Wordt betaald",
  betaald: "Betaald",
  mislukt: "Mislukt",
  geannuleerd: "Geannuleerd",
};
