import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  BEZORG_MAX_STOPS_PER_DAG,
  classifyRecruitmentRol,
  isAangenomenStatus,
} from "@/lib/recruitment-rollen";
import { optimizeBezorgStops } from "@/lib/bezorg-route";
import { normalizeSollicitatieStatus } from "@/lib/sollicitatie";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

function migrationHint(msg: string) {
  return (
    msg.includes("bezorg_routes") ||
    msg.includes("bezorg_route_stops") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

export async function GET(req: NextRequest) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = getSupabaseAdmin();
    const id = req.nextUrl.searchParams.get("id");

    if (id) {
      const { data: route, error } = await sb
        .from("bezorg_routes")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!route) {
        return NextResponse.json({ error: "Route niet gevonden" }, { status: 404 });
      }
      const { data: stops, error: stErr } = await sb
        .from("bezorg_route_stops")
        .select("*")
        .eq("route_id", id)
        .order("volgorde", { ascending: true });
      if (stErr) throw stErr;

      const projectIds = (stops || []).map((s) => s.project_id as string);
      let projectMeta = new Map<
        string,
        { project_nummer: string | null; klant_naam: string | null }
      >();
      if (projectIds.length) {
        const { data: projects } = await sb
          .from("projecten")
          .select("id, project_nummer, titel, leads(naam)")
          .in("id", projectIds);
        for (const p of projects || []) {
          const leadRaw = p.leads as
            | { naam?: string | null }
            | { naam?: string | null }[]
            | null;
          const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
          projectMeta.set(p.id as string, {
            project_nummer: (p.project_nummer as string | null) || null,
            klant_naam: lead?.naam || (p.titel as string | null) || null,
          });
        }
      }

      return NextResponse.json({
        route: {
          ...route,
          stops: (stops || []).map((s) => ({
            ...s,
            project_nummer: projectMeta.get(s.project_id as string)
              ?.project_nummer,
            klant_naam: projectMeta.get(s.project_id as string)?.klant_naam,
          })),
        },
      });
    }

    const { data: routes, error } = await sb
      .from("bezorg_routes")
      .select("*")
      .order("datum", { ascending: false })
      .limit(40);
    if (error) throw error;

    const routeIds = (routes || []).map((r) => r.id as string);
    const stopCount = new Map<string, { total: number; done: number }>();
    if (routeIds.length) {
      const { data: stops } = await sb
        .from("bezorg_route_stops")
        .select("route_id, geleverd_at")
        .in("route_id", routeIds);
      for (const s of stops || []) {
        const rid = s.route_id as string;
        const cur = stopCount.get(rid) || { total: 0, done: 0 };
        cur.total += 1;
        if (s.geleverd_at) cur.done += 1;
        stopCount.set(rid, cur);
      }
    }

    // Bezorger-opties voor de planner
    const { data: sols } = await sb
      .from("sollicitaties")
      .select("id, naam, functie, status")
      .in("status", [
        "aangenomen_actief",
        "aangenomen_training_gepland",
        "aangenomen",
      ])
      .order("naam", { ascending: true })
      .limit(80);

    const bezorgers = (sols || [])
      .filter((s) => {
        const st = normalizeSollicitatieStatus(s.status as string);
        if (!isAangenomenStatus(st)) return false;
        return classifyRecruitmentRol(s.functie as string) === "bezorger";
      })
      .map((s) => ({
        id: s.id as string,
        naam: (s.naam as string) || "Bezorger",
      }));

    return NextResponse.json({
      routes: (routes || []).map((r) => ({
        ...r,
        stops_total: stopCount.get(r.id as string)?.total || 0,
        stops_done: stopCount.get(r.id as string)?.done || 0,
      })),
      bezorgers,
      max_stops: BEZORG_MAX_STOPS_PER_DAG,
      draft: true,
    });
  } catch (e) {
    const msg = errMessage(e);
    if (migrationHint(msg)) {
      return NextResponse.json({
        routes: [],
        bezorgers: [],
        max_stops: BEZORG_MAX_STOPS_PER_DAG,
        draft: true,
        warning:
          "Voer supabase/migrate-bezorg-routes.sql uit in Supabase.",
      });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = getSupabaseAdmin();
    const body = (await req.json()) as {
      datum?: string;
      bezorger_naam?: string;
      bezorger_sollicitatie_id?: string | null;
      stops?: Array<{
        project_id: string;
        adres: string;
        lat?: number | null;
        lng?: number | null;
      }>;
      optimize?: boolean;
    };

    const datum = (body.datum || "").trim();
    const bezorgerNaam = (body.bezorger_naam || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      return NextResponse.json(
        { error: "datum (jjjj-mm-dd) is verplicht" },
        { status: 400 }
      );
    }
    if (!bezorgerNaam) {
      return NextResponse.json(
        { error: "bezorger_naam is verplicht" },
        { status: 400 }
      );
    }
    const rawStops = body.stops || [];
    if (!rawStops.length) {
      return NextResponse.json(
        { error: "Selecteer minstens 1 order" },
        { status: 400 }
      );
    }
    if (rawStops.length > BEZORG_MAX_STOPS_PER_DAG) {
      return NextResponse.json(
        {
          error: `Maximaal ${BEZORG_MAX_STOPS_PER_DAG} adressen per dag`,
        },
        { status: 400 }
      );
    }

    const optimized =
      body.optimize === false
        ? rawStops.map((s, i) => ({
            ...s,
            lat: s.lat ?? null,
            lng: s.lng ?? null,
            volgorde: i + 1,
          }))
        : await optimizeBezorgStops(
            rawStops.map((s) => ({
              project_id: s.project_id,
              adres: s.adres,
              lat: s.lat ?? null,
              lng: s.lng ?? null,
            }))
          );

    const { data: route, error } = await sb
      .from("bezorg_routes")
      .insert({
        datum,
        bezorger_naam: bezorgerNaam,
        bezorger_sollicitatie_id: body.bezorger_sollicitatie_id || null,
        status: "concept",
      })
      .select("*")
      .single();
    if (error) throw error;

    const rows = optimized.map((s) => ({
      route_id: route.id,
      project_id: s.project_id,
      volgorde: s.volgorde,
      adres: s.adres,
      lat: s.lat,
      lng: s.lng,
    }));

    const { data: stops, error: stErr } = await sb
      .from("bezorg_route_stops")
      .insert(rows)
      .select("*");
    if (stErr) {
      await sb.from("bezorg_routes").delete().eq("id", route.id);
      throw stErr;
    }

    return NextResponse.json({
      route: { ...route, stops: stops || [] },
      draft: true,
    });
  } catch (e) {
    const msg = errMessage(e);
    if (migrationHint(msg)) {
      return NextResponse.json(
        {
          error:
            "Voer eerst supabase/migrate-bezorg-routes.sql uit in Supabase.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
