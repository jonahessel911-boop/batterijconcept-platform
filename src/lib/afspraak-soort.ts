import type { Afspraak, AfspraakSoort, LeadStatus } from "@/types/database";
import { AFSPRAAK_DUUR_MINUTEN } from "@/lib/slots";

export const AFSPRAAK_SOORTEN: AfspraakSoort[] = [
  "nieuw",
  "bel",
  "warme_bel",
  "vervolg_fysiek",
  "vervolg_tel",
  "vervolg_punt",
];

export const afspraakSoortLabel: Record<AfspraakSoort, string> = {
  nieuw: "Afspraak",
  bel: "Terugbel afspraak",
  warme_bel: "Warme terugbel",
  vervolg_fysiek: "Vervolg op locatie",
  vervolg_tel: "Vervolg telefonisch",
  vervolg_punt: "Vervolg punt",
};

const ACTIEF = new Set(["gepland", "bevestigd", "verzet"]);

/** Leadstatussen waarbij geen vervolg punt meer nodig is. */
export const VERVOLG_PUNT_VRIJGESTELD = new Set<LeadStatus>([
  "vervolg_fysiek",
  "vervolg_tel",
  "vervolg_geen_contact",
  "sale_financiering",
  "sale_eigen_middelen",
  "offerte_afgewezen",
  "geen_interesse",
  "niet_gekwalificeerd",
  "deur_niet_open",
  "afspraak_afgezegd_klant",
  "geen_contact",
  "deal",
  "huurwoning",
  "foutief_nummer",
  "gegevens_niet_overeen",
]);

export function normalizeAfspraakSoort(
  value: string | null | undefined
): AfspraakSoort {
  if (
    value === "bel" ||
    value === "warme_bel" ||
    value === "vervolg_fysiek" ||
    value === "vervolg_tel" ||
    value === "vervolg_punt" ||
    value === "nieuw"
  ) {
    return value;
  }
  return "nieuw";
}

/** Fysieke afspraken blokkeren de agenda; bel/telefonisch/punt niet. */
export function afspraakBlokkeertAgenda(
  soort: string | null | undefined
): boolean {
  const s = normalizeAfspraakSoort(soort);
  return s === "nieuw" || s === "vervolg_fysiek";
}

export function afspraakStuurtMail(soort: string | null | undefined): boolean {
  return normalizeAfspraakSoort(soort) === "nieuw";
}

/** Interne soorten: geen klantmail, geen leadstatus-wijziging naar afspraak. */
export function isInterneAfspraakSoort(
  soort: string | null | undefined
): boolean {
  const s = normalizeAfspraakSoort(soort);
  return s === "bel" || s === "warme_bel" || s === "vervolg_punt";
}

/** Terugbel / warme terugbel (bellijst-prioriteit). */
export function isTerugbelSoort(soort: string | null | undefined): boolean {
  const s = normalizeAfspraakSoort(soort);
  return s === "bel" || s === "warme_bel";
}

export function afspraakDuurMinuten(soort: string | null | undefined): number {
  return afspraakBlokkeertAgenda(soort) ? AFSPRAAK_DUUR_MINUTEN : 30;
}

export function leadStatusVoorAfspraakSoort(
  soort: string | null | undefined
): LeadStatus {
  const s = normalizeAfspraakSoort(soort);
  if (s === "vervolg_fysiek") return "vervolg_fysiek";
  if (s === "vervolg_tel") return "vervolg_tel";
  return "afspraak";
}

export function isNaAfspraakStatus(status: string | null | undefined): boolean {
  return status === "na_afspraak";
}

export function afspraakIsAfgelopen(
  afspraak: Pick<Afspraak, "status" | "end_at" | "start_at">,
  now = new Date()
): boolean {
  if (afspraak.status === "voltooid") return true;
  if (afspraak.status === "geannuleerd") return false;
  if (!ACTIEF.has(afspraak.status)) return false;
  const end = new Date(afspraak.end_at || afspraak.start_at).getTime();
  return end < now.getTime();
}

/** Lead heeft (ooit) een fysieke afspraak gehad (niet-geannuleerd). */
export function leadHadFysiekeAfspraak(
  afspraken: Afspraak[],
  leadId: string
): boolean {
  return afspraken.some(
    (a) =>
      a.lead_id === leadId &&
      afspraakBlokkeertAgenda(a.soort) &&
      a.status !== "geannuleerd"
  );
}

/**
 * Mag deze afspraak in de agenda-week? Koude terugbels (vóór huisbezoek)
 * horen alleen in Bellen, niet in de agenda.
 */
export function afspraakZichtbaarInAgenda(
  afspraak: Afspraak,
  allAfspraken: Afspraak[]
): boolean {
  const s = normalizeAfspraakSoort(afspraak.soort);
  if (s === "bel" || s === "warme_bel") {
    return leadHadFysiekeAfspraak(allAfspraken, afspraak.lead_id);
  }
  return true;
}

/** Openstaand vervolg (punt / tel / fysiek / terugbel) voor deze lead. */
export function hasOpenVervolgVoorLead(
  afspraken: Afspraak[],
  leadId: string,
  afterStartAt: string
): boolean {
  const after = new Date(afterStartAt).getTime();
  return afspraken.some((a) => {
    if (a.lead_id !== leadId) return false;
    if (!ACTIEF.has(a.status)) return false;
    const s = normalizeAfspraakSoort(a.soort);
    if (
      s !== "vervolg_punt" &&
      s !== "bel" &&
      s !== "warme_bel" &&
      s !== "vervolg_tel" &&
      s !== "vervolg_fysiek"
    ) {
      return false;
    }
    return new Date(a.start_at).getTime() >= after;
  });
}

/**
 * Afgelopen fysieke afspraak zonder vervolg → “I” / actie nodig,
 * tenzij lead is afgeboekt (geen interesse / geen contact / …).
 */
export function needsVervolgPunt(
  afspraak: Afspraak,
  allAfspraken: Afspraak[],
  now = new Date()
): boolean {
  if (!afspraakBlokkeertAgenda(afspraak.soort)) return false;
  if (afspraak.status === "geannuleerd") return false;
  if (!afspraakIsAfgelopen(afspraak, now)) return false;
  const leadStatus = afspraak.leads?.status;
  if (leadStatus && VERVOLG_PUNT_VRIJGESTELD.has(leadStatus)) return false;
  if (hasOpenVervolgVoorLead(allAfspraken, afspraak.lead_id, afspraak.start_at)) {
    return false;
  }
  return true;
}
