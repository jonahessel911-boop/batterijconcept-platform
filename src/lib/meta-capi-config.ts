/**
 * Meta Conversions API — status → event mapping.
 * Aanpasbaar zonder de send-logica te wijzigen.
 *
 * Funnel (cumulatief, max 1× per event):
 *   1 QualifiedLead + Schedule  — fysieke afspraak geboekt (niet terugbel)
 *   2 (zelfde)                  — na-afspraak statussen (inhaal als gemist)
 *   3 Purchase                  — deal / sale
 *
 * Los daarvan:
 *   NotQualifiedLead — bel-uitkomsten die géén goede lead zijn
 */
import type { LeadStatus } from "@/types/database";

export type MetaCapiEventName =
  | "QualifiedLead"
  | "Schedule"
  | "Purchase"
  | "NotQualifiedLead";

/** Statussen → NotQualifiedLead (één keer). */
export const META_CAPI_NOT_QUALIFIED: ReadonlySet<LeadStatus> = new Set([
  "geen_interesse",
  "geen_contact",
  "huurwoning",
  "foutief_nummer",
  "gegevens_niet_overeen",
  "niet_gekwalificeerd",
]);

/**
 * Niveau in de positieve funnel.
 * 0 = niets (of NotQualifiedLead via aparte set)
 * 1 = QualifiedLead + Schedule (afspraak geboekt)
 * 2 = idem (na bezoek; vangt gemiste sync op)
 * 3 = + Purchase
 */
export const META_CAPI_STATUS_LEVEL: Partial<Record<LeadStatus, 0 | 1 | 2 | 3>> =
  {
    nieuw: 0,

    // NotQualifiedLead — zie META_CAPI_NOT_QUALIFIED
    huurwoning: 0,
    foutief_nummer: 0,
    gegevens_niet_overeen: 0,
    geen_contact: 0,
    geen_interesse: 0,
    niet_gekwalificeerd: 0,

    // Fysieke afspraak geboekt → QualifiedLead + Schedule
    afspraak: 1,
    vervolg_fysiek: 1,
    vervolg_tel: 1,

    // Na bezoek (Schedule al bij booking; blijft 1 voor inhaal)
    na_afspraak: 1,
    offerte_afgewezen: 1,
    vervolg_geen_contact: 1,
    deur_niet_open: 1,
    afspraak_afgezegd_klant: 1,

    // Purchase
    sale_financiering: 3,
    sale_eigen_middelen: 3,
    deal: 3,
  };

/** Positieve funnel-volgorde (cumulatief). NotQualifiedLead staat hier buiten. */
export const META_CAPI_EVENT_ORDER: Exclude<
  MetaCapiEventName,
  "NotQualifiedLead"
>[] = ["QualifiedLead", "Schedule", "Purchase"];

export function isMetaCapiNotQualified(
  status: LeadStatus | string
): boolean {
  return META_CAPI_NOT_QUALIFIED.has(status as LeadStatus);
}

export function metaCapiLevelForStatus(status: LeadStatus | string): 0 | 1 | 2 | 3 {
  const level = META_CAPI_STATUS_LEVEL[status as LeadStatus];
  return level ?? 0;
}

/**
 * Events voor deze status.
 * NotQualifiedLead is exclusief (geen QualifiedLead/Schedule/Purchase).
 * Niveau 1+ stuurt QualifiedLead + Schedule; niveau 3 ook Purchase.
 */
export function metaCapiEventsForStatus(
  status: LeadStatus | string
): MetaCapiEventName[] {
  if (isMetaCapiNotQualified(status)) {
    return ["NotQualifiedLead"];
  }
  const level = metaCapiLevelForStatus(status);
  if (level <= 0) return [];
  // Niveau 1 en 2 = QualifiedLead + Schedule; 3 = + Purchase
  if (level >= 3) return ["QualifiedLead", "Schedule", "Purchase"];
  return ["QualifiedLead", "Schedule"];
}

/** @deprecated Gebruik metaCapiEventsForStatus */
export function metaCapiEventsForLevel(
  level: 0 | 1 | 2 | 3
): MetaCapiEventName[] {
  if (level <= 0) return [];
  if (level >= 3) return ["QualifiedLead", "Schedule", "Purchase"];
  return ["QualifiedLead", "Schedule"];
}
