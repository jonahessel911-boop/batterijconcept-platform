import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireCockpitAdmin } from "@/lib/sales-cockpit/auth";
import { clearCockpitCache, getCockpit } from "@/lib/sales-cockpit/build";
import { currentWeekKey } from "@/lib/sales-cockpit/weeks";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await requireCockpitAdmin();
  if (!gate.ok) return gate.response;
  const week = req.nextUrl.searchParams.get("week") || currentWeekKey();
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("sales_cockpit_evaluations")
    .select("id, week_key, vastgelegd_at, vastgelegd_door_naam, bronkwaliteit, beeld")
    .eq("week_key", week)
    .order("vastgelegd_at", { ascending: false })
    .limit(20);
  if (error) {
    const msg = error.message || "";
    if (error.code === "42P01" || error.code === "PGRST205" || msg.includes("sales_cockpit_")) {
      return NextResponse.json({ missing: true, rows: [] });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ missing: false, rows: data || [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireCockpitAdmin();
  if (!gate.ok) return gate.response;
  const body = await req.json().catch(() => null);
  const week = String(body?.weekKey || "");
  if (!week) return NextResponse.json({ error: "weekKey is verplicht" }, { status: 400 });
  try {
    const sb = getSupabaseAdmin();
    const { bundle } = await getCockpit(sb, week);
    const { error } = await sb.from("sales_cockpit_evaluations").insert({
      week_key: week,
      vastgelegd_door: gate.session.adviseurId,
      vastgelegd_door_naam: gate.session.naam,
      bronkwaliteit: {
        beperkingen: bundle.beperkingen,
        errors: bundle.errors,
        storage: bundle.storage,
      },
      beeld: {
        home: bundle.home,
        adviseurs: bundle.adviseurs,
        meeting: bundle.meeting.rijen.map((r) => ({
          adviseurId: r.adviseurId,
          naam: r.naam,
          target: r.target,
          waarschuwing: r.waarschuwing,
        })),
        acties: bundle.acties,
      },
    });
    if (error) {
      const msg = error.message || "";
      if (error.code === "42P01" || error.code === "PGRST205" || msg.includes("sales_cockpit_")) {
        return NextResponse.json(
          { error: "Cockpit-opslag is nog niet geïnstalleerd" },
          { status: 503 }
        );
      }
      throw error;
    }
    clearCockpitCache();
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Vastleggen mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
