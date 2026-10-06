import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { parseInkoopRegelStatus } from "@/lib/project-inkoop-checklist";
import { toOperationalStatus } from "@/lib/project-status-config";
import type { Project } from "@/types/database";

/** Batterij/materiaal uiterlijk zoveel werkdagen (ma–vr) vóór installatie besteld. */
export const INKOOP_DAGEN_VOOR_INSTALLATIE = 3;

const KLAAR_ZONDER_INKOOP = new Set([
  "installatie_voltooid",
  "review_gevraagd",
  "service",
  "annulering",
]);

/** ISO weekday in Amsterdam: 1 = ma … 7 = zo. */
function amsterdamWeekday(at: Date): number {
  return Number(formatInTimeZone(at, AMSTERDAM_TZ, "i"));
}

function isAmsterdamWeekend(at: Date): boolean {
  const d = amsterdamWeekday(at);
  return d === 6 || d === 7;
}

/** Trek N werkdagen terug in Europe/Amsterdam (za/zo tellen niet). */
export function subtractWeekdaysAmsterdam(at: Date, days: number): Date {
  let iso = at;
  let left = Math.max(0, days);
  while (left > 0) {
    const local = toZonedTime(iso, AMSTERDAM_TZ);
    iso = fromZonedTime(addDays(local, -1), AMSTERDAM_TZ);
    if (!isAmsterdamWeekend(iso)) left -= 1;
  }
  return iso;
}

/** 17:00 Amsterdam, 3 werkdagen vóór de installatie (levering alleen ma–vr). */
export function bestelDeadlineVoorInstallatie(
  installatieAt: Date | string
): Date {
  const at =
    typeof installatieAt === "string" ? new Date(installatieAt) : installatieAt;
  const dueDay = subtractWeekdaysAmsterdam(
    at,
    INKOOP_DAGEN_VOOR_INSTALLATIE
  );
  const local = toZonedTime(dueDay, AMSTERDAM_TZ);
  local.setHours(17, 0, 0, 0);
  return fromZonedTime(local, AMSTERDAM_TZ);
}

/**
 * Nog open inkoop: checklist heeft “te kopen”, of er is niks afgevinkt
 * terwijl de order nog niet op “materiaal besteld” staat.
 */
export function materiaalNogTeBestellen(project: Project): boolean {
  const op = toOperationalStatus(project.status);
  if (KLAAR_ZONDER_INKOOP.has(op)) return false;

  const checks = project.materiaal_checks || {};
  const values = Object.values(checks);
  if (values.length > 0) {
    return values.some((v) => parseInkoopRegelStatus(v) === "te_kopen");
  }

  return op !== "materiaal_besteld";
}