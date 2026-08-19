export type LeadStatus =
  | "nieuw"
  | "afspraak"
  | "na_afspraak"
  | "vervolg_fysiek"
  | "vervolg_tel"
  | "vervolg_geen_contact"
  | "offerte_afgewezen"
  | "niet_gekwalificeerd"
  | "geen_interesse"
  | "geen_contact"
  | "deal";

export type AfspraakSoort = "nieuw" | "bel" | "vervolg_fysiek" | "vervolg_tel";

export type Prioriteit = "laag" | "normaal" | "hoog" | "urgent";
export type OfferteStatus =
  | "concept"
  | "verzonden"
  | "ondertekend"
  | "verlopen"
  | "afgewezen";
export type ProjectStatus =
  | "schouw_inplannen"
  | "schouw_gepland"
  | "btw_factuur_eruit"
  | "product_ingekocht"
  | "installatie_gepland"
  | "installatie_voltooid"
  | "service";
export type FactuurStatus =
  | "concept"
  | "verzonden"
  | "betaald"
  | "deels_betaald"
  | "vervallen";

export type ServiceVerzoekStatus = "open" | "afgehandeld";
export type SollicitatieStatus =
  | "nieuw"
  | "gescreend"
  | "gesprek"
  | "aangenomen"
  | "afgewezen";

export type CrmTab =
  | "leads"
  | "bellen"
  | "agenda"
  | "offertes"
  | "instroom"
  | "projecten"
  | "facturen"
  | "rapportage"
  | "instellingen";

export type AfspraakStatus =
  | "gepland"
  | "bevestigd"
  | "verzet"
  | "geannuleerd"
  | "voltooid";

export interface Adviseur {
  id: string;
  naam: string;
  email: string | null;
  telefoon: string | null;
  actief: boolean;
  werktijd_start: string;
  werktijd_eind: string;
}

export interface Afspraak {
  id: string;
  lead_id: string;
  adviseur_id: string;
  start_at: string;
  end_at: string;
  status: AfspraakStatus;
  soort?: AfspraakSoort;
  titel: string | null;
  notities: string | null;
  partner_aanwezig: boolean | null;
  andere_offertes_gehad: boolean | null;
  manage_token: string | null;
  herinnering_verstuurd: boolean;
  bevestiging_verstuurd: boolean;
  opwarm_verstuurd?: boolean;
  created_at: string;
  updated_at: string;
  leads?: Pick<
    Lead,
    | "naam"
    | "email"
    | "telefoon"
    | "lead_number"
    | "notities"
    | "postcode"
    | "huisnummer"
    | "toevoeging"
    | "straat"
    | "plaats"
  > | null;
  adviseurs?: Pick<Adviseur, "naam" | "email"> | null;
}

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
  terugbellen?: boolean;
  terugbel_notitie?: string | null;
  belpogingen?: number;
  laatst_gebeld_at?: string | null;
  belpogingen_vandaag?: number;
  adviseur_id: string | null;
  created_at: string;
  updated_at: string;
  adviseurs?: Pick<Adviseur, "id" | "naam"> | null;
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

export interface InstallatiePartner {
  id: string;
  naam: string;
  email: string;
  telefoon: string | null;
  actief: boolean;
  portal_token: string;
  created_at: string;
  updated_at: string;
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
  financiering_voorbehoud?: boolean | null;
  aanbetaling_modus?: "restant" | "btw" | "handmatig" | null;
  aanbetaling_bedrag_inc?: number | null;
  actie_required?: boolean | null;
  backoffice_afgerond_at?: string | null;
  aanbetaling_te_innen_inc?: number | null;
  backoffice_notitie?: string | null;
  installateur_notitie?: string | null;
  installatie_partner_id?: string | null;
  notities: string | null;
  created_at: string;
  updated_at: string;
  // joins
  leads?: Pick<
    Lead,
    "naam" | "email" | "lead_number" | "postcode" | "huisnummer" | "plaats" | "adviseur_id"
  > | null;
  offerte_regels?: OfferteRegel[];
  installatie_partners?: Pick<
    InstallatiePartner,
    "id" | "naam" | "email" | "telefoon"
  > | null;
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
  projectkosten: number;
  schouw_at?: string | null;
  schouw_notities?: string | null;
  installatie_partner_id?: string | null;
  schouw_mail_klant_verstuurd?: boolean;
  schouw_mail_partner_verstuurd?: boolean;
  installatie_at?: string | null;
  installatie_notities?: string | null;
  installatie_mail_klant_verstuurd?: boolean;
  installatie_mail_partner_verstuurd?: boolean;
  schouw_herinnering_verstuurd?: boolean;
  installatie_herinnering_verstuurd?: boolean;
  aanbetaling_te_innen_inc?: number | null;
  backoffice_notitie?: string | null;
  installateur_notitie?: string | null;
  backoffice_afgerond_at?: string | null;
  created_at: string;
  updated_at: string;
  leads?: Pick<
    Lead,
    | "naam"
    | "email"
    | "telefoon"
    | "lead_number"
    | "notities"
    | "postcode"
    | "huisnummer"
    | "toevoeging"
    | "straat"
    | "plaats"
    | "adviseur_id"
  > | null;
  installatie_partners?: Pick<
    InstallatiePartner,
    "id" | "naam" | "email" | "telefoon"
  > | null;
}

export interface SollicitatieBestand {
  id: string;
  sollicitatie_id: string;
  storage_path: string;
  bestandsnaam: string | null;
  mime_type: string | null;
  grootte_bytes: number | null;
  created_at: string;
  url?: string | null;
}

export interface Sollicitatie {
  id: string;
  naam: string;
  email: string | null;
  telefoon: string | null;
  bron: string | null;
  status: SollicitatieStatus;
  notitie: string | null;
  raw_payload?: unknown;
  created_at: string;
  updated_at: string;
  sollicitatie_bestanden?: SollicitatieBestand[];
}

export interface ProjectFoto {
  id: string;
  project_id: string;
  storage_path: string;
  bestandsnaam: string | null;
  omschrijving: string | null;
  created_at: string;
  /** Signed URL — alleen in API-responses */
  url?: string | null;
}

export interface ServiceVerzoek {
  id: string;
  project_id: string;
  lead_id: string;
  onderwerp: string;
  omschrijving: string | null;
  klant_email?: string | null;
  status: ServiceVerzoekStatus;
  interne_notitie: string | null;
  afgehandeld_op: string | null;
  created_at: string;
  updated_at: string;
  leads?: Pick<Lead, "naam" | "lead_number"> | null;
  projecten?: Pick<Project, "id" | "project_nummer" | "titel" | "status"> | null;
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
  leads?: Pick<Lead, "naam" | "email" | "lead_number" | "adviseur_id"> | null;
}

export interface WebhookLeadPayload {
  naam: string;
  email?: string;
  telefoon?: string;
  postcode?: string;
  huisnummer?: string;
  toevoeging?: string;
  /** Straatnaam — alias: `adres` */
  straat?: string;
  adres?: string;
  /** Woonplaats — alias: `woonplaats` */
  plaats?: string;
  woonplaats?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  bron?: string;
  /** Vrije tekst / formuliervelden — aliases: `notes`, `opmerkingen`, `bericht`, `message` */
  notities?: string;
  notes?: string;
  opmerkingen?: string;
  bericht?: string;
  message?: string;
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
