"use client";

import {
  googleCalendarUrl,
  outlookLiveCalendarUrl,
  outlookOfficeCalendarUrl,
  type CalendarEventInput,
} from "@/lib/add-to-calendar";
import { formatDateTimeLongNl } from "@/lib/format";
import type { AgendaProvider } from "@/lib/afspraak-opvolging/agenda-track";

export function AddToCalendarPanel({
  event,
  icsHref,
  onTrack,
}: {
  event: CalendarEventInput;
  /** Optioneel: Apple / andere agenda’s via .ics */
  icsHref?: string;
  /** Fire-and-forget vóór navigatie / download */
  onTrack?: (provider: AgendaProvider) => void;
}) {
  const google = googleCalendarUrl(event);
  const outlook = outlookLiveCalendarUrl(event);
  const office = outlookOfficeCalendarUrl(event);

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-[#d9d2c8] bg-white p-5 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#0D5C32]">
          Zet in je agenda
        </p>
        <h1 className="mt-1 text-xl font-bold tracking-tight text-[#1e3a2f]">
          {event.title}
        </h1>
        <p className="mt-2 text-sm text-[#3a4a44]">
          {formatDateTimeLongNl(event.start)}
          {event.location ? (
            <>
              <br />
              {event.location}
            </>
          ) : null}
        </p>
        <p className="mt-3 text-sm text-[#6b7570]">
          Kies je agenda — je wordt doorgestuurd, zonder bestand te downloaden.
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          <a
            href={google}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onTrack?.("google")}
            className="rounded-xl bg-[#0D5C32] px-4 py-3 text-center text-sm font-semibold text-white hover:bg-[#0a4a28]"
          >
            Google Agenda
          </a>
          <a
            href={outlook}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onTrack?.("outlook_live")}
            className="rounded-xl border border-[#d9d2c8] bg-white px-4 py-3 text-center text-sm font-semibold text-[#1e3a2f] hover:bg-[#f7f4ef]"
          >
            Outlook.com
          </a>
          <a
            href={office}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onTrack?.("outlook_office")}
            className="rounded-xl border border-[#d9d2c8] bg-white px-4 py-3 text-center text-sm font-semibold text-[#1e3a2f] hover:bg-[#f7f4ef]"
          >
            Outlook / Microsoft 365
          </a>
          {icsHref ? (
            <a
              href={icsHref}
              onClick={() => onTrack?.("ics")}
              className="rounded-xl border border-dashed border-[#d9d2c8] bg-[#f7f4ef] px-4 py-3 text-center text-sm font-medium text-[#3a4a44] hover:border-[#0D5C32]/40"
            >
              Apple Agenda of andere app
            </a>
          ) : null}
        </div>

        {icsHref ? (
          <p className="mt-3 text-[11px] leading-4 text-[#6b7570]">
            Apple Agenda opent via een agenda-bestand in je Agenda-app. Google
            en Outlook gaan via de browser.
          </p>
        ) : null}
      </div>
    </div>
  );
}
