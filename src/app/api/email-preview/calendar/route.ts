import { NextResponse } from "next/server";
import { fromZonedTime } from "date-fns-tz";
import { buildIcsCalendar } from "@/lib/ics";
import { AMSTERDAM_TZ } from "@/lib/format";
import { AFSPRAAK_DUUR_MINUTEN } from "@/lib/slots";

export const runtime = "nodejs";

/**
 * GET /api/email-preview/calendar
 * Demo .ics voor de mail-preview — zelfde formaat als productie,
 * met vaste voorbeelddata (geen echte afspraak nodig).
 */
export async function GET() {
  const start = fromZonedTime("2026-11-17T14:00:00", AMSTERDAM_TZ);
  const end = new Date(start.getTime() + AFSPRAAK_DUUR_MINUTEN * 60_000);

  const ics = buildIcsCalendar({
    name: "Batterijconcept afspraak (preview)",
    events: [
      {
        uid: "afspraak-preview@batterijconcept.nl",
        summary: "Afspraak · Batterijconcept",
        description: [
          "Kosteloos adviesgesprek met Piet Jansen.",
          "Duur: ongeveer 90 minuten.",
          "Handig: jaarafrekening (en eventueel zonnepaneelgegevens) bij de hand.",
          "Alle hoofdbewoners van de woning aanwezig voor de regelingstoets.",
          "",
          "Dit is een preview-testbestand — geen echte afspraak.",
          "Vragen? 085 800 1645 · info@batterijconcept.nl",
        ].join("\n"),
        location: "Voorbeeldstraat 12, 1234 AB Amsterdam",
        start,
        end,
      },
    ],
  });

  return new NextResponse(ics, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="batterijconcept-afspraak-preview.ics"',
      "Cache-Control": "no-cache, max-age=0",
    },
  });
}
