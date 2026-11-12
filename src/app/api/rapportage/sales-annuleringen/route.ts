import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fromZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  buildSalesAnnuleringRapportage,
  defaultSalesAnnuleringRange,
  type ProjectUitvalFlag,
  type SaleOfferteRow,
} from "@/lib/sales-annulering-rapportage";

export const runtime = "nodejs";

/**
 * GET /api/rapportage/sales-annuleringen
 * Cohort op ondertekenweek: uitval = annulering + HOLD SALES, uniek per lead.
 */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (rol === "beller") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const def = defaultSalesAnnuleringRange();
    let from = sp.get("from")?.trim() || def.startYmd;
    let to = sp.get("to")?.trim() || def.endYmd;
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }

    const startIso = fromZonedTime(
      new Date(
        Number(from.slice(0, 4)),
        Number(from.slice(5, 7)) - 1,
        Number(from.slice(8, 10)),
        0,
        0,
        0,
        0
      ),
      AMSTERDAM_TZ
    ).toISOString();
    const endIso = fromZonedTime(
      new Date(
        Number(to.slice(0, 4)),
        Number(to.slice(5, 7)) - 1,
        Number(to.slice(8, 10)),
        23,
        59,
        59,
        999
      ),
      AMSTERDAM_TZ
    ).toISOString();

    const sb = getSupabaseAdmin();
    const salesRaw = await fetchAllRows<{
      id: string;
      lead_id: string | null;
      ondertekend_op: string | null;
    }>((fromIdx, toIdx) =>
      sb
        .from("offertes")
        .select("id, lead_id, ondertekend_op")
        .not("ondertekend_op", "is", null)
        .gte("ondertekend_op", startIso)
        .lte("ondertekend_op", endIso)
        .order("id", { ascending: true })
        .range(fromIdx, toIdx)
    );

    const sales: SaleOfferteRow[] = salesRaw
      .filter((s): s is { id: string; lead_id: string | null; ondertekend_op: string } =>
        Boolean(s.ondertekend_op)
      )
      .map((s) => ({
        id: s.id,
        lead_id: s.lead_id,
        ondertekend_op: s.ondertekend_op,
      }));

    const offerteIds = sales.map((s) => s.id);
    const projects: ProjectUitvalFlag[] = [];
    for (let i = 0; i < offerteIds.length; i += 80) {
      const chunk = offerteIds.slice(i, i + 80);
      if (!chunk.length) continue;
      const { data, error } = await sb
        .from("projecten")
        .select("offerte_id, lead_id, status")
        .in("offerte_id", chunk);
      if (error) throw error;
      for (const p of data || []) {
        projects.push({
          offerte_id: (p.offerte_id as string | null) || null,
          lead_id: (p.lead_id as string | null) || null,
          status: (p.status as string | null) || null,
        });
      }
    }

    const rapportage = buildSalesAnnuleringRapportage({
      startYmd: from,
      endYmd: to,
      sales,
      projects,
    });

    return NextResponse.json(rapportage);
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
