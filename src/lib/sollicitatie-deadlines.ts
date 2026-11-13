import type { SollicitatieStatus } from "@/types/database";

/** +1 dag na gesprek: sollicitatie beoordelen. */
export const SOLLICITATIE_TAKEL_BEOORDELEN = "Sollicitatie beoordelen";

/**
 * Binnen 3 dagen na gesprek: uitkomst zetten.
 * Opties: diskwalificatie · training gepland · actief.
 */
export const SOLLICITATIE_TAKEL_BESLISSING =
  "Beslissing: diskwalificatie / training / actief";

/** Eindstatussen die open beoordeling-/beslissingstaken afronden. */
export const SOLLICITATIE_UITKOMST_STATUSSEN: SollicitatieStatus[] = [
  "gesprek_gehad_diskwalificatie",
  "aangenomen_training_gepland",
  "aangenomen_actief",
];

export function isSollicitatieUitkomstStatus(
  status: SollicitatieStatus
): boolean {
  return SOLLICITATIE_UITKOMST_STATUSSEN.includes(status);
}

/** Zet deadline op 17:00 lokale (browser/server) tijd, N dagen na basis. */
export function sollicitatieDeadlineAt(
  daysFromBase: number,
  base: Date | string = new Date()
): Date {
  const d = new Date(base);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    fallback.setDate(fallback.getDate() + daysFromBase);
    fallback.setHours(17, 0, 0, 0);
    return fallback;
  }
  d.setDate(d.getDate() + daysFromBase);
  d.setHours(17, 0, 0, 0);
  return d;
}

export function sollicitatieBeoordelingDueAt(
  gesprekAt: Date | string = new Date()
): string {
  return sollicitatieDeadlineAt(1, gesprekAt).toISOString();
}

export function sollicitatieBeslissingDueAt(
  gesprekAt: Date | string = new Date()
): string {
  return sollicitatieDeadlineAt(3, gesprekAt).toISOString();
}
