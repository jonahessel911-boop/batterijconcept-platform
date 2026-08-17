import { formatInTimeZone } from "date-fns-tz";
import type { Lead, LeadStatus } from "@/types/database";
import { AMSTERDAM_TZ } from "@/lib/format";

export const MAX_BELPOGINGEN = 7;
export const MAX_BELPOGINGEN_PER_DAG = 2;

const QUEUE_STATUSES: LeadStatus[] = ["nieuw", "geen_contact"];

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

export function inBelQueue(
  lead: Lead,
  appointmentLeadIds?: Set<string>
): boolean {
  if (!lead.telefoon?.trim()) return false;
  if (!QUEUE_STATUSES.includes(lead.status)) return false;
  if (lead.status === "afspraak") return false;
  if (appointmentLeadIds?.has(lead.id)) return false;
  if (belpogingenOf(lead) >= MAX_BELPOGINGEN) return false;
  if (belpogingenVandaagOf(lead) >= MAX_BELPOGINGEN_PER_DAG) return false;
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
