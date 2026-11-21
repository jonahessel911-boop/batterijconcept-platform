import { formatIcsUtc } from "@/lib/ics";

export type CalendarEventInput = {
  title: string;
  description: string;
  location?: string;
  start: Date;
  end: Date;
};

/** Google Calendar (web) — geen download. */
export function googleCalendarUrl(ev: CalendarEventInput): string {
  const dates = `${formatIcsUtc(ev.start)}/${formatIcsUtc(ev.end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates,
    details: ev.description,
  });
  if (ev.location) params.set("location", ev.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook.com (web) — geen download. */
export function outlookLiveCalendarUrl(ev: CalendarEventInput): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: ev.title,
    body: ev.description,
    startdt: ev.start.toISOString(),
    enddt: ev.end.toISOString(),
  });
  if (ev.location) params.set("location", ev.location);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}

/** Microsoft 365 / Outlook werk (web) — geen download. */
export function outlookOfficeCalendarUrl(ev: CalendarEventInput): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: ev.title,
    body: ev.description,
    startdt: ev.start.toISOString(),
    enddt: ev.end.toISOString(),
  });
  if (ev.location) params.set("location", ev.location);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}
