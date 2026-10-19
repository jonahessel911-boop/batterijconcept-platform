/**
 * Warmtefonds-financieringsfase — parallel aan de hoofd-projectstatus.
 *
 * Pipeline (portaal + CRM):
 * 1. Doorgestuurd (offerte getekend → BO)
 * 2. Documenten aanleveren
 * 3. Warmtefonds in behandeling
 * 4. Aanbod ondertekenen (goedgekeurd)
 * 5. Declaratie indienen
 * 6. Afgehandeld — wachten op betaling
 * 7. Afgehandeld — betaald
 *
 * Legacy statuses blijven geldig en worden genormaliseerd voor de pipeline-UI.
 * Interne afspraak (warmtefonds_afspraak_at) is geen pipeline-stap.
 */
import type { ProjectAfdeling } from "@/lib/project-afdeling";

export type FinancieringStatus =
  | "doorgestuurd_naar_edwin"
  | "documenten_aanleveren"
  | "in_behandeling"
  | "aanbod_ondertekenen"
  | "declaratie_indienen"
  | "wacht_op_betaling"
  | "uitbetaald"
  | "afgewezen"
  /** @deprecated legacy — genormaliseerd naar pipeline */
  | "afspraak_ingepland"
  /** @deprecated legacy → in_behandeling */
  | "aanvraag_gedaan"
  /** @deprecated legacy → aanbod_ondertekenen */
  | "aanvraag_goedgekeurd";

/** Actieve pipeline-stappen (zonder afgewezen / legacy). */
export const FINANCIERING_PIPELINE: FinancieringStatus[] = [
  "doorgestuurd_naar_edwin",
  "documenten_aanleveren",
  "in_behandeling",
  "aanbod_ondertekenen",
  "declaratie_indienen",
  "wacht_op_betaling",
  "uitbetaald",
];

export const FINANCIERING_STATUS_LABEL: Record<FinancieringStatus, string> = {
  doorgestuurd_naar_edwin: "Doorgestuurd naar Warmtefonds",
  documenten_aanleveren: "Documenten aanleveren",
  in_behandeling: "Warmtefonds in behandeling",
  aanbod_ondertekenen: "Aanbod ondertekenen",
  declaratie_indienen: "Declaratie indienen",
  wacht_op_betaling: "Afgehandeld — wachten op betaling",
  uitbetaald: "Afgehandeld — betaald",
  afgewezen: "Warmtefonds afgewezen",
  afspraak_ingepland: "Afspraak gepland",
  aanvraag_gedaan: "Warmtefonds aanvraag gedaan",
  aanvraag_goedgekeurd: "Warmtefonds aanvraag goedgekeurd",
};

export const FINANCIERING_STATUS_LABEL_KORT: Record<
  FinancieringStatus,
  string
> = {
  doorgestuurd_naar_edwin: "Doorgestuurd",
  documenten_aanleveren: "Documenten aanleveren",
  in_behandeling: "In behandeling",
  aanbod_ondertekenen: "Aanbod ondertekenen",
  declaratie_indienen: "Declaratie indienen",
  wacht_op_betaling: "Wachten op betaling",
  uitbetaald: "Betaald",
  afgewezen: "Afgewezen",
  afspraak_ingepland: "Afspraak gepland",
  aanvraag_gedaan: "Aanvraag gedaan",
  aanvraag_goedgekeurd: "Aanvraag goedgekeurd",
};

/** Stapnummer in UI (1…7) voor pipeline-statuses. */
export function financieringStapNummer(
  status: FinancieringStatus | null | undefined
): number | null {
  const n = normalizeFinancieringStatus(status);
  if (!n || n === "afgewezen") return null;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Map legacy → huidige pipeline-stap voor weergave / voortgang.
 * afspraak_ingepland blijft “vroeg” (doorgestuurd) — afspraak is apart.
 */
export function normalizeFinancieringStatus(
  status: FinancieringStatus | string | null | undefined
): FinancieringStatus | null {
  if (!status) return null;
  if (status === "afspraak_ingepland") return "doorgestuurd_naar_edwin";
  if (status === "aanvraag_gedaan") return "in_behandeling";
  if (status === "aanvraag_goedgekeurd") return "aanbod_ondertekenen";
  if (isFinancieringStatus(status)) return status;
  return null;
}

export type FinancieringTaakConfig = {
  titel: string;
  afdeling: ProjectAfdeling;
  dueDays: number;
  autoKeySuffix: string;
};

/** Auto-taken per financieringsfase. */
export const FINANCIERING_STATUS_TAAK: Partial<
  Record<FinancieringStatus, FinancieringTaakConfig>
> = {
  doorgestuurd_naar_edwin: {
    autoKeySuffix: "wacht_documenten",
    titel: "Warmtefonds: documenten opvragen / afspraak plannen",
    afdeling: "Backoffice",
    dueDays: 2,
  },
  documenten_aanleveren: {
    autoKeySuffix: "documenten",
    titel: "Warmtefonds: documenten compleet maken",
    afdeling: "Backoffice",
    dueDays: 3,
  },
  in_behandeling: {
    autoKeySuffix: "opvolgen",
    titel: "Opvolgen bij Warmtefonds (in behandeling)",
    afdeling: "Backoffice",
    dueDays: 5,
  },
  aanbod_ondertekenen: {
    autoKeySuffix: "aanbod",
    titel: "Warmtefonds-aanbod laten ondertekenen door klant",
    afdeling: "Backoffice",
    dueDays: 3,
  },
  declaratie_indienen: {
    autoKeySuffix: "declaratie",
    titel: "Warmtefonds-declaratie indienen",
    afdeling: "Backoffice",
    dueDays: 2,
  },
  wacht_op_betaling: {
    autoKeySuffix: "betaling",
    titel: "Wachten op Warmtefonds-uitbetaling",
    afdeling: "Backoffice",
    dueDays: 14,
  },
  // Legacy keys (als status nog zo in DB staat)
  afspraak_ingepland: {
    autoKeySuffix: "aanvraag",
    titel: "Warmtefonds-aanvraag indienen tijdens/na afspraak",
    afdeling: "Backoffice",
    dueDays: 1,
  },
  aanvraag_gedaan: {
    autoKeySuffix: "opvolgen",
    titel: "Opvolgen bij Warmtefonds",
    afdeling: "Backoffice",
    dueDays: 3,
  },
  aanvraag_goedgekeurd: {
    autoKeySuffix: "restantfactuur",
    titel: "Restantfactuur Warmtefonds (max. € 8.500) opstellen en versturen",
    afdeling: "Backoffice",
    dueDays: 1,
  },
  afgewezen: {
    autoKeySuffix: "schakel",
    titel:
      "Schakel financiering: zet om naar eigen middelen of stop project, overleg met klant",
    afdeling: "Backoffice",
    dueDays: 1,
  },
};

const ALL_STATUSES: FinancieringStatus[] = [
  ...FINANCIERING_PIPELINE,
  "afgewezen",
  "afspraak_ingepland",
  "aanvraag_gedaan",
  "aanvraag_goedgekeurd",
];

export function isFinancieringStatus(
  value: string | null | undefined
): value is FinancieringStatus {
  return ALL_STATUSES.includes(value as FinancieringStatus);
}

/**
 * Leid financiering_status af uit de oude hoofdstatus (backfill / fallback).
 */
export function financieringStatusFromProjectStatus(
  status: string | null | undefined
): FinancieringStatus | null {
  switch (status) {
    case "warmtefonds_afspraak_ingepland":
      return "doorgestuurd_naar_edwin";
    case "warmtefonds_aangevraagd":
    case "warmtefonds_in_behandeling":
      return "in_behandeling";
    case "warmtefonds_goedgekeurd":
      return "aanbod_ondertekenen";
    case "warmtefonds_afgewezen":
      return "afgewezen";
    default:
      return null;
  }
}

/** Effectieve financieringsstatus: kolom, anders afgeleid van project.status. */
export function resolveFinancieringStatus(project: {
  financiering_status?: string | null;
  status?: string | null;
}): FinancieringStatus | null {
  if (isFinancieringStatus(project.financiering_status)) {
    return project.financiering_status;
  }
  return financieringStatusFromProjectStatus(project.status);
}

/** Restantfactuur vanaf aanbod/goedgekeurd (niet eerder). */
export function financieringMagRestantFactuur(
  status: FinancieringStatus | null | undefined
): boolean {
  const n = normalizeFinancieringStatus(status);
  if (!n) return false;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  const from = FINANCIERING_PIPELINE.indexOf("aanbod_ondertekenen");
  return idx >= from;
}
