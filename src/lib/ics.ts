/** Minimal iCalendar (ICS) helpers for Google Calendar / Apple Calendar feeds. */

export type IcsEvent = {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  /** ISO or Date for LAST-MODIFIED / DTSTAMP */
  stamp?: Date;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC timestamp: 20261014T143000Z */
export function formatIcsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  );
}

export function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** Fold long content lines per RFC 5545 (§3.1). */
function foldLine(line: string): string {
  const max = 75;
  if (line.length <= max) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, max));
  rest = rest.slice(max);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, max - 1)}`);
    rest = rest.slice(max - 1);
  }
  return parts.join("\r\n");
}

export function buildIcsCalendar(opts: {
  name: string;
  events: IcsEvent[];
}): string {
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BatterijConcept//Installatieagenda//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsEscape(opts.name)}`,
    "X-WR-TIMEZONE:Europe/Amsterdam",
  ];

  for (const ev of opts.events) {
    const stamp = ev.stamp ?? now;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${icsEscape(ev.uid)}`);
    lines.push(`DTSTAMP:${formatIcsUtc(stamp)}`);
    lines.push(`DTSTART:${formatIcsUtc(ev.start)}`);
    lines.push(`DTEND:${formatIcsUtc(ev.end)}`);
    lines.push(`SUMMARY:${icsEscape(ev.summary)}`);
    if (ev.description) {
      lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
    }
    if (ev.location) {
      lines.push(`LOCATION:${icsEscape(ev.location)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
