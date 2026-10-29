import {
  isAanbetalingFactuurOmschrijving,
  isRestantFactuurOmschrijving,
} from "@/lib/aanbetaling";
import type { Factuur, Project } from "@/types/database";

/** Factuursoort voor CRM-lijst (naast betaalstatus). */
export type FactuurSoort =
  | "aanbetaling"
  | "em"
  | "wf_intern"
  | "wf_declaratie"
  | "credit";

export const factuurSoortLabel: Record<FactuurSoort, string> = {
  aanbetaling: "Aanbetalingsfactuur",
  em: "EM factuur",
  wf_intern: "WF factuur intern",
  wf_declaratie: "WF declaratie factuur",
  credit: "Credit",
};

/** Korte toelichting (title/tooltip). */
export const factuurSoortHint: Record<FactuurSoort, string> = {
  aanbetaling: "Aanbetalingsfactuur — klant betaalt vooraf",
  em: "Eigen middelen — restant-/orderfactuur",
  wf_intern: "Warmtefonds — intern; betaling vaak later via het fonds",
  wf_declaratie:
    "Warmtefonds-declaratie — betaling vaak later via het fonds",
  credit: "Creditfactuur",
};

/**
 * Positief WF-signaal (geen default-WF zoals resolveBetaalwijze).
 * Onbekend → false, zodat we geen EM-factuur als WF-intern markeren.
 */
export function isWarmtefondsFactuurContext(opts: {
  project?: Pick<Project, "betaalwijze"> & {
    leads?: { status?: string | null } | null;
    offertes?:
      | { financiering_voorbehoud?: boolean | null }
      | { financiering_voorbehoud?: boolean | null }[]
      | null;
  } | null;
  financieringVoorbehoud?: boolean | null;
}): boolean {
  const leadStatus = opts.project?.leads?.status ?? null;
  if (leadStatus === "sale_eigen_middelen") return false;
  if (leadStatus === "sale_financiering") return true;

  const bw = opts.project?.betaalwijze;
  if (bw === "eigen_middelen") return false;
  if (bw === "warmtefonds") return true;

  const off = Array.isArray(opts.project?.offertes)
    ? opts.project?.offertes[0]
    : opts.project?.offertes;
  const voorbehoud =
    opts.financieringVoorbehoud ?? off?.financiering_voorbehoud ?? null;
  if (voorbehoud === false) return false;
  if (voorbehoud === true) return true;
  return false;
}

/**
 * Classificeer factuur voor badges in de facturenlijst.
 * WF + restant → declaratie; overige WF-order → intern (later via fonds).
 */
export function resolveFactuurSoort(
  factuur: Pick<Factuur, "omschrijving" | "credit_van_factuur_id">,
  opts?: {
    isWarmtefonds?: boolean;
  }
): FactuurSoort {
  if (factuur.credit_van_factuur_id) return "credit";
  if (isAanbetalingFactuurOmschrijving(factuur.omschrijving)) {
    return "aanbetaling";
  }
  if (opts?.isWarmtefonds) {
    return isRestantFactuurOmschrijving(factuur.omschrijving)
      ? "wf_declaratie"
      : "wf_intern";
  }
  return "em";
}

/**
 * WF-intern / declaratie: geen “verlopen”-alarm in de lijst —
 * betaling komt vaak later via Warmtefonds.
 */
export function isFactuurWfLaterBetaald(
  factuur: Pick<Factuur, "omschrijving" | "credit_van_factuur_id">,
  opts?: { isWarmtefonds?: boolean }
): boolean {
  const soort = resolveFactuurSoort(factuur, opts);
  return soort === "wf_intern" || soort === "wf_declaratie";
}

export function factuurSoortTone(soort: FactuurSoort): string {
  switch (soort) {
    case "aanbetaling":
      return "border border-[#C9A227]/40 bg-[#FFF8D6] text-[#8A6D00]";
    case "em":
      return "border border-[#2E7D32]/30 bg-[#E8F5E9] text-[#2E7D32]";
    case "wf_intern":
    case "wf_declaratie":
      return "border border-[#1A4A6E]/30 bg-[#E8F0F6] text-[#1A4A6E]";
    case "credit":
      return "border border-[#6B7C72]/25 bg-[#EEF2F0] text-[#5A635C]";
    default:
      return "border border-line bg-wash text-muted";
  }
}
