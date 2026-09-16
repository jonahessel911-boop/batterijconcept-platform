/** Targets: altijd per 7 dagen, tenzij % (die schalen niet). */

export type TargetRole = "team" | "adviseur" | "beller" | "installateur";

/** Alle mogelijke KPI-velden (niet elke rol gebruikt alles). */
export type TargetFields = {
  /** Nieuwe leads */
  leads: number;
  /** Fysieke afspraken gepland */
  afsprakenGepland: number;
  /** Lead → afspraak % */
  leadToAppt: number;
  /** Afspraak → sale / closing % */
  afspraakToSale: number;
  /** Show-rate % */
  showRate: number;
  /** Getekende deals */
  orders: number;
  /** Gemiddelde orderwaarde excl. btw (doel per deal) */
  gemOrderwaarde: number;
  /** Getekende omzet excl. btw = orders × gemOrderwaarde */
  omzet: number;
  /** Installaties (partners / installateurs) */
  installaties: number;
};

export type TargetFieldKey = keyof TargetFields;

export type FieldMeta = {
  key: TargetFieldKey;
  label: string;
  kind: "number" | "percent" | "currency";
  hint: string;
  /** true = niet schalen met periode */
  isRate?: boolean;
};

export const TARGET_FIELD_META: FieldMeta[] = [
  {
    key: "leads",
    label: "Leads nodig",
    kind: "number",
    hint: "Berekend: afspraken ÷ (lead→afspraak %)",
  },
  {
    key: "afsprakenGepland",
    label: "Afspraken gepland",
    kind: "number",
    hint: "bijv. 4/dag × 5 werkdagen = 20 / week",
  },
  {
    key: "leadToAppt",
    label: "Lead → afspraak",
    kind: "percent",
    hint: "Conversie % — bepaalt hoeveel leads nodig zijn",
    isRate: true,
  },
  {
    key: "afspraakToSale",
    label: "Afspraak → sale",
    kind: "percent",
    hint: "Berekend: orders ÷ afspraken (doel); dashboard telt t.o.v. afgeboekte afspraken",
    isRate: true,
  },
  {
    key: "showRate",
    label: "Show-rate",
    kind: "percent",
    hint: "Klant aanwezig %",
    isRate: true,
  },
  {
    key: "orders",
    label: "Orders",
    kind: "number",
    hint: "Getekende deals per persoon / 7 dagen",
  },
  {
    key: "gemOrderwaarde",
    label: "Gem. orderwaarde",
    kind: "currency",
    hint: "Doel per deal excl. btw — omzet = orders × dit",
  },
  {
    key: "omzet",
    label: "Omzet",
    kind: "currency",
    hint: "Berekend: orders × gem. orderwaarde",
  },
  {
    key: "installaties",
    label: "Installaties",
    kind: "number",
    hint: "Installaties per persoon / 7 dagen",
  },
];

/** Velden die de gebruiker invult (leads/closing/omzet worden afgeleid). */
export const EDITABLE_FIELDS_BY_ROLE: Record<TargetRole, TargetFieldKey[]> = {
  team: [],
  adviseur: [
    "afsprakenGepland",
    "leadToAppt",
    "orders",
    "gemOrderwaarde",
    "showRate",
  ],
  beller: ["afsprakenGepland", "leadToAppt"],
  installateur: ["installaties", "afsprakenGepland"],
};

export const FIELDS_BY_ROLE: Record<TargetRole, TargetFieldKey[]> = {
  team: [
    "leads",
    "afsprakenGepland",
    "leadToAppt",
    "afspraakToSale",
    "showRate",
    "orders",
    "gemOrderwaarde",
    "omzet",
  ],
  adviseur: [
    "afsprakenGepland",
    "leadToAppt",
    "leads",
    "orders",
    "gemOrderwaarde",
    "afspraakToSale",
    "showRate",
    "omzet",
  ],
  beller: ["afsprakenGepland", "leadToAppt", "leads"],
  installateur: ["installaties", "afsprakenGepland"],
};

export const DEFAULT_TARGETS: Record<TargetRole, TargetFields> = {
  team: {
    leads: 80,
    afsprakenGepland: 20,
    leadToAppt: 25,
    afspraakToSale: 25,
    showRate: 80,
    orders: 5,
    gemOrderwaarde: 8000,
    omzet: 40000,
    installaties: 0,
  },
  /** 4 afspraken/dag × 5 werkdagen, 25% L2A → 80 leads; 5 orders × €8k = €40k */
  adviseur: {
    leads: 80,
    afsprakenGepland: 20,
    leadToAppt: 25,
    afspraakToSale: 25,
    showRate: 80,
    orders: 5,
    gemOrderwaarde: 8000,
    omzet: 40000,
    installaties: 0,
  },
  beller: {
    leads: 80,
    afsprakenGepland: 20,
    leadToAppt: 25,
    afspraakToSale: 0,
    showRate: 0,
    orders: 0,
    gemOrderwaarde: 0,
    omzet: 0,
    installaties: 0,
  },
  installateur: {
    leads: 0,
    afsprakenGepland: 5,
    leadToAppt: 0,
    afspraakToSale: 0,
    showRate: 0,
    orders: 0,
    gemOrderwaarde: 0,
    omzet: 0,
    installaties: 8,
  },
};
export type PersonOverride = Partial<TargetFields>;

export type AdminTargetsStore = {
  version: 1;
  defaults: Record<TargetRole, TargetFields>;
  /** Overrides per medewerker (adviseurs-tabel id) */
  personen: Record<string, PersonOverride>;
  /** Overrides per installatiepartner */
  partners: Record<string, PersonOverride>;
};

export const ROLE_LABELS: Record<TargetRole, string> = {
  team: "Team (dashboard)",
  adviseur: "Adviseurs",
  beller: "Bellers",
  installateur: "Installatie",
};
