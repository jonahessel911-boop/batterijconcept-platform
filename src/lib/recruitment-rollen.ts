import type { RecruitmentRol } from "@/types/database";

export type RecruitmentKaartPin = {
  id: string;
  kind: "hq" | "kandidaat" | "adviseur" | "monteur";
  rol: RecruitmentRol | "hq" | "adviseur";
  naam: string;
  functie: string | null;
  status: string | null;
  plaats: string | null;
  lat: number;
  lng: number;
  aangenomen: boolean;
  /** Adviseurs / monteurs: startadres-label. */
  start_adres?: string | null;
};

export const RECRUITMENT_ROL_LABEL: Record<RecruitmentRol, string> = {
  adviseur_sales: "Adviseur sales",
  appointment_setter: "Appointment setter",
  installateur: "Installateur / team",
  monteur: "Monteur",
  am_maintenance: "AM Maintenance",
  bezorger: "Bezorger / bus",
  overig: "Overig",
};

export const RECRUITMENT_ROL_OPTIONS: RecruitmentRol[] = [
  "adviseur_sales",
  "appointment_setter",
  "installateur",
  "monteur",
  "am_maintenance",
  "bezorger",
  "overig",
];

/** Classificeer functie-/rol-string voor filters en kaart. */
export function classifyRecruitmentRol(
  value: string | null | undefined
): RecruitmentRol {
  const t = (value || "").trim().toLowerCase();
  if (!t) return "overig";
  if ((RECRUITMENT_ROL_OPTIONS as string[]).includes(t)) {
    return t as RecruitmentRol;
  }
  // Huidige functie: ZZP-verkoper / sales telt als adviseur (ook als iemand
  // oorspronkelijk als setter solliciteerde).
  const looksSales =
    (/adviseur|verkoper|account[\s_-]?manager|\bsales\b|buitendienst|thuisadviseur|energie[\s_-]?adviseur/.test(
      t
    ) ||
      (/zzp|zzpz/.test(t) &&
        /sales|verkoper|adviseur/.test(t))) &&
    !/appointment[\s_-]?setter|belteam|telemarketing/.test(t);
  if (looksSales) {
    return "adviseur_sales";
  }
  if (
    /appointment[\s_-]?setter|setter|beller|belteam|telemarketing|afspraak[\s_-]?zet/.test(
      t
    )
  ) {
    return "appointment_setter";
  }
  if (/bezorg|bus|chauffeur|koerier|materiaal|bestel/.test(t)) {
    return "bezorger";
  }
  if (
    /am[\s_-]?maintenance|am maintenance|maintenance|nazorg|service[\s_-]?tech|after[\s_-]?sales|aftercare/.test(
      t
    )
  ) {
    return "am_maintenance";
  }
  if (/monteur|montage/.test(t)) {
    return "monteur";
  }
  if (/install|team|elektr|batterij|techniek/.test(t)) {
    return "installateur";
  }
  return "overig";
}

/**
 * Rol voor CPH / staffing: huidige functie wint.
 * Vacature-rol alleen als functie leeg/onduidelijk is
 * (bijv. iemand die als setter solliciteerde maar nu ZZP-verkoper is).
 */
export function classifyHireRol(opts: {
  functie?: string | null;
  vacatureRol?: string | null;
}): RecruitmentRol {
  const fromFunctie = classifyRecruitmentRol(opts.functie);
  if (fromFunctie !== "overig") return fromFunctie;
  return classifyRecruitmentRol(opts.vacatureRol);
}

/** Standaard vacatures die altijd open staan (koppelbaar aan Meta / sollicitaties). */
export const STANDARD_RECRUITMENT_VACATURES = [
  {
    titel: "Adviseur sales",
    rol: "adviseur_sales" as RecruitmentRol,
    korte_omschrijving: "Sales-adviseur thuisbatterijen / warmtepompen. Fulltime, NL.",
    sort_order: 1,
  },
  {
    titel: "Appointment setter",
    rol: "appointment_setter" as RecruitmentRol,
    korte_omschrijving: "Afspraken inplannen voor adviseurs. Fulltime, NL.",
    sort_order: 2,
  },
  {
    titel: "Monteur batterijen",
    rol: "monteur" as RecruitmentRol,
    korte_omschrijving: "Montage thuisbatterijen bij particulieren. Fulltime, NL.",
    sort_order: 3,
  },
  {
    titel: "Monteur warmtepompen",
    rol: "monteur" as RecruitmentRol,
    korte_omschrijving: "Montage warmtepompen bij particulieren. Fulltime, NL.",
    sort_order: 4,
  },
] as const;

export function isStandardVacatureTitel(
  titel: string | null | undefined
): boolean {
  const t = (titel || "").trim().toLowerCase();
  if (!t) return false;
  return STANDARD_RECRUITMENT_VACATURES.some(
    (v) => v.titel.toLowerCase() === t
  );
}

export function isAangenomenStatus(status: string | null | undefined): boolean {
  const s = (status || "").trim();
  return (
    s === "aangenomen_training_gepland" ||
    s === "aangenomen_actief" ||
    s === "aangenomen"
  );
}

/** HQ Daltonlaan — vaste coords voor routes. */
export const BEZORG_HQ = {
  label: "HQ BatterijConcept",
  adres: "Daltonlaan 500, 3584 BK Utrecht",
  lat: 52.0875,
  lng: 5.1686,
} as const;

export const BEZORG_MAX_STOPS_PER_DAG = 9;
