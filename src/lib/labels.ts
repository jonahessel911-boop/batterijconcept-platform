import type {
  AfspraakStatus,
  FactuurStatus,
  LeadStatus,
  OfferteStatus,
  Prioriteit,
  ProjectStatus,
  ServiceVerzoekStatus,
} from "@/types/database";

export const leadStatusLabel: Record<LeadStatus, string> = {
  nieuw: "Nieuw",
  afspraak: "Afspraak",
  na_afspraak: "Na afspraak",
  vervolg_fysiek: "Vervolg fysiek",
  vervolg_tel: "Vervolg telefonisch",
  vervolg_geen_contact: "Vervolg – geen contact",
  offerte_afgewezen: "Offerte afgewezen",
  niet_gekwalificeerd: "Niet gekwalificeerd",
  geen_interesse: "Geen interesse",
  geen_contact: "Geen contact",
  deal: "Deal",
};

export const LEAD_STATUSES: LeadStatus[] = [
  "nieuw",
  "afspraak",
  "na_afspraak",
  "vervolg_fysiek",
  "vervolg_tel",
  "vervolg_geen_contact",
  "offerte_afgewezen",
  "niet_gekwalificeerd",
  "geen_interesse",
  "geen_contact",
  "deal",
];

export const prioriteitLabel: Record<Prioriteit, string> = {
  laag: "Laag",
  normaal: "Normaal",
  hoog: "Hoog",
  urgent: "Urgent",
};

export const offerteStatusLabel: Record<OfferteStatus, string> = {
  concept: "Concept",
  verzonden: "Verzonden",
  ondertekend: "Ondertekend",
  verlopen: "Verlopen",
  afgewezen: "Afgewezen",
};

export const projectStatusLabel: Record<ProjectStatus, string> = {
  schouw_inplannen: "Schouw inplannen",
  schouw_gepland: "Schouw gepland",
  btw_factuur_eruit: "BTW factuur eruit",
  product_ingekocht: "Product ingekocht",
  installatie_gepland: "Installatie gepland",
  installatie_voltooid: "Installatie voltooid",
  service: "Service",
};

export const PROJECT_STATUSES: ProjectStatus[] = [
  "schouw_inplannen",
  "schouw_gepland",
  "btw_factuur_eruit",
  "product_ingekocht",
  "installatie_gepland",
  "installatie_voltooid",
  "service",
];

export const serviceVerzoekStatusLabel: Record<ServiceVerzoekStatus, string> = {
  open: "Open",
  afgehandeld: "Afgehandeld",
};

export const afspraakStatusLabel: Record<AfspraakStatus, string> = {
  gepland: "Gepland",
  bevestigd: "Bevestigd",
  verzet: "Verzet",
  geannuleerd: "Geannuleerd",
  voltooid: "Voltooid",
};

export const factuurStatusLabel: Record<FactuurStatus, string> = {
  concept: "Concept",
  verzonden: "Verzonden",
  betaald: "Betaald",
  deels_betaald: "Deels betaald",
  vervallen: "Vervallen",
};

/** Tailwind classes voor status labels (strak, geen pills) */
export function statusTone(
  kind: "lead" | "offerte" | "project" | "factuur" | "prioriteit" | "afspraak",
  value: string
): string {
  const success = "border border-[#0D5C32]/25 bg-[#E8F6EC] text-[#0D5C32]";
  const warn = "border border-[#C45A12]/25 bg-[#FFF0E6] text-[#C45A12]";
  const muted = "border border-[#cfd6d1] bg-[#f5f7f6] text-[#5A635C]";
  const urgent = "border border-[#F37021] bg-[#F37021] text-white";
  const info = "border border-[#1A4A6E]/20 bg-[#E8F0F6] text-[#1A4A6E]";
  const ink = "border border-[#1A1F1C]/25 bg-[#f5f7f6] text-[#1A1F1C]";
  const yellow = "border border-[#C9A227]/35 bg-[#FFF8D6] text-[#8A6D00]";
  const danger = "border border-[#C62828]/30 bg-[#FDECEA] text-[#C62828]";

  if (kind === "prioriteit") {
    if (value === "urgent") return urgent;
    if (value === "hoog") return warn;
    return muted;
  }

  if (kind === "lead") {
    if (value === "deal") return success;
    if (value === "afspraak" || value === "vervolg_fysiek") return yellow;
    if (value === "na_afspraak") return warn;
    if (value === "vervolg_tel") return info;
    if (value === "vervolg_geen_contact" || value === "geen_contact") return ink;
    if (
      value === "geen_interesse" ||
      value === "offerte_afgewezen" ||
      value === "niet_gekwalificeerd"
    ) {
      return danger;
    }
  }

  if (
    [
      "deal",
      "ondertekend",
      "installatie_voltooid",
      "service",
      "betaald",
      "bevestigd",
      "voltooid",
    ].includes(value)
  ) {
    return success;
  }
  if (
    [
      "urgent",
      "verlopen",
      "vervallen",
      "geannuleerd",
    ].includes(value)
  ) {
    return value === "urgent" ? urgent : warn;
  }
  if (
    [
      "nieuw",
      "verzonden",
      "schouw_inplannen",
      "schouw_gepland",
      "btw_factuur_eruit",
      "product_ingekocht",
      "installatie_gepland",
      "deels_betaald",
      "gepland",
      "verzet",
    ].includes(value)
  ) {
    return info;
  }
  return muted;
}
