import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel } from "@/lib/format";
import { buildIcsCalendar } from "@/lib/ics";
import { afspraakDuurMinuten, afspraakSoortLabel } from "@/lib/afspraak-soort";
import { appBaseUrl } from "@/lib/email/postmark";
import { trackAgendaAdd } from "@/lib/afspraak-opvolging/agenda-track";

export const runtime = "nodejs";

type LeadRow = {
  naam?: string | null;
  telefoon?: string | null;
  email?: string | null;
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
};

type AdviseurRow = {
  naam?: string | null;
};

function asOne<T>(raw: unknown): T | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return (raw[0] as T) ?? null;
  return raw as T;
}

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

/**
 * GET /api/afspraken/[token]/calendar
 * Publiek .ics-bestand zodat de klant de afspraak in de eigen agenda zet
 * (Apple Calendar, Google Calendar, Outlook, …).
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: afspraak, error } = await sb
      .from("afspraken")
      .select(
        "id, start_at, end_at, soort, status, manage_token, leads(naam, telefoon, email, straat, huisnummer, toevoeging, postcode, plaats), adviseurs!adviseur_id(naam)"
      )
      .eq("manage_token", token)
      .single();

    if (error || !afspraak) {
      return new NextResponse("Afspraak niet gevonden", { status: 404 });
    }

    if (
      afspraak.status === "geannuleerd" ||
      afspraak.status === "voltooid"
    ) {
      return new NextResponse("Afspraak is niet meer actief", { status: 410 });
    }

    const start = new Date(afspraak.start_at);
    if (Number.isNaN(start.getTime())) {
      return new NextResponse("Ongeldige afspraakdatum", { status: 400 });
    }

    const lead = asOne<LeadRow>(afspraak.leads);
    const adviseur = asOne<AdviseurRow>(afspraak.adviseurs);
    const duur = afspraakDuurMinuten(afspraak.soort);
    const end = afspraak.end_at
      ? new Date(afspraak.end_at)
      : addMinutes(start, duur);
    const endSafe = Number.isNaN(end.getTime())
      ? addMinutes(start, duur)
      : end;

    const soortLabel =
      afspraakSoortLabel[
        afspraak.soort as keyof typeof afspraakSoortLabel
      ] ?? "Afspraak";
    const adviseurNaam = adviseur?.naam?.trim() || "Batterijconcept";
    const adres = lead ? adresRegel(lead) : "";
    const manageUrl = `${appBaseUrl()}/afspraak/${afspraak.manage_token}`;

    const description = [
      `Kosteloos adviesgesprek met ${adviseurNaam}.`,
      "Duur: ongeveer 90 minuten.",
      "Handig: jaarafrekening (en eventueel zonnepaneelgegevens) bij de hand.",
      "Alle hoofdbewoners van de woning aanwezig voor de regelingstoets.",
      "",
      `Afspraak beheren: ${manageUrl}`,
      "Vragen? 085 800 1645 · info@batterijconcept.nl",
    ].join("\n");

    const ics = buildIcsCalendar({
      name: "Batterijconcept afspraak",
      events: [
        {
          uid: `afspraak-${afspraak.id}@batterijconcept.nl`,
          summary: `${soortLabel} · Batterijconcept`,
          description,
          location: adres || undefined,
          start,
          end: endSafe,
        },
      ],
    });

    const filename = `batterijconcept-afspraak-${afspraak.id.slice(0, 8)}.ics`;

    // First-touch: ICS-download telt als agenda-add (server-side, betrouwbaarder dan client-click)
    try {
      await trackAgendaAdd(sb, afspraak.id, "ics");
    } catch {
      /* tracking mag ICS-response niet blokkeren */
    }

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache, max-age=0",
      },
    });
  } catch (e) {
    return new NextResponse(errMessage(e, "Fout"), { status: 500 });
  }
}
