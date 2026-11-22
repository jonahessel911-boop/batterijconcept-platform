import type { Metadata } from "next";
import { fromZonedTime } from "date-fns-tz";
import { AddToCalendarPanel } from "@/components/afspraak/AddToCalendarPanel";
import { AMSTERDAM_TZ } from "@/lib/format";
import { AFSPRAAK_DUUR_MINUTEN } from "@/lib/slots";

export const metadata: Metadata = {
  title: "Agenda preview | Batterijconcept",
};

export default function EmailPreviewAgendaPage() {
  const start = fromZonedTime("2026-11-17T14:00:00", AMSTERDAM_TZ);
  const end = new Date(start.getTime() + AFSPRAAK_DUUR_MINUTEN * 60_000);

  return (
    <main className="min-h-screen bg-[#f2ede8] px-4 py-10 text-[#1e3a2f]">
      <div className="mx-auto mb-4 max-w-md text-center">
        <a
          href="/email-preview"
          className="text-sm font-medium text-[#0D5C32] underline-offset-2 hover:underline"
        >
          ← Terug naar mail-preview
        </a>
        <p className="mt-2 text-xs text-[#6b7570]">
          Preview · voorbeelddata
        </p>
      </div>
      <AddToCalendarPanel
        event={{
          title: "Afspraak · Batterijconcept",
          description: [
            "Kosteloos adviesgesprek met Piet Jansen.",
            "Duur: ongeveer 90 minuten.",
            "Handig: jaarafrekening (en eventueel zonnepaneelgegevens) bij de hand.",
            "Alle hoofdbewoners van de woning aanwezig voor de regelingstoets.",
            "",
            "Dit is een preview-test.",
            "Vragen? 085 800 1645 · info@batterijconcept.nl",
          ].join("\n"),
          location: "Voorbeeldstraat 12, 1234 AB Amsterdam",
          start,
          end,
        }}
        icsHref="/api/email-preview/calendar"
      />
    </main>
  );
}
