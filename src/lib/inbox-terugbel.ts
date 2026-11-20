import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

const WEEKDAY: Record<string, number> = {
  zondag: 0,
  maandag: 1,
  dinsdag: 2,
  woensdag: 3,
  donderdag: 4,
  vrijdag: 5,
  zaterdag: 6,
};

const NEGATIVE =
  /niet\s*(meer\s*)?(bellen|benader)|geen\s*contact|stop\s*(met\s*)?(mail|bellen)|haal\s*me\s*uit|uitschrijv/;

const CALL_INTENT =
  /bel\s*me|bel\s*mij|terugbel|terug\s*te?\s*bellen|terug\s*bellen|kunnen jullie (me\s*)?bellen|even bellen|telefonisch|bel\s*je\s*me|kun je (me\s*)?bellen|neem\s+contact|contact\s+opnemen/;

const AVAIL =
  /bereikbaar|beschikbaar|kan ik (wel\s*)?(opgenomen|opnemen)|tijd\s+voor\s+(een\s+)?gesprek/;

export type InboxTerugbelSuggestie = {
  startAt: string;
  label: string;
  hint: string;
};

function stripQuoted(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .split(
      /\nOn .+ wrote:|\nOp .+ schreef |Oorspronkelijk bericht|-----Original Message-----|From:\s+.+\nSent:/i
    )[0]
    .trim();
}

function localParts(now: Date) {
  const local = toZonedTime(now, AMSTERDAM_TZ);
  return {
    local,
    y: local.getFullYear(),
    m: local.getMonth(),
    d: local.getDate(),
    h: local.getHours(),
    min: local.getMinutes(),
    dow: local.getDay(),
  };
}

function isoAt(
  y: number,
  month0: number,
  day: number,
  hour: number,
  minute: number
): string {
  const stamp = `${y}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  return fromZonedTime(stamp, AMSTERDAM_TZ).toISOString();
}

function addDaysYmd(
  y: number,
  month0: number,
  day: number,
  add: number
): { y: number; m: number; d: number } {
  const dt = new Date(y, month0, day + add);
  return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() };
}

function nextDow(
  now: Date,
  targetDow: number,
  hour: number,
  minute: number,
  allowToday: boolean
): { iso: string; y: number; m: number; d: number } {
  const p = localParts(now);
  let add = (targetDow - p.dow + 7) % 7;
  if (add === 0) {
    if (!allowToday || p.h > hour || (p.h === hour && p.min >= minute)) {
      add = 7;
    }
  }
  const next = addDaysYmd(p.y, p.m, p.d, add);
  return {
    iso: isoAt(next.y, next.m, next.d, hour, minute),
    y: next.y,
    m: next.m,
    d: next.d,
  };
}

function parseClock(text: string): { hour: number; minute: number } | null {
  const m =
    text.match(
      /\b(?:om|rond|na|vanaf|tussen)?\s*(\d{1,2})\s*[:.u]\s*(\d{2})\b/
    ) || text.match(/\b(?:om|rond|na|vanaf)?\s*(\d{1,2})\s*uur\b/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = m[2] != null && m[2] !== "uur" ? Number(m[2]) : 0;
  if (!Number.isFinite(hour) || hour > 21 || hour < 8) return null;
  const min = Number.isFinite(minute) && minute < 60 ? minute : 0;
  return { hour, minute: min };
}

function formatNl(iso: string): string {
  const d = toZonedTime(new Date(iso), AMSTERDAM_TZ);
  return d.toLocaleString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: AMSTERDAM_TZ,
  });
}

export function formatInboxTerugbelLabel(iso: string): string {
  return formatNl(iso);
}

/** datetime-local waarde in Europe/Amsterdam. */
export function isoToDatetimeLocal(iso: string): string {
  const d = toZonedTime(new Date(iso), AMSTERDAM_TZ);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function datetimeLocalToIso(value: string): string | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return isoAt(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5])
  );
}

/** Eerstvolgend belmoment als de mail geen tijdstip noemt. */
export function defaultInboxTerugbelMoment(now = new Date()): InboxTerugbelSuggestie {
  const p = localParts(now);
  let iso: string;
  if (p.dow === 0) {
    const n = addDaysYmd(p.y, p.m, p.d, 1);
    iso = isoAt(n.y, n.m, n.d, 10, 0);
  } else if (p.dow === 6) {
    const n = addDaysYmd(p.y, p.m, p.d, 2);
    iso = isoAt(n.y, n.m, n.d, 10, 0);
  } else if (p.h < 16) {
    iso = isoAt(p.y, p.m, p.d, Math.max(10, p.h + 1), 0);
  } else {
    const add = p.dow === 5 ? 3 : 1;
    const n = addDaysYmd(p.y, p.m, p.d, add);
    iso = isoAt(n.y, n.m, n.d, 10, 0);
  }
  return {
    startAt: iso,
    label: formatNl(iso),
    hint: "terugbellen",
  };
}

/** Altijd een moment: uit de mailtekst, anders eerstvolgende belmoment. */
export function inboxTerugbelMoment(
  input: {
    subject?: string | null;
    bodyText?: string | null;
    aiSummary?: string | null;
  },
  now = new Date()
): InboxTerugbelSuggestie {
  return parseInboxTerugbelSuggestie(input, now) || defaultInboxTerugbelMoment(now);
}

function hasIntent(text: string): boolean {
  const t = text.toLowerCase();
  if (NEGATIVE.test(t) && !AVAIL.test(t) && !/vanmiddag|morgen|maandag/.test(t)) {
    return false;
  }
  if (CALL_INTENT.test(t)) return true;
  if (AVAIL.test(t)) return true;
  return false;
}

/**
 * Detecteer “bel me / ik ben bereikbaar …” en kies een moment (Europe/Amsterdam).
 */
export function parseInboxTerugbelSuggestie(
  input: {
    subject?: string | null;
    bodyText?: string | null;
    aiSummary?: string | null;
  },
  now = new Date()
): InboxTerugbelSuggestie | null {
  const body = stripQuoted(input.bodyText || "");
  const blob = `${input.subject || ""}\n${body}\n${input.aiSummary || ""}`;
  if (!hasIntent(blob)) return null;

  const t = blob.toLowerCase();
  const p = localParts(now);
  const clock = parseClock(t);
  const hour = clock?.hour ?? 14;
  const minute = clock?.minute ?? 0;

  const weekdayHit = Object.keys(WEEKDAY).find((w) =>
    new RegExp(`\\b${w}\\b`).test(t)
  );

  let iso: string;
  let hint: string;

  if (/\bovermorgen\b/.test(t)) {
    const n = addDaysYmd(p.y, p.m, p.d, 2);
    iso = isoAt(n.y, n.m, n.d, clock?.hour ?? 10, minute);
    hint = "overmorgen";
  } else if (/\bmorgen\b/.test(t)) {
    const n = addDaysYmd(p.y, p.m, p.d, 1);
    iso = isoAt(n.y, n.m, n.d, clock?.hour ?? 10, minute);
    hint = "morgen";
  } else if (weekdayHit) {
    const dow = WEEKDAY[weekdayHit];
    const next = nextDow(now, dow, clock?.hour ?? 10, minute, true);
    iso = next.iso;
    hint = weekdayHit;
  } else if (/\bvanavond\b|\bvan\s*avond\b|\bvanacht\b/.test(t)) {
    const h = clock?.hour ?? 18;
    if (p.h >= 20) {
      const n = addDaysYmd(p.y, p.m, p.d, 1);
      iso = isoAt(n.y, n.m, n.d, h, minute);
    } else {
      iso = isoAt(p.y, p.m, p.d, h, minute);
    }
    hint = "vanavond";
  } else if (/\bvanochtend\b|\bochtend\b/.test(t)) {
    const h = clock?.hour ?? 10;
    if (p.h >= 12) {
      const n = addDaysYmd(p.y, p.m, p.d, 1);
      iso = isoAt(n.y, n.m, n.d, h, minute);
    } else {
      iso = isoAt(p.y, p.m, p.d, h, minute);
    }
    hint = "ochtend";
  } else if (/\bvanmiddag\b|\bmiddag\b/.test(t)) {
    const h = clock?.hour ?? 14;
    if (p.h >= 16) {
      const n = addDaysYmd(p.y, p.m, p.d, 1);
      iso = isoAt(n.y, n.m, n.d, h, minute);
    } else {
      iso = isoAt(p.y, p.m, p.d, Math.max(h, p.h + 1), minute);
    }
    hint = "vanmiddag";
  } else if (clock) {
    if (p.h > hour || (p.h === hour && p.min >= minute)) {
      const n = addDaysYmd(p.y, p.m, p.d, 1);
      iso = isoAt(n.y, n.m, n.d, hour, minute);
    } else {
      iso = isoAt(p.y, p.m, p.d, hour, minute);
    }
    hint = `${hour}:${String(minute).padStart(2, "0")}`;
  } else {
    return defaultInboxTerugbelMoment(now);
  }

  return {
    startAt: iso,
    label: formatNl(iso),
    hint,
  };
}

export function mailSuggestsTerugbel(mail: {
  subject?: string | null;
  bodyText?: string | null;
  aiSummary?: string | null;
  aiEffects?: { createTerugbel?: boolean } | null;
}): boolean {
  if (mail.aiEffects?.createTerugbel) return true;
  return parseInboxTerugbelSuggestie(mail) != null;
}
