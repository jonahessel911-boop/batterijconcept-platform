import { formatInTimeZone } from "date-fns-tz";
import type { Afspraak, Lead, LeadStatus } from "@/types/database";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  isTerugbelSoort,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";
import {
  NL_PROVINCIES,
  normalizeProvincieLabel,
  provincieVanPostcode,
  type NlProvincie,
} from "@/lib/postcode-provincie";

export const MAX_BELPOGINGEN = 5;
export const MAX_BELPOGINGEN_PER_DAG = 1;
/** Minimale pauze tussen twee belpogingen op dezelfde dag (uren, Amsterdam). */
export const MIN_UREN_TUSSEN_BELPOGINGEN = 3;

const QUEUE_STATUSES: LeadStatus[] = [
  "nieuw",
  "geen_contact",
  "vervolg_geen_contact",
  /** Herplannen: appointment setter (beller), niet backoffice-Acties */
  "afspraak_afgezegd_klant",
  "deur_niet_open",
];

const ACTIEVE_AFSPRAAK = new Set(["gepland", "bevestigd", "verzet"]);

/** Leadstatussen die herplannen nodig hebben → voorrang in de bellijst. */
export const HERPLAN_BEL_STATUSES = new Set<LeadStatus>([
  "afspraak_afgezegd_klant",
  "deur_niet_open",
]);

const BEL_BLOKKEER_STATUS = new Set<LeadStatus>([
  "deal",
  "sale_financiering",
  "sale_eigen_middelen",
  "geen_interesse",
  "geen_interesse_al_batterij",
  "geen_interesse_plugin",
  "geen_interesse_alleen_info",
  "offerte_afgewezen",
  "niet_gekwalificeerd",
  "huurwoning",
  "foutief_nummer",
  "gegevens_niet_overeen",
]);

/** Sollicitaties horen in Instroom, niet in de bel-queue. */
export function isSollicitatieLead(lead: Pick<Lead, "naam" | "bron">): boolean {
  const naam = (lead.naam || "").toLowerCase();
  if (naam.includes("sollicitant")) return true;
  const bron = (lead.bron || "").toLowerCase();
  if (
    bron.includes("sollicit") ||
    bron.includes("werkenbij") ||
    bron.includes("vacature")
  ) {
    return true;
  }
  return false;
}

export function belpogingenOf(lead: Pick<Lead, "belpogingen">): number {
  return Math.max(0, Number(lead.belpogingen) || 0);
}

export function amsterdamDayKey(d: Date | string): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Belpogingen op de huidige Amsterdam-kalenderdag. */
export function belpogingenVandaagOf(
  lead: Pick<Lead, "laatst_gebeld_at" | "belpogingen_vandaag">
): number {
  if (!lead.laatst_gebeld_at) return 0;
  if (amsterdamDayKey(lead.laatst_gebeld_at) !== amsterdamDayKey(new Date())) {
    return 0;
  }
  const n = Number(lead.belpogingen_vandaag);
  if (Number.isFinite(n) && n > 0) return n;
  return 1;
}

export function geenContactPogingLabel(pogingen: number): string {
  const n = Math.min(Math.max(pogingen, 0), MAX_BELPOGINGEN);
  return `Geen contact ${n}/${MAX_BELPOGINGEN}`;
}

/**
 * Patch + mailvlag bij status «geen contact» (BelPanel én Leads-tab).
 * Elke keer dat je op geen contact zet = +1 belpoging; mail bij poging 1 en 3.
 */
export function buildGeenContactOutcomePatch(
  lead: Pick<Lead, "belpogingen" | "belpogingen_vandaag" | "laatst_gebeld_at">
): {
  patch: {
    status: "geen_contact";
    belpogingen: number;
    belpogingen_vandaag: number;
    terugbellen: false;
    terugbel_notitie: null;
  };
  pogingen: number;
  sendGeenContactMail: boolean;
} {
  const pogingen = Math.min(belpogingenOf(lead) + 1, MAX_BELPOGINGEN);
  const vandaag = Math.min(
    belpogingenVandaagOf(lead) + 1,
    MAX_BELPOGINGEN_PER_DAG
  );
  return {
    patch: {
      status: "geen_contact",
      belpogingen: pogingen,
      belpogingen_vandaag: vandaag,
      terugbellen: false,
      terugbel_notitie: null,
    },
    pogingen,
    sendGeenContactMail: pogingen === 1 || pogingen === 3,
  };
}

/** Actieve terugbel-afspraak (bel / warme_bel) voor deze lead. */
export function activeBelAfspraak(
  afspraken: Afspraak[],
  leadId: string
): Afspraak | null {
  const list = afspraken
    .filter(
      (a) =>
        a.lead_id === leadId &&
        ACTIEVE_AFSPRAAK.has(a.status) &&
        isTerugbelSoort(a.soort)
    )
    .sort((a, b) => {
      // Warme terugbel eerst
      const aWarm = normalizeAfspraakSoort(a.soort) === "warme_bel" ? 1 : 0;
      const bWarm = normalizeAfspraakSoort(b.soort) === "warme_bel" ? 1 : 0;
      if (aWarm !== bWarm) return bWarm - aWarm;
      return (
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      );
    });
  return list[0] || null;
}

/**
 * Terugbel-afspraak die als chip bovenaan Bellen hoort (niet in de belwachtrij):
 * vanaf de Amsterdam-dag van het geplande moment tot afgevinkt/afgehandeld.
 */
export function isTerugbelDue(
  afspraak: Afspraak,
  now = new Date()
): boolean {
  if (!ACTIEVE_AFSPRAAK.has(afspraak.status)) return false;
  if (!isTerugbelSoort(afspraak.soort)) return false;
  return amsterdamDayKey(afspraak.start_at) <= amsterdamDayKey(now);
}

/** @deprecated alias — gebruik isTerugbelDue */
export function isTerugbelDueToday(
  afspraak: Afspraak,
  now = new Date()
): boolean {
  return isTerugbelDue(afspraak, now);
}

/** Nog te kort geleden gebeld voor een 2e poging vandaag. */
export function inBelCooldown(
  lead: Pick<Lead, "laatst_gebeld_at">,
  now = new Date()
): boolean {
  if (!lead.laatst_gebeld_at) return false;
  const last = new Date(lead.laatst_gebeld_at).getTime();
  if (Number.isNaN(last)) return false;
  const minMs = MIN_UREN_TUSSEN_BELPOGINGEN * 60 * 60 * 1000;
  return now.getTime() - last < minMs;
}

/**
 * Lead had een *nieuwe* fysieke afspraak die geannuleerd is en heeft
 * geen actieve toekomstige afspraak meer → uit de bellijst (herplannen via agenda).
 */
export function cancelledAppointmentLeadIds(
  afspraken: Afspraak[],
  now = new Date()
): Set<string> {
  const nowMs = now.getTime();
  const byLead = new Map<string, Afspraak[]>();
  for (const a of afspraken) {
    const list = byLead.get(a.lead_id) || [];
    list.push(a);
    byLead.set(a.lead_id, list);
  }

  const out = new Set<string>();
  for (const [leadId, list] of byLead) {
    const hasActiveFuture = list.some(
      (a) =>
        ACTIEVE_AFSPRAAK.has(a.status) &&
        new Date(a.start_at).getTime() >= nowMs
    );
    if (hasActiveFuture) continue;

    const hadCancelledNieuw = list.some(
      (a) =>
        a.status === "geannuleerd" &&
        normalizeAfspraakSoort(a.soort) === "nieuw"
    );
    if (hadCancelledNieuw) out.add(leadId);
  }
  return out;
}

/** Meest recente geannuleerde *nieuwe* afspraak van de lead. */
export function latestCancelledVisitAfspraak(
  afspraken: Afspraak[],
  leadId: string
): Afspraak | null {
  const list = afspraken
    .filter(
      (a) =>
        a.lead_id === leadId &&
        a.status === "geannuleerd" &&
        normalizeAfspraakSoort(a.soort) === "nieuw"
    )
    .sort(
      (a, b) =>
        new Date(b.updated_at || b.start_at).getTime() -
        new Date(a.updated_at || a.start_at).getTime()
    );
  return list[0] || null;
}

const ANNULERING_NOTE_RE =
  /Annulering\s*\(([^)]*)\)(?:\s*door\s+([^:]+))?:\s*([\s\S]+)$/i;

/** Haalt de annuleringsreden uit afspraak-notities, indien aanwezig. */
export function annuleringsNotitieFromAfspraak(
  afspraak: Pick<Afspraak, "notities"> | null | undefined
): string | null {
  const raw = afspraak?.notities?.trim();
  if (!raw) return null;
  const match = raw.match(ANNULERING_NOTE_RE);
  if (match?.[3]?.trim()) return match[3].trim();
  // Legacy zonder "door …"
  const legacy = raw.match(/Annulering\s*\([^)]*\):\s*([\s\S]+)$/i);
  if (legacy?.[1]?.trim()) return legacy[1].trim();
  if (/annulering/i.test(raw)) return raw;
  return null;
}

/** Wie de CRM-annulering deed, uit notitie `Annulering (CRM) door Naam: …`. */
export function annuleringsDoorFromAfspraak(
  afspraak: Pick<Afspraak, "notities"> | null | undefined
): string | null {
  const raw = afspraak?.notities?.trim();
  if (!raw) return null;
  const match = raw.match(ANNULERING_NOTE_RE);
  const door = match?.[2]?.trim();
  return door || null;
}

/** True als de notitie een klant-annulering is (`Annulering (klant): …`). */
export function isKlantAnnuleringAfspraak(
  afspraak: Pick<Afspraak, "notities" | "status"> | null | undefined
): boolean {
  if (!afspraak || afspraak.status !== "geannuleerd") return false;
  const raw = afspraak.notities?.trim() || "";
  if (!raw) return false;
  const match = raw.match(ANNULERING_NOTE_RE);
  const bron = (match?.[1] || "").trim().toLowerCase();
  if (bron === "klant") return true;
  // Legacy / token-route zonder exacte bron-tag
  return /annulering\s*\(\s*klant\s*\)/i.test(raw);
}

/**
 * Lead hoort in de Annuleringen-bak van deze beller:
 * status afspraak_afgezegd_klant, meest recente geannuleerde nieuw-bezoek
 * was door de klant én door deze beller ingepland (`ingepland_door_id`).
 */
export function inAnnuleringQueueForBeller(
  lead: Lead,
  afspraken: Afspraak[],
  bellerId: string,
  appointmentLeadIds?: Set<string>
): boolean {
  if (!bellerId) return false;
  if (isSollicitatieLead(lead)) return false;
  if (!lead.telefoon?.trim()) return false;
  if (lead.status !== "afspraak_afgezegd_klant") return false;
  if (BEL_BLOKKEER_STATUS.has(lead.status)) return false;
  if (appointmentLeadIds?.has(lead.id)) return false;

  const cancelled = latestCancelledVisitAfspraak(afspraken, lead.id);
  if (!cancelled) return false;
  if (!isKlantAnnuleringAfspraak(cancelled)) return false;
  const door = (cancelled.ingepland_door_id || "").trim();
  if (door !== bellerId) return false;
  return true;
}

/** Normale/provincie-bak: herplan-statussen eruit (die gaan via Annuleringen). */
export function inNormaleBelQueue(
  lead: Lead,
  appointmentLeadIds?: Set<string>
): boolean {
  if (isHerplanBelLead(lead)) return false;
  return inBelQueue(lead, appointmentLeadIds);
}

export function inBelQueue(
  lead: Lead,
  appointmentLeadIds?: Set<string>,
  /**
   * @deprecated Genegeerd. Herplan-statussen (`afspraak_afgezegd_klant` /
   * `deur_niet_open`) zitten in de bellijst (appointment setter), niet meer
   * als backoffice-Actie.
   */
  _cancelledAppointmentLeadIds?: Set<string>
): boolean {
  if (isSollicitatieLead(lead)) return false;
  if (!lead.telefoon?.trim()) return false;
  if (BEL_BLOKKEER_STATUS.has(lead.status)) return false;
  if (appointmentLeadIds?.has(lead.id)) return false;

  if (!QUEUE_STATUSES.includes(lead.status)) return false;
  if (lead.status === "na_afspraak") return false;
  if (lead.status === "afspraak") return false;
  if (lead.status === "vervolg_fysiek" || lead.status === "vervolg_tel") {
    return false;
  }
  if (belpogingenOf(lead) >= MAX_BELPOGINGEN) return false;
  if (belpogingenVandaagOf(lead) >= MAX_BELPOGINGEN_PER_DAG) return false;
  if (inBelCooldown(lead)) return false;
  return true;
}

export function isHerplanBelLead(lead: Pick<Lead, "status">): boolean {
  return HERPLAN_BEL_STATUSES.has(lead.status as LeadStatus);
}

export function sortBelQueue(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => {
    // Herplannen eerst — beller moet die opnieuw inplannen
    const aHerplan = isHerplanBelLead(a) ? 1 : 0;
    const bHerplan = isHerplanBelLead(b) ? 1 : 0;
    if (aHerplan !== bHerplan) return bHerplan - aHerplan;

    const aToday = belpogingenVandaagOf(a);
    const bToday = belpogingenVandaagOf(b);
    if (aToday !== bToday) return aToday - bToday;

    const aUncalled = a.laatst_gebeld_at ? 0 : 1;
    const bUncalled = b.laatst_gebeld_at ? 0 : 1;
    if (aUncalled !== bUncalled) return bUncalled - aUncalled;

    if (!a.laatst_gebeld_at && !b.laatst_gebeld_at) {
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    const aCalled = new Date(a.laatst_gebeld_at || 0).getTime();
    const bCalled = new Date(b.laatst_gebeld_at || 0).getTime();
    if (aCalled !== bCalled) return aCalled - bCalled;

    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

export function isNlProvincie(v: unknown): v is NlProvincie {
  return (
    typeof v === "string" &&
    (NL_PROVINCIES as readonly string[]).includes(v)
  );
}

/** Postcode uit leadvelden (postcode, anders uit plaats/straat). */
export function leadPostcodeDigits(
  lead: Pick<Lead, "postcode" | "plaats" | "straat">
): string | null {
  const direct = (lead.postcode || "").trim();
  if (direct) {
    const m = direct.replace(/\s+/g, "").match(/^(\d{4})/);
    if (m) return m[1];
  }
  for (const raw of [lead.plaats, lead.straat]) {
    const t = (raw || "").trim();
    if (!t) continue;
    const m = t.match(/\b(\d{4})\s*[A-Za-z]{0,2}\b/);
    if (m) return m[1];
  }
  return null;
}

/** Lead hoort bij de gekozen provincie-belbak (via postcode). */
export function leadInProvincie(
  lead: Pick<Lead, "postcode" | "plaats" | "straat">,
  provincie: string | null | undefined
): boolean {
  // Geen filter → alles mag
  if (!provincie) return true;
  // Ongeldige provincie → niets matchen (nooit per ongeluk heel NL)
  if (!isNlProvincie(provincie)) return false;
  const pc = leadPostcodeDigits(lead);
  if (!pc) return false;
  return normalizeProvincieLabel(provincieVanPostcode(pc)) === provincie;
}

export function telHref(telefoon: string): string {
  const compact = telefoon.replace(/[^\d+]/g, "");
  return `tel:${compact}`;
}
