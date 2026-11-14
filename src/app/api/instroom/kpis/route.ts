import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import { resolveConversiePeriod } from "@/lib/conversie-period";
import { buildSalesRapportage } from "@/lib/sales-rapportage";
import {
  buildRecruitmentKpiRows,
  RECRUITMENT_KPI_DEFAULTS,
} from "@/lib/recruitment-kpi";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

function noonIsoFromYmd(ymd: string, endOfDay = false): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(
    endOfDay
      ? new Date(y!, m! - 1, d!, 23, 59, 59, 999)
      : new Date(y!, m! - 1, d!, 0, 0, 0, 0),
    AMSTERDAM_TZ
  ).toISOString();
}

/**
 * GET /api/instroom/kpis
 * Query: target_sales (default 50), setter_calls_per_day (default 60)
 */
export async function GET(req: NextRequest) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const targetSales = Math.max(
      1,
      Number(sp.get("target_sales")) ||
        RECRUITMENT_KPI_DEFAULTS.targetSalesPerWeek
    );
    const setterCalls = Math.max(
      1,
      Number(sp.get("setter_calls_per_day")) ||
        RECRUITMENT_KPI_DEFAULTS.setterCallsPerDay
    );

    const range = resolveConversiePeriod("last_14_days");
    const sb = getSupabaseAdmin();

    const fromIso = noonIsoFromYmd(range.startYmd, false);
    const toIso = noonIsoFromYmd(range.endYmd, true);

    const [salesRapport, adviseursRes, leadsRes, wfEventsRes, wfOpsRes] =
      await Promise.all([
        buildSalesRapportage(sb, range.startYmd, range.endYmd),
        sb
          .from("adviseurs")
          .select("id, naam, email, actief, rol")
          .eq("actief", true),
        sb
          .from("leads")
          .select("id", { count: "exact", head: true })
          .gte("created_at", fromIso)
          .lte("created_at", toIso),
        sb
          .from("lead_events")
          .select("id, meta, created_at")
          .eq("soort", "status")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .limit(5000),
        sb
          .from("warmtefonds_operators")
          .select("id")
          .eq("actief", true),
      ]);

    const adviseurs = (adviseursRes.data || []) as {
      id: string;
      naam: string;
      email?: string | null;
      actief?: boolean | null;
      rol?: string | null;
    }[];

    const activeAdviseurs = adviseurs.filter((a) =>
      isPlanbaarAdviseur(a)
    ).length;
    const activeSetters = adviseurs.filter(
      (a) => normalizeRol(a.rol) === "beller"
    ).length;

    let activeWfOperators = (wfOpsRes.data || []).length;
    if (wfOpsRes.error) {
      // Tabel ontbreekt → 0
      activeWfOperators = 0;
    }

    const gelopen = salesRapport.totals.gelopen || 0;
    const sales = salesRapport.totals.sales || 0;
    const leadsIn = leadsRes.count || 0;

    let wfDoorgestuurd14d = 0;
    if (!wfEventsRes.error) {
      const seen = new Set<string>();
      for (const ev of wfEventsRes.data || []) {
        const meta = ev.meta as {
          naar?: unknown;
          project_id?: unknown;
          lead_id?: unknown;
        } | null;
        const naar = typeof meta?.naar === "string" ? meta.naar : "";
        if (naar !== "doorgestuurd_naar_edwin") continue;
        const key =
          (typeof meta?.project_id === "string" && meta.project_id) ||
          (typeof meta?.lead_id === "string" && meta.lead_id) ||
          (ev.id as string);
        if (seen.has(key)) continue;
        seen.add(key);
        wfDoorgestuurd14d += 1;
      }
    }

    // Fallback: open “Doorgestuurd”-queue ≈ huidige weekvolume
    let wfLookbackDays = range.days;
    let wfDoorgestuurd = wfDoorgestuurd14d;
    if (wfDoorgestuurd14d === 0) {
      const { count } = await sb
        .from("projecten")
        .select("id", { count: "exact", head: true })
        .eq("financiering_status", "doorgestuurd_naar_edwin");
      wfDoorgestuurd = count || 0;
      wfLookbackDays = 7;
    }

    const rows = buildRecruitmentKpiRows({
      targetSalesPerWeek: targetSales,
      setterCallsPerDay: setterCalls,
      gelopen,
      sales,
      lookbackDays: range.days,
      activeAdviseurs,
      activeSetters,
      activeWfOperators,
      leadsIn,
      wfDoorgestuurd:
        wfLookbackDays === range.days
          ? wfDoorgestuurd
          : // Normaliseer open-queue naar “alsof 14d” zodat perWeek klopt
            Math.round((wfDoorgestuurd / 7) * range.days),
    });

    return NextResponse.json({
      ok: true,
      period: {
        startYmd: range.startYmd,
        endYmd: range.endYmd,
        days: range.days,
        label: range.label,
      },
      inputs: {
        target_sales_per_week: targetSales,
        setter_calls_per_day: setterCalls,
        gelopen,
        sales,
        conv_gelopen_sale_pct:
          gelopen > 0 ? Math.round((sales / gelopen) * 1000) / 10 : null,
        leads_in: leadsIn,
        wf_doorgestuurd: wfDoorgestuurd,
        active_adviseurs: activeAdviseurs,
        active_setters: activeSetters,
        active_wf_operators: activeWfOperators,
      },
      rows,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "KPI's laden mislukt") },
      { status: 500 }
    );
  }
}
