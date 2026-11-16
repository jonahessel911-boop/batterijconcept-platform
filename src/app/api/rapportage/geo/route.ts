/**
 * Lichte endpoint voor Rapportage → Kaart (leads per provincie).
 * Geen financial tree — alleen wat buildGeoBreakdown nodig heeft.
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import {
  parseConversiePeriod,
  resolveConversiePeriod,
  type ConversiePeriod,
} from "@/lib/conversie-period";
import { amsDayBounds, inAmsterdamDayRange } from "@/lib/lead-conversie";
import { buildGeoBreakdown, type RapportageLead } from "@/lib/rapportage";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseGeoPeriod(raw: string | null): ConversiePeriod {
  if (!raw?.trim()) return "all_time";
  return parseConversiePeriod(raw);
}

export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (
      rol !== "admin" &&
      rol !== "sales_manager" &&
      rol !== "backoffice"
    ) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const adviseurId = req.nextUrl.searchParams.get("adviseur_id");
    const geoPeriod = parseGeoPeriod(req.nextUrl.searchParams.get("geo_period"));
    const geoResolved = resolveConversiePeriod(geoPeriod);
    const { start: geoStart } = amsDayBounds(geoResolved.startYmd);
    const { end: geoEnd } = amsDayBounds(geoResolved.endYmd);

    const sb = getSupabaseAdmin();

    let leadsQuery = sb
      .from("leads")
      .select("id, created_at, status, adviseur_id, postcode, plaats")
      .order("created_at", { ascending: false })
      .limit(25000);
    if (geoPeriod !== "all_time") {
      leadsQuery = leadsQuery
        .gte("created_at", `${geoResolved.startYmd}T00:00:00.000Z`)
        .lte("created_at", `${geoResolved.endYmd}T23:59:59.999Z`);
    }

    const [leadsRes, afsprakenRes, offertesRes, projectenRes] =
      await Promise.all([
        leadsQuery,
        sb
          .from("afspraken")
          .select("id, lead_id, status, soort")
          .limit(40000),
        sb
          .from("offertes")
          .select("id, lead_id, status, ondertekend_op, subtotaal_ex_btw")
          .eq("status", "ondertekend")
          .limit(20000),
        sb
          .from("projecten")
          .select("id, offerte_id, status")
          .eq("status", "annulering")
          .limit(8000),
      ]);

    if (leadsRes.error) throw leadsRes.error;
    if (afsprakenRes.error) throw afsprakenRes.error;
    if (offertesRes.error) throw offertesRes.error;

    let leads = (leadsRes.data || []) as RapportageLead[];
    leads = leads.filter((l) =>
      inAmsterdamDayRange(l.created_at, geoStart, geoEnd)
    );

    const afspraken = (afsprakenRes.data || []).map((a) => ({
      id: a.id as string,
      lead_id: a.lead_id as string,
      adviseur_id: null as string | null,
      start_at: "",
      created_at: "",
      status: (a.status as string) || "",
      soort: (a.soort as string | null) ?? null,
      ingepland_door_id: null as string | null,
    }));

    const offertes = (offertesRes.data || []).map((o) => ({
      id: o.id as string,
      lead_id: o.lead_id as string,
      status: o.status as string,
      ondertekend_op: (o.ondertekend_op as string | null) ?? null,
      created_at: "",
      subtotaal_ex_btw: Number(o.subtotaal_ex_btw) || 0,
      btw_bedrag: 0,
      totaal_inc_btw: 0,
      financiering_voorbehoud: null as boolean | null,
      adviseur_id: null as string | null,
      offerte_nummer: null as string | null,
    }));

    const projecten = (projectenRes.data || []).map((p) => ({
      id: p.id as string,
      lead_id: "",
      offerte_id: (p.offerte_id as string | null) ?? null,
      created_at: "",
      projectkosten: 0,
      adviseur_id: null as string | null,
      installatie_at: null as string | null,
      installatie_voltooid_at: null as string | null,
      schouw_at: null as string | null,
      status: (p.status as string) || "annulering",
      project_nummer: null as string | null,
      materiaal_checks: null,
    }));

    const geo = buildGeoBreakdown(
      {
        leads,
        afspraken,
        offertes,
        projecten,
        facturen: [],
      },
      adviseurId
    );

    return NextResponse.json({
      geo,
      geoPeriod: geoResolved.period,
      geoPeriodLabel: geoResolved.label,
      geoRangeStartYmd: geoResolved.startYmd,
      geoRangeEndYmd: geoResolved.endYmd,
      leadCount: leads.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Kaart laden mislukt") },
      { status: 500 }
    );
  }
}
