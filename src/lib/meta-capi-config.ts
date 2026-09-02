/**
 * Meta Conversions API — status → event mapping.
 * Aanpasbaar zonder de send-logica te wijzigen.
 */
import type { LeadStatus } from "@/types/database";

export type MetaCapiEventName = "QualifiedLead" | "Schedule" | "Purchase";

/** Niveau 1 = QualifiedLead, 2 = Schedule, 3 = Purchase. 0 = niets. */
export const META_CAPI_STATUS_LEVEL: Partial<Record<LeadStatus, 0 | 1 | 2 | 3>> =
  {
    // Nooit versturen
    nieuw: 0,
    huurwoning: 0,
    foutief_nummer: 0,
    gegevens_niet_overeen: 0,
    geen_contact: 0,
    niet_gekwalificeerd: 0,

    // QualifiedLead (afspraak geboekt / in pipeline na booking)
    afspraak: 1,
    // Schedule (afspraak heeft plaatsgevonden / uitkomst na bezoek)
    na_afspraak: 2,
    vervolg_fysiek: 2,
    vervolg_tel: 2,
    offerte_afgewezen: 2,
    geen_interesse: 2,
    vervolg_geen_contact: 2,
    // Afspraak nooit doorgegaan → wel QualifiedLead, géén Schedule
    deur_niet_open: 1,
    afspraak_afgezegd_klant: 1,

    // Purchase (één keer per lead; sale-uitkomst óf getekende deal)
    sale_financiering: 3,
    sale_eigen_middelen: 3,
    deal: 3,
  };

export const META_CAPI_EVENT_ORDER: MetaCapiEventName[] = [
  "QualifiedLead",
  "Schedule",
  "Purchase",
];

export function metaCapiLevelForStatus(status: LeadStatus | string): 0 | 1 | 2 | 3 {
  const level = META_CAPI_STATUS_LEVEL[status as LeadStatus];
  return level ?? 0;
}

/** Events die horen bij dit niveau (cumulatief). */
export function metaCapiEventsForLevel(
  level: 0 | 1 | 2 | 3
): MetaCapiEventName[] {
  if (level <= 0) return [];
  return META_CAPI_EVENT_ORDER.slice(0, level);
}
