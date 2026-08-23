import { formatInTimeZone } from "date-fns-tz";
import type { Afspraak, Lead, LeadStatus } from "@/types/database";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";

export const MAX_BELPOGINGEN = 7;
export const MAX_BELPOGINGEN_PER_DAG = 2;
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
  "geen_interesse",
  "offerte_afgewezen",
  "niet_gekwalificeerd",
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

/** Actieve terugbel-afspraak (soort bel) voor deze lead. */
export function activeBelAfspraak(
  afspraken: Afspraak[],
  leadId: string
): Afspraak | null {
  const list = afspraken
    .filter(
      (a) =>
        a.lead_id === leadId &&
        ACTIEVE_AFSPRAAK.has(a.status) &&
        normalizeAfspraakSoort(a.soort) === "bel"
    )
    .sort(
      (a, b) =>
        new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
    );
  return list[0] || null;
}

/** Vanaf 00:01 Amsterdam op de dag van de terugbel-afspraak tot afgehandeld. */
export function isTerugbelDueToday(
  afspraak: Afspraak,
  now = new Date()
): boolean {
  if (!ACTIEVE_AFSPRAAK.has(afspraak.status)) return false;
  if (normalizeAfspraakSoort(afspraak.soort) !== "bel") return false;
  return amsterdamDayKey(afspraak.start_at) === amsterdamDayKey(now);
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
 * Lead had een *nieuwe* (eerste) fysieke afspraak die geannuleerd is en heeft
 * geen actieve toekomstige afspraak meer → opnieuw in de bellijst (prioriteit).
 * Vervolgafspraken / terugbel tellen hier niet mee.
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
  /** Leads met geannuleerde afspraak → juist wél in de bellijst (herplannen) */
  cancelledAppointmentLeadIds?: Set<string>
): boolean {
  if (isSollicitatieLead(lead)) return false;
  if (!lead.telefoon?.trim()) return false;
  if (BEL_BLOKKEER_STATUS.has(lead.status)) return false;
  if (appointmentLeadIds?.has(lead.id)) return false;

  const isCancelledReplan = cancelledAppointmentLeadIds?.has(lead.id) === true;

  if (isCancelledReplan) {
    // Geannuleerde nieuwe afspraak: prioriteit, maar wél daglimiet / cooldown
    // zodat "Volgende" ze niet eindeloos terugbrengt.
    if (belpogingenOf(lead) >= MAX_BELPOGINGEN) return false;
    if (belpogingenVandaagOf(lead) >= MAX_BELPOGINGEN_PER_DAG) return false;
    if (inBelCooldown(lead)) return false;
    return true;
  }

  if (!QUEUE_STATUSES.includes(lead.status)) return false;
  // na_afspraak alleen via annulering (hierboven), niet na voltooid bezoek
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

export function sortBelQueue(
  leads: Lead[],
  cancelledIds?: Set<string>
): Lead[] {
  return [...leads].sort((a, b) => {
    const aCancel = cancelledIds?.has(a.id) ? 1 : 0;
    const bCancel = cancelledIds?.has(b.id) ? 1 : 0;
    if (aCancel !== bCancel) return bCancel - aCancel;

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
