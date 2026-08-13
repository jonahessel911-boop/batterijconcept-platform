export type LeadStatus = "nieuw" | "contact" | "offerte" | "gewonnen" | "verloren";
export type Prioriteit = "laag" | "normaal" | "hoog" | "urgent";
export type OfferteStatus =
  | "concept"
  | "verzonden"
  | "ondertekend"
  | "verlopen"
  | "afgewezen";
export type ProjectStatus =
  | "gepland"
  | "in_uitvoering"
  | "wacht_op_materiaal"
  | "opgeleverd"
  | "geannuleerd";
export type FactuurStatus =
  | "concept"
  | "verzonden"
  | "betaald"
  | "deels_betaald"
  | "vervallen";

export type CrmTab = "leads" | "offertes" | "projecten" | "facturen";

export interface Lead {
  id: string;
  lead_number: string;
  naam: string;
  email: string | null;
  telefoon: string | null;
  postcode: string | null;
  huisnummer: string | null;
  toevoeging: string | null;
  straat: string | null;
  plaats: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  bron: string | null;
  status: LeadStatus;
  prioriteit: Prioriteit;
  notities: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  sku: string | null;
  naam: string;
  omschrijving: string | null;
  prijs_ex_btw: number;
  btw_percentage: number;
  eenheid: string;
  actief: boolean;
}

export interface OfferteRegel {
  id: string;
  offerte_id: string;
  product_id: string | null;
  omschrijving: string;
  aantal: number;
  prijs_ex_btw: number;
  btw_percentage: number;
  totaal_ex_btw: number;
  sort_order: number;
}

export interface Offerte {
  id: string;
  lead_id: string;
  offerte_nummer: string;
  status: OfferteStatus;
  titel: string | null;
  intro_tekst: string | null;
  subtotaal_ex_btw: number;
  btw_bedrag: number;
  totaal_inc_btw: number;
  geldig_tot: string | null;
  sign_token: string | null;
  ondertekend_naam: string | null;
  ondertekend_handtekening: string | null;
  ondertekend_op: string | null;
  waarden_akkoord: boolean | null;
  signed_pdf_path: string | null;
  notities: string | null;
  created_at: string;
  updated_at: string;
  // joins
  leads?: Pick<Lead, "naam" | "email" | "lead_number" | "postcode" | "huisnummer" | "plaats"> | null;
  offerte_regels?: OfferteRegel[];
}

export interface Project {
  id: string;
  lead_id: string;
  offerte_id: string | null;
  project_nummer: string;
  status: ProjectStatus;
  titel: string | null;
  startdatum: string | null;
  opleverdatum: string | null;
  monteur: string | null;
  notities: string | null;
  created_at: string;
  updated_at: string;
  leads?: Pick<Lead, "naam" | "lead_number"> | null;
}

export interface Factuur {
  id: string;
  lead_id: string;
  project_id: string | null;
  offerte_id: string | null;
  factuur_nummer: string;
  status: FactuurStatus;
  omschrijving: string | null;
  bedrag_ex_btw: number;
  btw_bedrag: number;
  bedrag_inc_btw: number;
  factuurdatum: string;
  vervaldatum: string | null;
  betaald_op: string | null;
  notities: string | null;
  created_at: string;
  updated_at: string;
  leads?: Pick<Lead, "naam" | "lead_number"> | null;
}

export interface WebhookLeadPayload {
  naam: string;
  email?: string;
  telefoon?: string;
  postcode?: string;
  huisnummer?: string;
  toevoeging?: string;
  straat?: string;
  plaats?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  bron?: string;
  notities?: string;
}

export const BEDRIJFSWAARDEN = [
  {
    titel: "Eerlijk advies",
    tekst: "We adviseren alleen wat past bij jouw situatie — geen upsell om de upsell.",
  },
  {
    titel: "Juiste batterijkeuze",
    tekst: "Opwekken, opladen, opslaan: we matchen capaciteit en omvormer aan jouw woning.",
  },
  {
    titel: "Gecertificeerde monteurs",
    tekst: "Installatie door gecertificeerde monteurs, netjes afgewerkt en veilig aangesloten.",
  },
  {
    titel: "Gratis advies aan huis",
    tekst: "Eerst kijken, dan kiezen. Onze scan en adviesbezoek zijn vrijblijvend.",
  },
] as const;
