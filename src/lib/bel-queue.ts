import { formatInTimeZone } from "date-fns-tz";
import type { Afspraak, Lead, LeadStatus } from "@/types/database";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  isTerugbelSoort,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";

export const MAX_BELPOGINGEN = 5;
export const MAX_BELPOGINGEN_PER_DAG = 1;
/** Minimale pauze tussen twee belpogingen op dezelfde dag (uren, Amsterdam). */
export const MIN_UREN_TUSSEN_BELPOGINGEN = 3;

const QUEUE_STATUSES: LeadStatus[] = [
  "nieuw",
  "geen_contact",
  "vervolg_geen_contact",
];

const ACTIEVE_AFSPRAAK = new Set(["gepland", "bevestigd", "verzet"]);

const BEL_BLOKKEER_STATUS = new Set<LeadStatus>([
  "deal",
  "sale_financiering",
  "sale_eigen_middelen",
  "geen_interesse",
  "offerte_afgewezen",
  "niet_gekwalificeerd",
  "huurwoning",
  "foutief_nummer",
  "gegevens_niet_overeen",
  "deur_niet_open",
  "afspraak_afgezegd_klant",
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

/** Haalt de annuleringsreden uit afspraak-notities, indien aanwezig. */
export function annuleringsNotitieFromAfspraak(
  afspraak: Pick<Afspraak, "notities"> | null | undefined
): string | null {
  const raw = afspraak?.notities?.trim();
  if (!raw) return null;
  const match = raw.match(/Annulering\s*\([^)]*\):\s*([\s\S]+)$/i);
  if (match?.[1]?.trim()) return match[1].trim();
  if (/annulering/i.test(raw)) return raw;
  return null;
}

export function inBelQueue(
  lead: Lead,
  appointmentLeadIds?: Set<string>,
  /** Leads met geannuleerde afspraak → uit de bellijst */
  cancelledAppointmentLeadIds?: Set<string>
): boolean {
  if (isSollicitatieLead(lead)) return false;
  if (!lead.telefoon?.trim()) return false;
  if (BEL_BLOKKEER_STATUS.has(lead.status)) return false;
  if (appointmentLeadIds?.has(lead.id)) return false;
  // Geannuleerde huisbezoek-afspraak zonder nieuwe afspraak: niet bellen
  if (cancelledAppointmentLeadIds?.has(lead.id)) return false;

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

export function sortBelQueue(leads: Lead[]): Lead[] {
  return [...leads].sort((a, b) => {
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

export function telHref(telefoon: string): string {
  const compact = telefoon.replace(/[^\d+]/g, "");
  return `tel:${compact}`;
}
