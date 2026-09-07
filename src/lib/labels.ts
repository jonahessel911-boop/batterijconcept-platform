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
  vervolg_fysiek: "Vervolg op locatie",
  vervolg_tel: "Vervolg telefonisch",
  vervolg_geen_contact: "Na Vervolg telefonisch 3x geen gehoor",
  offerte_afgewezen: "Offerte afgewezen",
  niet_gekwalificeerd: "Niet goed gekwalificeerd door beller",
  geen_interesse: "Geen interesse in thuisbatterij",
  geen_contact: "Geen contact",
  deal: "Deal",
  sale_financiering: "Sale met financiering",
  sale_eigen_middelen: "Sale met eigen middelen",
  deur_niet_open: "Deur niet open / klant niet bereikbaar",
  afspraak_afgezegd_klant: "Afspraak door klant afgezegd",
  huurwoning: "Huurwoning",
  foutief_nummer: "Foutief nummer",
  gegevens_niet_overeen: "Gegevens komen niet overeen",
};

/** Uitkomsten na een fysieke afspraak (actiepunten in agenda). */
export const AFSPRAAK_UITKOMSTEN: LeadStatus[] = [
  "vervolg_fysiek",
  "vervolg_tel",
  "sale_financiering",
  "sale_eigen_middelen",
  "offerte_afgewezen",
  "geen_interesse",
  "niet_gekwalificeerd",
  "deur_niet_open",
  "afspraak_afgezegd_klant",
  "vervolg_geen_contact",
];

/** Bel-uitkomsten (excl. terugbel-afspraak / warme terugbel — die zijn aparte acties). */
export const BEL_UITKOMSTEN: LeadStatus[] = [
  "huurwoning",
  "foutief_nummer",
  "gegevens_niet_overeen",
  "geen_interesse",
];

/**
 * Alle leadstatussen gegroepeerd voor dropdowns (met scheiding).
 * Volgorde = weergavevolgorde.
 */
export const LEAD_STATUS_GROUPS: {
  label: string;
  statuses: LeadStatus[];
}[] = [
  {
    label: "Pipeline",
    statuses: ["nieuw", "afspraak", "na_afspraak"],
  },
  {
    label: "Uitkomst afspraak",
    statuses: [
      "vervolg_fysiek",
      "vervolg_tel",
      "sale_financiering",
      "sale_eigen_middelen",
      "offerte_afgewezen",
      "niet_gekwalificeerd",
      "deur_niet_open",
      "afspraak_afgezegd_klant",
      "vervolg_geen_contact",
    ],
  },
  {
    label: "Bellen",
    statuses: [
      "huurwoning",
      "foutief_nummer",
      "gegevens_niet_overeen",
      "geen_interesse",
      "geen_contact",
    ],
  },
  {
    label: "Overig",
    statuses: ["deal"],
  },
];

/** Platte lijst (zelfde volgorde als groepen). */
export const LEAD_STATUSES: LeadStatus[] = LEAD_STATUS_GROUPS.flatMap(
  (g) => g.statuses
);

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
  schouw_aanbetaling: "Schouw + aanbetaling",
  aanbetaling_betaald: "Aanbetaling betaald",
  schouw_in_afwachting: "Schouw in afwachting",
  schouw_voltooid: "Schouw voltooid",
  restfactuur_verstuurd: "Restfactuur verstuurd",
  restfactuur_betaald: "Restfactuur betaald",
  materiaal_installatie: "Materiaal + installatie plannen",
  installatie_voltooid: "Installatie voltooid",
  service: "Service",
};

/** Klikbare pipeline in backoffice (zonder service). */
export const PROJECT_PIPELINE: ProjectStatus[] = [
  "schouw_aanbetaling",
  "aanbetaling_betaald",
  "schouw_in_afwachting",
  "schouw_voltooid",
  "restfactuur_verstuurd",
  "restfactuur_betaald",
  "materiaal_installatie",
  "installatie_voltooid",
];

export const PROJECT_STATUSES: ProjectStatus[] = [
  ...PROJECT_PIPELINE,
  "service",
];

/** Oude statussen → nieuwe pipeline (voor data vóór migrate). */
export function normalizeProjectStatus(
  status: string | null | undefined
): ProjectStatus {
  switch (status) {
    case "schouw_aanbetaling":
    case "aanbetaling_betaald":
    case "schouw_in_afwachting":
    case "schouw_voltooid":
    case "restfactuur_verstuurd":
    case "restfactuur_betaald":
    case "materiaal_installatie":
    case "installatie_voltooid":
    case "service":
      return status;
    case "schouw_inplannen":
    case "schouwweek_gepland":
    case "schouwdag_plannen":
      return "schouw_aanbetaling";
    case "schouw_gepland":
      return "schouw_in_afwachting";
    case "btw_factuur_eruit":
      return "restfactuur_verstuurd";
    case "materiaal_inkopen":
    case "product_ingekocht":
    case "installatie_gepland":
      return "materiaal_installatie";
    default:
      return "schouw_aanbetaling";
  }
}

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

/** Tailwind classes voor status labels (strak, geen pills). Elke status eigen tint. */
export function statusTone(
  kind: "lead" | "offerte" | "project" | "factuur" | "prioriteit" | "afspraak",
  value: string
): string {
  if (kind === "prioriteit") {
    if (value === "urgent")
      return "border border-[#F37021] bg-[#F37021] text-white";
    if (value === "hoog")
      return "border border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]";
    if (value === "laag")
      return "border border-[#6B7C72]/25 bg-[#EEF2F0] text-[#5A635C]";
    return "border border-[#1A4A6E]/20 bg-[#E8F0F6] text-[#1A4A6E]";
  }

  if (kind === "lead") {
    const lead: Record<string, string> = {
      nieuw: "border border-[#1A4A6E]/25 bg-[#E8F0F6] text-[#1A4A6E]",
      afspraak: "border border-[#C9A227]/40 bg-[#FFF8D6] text-[#8A6D00]",
      na_afspraak: "border border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]",
      vervolg_fysiek: "border border-[#0D7A6F]/30 bg-[#E6F7F5] text-[#0D5C54]",
      vervolg_tel: "border border-[#2F6B9A]/30 bg-[#E7F2FA] text-[#1F5078]",
      vervolg_geen_contact:
        "border border-[#5A4A6E]/30 bg-[#F0ECF5] text-[#4A3A5C]",
      offerte_afgewezen:
        "border border-[#B71C1C]/30 bg-[#FDECEA] text-[#B71C1C]",
      niet_gekwalificeerd:
        "border border-[#8D6E63]/35 bg-[#F5EEEA] text-[#6D4C41]",
      geen_interesse: "border border-[#C62828]/30 bg-[#FFEBEE] text-[#C62828]",
      geen_contact: "border border-[#37474F]/30 bg-[#ECEFF1] text-[#37474F]",
      deal: "border border-[#0D5C32]/30 bg-[#E8F6EC] text-[#0D5C32]",
      sale_financiering:
        "border border-[#1B7A3E]/30 bg-[#DFF5E7] text-[#145C2E]",
      sale_eigen_middelen:
        "border border-[#2E7D32]/30 bg-[#E8F5E9] text-[#1B5E20]",
      deur_niet_open: "border border-[#1565C0]/30 bg-[#E3F2FD] text-[#0D47A1]",
      afspraak_afgezegd_klant:
        "border border-[#E65100]/30 bg-[#FFF3E0] text-[#E65100]",
      huurwoning: "border border-[#795548]/30 bg-[#EFEBE9] text-[#5D4037]",
      foutief_nummer: "border border-[#D32F2F]/30 bg-[#FFCDD2] text-[#B71C1C]",
      gegevens_niet_overeen:
        "border border-[#AD1457]/30 bg-[#FCE4EC] text-[#880E4F]",
    };
    return (
      lead[value] ||
      "border border-[#cfd6d1] bg-[#f5f7f6] text-[#5A635C]"
    );
  }

  if (kind === "afspraak") {
    const afspraak: Record<string, string> = {
      gepland: "border border-[#1A4A6E]/25 bg-[#E8F0F6] text-[#1A4A6E]",
      bevestigd: "border border-[#0D5C32]/30 bg-[#E8F6EC] text-[#0D5C32]",
      verzet: "border border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]",
      geannuleerd: "border border-[#C62828]/30 bg-[#FDECEA] text-[#C62828]",
      voltooid: "border border-[#00695C]/30 bg-[#E0F2F1] text-[#00695C]",
    };
    return (
      afspraak[value] ||
      "border border-[#cfd6d1] bg-[#f5f7f6] text-[#5A635C]"
    );
  }

  if (kind === "offerte") {
    const offerte: Record<string, string> = {
      concept: "border border-[#5A635C]/25 bg-[#EEF2F0] text-[#5A635C]",
      verzonden: "border border-[#1A4A6E]/25 bg-[#E8F0F6] text-[#1A4A6E]",
      ondertekend: "border border-[#0D5C32]/30 bg-[#E8F6EC] text-[#0D5C32]",
      verlopen: "border border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]",
      afgewezen: "border border-[#C62828]/30 bg-[#FDECEA] text-[#C62828]",
    };
    return (
      offerte[value] ||
      "border border-[#cfd6d1] bg-[#f5f7f6] text-[#5A635C]"
    );
  }

  if (kind === "project") {
    const project: Record<string, string> = {
      schouw_aanbetaling:
        "border border-[#1A4A6E]/25 bg-[#E8F0F6] text-[#1A4A6E]",
      aanbetaling_betaald:
        "border border-[#0D7A6F]/30 bg-[#E6F7F5] text-[#0D5C54]",
      schouw_in_afwachting:
        "border border-[#CA8A04]/35 bg-[#FEF9C3] text-[#854D0E]",
      schouw_voltooid:
        "border border-[#1565C0]/30 bg-[#E3F2FD] text-[#0D47A1]",
      restfactuur_verstuurd:
        "border border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]",
      restfactuur_betaald:
        "border border-[#C9A227]/40 bg-[#FFF8D6] text-[#8A6D00]",
      materiaal_installatie:
        "border border-[#7C3AED]/30 bg-[#F5F3FF] text-[#5B21B6]",
      installatie_voltooid:
        "border border-[#0D5C32]/30 bg-[#E8F6EC] text-[#0D5C32]",
      service: "border border-[#00695C]/30 bg-[#E0F2F1] text-[#00695C]",
      schouw_inplannen:
        "border border-[#1A4A6E]/25 bg-[#E8F0F6] text-[#1A4A6E]",
      schouwweek_gepland:
        "border border-[#0F766E]/30 bg-[#F0FDFA] text-[#0F766E]",
      schouwdag_plannen:
        "border border-[#CA8A04]/35 bg-[#FEF9C3] text-[#854D0E]",
      schouw_gepland:
        "border border-[#1565C0]/30 bg-[#E3F2FD] text-[#0D47A1]",
      materiaal_inkopen:
        "border border-[#7C3AED]/30 bg-[#F5F3FF] text-[#5B21B6]",
      btw_factuur_eruit:
        "border border-[#C9A227]/40 bg-[#FFF8D6] text-[#8A6D00]",
      product_ingekocht:
        "border border-[#0D7A6F]/30 bg-[#E6F7F5] text-[#0D5C54]",
      installatie_gepland:
        "border border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]",
    };
    return (
      project[value] ||
      "border border-[#cfd6d1] bg-[#f5f7f6] text-[#5A635C]"
    );
  }

  if (kind === "factuur") {
    const factuur: Record<string, string> = {
      concept: "border border-[#5A635C]/25 bg-[#EEF2F0] text-[#5A635C]",
      verzonden: "border border-[#1A4A6E]/25 bg-[#E8F0F6] text-[#1A4A6E]",
      betaald: "border border-[#0D5C32]/30 bg-[#E8F6EC] text-[#0D5C32]",
      deels_betaald:
        "border border-[#C9A227]/40 bg-[#FFF8D6] text-[#8A6D00]",
      vervallen: "border border-[#C62828]/30 bg-[#FDECEA] text-[#C62828]",
    };
    return (
      factuur[value] ||
      "border border-[#cfd6d1] bg-[#f5f7f6] text-[#5A635C]"
    );
  }

  return "border border-[#cfd6d1] bg-[#f5f7f6] text-[#5A635C]";
}

/** Linker-accent + achtergrond voor afspraakchips in de agenda (per status/soort/afboek). */
export function afspraakAgendaAccent(
  status: string,
  soort?: string | null,
  /** Lead-status / afboekcode na afronden (bij voltooid). */
  leadStatus?: string | null
): { bar: string; bg: string; time: string } {
  if (status === "geannuleerd") {
    return {
      bar: "bg-[#C62828]",
      bg: "bg-[#FDECEA]",
      time: "text-[#C62828]",
    };
  }

  // Voltooid: kleur op basis van afboekcode (lead-uitkomst)
  if (status === "voltooid") {
    const afboek = leadStatus ? afboekAgendaAccent(leadStatus) : null;
    if (afboek) return afboek;
    return {
      bar: "bg-[#00695C]",
      bg: "bg-[#E0F2F1]",
      time: "text-[#00695C]",
    };
  }

  if (status === "verzet") {
    return {
      bar: "bg-[#C45A12]",
      bg: "bg-[#FFF0E6]",
      time: "text-[#C45A12]",
    };
  }

  // Actief (gepland / bevestigd): kleur per soort
  if (soort === "warme_bel") {
    return {
      bar: "bg-[#C9A227]",
      bg: "bg-[#FFF8D6]",
      time: "text-[#8A6D00]",
    };
  }
  if (soort === "bel") {
    return {
      bar: "bg-[#C45A12]",
      bg: "bg-[#FFF0E6]",
      time: "text-[#C45A12]",
    };
  }
  if (soort === "vervolg_punt") {
    return {
      bar: "bg-[#1A4A6E]",
      bg: "bg-[#E8F0F6]",
      time: "text-[#1A4A6E]",
    };
  }
  if (soort === "vervolg_tel") {
    return {
      bar: "bg-[#5B4B8A]",
      bg: "bg-[#F0ECF8]",
      time: "text-[#5B4B8A]",
    };
  }
  if (soort === "vervolg_fysiek") {
    return {
      bar: "bg-[#0E7490]",
      bg: "bg-[#E0F7FA]",
      time: "text-[#0E7490]",
    };
  }
  // nieuw / default — groen (huisbezoek)
  return {
    bar: "bg-green",
    bg: "bg-green-soft",
    time: "text-green-dark",
  };
}

/** Agenda-kleuren voor afboekcodes (lead-uitkomsten na bezoek). */
function afboekAgendaAccent(
  leadStatus: string
): { bar: string; bg: string; time: string } | null {
  switch (leadStatus) {
    case "sale_financiering":
    case "sale_eigen_middelen":
    case "deal":
      return {
        bar: "bg-[#1B7A3E]",
        bg: "bg-[#DFF5E7]",
        time: "text-[#145C2E]",
      };
    case "geen_interesse":
    case "offerte_afgewezen":
      return {
        bar: "bg-[#C62828]",
        bg: "bg-[#FFEBEE]",
        time: "text-[#C62828]",
      };
    case "niet_gekwalificeerd":
    case "huurwoning":
      return {
        bar: "bg-[#6D4C41]",
        bg: "bg-[#F5EEEA]",
        time: "text-[#6D4C41]",
      };
    case "deur_niet_open":
      return {
        bar: "bg-[#1565C0]",
        bg: "bg-[#E3F2FD]",
        time: "text-[#0D47A1]",
      };
    case "afspraak_afgezegd_klant":
      return {
        bar: "bg-[#E65100]",
        bg: "bg-[#FFF3E0]",
        time: "text-[#E65100]",
      };
    case "vervolg_fysiek":
      return {
        bar: "bg-[#0D7A6F]",
        bg: "bg-[#E6F7F5]",
        time: "text-[#0D5C54]",
      };
    case "vervolg_tel":
      return {
        bar: "bg-[#2F6B9A]",
        bg: "bg-[#E7F2FA]",
        time: "text-[#1F5078]",
      };
    case "vervolg_geen_contact":
      return {
        bar: "bg-[#5A4A6E]",
        bg: "bg-[#F0ECF5]",
        time: "text-[#4A3A5C]",
      };
    case "geen_contact":
    case "foutief_nummer":
    case "gegevens_niet_overeen":
      return {
        bar: "bg-[#37474F]",
        bg: "bg-[#ECEFF1]",
        time: "text-[#37474F]",
      };
    default:
      return null;
  }
}
