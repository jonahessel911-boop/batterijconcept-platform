import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireCockpitAdmin } from "@/lib/sales-cockpit/auth";
import { filterDossiers, getCockpit } from "@/lib/sales-cockpit/build";
import { currentWeekKey } from "@/lib/sales-cockpit/weeks";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await requireCockpitAdmin();
  if (!gate.ok) return gate.response;
  const week = req.nextUrl.searchParams.get("week") || currentWeekKey();
  const kind = req.nextUrl.searchParams.get("kind") || "toegewezen";
  const adviseurId = req.nextUrl.searchParams.get("adv") || null;
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") || 0) || 0);
  const limit = 40;
  try {
    const sb = getSupabaseAdmin();
    const { kansen, orders } = await getCockpit(sb, week);
    const ids = [...new Set(filterDossiers({ kansen, orders, kind, weekKey: week, adviseurId }))];
    const page = ids.slice(offset, offset + limit);
    let rows: { id: string; lead_number: string | null; naam: string | null; plaats: string | null }[] = [];
    if (page.length) {
      const { data, error } = await sb
        .from("leads")
        .select("id, lead_number, naam, plaats")
        .in("id", page);
      if (error) throw error;
      rows = (data || []) as typeof rows;
    }
    return NextResponse.json({
      total: ids.length,
      offset,
      rows: page.map((id) => {
        const row = rows.find((r) => r.id === id);
        return {
          id,
          leadNumber: row?.lead_number || null,
          naam: row?.naam || "Onbekend",
          plaats: row?.plaats || null,
          href: `/leads/${id}`,
        };
      }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Dossiers laden mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
