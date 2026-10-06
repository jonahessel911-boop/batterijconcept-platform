/**
 * Aparte financieringsfase (Warmtefonds) — parallel aan de hoofd-projectstatus.
 *
 * 1. Doorgestuurd naar Edwin (intake / WhatsApp)
 * 2. Afspraak gepland (+ interne datum/tijd)
 * 3. Aanvraag gedaan → goedgekeurd → uitbetaald
 */
import type { ProjectAfdeling } from "@/lib/project-afdeling";

export type FinancieringStatus =
  | "doorgestuurd_naar_edwin"
  | "afspraak_ingepland"
  | "aanvraag_gedaan"
  | "aanvraag_goedgekeurd"
  | "uitbetaald"
  | "afgewezen";

export const FINANCIERING_PIPELINE: FinancieringStatus[] = [
  "doorgestuurd_naar_edwin",
  "afspraak_ingepland",
  "aanvraag_gedaan",
  "aanvraag_goedgekeurd",
  "uitbetaald",
];

export const FINANCIERING_STATUS_LABEL: Record<FinancieringStatus, string> = {
  doorgestuurd_naar_edwin: "Doorgestuurd naar Edwin",
  afspraak_ingepland: "Afspraak gepland",
  aanvraag_gedaan: "Warmtefonds aanvraag gedaan",
  aanvraag_goedgekeurd: "Warmtefonds aanvraag goedgekeurd",
  uitbetaald: "Warmtefonds uitbetaald",
  afgewezen: "Warmtefonds afgewezen",
};

export const FINANCIERING_STATUS_LABEL_KORT: Record<
  FinancieringStatus,
  string
> = {
  doorgestuurd_naar_edwin: "Doorgestuurd naar Edwin",
  afspraak_ingepland: "Afspraak gepland",
  aanvraag_gedaan: "Aanvraag gedaan",
  aanvraag_goedgekeurd: "Aanvraag goedgekeurd",
  uitbetaald: "Uitbetaald",
  afgewezen: "Afgewezen",
};

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
    autoKeySuffix: "wacht_afspraak",
    titel: "Wachten op Warmtefonds-afspraak van Edwin (binnen ±2 dagen)",
    afdeling: "Backoffice",
    dueDays: 2,
  },
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

export function isFinancieringStatus(
  value: string | null | undefined
): value is FinancieringStatus {
  return (
    value === "doorgestuurd_naar_edwin" ||
    value === "afspraak_ingepland" ||
    value === "aanvraag_gedaan" ||
    value === "aanvraag_goedgekeurd" ||
    value === "uitbetaald" ||
    value === "afgewezen"
  );
}

/**
 * Leid financiering_status af uit de oude hoofdstatus (backfill / fallback).
 */
export function financieringStatusFromProjectStatus(
  status: string | null | undefined
): FinancieringStatus | null {
  switch (status) {
    case "warmtefonds_afspraak_ingepland":
      return "afspraak_ingepland";
    case "warmtefonds_aangevraagd":
    case "warmtefonds_in_behandeling":
      return "aanvraag_gedaan";
    case "warmtefonds_goedgekeurd":
      return "aanvraag_goedgekeurd";
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
