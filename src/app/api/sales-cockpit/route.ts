import { NextRequest, NextResponse } from "next/server";
import { requireSalesCockpitAdmin } from "@/lib/sales-cockpit/auth";
import { buildSalesCockpitReport } from "@/lib/sales-cockpit/load";
import type { Filters, Focus } from "@/lib/sales-cockpit/aggregate";
import {
  defaultGroupBy,
  isYmd,
  presetRange,
  previousEqualRange,
  QUALITY_PERIOD_IDS,
  qualityPeriodRange,
  sameRangeLastYear,
  todayYmd,
  TREND_PERIOD_IDS,
  trendPeriodRange,
  type GroupBy,
  type PresetId,
  type QualityPeriodId,
  type TrendPeriodId,
} from "@/lib/sales-cockpit/range";

export const runtime = "nodejs";

const FOCI = new Set<Focus>([
  "toegewezen",
  "gelopen",
  "open",
  "open_vervolg",
  "afgeboekt",
  "sale",
  "onbekend",
  "getekend",
  "aanbetaald",
  "tijdig",
  "in_termijn",
  "open_7",
  "geen_aanbetaling",
  "geannuleerd",
  "netto",
  "niet_toegerekend",
]);

const PRESETS = new Set<PresetId>([
  "vandaag",
  "gisteren",
  "deze_week",
  "vorige_week",
  "deze_maand",
  "vorige_maand",
  "d30",
  "d90",
  "dit_jaar",
  "vrij",
]);

export async function GET(req: NextRequest) {
  const auth = await requireSalesCockpitAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const sp = req.nextUrl.searchParams;
    const parsed = parseReportQuery(sp);
    const report = await buildSalesCockpitReport(auth.sb, parsed);
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Rapportage laden mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export function parseReportQuery(sp: URLSearchParams) {
  const presetRaw = sp.get("preset") || "deze_maand";
  const preset = PRESETS.has(presetRaw as PresetId) ? (presetRaw as PresetId) : "deze_maand";
  let from = sp.get("van") || "";
  let to = sp.get("tot") || "";
  if (!isYmd(from) || !isYmd(to)) {
    const presetRangeValue = presetRange(preset === "vrij" ? "deze_maand" : preset);
    from = presetRangeValue.from;
    to = presetRangeValue.to;
  }
  if (from > to) {
    const swap = from;
    from = to;
    to = swap;
  }
  const range = { from, to };
  const cmp = sp.get("cmp") || "geen";
  let compare: { from: string; to: string } | null = null;
  if (cmp === "vorige") compare = previousEqualRange(range);
  else if (cmp === "jaar") compare = sameRangeLastYear(range);
  else if (cmp === "vrij") {
    const a = sp.get("cmpVan") || "";
    const b = sp.get("cmpTot") || "";
    if (isYmd(a) && isYmd(b)) compare = a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  const groupRaw = sp.get("groep");
  const group: GroupBy =
    groupRaw === "dag" || groupRaw === "week" || groupRaw === "maand"
      ? groupRaw
      : defaultGroupBy(range);
  const advisorIds = (sp.get("adv") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const activityRaw = sp.get("actief");
  const activity =
    activityRaw === "actief" || activityRaw === "historisch" ? activityRaw : "alle";
  const finRaw = sp.get("fin");
  const financiering =
    finRaw === "warmtefonds" || finRaw === "eigen_middelen" || finRaw === "onbekend"
      ? finRaw
      : "alle";
  const filters: Filters = {
    advisorIds,
    activity,
    bron: sp.get("bron")?.trim() || null,
    plannerId: sp.get("planner")?.trim() || null,
    financiering,
  };
  const focusRaw = sp.get("focus");
  const focus = focusRaw && FOCI.has(focusRaw as Focus) ? (focusRaw as Focus) : null;
  const page = Math.max(1, Number(sp.get("page") || "1") || 1);
  const weekRaw = sp.get("week") || "";
  const weekAnchorYmd = isYmd(weekRaw) ? weekRaw : undefined;
  const dayRaw = sp.get("dag") || "";
  const dayAnchorYmd = isYmd(dayRaw) ? dayRaw : undefined;
  const today = todayYmd();
  const trendPeriodRaw = sp.get("trend_periode") || "w12";
  const trendPeriod = TREND_PERIOD_IDS.has(trendPeriodRaw as TrendPeriodId)
    ? (trendPeriodRaw as TrendPeriodId)
    : "w12";
  let trendFrom = sp.get("trend_van") || "";
  let trendTo = sp.get("trend_tot") || "";
  if (trendPeriod === "vrij") {
    if (!isYmd(trendFrom) || !isYmd(trendTo)) {
      const tr = trendPeriodRange("d30", today);
      trendFrom = tr.from;
      trendTo = tr.to;
    }
  } else {
    const tr = trendPeriodRange(trendPeriod, today);
    trendFrom = tr.from;
    trendTo = tr.to;
  }
  if (trendFrom > trendTo) {
    const swap = trendFrom;
    trendFrom = trendTo;
    trendTo = swap;
  }
  const trendRange = { from: trendFrom, to: trendTo };
  const trendGroupRaw = sp.get("trend_groep");
  const trendGroup: GroupBy =
    trendGroupRaw === "dag" ||
    trendGroupRaw === "week" ||
    trendGroupRaw === "maand"
      ? trendGroupRaw
      : defaultGroupBy(trendRange);
  const trendAdvisorIds = (sp.get("trend_adv") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const qualityPeriodRaw = sp.get("kwaliteit_periode") || "deze_maand";
  const qualityPeriod = QUALITY_PERIOD_IDS.has(
    qualityPeriodRaw as QualityPeriodId
  )
    ? (qualityPeriodRaw as QualityPeriodId)
    : "deze_maand";
  let qualityFrom = sp.get("kwaliteit_van") || "";
  let qualityTo = sp.get("kwaliteit_tot") || "";
  if (qualityPeriod === "vrij") {
    if (!isYmd(qualityFrom) || !isYmd(qualityTo)) {
      const qr = qualityPeriodRange("d30", today);
      qualityFrom = qr.from;
      qualityTo = qr.to;
    }
  } else {
    const qr = qualityPeriodRange(qualityPeriod, today);
    qualityFrom = qr.from;
    qualityTo = qr.to;
  }
  if (qualityFrom > qualityTo) {
    const swap = qualityFrom;
    qualityFrom = qualityTo;
    qualityTo = swap;
  }
  const qualityRange = { from: qualityFrom, to: qualityTo };
  return {
    range,
    compare,
    group,
    filters,
    focus,
    page,
    pageSize: 40,
    todayYmd: today,
    weekAnchorYmd,
    dayAnchorYmd,
    trendRange,
    trendGroup,
    trendAdvisorIds,
    qualityRange,
  };
}
