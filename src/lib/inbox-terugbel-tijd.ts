/**
 * Haal voorgesteld belmoment uit INFO-mailtekst (NL).
 * Voorbeeld: "vrij. 6 nov rond 12.30", "morgen na 17:00", "di 14u".
 */

import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";

const MAAND: Record<string, number> = {
  jan: 0,
  januari: 0,
  feb: 1,
  februari: 1,
  mrt: 2,
  maart: 2,
  apr: 3,
  april: 3,
  mei: 4,
  jun: 5,
  juni: 5,
  jul: 6,
  juli: 6,
  aug: 7,
  augustus: 7,
  sep: 8,
  sept: 8,
  september: 8,
  okt: 9,
  oktober: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAG: Record<string, number> = {
  zo: 0,
  zon: 0,
  zondag: 0,
  ma: 1,
  maan: 1,
  maandag: 1,
  di: 2,
  din: 2,
  dinsdag: 2,
  wo: 3,
  woe: 3,
  woensdag: 3,
  do: 4,
  don: 4,
  donderdag: 4,
  vr: 5,
  vrij: 5,
  vrijdag: 5,
  za: 6,
  zat: 6,
  zaterdag: 6,
};

export type InboxTerugbelVoorstel = {
  /** Amsterdam-lokaal voor datetime-local / planAfspraak */
  startLocal: string;
  startIso: string;
  label: string;
  confidence: number;
  source: "heuristic";
};

function mailBodyFocus(text: string): string {
  return text.split(
    /Oorspronkelijk bericht|het volgende geschreven:|-----Original Message-----|Verzonden vanaf mijn|Op .+ schreef/i
  )[0];
}

function wallParts(ref: Date): {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  dow: number;
} {
  const y = Number(formatInTimeZone(ref, AMSTERDAM_TZ, "yyyy"));
  const mo = Number(formatInTimeZone(ref, AMSTERDAM_TZ, "MM")) - 1;
  const d = Number(formatInTimeZone(ref, AMSTERDAM_TZ, "dd"));
  const h = Number(formatInTimeZone(ref, AMSTERDAM_TZ, "HH"));
  const mi = Number(formatInTimeZone(ref, AMSTERDAM_TZ, "mm"));
  const dow = toZonedTime(ref, AMSTERDAM_TZ).getDay(); // 0=zo .. 6=za
  return { y, mo, d, h, mi, dow };
}

function instantFromWall(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number
): Date {
  return fromZonedTime(new Date(y, mo, d, h, mi, 0, 0), AMSTERDAM_TZ);
}

function addDaysWall(
  y: number,
  mo: number,
  d: number,
  add: number
): { y: number; mo: number; d: number } {
  const base = new Date(Date.UTC(y, mo, d + add));
  return {
    y: base.getUTCFullYear(),
    mo: base.getUTCMonth(),
    d: base.getUTCDate(),
  };
}

function normalizeWeekdayToken(raw: string): number | null {
  const key = raw.toLowerCase().replace(/\.$/, "");
  return (
    WEEKDAG[key] ??
    WEEKDAG[key.slice(0, 4)] ??
    WEEKDAG[key.slice(0, 3)] ??
    WEEKDAG[key.slice(0, 2)] ??
    null
  );
}

/**
 * Detecteer of de mail vraagt om teruggebeld te worden (los van exacte tijd).
 */
export function mailSuggestsTerugbel(input: {
  subject?: string | null;
  bodyText?: string | null;
  aiSummary?: string | null;
}): boolean {
  const t =
    `${input.subject || ""}\n${input.bodyText || ""}\n${input.aiSummary || ""}`.toLowerCase();
  if (
    /geen\s*interesse|niet\s*bellen|stop\s*(met\s*)?bellen|afzeg|annul/.test(t)
  ) {
    return false;
  }
  return (
    /\b(bel\s*(me|ons|maar|terug)|terugbel|terug\s*bellen|kunnen\s+jullie\s+(me\s+)?bellen|kunt\s+u\s+(me\s+)?bellen|wil(t)?\s+(u|je)\s+(me\s+)?bellen|bereikbaar|kun\s+je\s+bellen|belafspraak|bel\s*afspraak|rond\s+\d|u kunt mij bereiken)\b/i.test(
      t
    )
  );
}

/**
 * Parse voorgesteld belmoment. `receivedAt` = anker (mail ontvangen).
 */
export function parseInboxTerugbelVoorstel(input: {
  subject?: string | null;
  bodyText?: string | null;
  receivedAt?: string | Date | null;
}): InboxTerugbelVoorstel | null {
  const focus = mailBodyFocus(
    `${input.subject || ""}\n${input.bodyText || ""}`
  );
  const text = focus.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const refRaw = input.receivedAt ? new Date(input.receivedAt) : new Date();
  const ref = Number.isNaN(refRaw.getTime()) ? new Date() : refRaw;
  const refWall = wallParts(ref);

  type Cand = { instant: Date; confidence: number };
  const cands: Cand[] = [];

  // "vrij. 6 nov rond 12.30" / "6 november om 12:30"
  const reDagDatumTijd =
    /\b(?:(zo(?:n(?:dag)?)?|ma(?:an(?:dag)?)?|di(?:n(?:sdag)?)?|woe?(?:nsdag)?|do(?:n(?:derdag)?)?|vr(?:ij(?:dag)?)?|za(?:t(?:erdag)?)?)\.?\s+)?(\d{1,2})\s+(jan(?:uari)?|feb(?:ruari)?|mrt|maart|apr(?:il)?|mei|jun(?:i)?|jul(?:i)?|aug(?:ustus)?|sep(?:t(?:ember)?)?|okt(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:\s+(\d{4}))?\s*(?:rond|om|tegen|na|vóór|voor)?\s*(\d{1,2})(?:[:.\su]?(\d{2}))?\s*u?\b/gi;

  let m: RegExpExecArray | null;
  while ((m = reDagDatumTijd.exec(text)) !== null) {
    const dayNum = Number(m[2]);
    const maandKey = m[3].toLowerCase().replace(/\.$/, "");
    const month = MAAND[maandKey];
    if (month == null || dayNum < 1 || dayNum > 31) continue;
    let year = m[4] ? Number(m[4]) : refWall.y;
    const h = Number(m[5]);
    const min = m[6] ? Number(m[6]) : 0;
    if (h > 23 || min > 59) continue;
    let instant = instantFromWall(year, month, dayNum, h, min);
    // Datum in verleden t.o.v. mail → volgend jaar
    if (instant.getTime() + 12 * 3600_000 < ref.getTime()) {
      year += 1;
      instant = instantFromWall(year, month, dayNum, h, min);
    }
    cands.push({ instant, confidence: 0.92 });
  }

  // "morgen om 14:00" / "vandaag na 17u"
  const reRel =
    /\b(vandaag|morgen|overmorgen)\b(?:[^.!?]{0,40}?)(?:rond|om|tegen|na|vóór|voor)?\s*(\d{1,2})(?:[:.\su]?(\d{2}))?\s*u?\b/gi;
  while ((m = reRel.exec(text)) !== null) {
    const word = m[1].toLowerCase();
    const h = Number(m[2]);
    const min = m[3] ? Number(m[3]) : 0;
    if (h > 23 || min > 59) continue;
    let add = 0;
    if (word === "morgen") add = 1;
    if (word === "overmorgen") add = 2;
    const day = addDaysWall(refWall.y, refWall.mo, refWall.d, add);
    cands.push({
      instant: instantFromWall(day.y, day.mo, day.d, h, min),
      confidence: 0.88,
    });
  }

  // "vrijdag rond 12.30" zonder dagnummer
  const reWeekdag =
    /\b(zo(?:n(?:dag)?)?|ma(?:an(?:dag)?)?|di(?:n(?:sdag)?)?|woe?(?:nsdag)?|do(?:n(?:derdag)?)?|vr(?:ij(?:dag)?)?|za(?:t(?:erdag)?)?)\.?\s+(?:rond|om|tegen|na|vóór|voor)?\s*(\d{1,2})(?:[:.\su]?(\d{2}))?\s*u?\b/gi;
  while ((m = reWeekdag.exec(text)) !== null) {
    // Skip if this was already part of "vrij 6 nov …" (has digit after weekday before time handled above)
    const before = text.slice(Math.max(0, (m.index || 0) - 1), m.index || 0);
    if (/\d/.test(before)) continue;
    const dow = normalizeWeekdayToken(m[1]);
    if (dow == null) continue;
    const h = Number(m[2]);
    const min = m[3] ? Number(m[3]) : 0;
    if (h > 23 || min > 59) continue;
    let add = (dow - refWall.dow + 7) % 7;
    let day = addDaysWall(refWall.y, refWall.mo, refWall.d, add);
    let instant = instantFromWall(day.y, day.mo, day.d, h, min);
    if (instant.getTime() <= ref.getTime() + 5 * 60_000) {
      day = addDaysWall(day.y, day.mo, day.d, 7);
      instant = instantFromWall(day.y, day.mo, day.d, h, min);
    }
    cands.push({ instant, confidence: 0.78 });
  }

  // Alleen tijd: "bel me om 15u"
  if (cands.length === 0) {
    const reOnlyTime =
      /\b(?:bel|bereikbaar|terugbel|rond|om|na)\b[^.!?]{0,35}?\b(\d{1,2})(?:[:.\su](\d{2}))?\s*u?\b/i;
    const tm = text.match(reOnlyTime);
    if (tm) {
      const h = Number(tm[1]);
      const min = tm[2] ? Number(tm[2]) : 0;
      if (h <= 23 && min <= 59) {
        let day = { y: refWall.y, mo: refWall.mo, d: refWall.d };
        let instant = instantFromWall(day.y, day.mo, day.d, h, min);
        if (instant.getTime() <= ref.getTime() + 5 * 60_000) {
          day = addDaysWall(day.y, day.mo, day.d, 1);
          instant = instantFromWall(day.y, day.mo, day.d, h, min);
        }
        cands.push({ instant, confidence: 0.55 });
      }
    }
  }

  if (!cands.length) return null;
  cands.sort((a, b) => b.confidence - a.confidence);
  const best = cands[0];
  const startLocal = formatInTimeZone(
    best.instant,
    AMSTERDAM_TZ,
    "yyyy-MM-dd'T'HH:mm"
  );
  const label = formatInTimeZone(
    best.instant,
    AMSTERDAM_TZ,
    "EEEE d MMMM 'om' HH:mm",
    { locale: nl }
  );
  return {
    startLocal,
    startIso: best.instant.toISOString(),
    label,
    confidence: best.confidence,
    source: "heuristic",
  };
}
