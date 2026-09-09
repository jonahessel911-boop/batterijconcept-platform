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
  | "deal"
  | "sale_financiering"
  | "sale_eigen_middelen"
  | "deur_niet_open"
  | "afspraak_afgezegd_klant"
  | "huurwoning"
  | "foutief_nummer"
  | "gegevens_niet_overeen";

export type AfspraakSoort =
  | "nieuw"
  | "bel"
  | "warme_bel"
  | "vervolg_fysiek"
  | "vervolg_tel"
  | "vervolg_punt";

export type Prioriteit = "laag" | "normaal" | "hoog" | "urgent";
export type OfferteStatus =
  | "concept"
  | "verzonden"
  | "ondertekend"
  | "verlopen"
  | "afgewezen";
export type ProjectStatus =
  | "schouw_aanbetaling"
  | "aanbetaling_betaald"
  | "schouw_in_afwachting"
  | "schouw_voltooid"
  | "restfactuur_verstuurd"
  | "restfactuur_betaald"
  | "materiaal_installatie"
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

export type GebruikerRol =
  | "adviseur"
  | "backoffice"
  | "admin"
  | "installateur"
  | "beller";

export interface Adviseur {
  id: string;
  naam: string;
  email: string | null;
  telefoon: string | null;
  actief: boolean;
  werktijd_start: string;
  werktijd_eind: string;
  /** Vertrekadres voor reistijd / eerste afspraak van de dag. */
  start_adres?: string | null;
  /** CRM-rol */
  rol?: GebruikerRol | null;
  /** Commissie over omzet excl. btw (%) — saleskosten in Financial Dashboard */
  commissie_pct?: number | null;
  /** ZZP factuurgegevens */
  bedrijfsnaam?: string | null;
  kvk_nummer?: string | null;
  btw_nummer?: string | null;
  factuur_adres?: string | null;
  factuur_postcode?: string | null;
  factuur_plaats?: string | null;
  iban?: string | null;
  /** Max bedrag per creditfactuur (excl. btw); null = geen limiet */
  max_factuur_bedrag?: number | null;
}

export type AdviseurCreditFactuurStatus =
  | "concept"
  | "goedgekeurd"
  | "betaald"
  | "geannuleerd";

export interface AdviseurCreditFactuur {
  id: string;
  adviseur_id: string;
  factuur_nummer: string;
  status: AdviseurCreditFactuurStatus;
  week_jaar: number;
  week_nummer: number;
  periode_van: string;
  periode_tot: string;
  aantal_aanbetalingen: number;
  bedrag_ex_btw: number;
  btw_bedrag: number;
  bedrag_inc_btw: number;
  max_bedrag_toegepast?: number | null;
  factuurdatum: string;
  betaald_op: string | null;
  notities: string | null;
  created_at: string;
  updated_at: string;
  regels?: AdviseurCreditFactuurRegel[];
}

export interface AdviseurCreditFactuurRegel {
  id: string;
  creditfactuur_id: string;
  factuur_id: string;
  lead_id: string | null;
  bedrag: number;
  omschrijving: string | null;
  factuur_nummer?: string | null;
  lead_naam?: string | null;
}

export interface AdviseurBeschikbaarheid {
  adviseur_id: string;
  jaar: number;
  week: number;
  beschikbaar: boolean;
  notitie?: string | null;
}

/** Geblokkeerd vast tijdsblok (10 / 13 / 16 / 19) per dag. */
export interface AdviseurAfblokkering {
  id?: string;
  adviseur_id: string;
  dag: string;
  slot_hour: 10 | 13 | 16 | 19;
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
    | "status"
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
  /** Landing page / lander (webhook attribution). */
  lander: string | null;
  /** Campagnenaam (webhook). */
  campaign_name: string | null;
  /** Advertentienaam (webhook). */
  ad_name: string | null;
  bron: string | null;
  status: LeadStatus;
  prioriteit: Prioriteit;
  notities: string | null;
  terugbellen?: boolean;
  terugbel_notitie?: string | null;
  belpogingen?: number;
  laatst_gebeld_at?: string | null;
  /** Eerste belpoging (TTFC); blijft staan na latere pogingen. */
  eerste_gebeld_at?: string | null;
  belpogingen_vandaag?: number;
  adviseur_id: string | null;
  /** Toegewezen beller (CRM-rol beller). */
  beller_id?: string | null;
  /** Meta CAPI events al verstuurd (QualifiedLead, Schedule, Purchase). */
  capi_events_sent?: string[] | null;
  meta_fbc?: string | null;
  meta_fbp?: string | null;
  meta_client_ip?: string | null;
  meta_user_agent?: string | null;
  meta_event_source_url?: string | null;
  created_at: string;
  updated_at: string;
  adviseurs?: Pick<Adviseur, "id" | "naam"> | null;
  /** Join: toegewezen beller */
  bellers?: Pick<Adviseur, "id" | "naam"> | null;
}

export type LeadEventSoort =
  | "status"
  | "bel"
  | "afspraak"
  | "terugbel"
  | "notitie"
  | "contact"
  | "overig";

export interface LeadEvent {
  id: string;
  lead_id: string;
  soort: LeadEventSoort | string;
  titel: string;
  detail: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
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
  backoffice_notitie_door?: string | null;
  installateur_notitie_door?: string | null;
  installatie_partner_id?: string | null;
  notities: string | null;
  created_at: string;
  updated_at: string;
  // joins
  leads?: (Pick<
    Lead,
    | "naam"
    | "email"
    | "telefoon"
    | "lead_number"
    | "postcode"
    | "huisnummer"
    | "plaats"
    | "straat"
    | "toevoeging"
    | "adviseur_id"
  > & {
    adviseurs?: Pick<Adviseur, "id" | "naam"> | null;
  }) | null;
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
  /** ISO-weekjaar van de schouw (exacte dag/tijd volgt later). */
  schouw_jaar?: number | null;
  /** ISO-weeknummer 1–53. */
  schouw_week?: number | null;
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
  backoffice_notitie_door?: string | null;
  installateur_notitie_door?: string | null;
  backoffice_afgerond_at?: string | null;
  /** Afdeling verantwoordelijk (Backoffice, Planning, Installatie, …). */
  afdeling?: string | null;
  /** Medewerker verantwoordelijk voor dit project. */
  verantwoordelijke_id?: string | null;
  /** Backoffice heeft klant gebeld voor schouw (+ aanbetaling). */
  bel_schouw_aanbetaling_at?: string | null;
  /** Backoffice heeft met financieringsman geschakeld (Warmtefonds). */
  financiering_geschakeld_at?: string | null;
  /** Afleveradres voor materiaalinkoop. */
  leveradres?: string | null;
  /** Offerte-regel id → afgevinkt bij inkopen. */
  materiaal_checks?: Record<string, boolean> | null;
  created_at: string;
  updated_at: string;
  leads?: (Pick<
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
    | "status"
  > & {
    adviseurs?: Pick<Adviseur, "id" | "naam"> | null;
  }) | null;
  installatie_partners?: Pick<
    InstallatiePartner,
    "id" | "naam" | "email" | "telefoon"
  > | null;
  verantwoordelijke?: Pick<Adviseur, "id" | "naam" | "email"> | null;
  offertes?: Pick<
    Offerte,
    | "id"
    | "offerte_nummer"
    | "financiering_voorbehoud"
    | "aanbetaling_te_innen_inc"
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

export type ProjectTaakStatus = "todo" | "doing" | "done";

export interface ProjectTaak {
  id: string;
  project_id: string;
  titel: string;
  status: ProjectTaakStatus;
  afdeling: string;
  verantwoordelijke_id: string | null;
  due_at: string | null;
  auto_key: string | null;
  notities: string | null;
  created_at: string;
  updated_at: string;
  verantwoordelijke?: Pick<Adviseur, "id" | "naam" | "email"> | null;
  projecten?: Pick<
    Project,
    "id" | "project_nummer" | "titel" | "status" | "lead_id"
  > & {
    leads?: Pick<Lead, "naam" | "plaats" | "telefoon"> | null;
  } | null;
}

export type BackofficeActieEventSoort =
  | "bel_schouw_aanbetaling"
  | "schakel_financiering"
  | "nabellen_factuur"
  | "herplan_afspraak";

export interface BackofficeActieEvent {
  id: string;
  soort: BackofficeActieEventSoort;
  lead_id: string | null;
  project_id: string | null;
  factuur_id: string | null;
  adviseur_id: string | null;
  deadline_at: string | null;
  completed_at: string;
  on_time: boolean | null;
  meta?: Record<string, unknown> | null;
  created_at: string;
  adviseurs?: Pick<Adviseur, "id" | "naam"> | null;
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
  /** bunq Payment id bij auto-match */
  bunq_payment_id?: number | null;
  notities: string | null;
  /** Gezet = creditfactuur bij deze oorspronkelijke factuur. */
  credit_van_factuur_id?: string | null;
  created_at: string;
  updated_at: string;
  leads?: Pick<
    Lead,
    "naam" | "email" | "telefoon" | "lead_number" | "adviseur_id"
  > | null;
  offertes?: Pick<Offerte, "id" | "offerte_nummer"> | null;
  /** Join: oorspronkelijke factuur bij credit */
  credit_van?: Pick<Factuur, "id" | "factuur_nummer"> | null;
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
  /** Landing page — aliases: `Lander` */
  lander?: string;
  Lander?: string;
  /** Campagnenaam — aliases: `Campaign_name`, `campaign`, `utm_campaign` */
  campaign_name?: string;
  Campaign_name?: string;
  campaign?: string;
  /** Advertentienaam — aliases: `Ad_name`, `ad`, `utm_content` */
  ad_name?: string;
  Ad_name?: string;
  ad?: string;
  bron?: string;
  /** Vrije tekst / formuliervelden — aliases: `notes`, `opmerkingen`, `bericht`, `message` */
  notities?: string;
  notes?: string;
  opmerkingen?: string;
  bericht?: string;
  message?: string;
  /** Meta click / browser IDs voor Conversions API */
  fbc?: string;
  fbp?: string;
  _fbc?: string;
  _fbp?: string;
  meta_fbc?: string;
  meta_fbp?: string;
  fbclid?: string;
  event_source_url?: string;
  page_url?: string;
  landing_url?: string;
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
