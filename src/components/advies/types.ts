export type FinancieringOptie = "eigen_geld" | "warmtefonds" | "svn";

export type AdviesStepId =
  | "adres"
  | "kwalificatie"
  | "saldering"
  | "batterij"
  | "over_ons"
  | "mensen"
  | "trustpilot"
  | "financiering"
  | "tech_check"
  | "product"
  | "prijs"
  | "bevestiging";

export interface AdviesLeadVars {
  leadId: string;
  leadNaam: string;
  plaatsNaam: string;
  adres: string;
  straat: string;
  postcode: string;
  huisnummer: string;
  toevoeging: string;
  plaats: string;
}

export interface AdviesAnswers {
  heeftZonnepanelen: boolean | null;
  aantalPanelen: number | null;
  jaarverbruikKwh: number | null;
  teruglevering: number | null;
  terugleveringIsProcent: boolean;
  prijsPerKwh: number | null;
  /** Hoe terugleverkosten worden ingevuld */
  terugleverkostenModus: "per_kwh" | "totaal";
  terugleverkostenPerKwh: number | null;
  /** Jaarlijks totaalbedrag terugleverkosten (modus totaal) */
  terugleverkostenTotaalJaar: number | null;
  financieringen: FinancieringOptie[];
  termijnbedragHuidig: number | null;
  looptijdMaanden: number;
  subsidieCheckGedaan: boolean;
  subsidieAkkoord: boolean;
}

export const INITIAL_ANSWERS: AdviesAnswers = {
  heeftZonnepanelen: null,
  aantalPanelen: null,
  jaarverbruikKwh: null,
  teruglevering: null,
  terugleveringIsProcent: false,
  prijsPerKwh: null,
  terugleverkostenModus: "per_kwh",
  terugleverkostenPerKwh: null,
  terugleverkostenTotaalJaar: null,
  financieringen: [],
  termijnbedragHuidig: null,
  looptijdMaanden: 15,
  subsidieCheckGedaan: false,
  subsidieAkkoord: false,
};

/** 9,3 kWh Alpha ESS G3 S5 (1-fase) — pakketprijs EXCL. btw, incl. installatie */
export const ALPHA_ESS_93 = {
  naam: "Alpha ESS G3 S5 — 9,3 kWh",
  capaciteitKwh: 9.3,
  prijsExBtw: 8381.5,
  btwPercentage: 21,
} as const;

export const STEP_ORDER: AdviesStepId[] = [
  "adres",
  "kwalificatie",
  "saldering",
  "batterij",
  "over_ons",
  "mensen",
  "trustpilot",
  "financiering",
  "tech_check",
  "product",
  "prijs",
  "bevestiging",
];

export const STEP_LABELS: Record<AdviesStepId, string> = {
  adres: "Woning",
  kwalificatie: "Situatie",
  saldering: "Saldering",
  batterij: "Batterij",
  over_ons: "Over ons",
  mensen: "Team",
  trustpilot: "Reviews",
  financiering: "Financiering",
  tech_check: "Analyse",
  product: "Advies",
  prijs: "Prijs",
  bevestiging: "Afronden",
};
