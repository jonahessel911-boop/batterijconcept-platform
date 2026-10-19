import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel } from "@/lib/format";
import { buildIcsCalendar, type IcsEvent } from "@/lib/ics";
import {
  INSTALLATIE_DUUR_MINUTEN,
  SCHOUW_DUUR_MINUTEN,
  SERVICE_DUUR_MINUTEN,
} from "@/lib/planning-duur";

export const runtime = "nodejs";

type LeadAdres = {
  naam?: string | null;
  telefoon?: string | null;
  email?: string | null;
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
  lead_number?: string | null;
};

function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * 60_000);
}

function leadFromRow(raw: unknown): LeadAdres | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return (raw[0] as LeadAdres) ?? null;
  return raw as LeadAdres;
}

/**
 * GET /api/installatie/[token]/calendar
 * Publieke ICS-feed voor Google Calendar / Apple Calendar.
 * Bevat schouw, installatie en service van deze partner.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: partner, error: partnerErr } = await sb
      .from("installatie_partners")
      .select("id, naam, actief, portal_token")
      .eq("portal_token", token)
      .single();

    if (partnerErr || !partner || !partner.actief) {
      return new NextResponse("Portaal niet gevonden", { status: 404 });
    }

    const { data: orders, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, titel, status, schouw_at, schouw_notities, installatie_at, installatie_notities, service_at, service_notities, leads(naam, telefoon, email, straat, huisnummer, toevoeging, postcode, plaats, lead_number)"
      )
      .eq("installatie_partner_id", partner.id);

    if (error) throw error;

    const events: IcsEvent[] = [];
    const now = new Date();

    for (const row of orders || []) {
      const lead = leadFromRow(row.leads);
      const klant = lead?.naam?.trim() || "Klant";
      const adres = lead ? adresRegel(lead) : "";
      const nr = row.project_nummer || row.id.slice(0, 8);
      const baseDesc = [
        `Project ${nr}`,
        row.titel ? `Titel: ${row.titel}` : null,
        lead?.telefoon ? `Tel: ${lead.telefoon}` : null,
        lead?.email ? `E-mail: ${lead.email}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      if (row.schouw_at) {
        const start = new Date(row.schouw_at);
        if (!Number.isNaN(start.getTime())) {
          events.push({
            uid: `schouw-${row.id}@batterijconcept.nl`,
            summary: `Schouw · ${klant}`,
            description: [baseDesc, row.schouw_notities || null]
              .filter(Boolean)
              .join("\n\n"),
            location: adres || undefined,
            start,
            end: addMinutes(start, SCHOUW_DUUR_MINUTEN),
            stamp: now,
          });
        }
      }

      if (row.installatie_at) {
        const start = new Date(row.installatie_at);
        if (!Number.isNaN(start.getTime())) {
          events.push({
            uid: `installatie-${row.id}@batterijconcept.nl`,
            summary: `Installatie · ${klant}`,
            description: [baseDesc, row.installatie_notities || null]
              .filter(Boolean)
              .join("\n\n"),
            location: adres || undefined,
            start,
            end: addMinutes(start, INSTALLATIE_DUUR_MINUTEN),
            stamp: now,
          });
        }
      }

      if (row.service_at) {
        const start = new Date(row.service_at);
        if (!Number.isNaN(start.getTime())) {
          events.push({
            uid: `service-${row.id}@batterijconcept.nl`,
            summary: `Service · ${klant}`,
            description: [baseDesc, row.service_notities || null]
              .filter(Boolean)
              .join("\n\n"),
            location: adres || undefined,
            start,
            end: addMinutes(start, SERVICE_DUUR_MINUTEN),
            stamp: now,
          });
        }
      }
    }

    const ics = buildIcsCalendar({
      name: `BatterijConcept · ${partner.naam}`,
      events,
    });

    return new NextResponse(ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="batterijconcept-${partner.id.slice(0, 8)}.ics"`,
        "Cache-Control": "no-cache, max-age=0",
      },
    });
  } catch (e) {
    return new NextResponse(errMessage(e, "Fout"), { status: 500 });
  }
}
