import type {
  FactuurStatus,
  LeadStatus,
  OfferteStatus,
  Prioriteit,
  ProjectStatus,
} from "@/types/database";

export const leadStatusLabel: Record<LeadStatus, string> = {
  nieuw: "Nieuw",
  afspraak: "Afspraak",
  geen_interesse: "Geen interesse",
  geen_contact: "Geen contact",
  deal: "Deal",
};

export const LEAD_STATUSES: LeadStatus[] = [
  "nieuw",
  "afspraak",
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
  gepland: "Gepland",
  in_uitvoering: "In uitvoering",
  wacht_op_materiaal: "Wacht op materiaal",
  opgeleverd: "Opgeleverd",
  geannuleerd: "Geannuleerd",
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
  kind: "lead" | "offerte" | "project" | "factuur" | "prioriteit",
  value: string
): string {
  const success = "border border-[#0D5C32]/25 bg-[#E8F6EC] text-[#0D5C32]";
  const warn = "border border-[#C45A12]/25 bg-[#FFF0E6] text-[#C45A12]";
  const muted = "border border-[#cfd6d1] bg-[#f5f7f6] text-[#5A635C]";
  const urgent = "border border-[#F37021] bg-[#F37021] text-white";
  const info = "border border-[#1A4A6E]/20 bg-[#E8F0F6] text-[#1A4A6E]";

  if (kind === "prioriteit") {
    if (value === "urgent") return urgent;
    if (value === "hoog") return warn;
    return muted;
  }

  if (["deal", "ondertekend", "opgeleverd", "betaald"].includes(value)) {
    return success;
  }
  if (
    [
      "urgent",
      "verlopen",
      "vervallen",
      "geen_interesse",
      "geen_contact",
      "geannuleerd",
    ].includes(value)
  ) {
    return value === "urgent" ? urgent : warn;
  }
  if (
    ["nieuw", "afspraak", "verzonden", "in_uitvoering", "deels_betaald"].includes(
      value
    )
  ) {
    return info;
  }
  return muted;
}
