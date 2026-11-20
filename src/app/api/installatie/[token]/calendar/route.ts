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
import {
  applyOwnJobsFilter,
  koppelIdsVoorMonteur,
  resolveInstallatiePortal,
  resolveOwnJobsScope,
  scopesToOwnJobsOnly,
} from "@/lib/installatie-portal";

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
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const session = await resolveInstallatiePortal(token, req);
    if (!session) {
      return new NextResponse("Portaal niet gevonden", { status: 404 });
    }
    const partner = session.partner;
    const sb = getSupabaseAdmin();

    let q = sb
      .from("projecten")
      .select(
        "id, project_nummer, titel, status, schouw_at, schouw_notities, installatie_at, installatie_notities, service_at, service_notities, installatie_teamgenoot_id, installatie_koppel_id, leads(naam, telefoon, email, straat, huisnummer, toevoeging, postcode, plaats, lead_number)"
      )
      .eq("installatie_partner_id", partner.id) as unknown as {
      eq: (col: string, val: string) => typeof q;
      or: (filter: string) => typeof q;
    };
    q = applyOwnJobsFilter(q, await resolveOwnJobsScope(session));

    const { data: orders, error } = await (q as unknown as Promise<{
      data: Array<{
        id: string;
        project_nummer?: string | null;
        titel?: string | null;
        schouw_at?: string | null;
        schouw_notities?: string | null;
        installatie_at?: string | null;
        installatie_notities?: string | null;
        service_at?: string | null;
        service_notities?: string | null;
        installatie_teamgenoot_id?: string | null;
        installatie_koppel_id?: string | null;
        leads?: unknown;
      }> | null;
      error: { message?: string } | null;
    }>);

    if (error) throw error;

    const events: IcsEvent[] = [];
    const now = new Date();
    const ownOnly = scopesToOwnJobsOnly(session);
    const tgId = ownOnly ? session.teamgenoot.id : null;
    const ownKoppelIds = ownOnly
      ? new Set(await koppelIdsVoorMonteur(partner.id, session.teamgenoot.id))
      : null;

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

      if (
        row.schouw_at &&
        (!ownOnly || row.installatie_teamgenoot_id === tgId)
      ) {
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

      if (
        row.installatie_at &&
        (!ownOnly ||
          (row.installatie_koppel_id &&
            ownKoppelIds?.has(row.installatie_koppel_id)) ||
          (!row.installatie_koppel_id &&
            row.installatie_teamgenoot_id === tgId))
      ) {
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
            summary: `${
              (row.service_notities || "").trim().startsWith("Service - VV Installatie")
                ? "Service - VV Installatie"
                : "Service"
            } · ${klant}`,
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
