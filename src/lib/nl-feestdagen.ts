import { addDays, format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export type NlFeestdag = {
  key: string;
  naam: string;
};

/** Paaszondag (Gregoriaanse computus). */
function paasZondag(jaar: number): Date {
  const a = jaar % 19;
  const b = Math.floor(jaar / 100);
  const c = jaar % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(jaar, month - 1, day);
}

function dagKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function koningsdag(jaar: number): Date {
  const d = new Date(jaar, 3, 27);
  if (d.getDay() === 0) return new Date(jaar, 3, 26);
  return d;
}

/** Officiële NL-feestdagen relevant voor schouw/installatie. */
export function nederlandseFeestdagen(jaar: number): NlFeestdag[] {
  const pasen = paasZondag(jaar);
  const hemelvaart = addDays(pasen, 39);
  const pinksteren = addDays(pasen, 49);
  const kd = koningsdag(jaar);
  return [
    { key: dagKey(new Date(jaar, 0, 1)), naam: "Nieuwjaarsdag" },
    { key: dagKey(pasen), naam: "Eerste paasdag" },
    { key: dagKey(addDays(pasen, 1)), naam: "Tweede paasdag" },
    { key: dagKey(kd), naam: "Koningsdag" },
    { key: dagKey(hemelvaart), naam: "Hemelvaartsdag" },
    { key: dagKey(pinksteren), naam: "Eerste pinksterdag" },
    { key: dagKey(addDays(pinksteren, 1)), naam: "Tweede pinksterdag" },
    { key: dagKey(new Date(jaar, 11, 25)), naam: "Eerste kerstdag" },
    { key: dagKey(new Date(jaar, 11, 26)), naam: "Tweede kerstdag" },
  ];
}

const FEESTDAG_CACHE = new Map<string, NlFeestdag>();

function cacheVoorJaar(jaar: number) {
  if (FEESTDAG_CACHE.has(`${jaar}-01-01`)) return;
  for (const dag of nederlandseFeestdagen(jaar)) {
    FEESTDAG_CACHE.set(dag.key, dag);
  }
}

export function feestdagOp(dayKey: string | null | undefined): NlFeestdag | null {
  if (!dayKey || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const jaar = Number(dayKey.slice(0, 4));
  if (!Number.isInteger(jaar) || jaar < 2020 || jaar > 2040) return null;
  cacheVoorJaar(jaar);
  return FEESTDAG_CACHE.get(dayKey) || null;
}

export function isNlFeestdag(dayKey: string | null | undefined): boolean {
  return Boolean(feestdagOp(dayKey));
}

export function feestdagVoorMoment(
  at: Date | string | null | undefined
): NlFeestdag | null {
  if (!at) return null;
  const d = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(d.getTime())) return null;
  const key = formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
  return feestdagOp(key);
}

/** Fouttekst als schouw/installatie op een feestdag valt; anders null. */
export function feestdagPlanningFout(
  at: Date | string | null | undefined
): string | null {
  const dag = feestdagVoorMoment(at);
  if (!dag) return null;
  const [y, m, d] = dag.key.split("-");
  const label = format(
    new Date(Number(y), Number(m) - 1, Number(d)),
    "d MMMM yyyy"
  );
  return `${label} is ${dag.naam} — geen schouw of installatie.`;
}
