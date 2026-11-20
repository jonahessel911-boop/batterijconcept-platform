import { dayKeyAmsterdam } from "@/lib/planning-window";

/** Portaal: alleen installaties vanaf deze dag (oudere missen te veel data). */
export const PORTAL_INSTALLATIES_VANAF = "2026-11-16";

const INSTALLATIE_GEDAAN_STATUS = new Set([
  "installatie_voltooid",
  "after_sale",
  "review_gevraagd",
  "afgerond",
  "service",
]);

/** Klaar voor beoordeling: oplevering gedaan, niet alleen ingepland. */
export function isInstallatieGedaan(row: {
  status?: string | null;
  installatie_voltooid_at?: string | null;
}): boolean {
  if (row.installatie_voltooid_at) return true;
  return INSTALLATIE_GEDAAN_STATUS.has(row.status || "");
}

export function isInstallatieVanafCutoff(
  installatieAt?: string | null,
  voltooidAt?: string | null,
  cutoff: string = PORTAL_INSTALLATIES_VANAF
): boolean {
  const iso = installatieAt || voltooidAt || null;
  if (!iso) return false;
  return dayKeyAmsterdam(iso) >= cutoff;
}
