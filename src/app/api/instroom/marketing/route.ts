import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  defaultBanenRange,
  fetchMetaBanenSpend,
  metaBanenAdAccountId,
} from "@/lib/meta-banen-spend";
import {
  classifyHireRol,
  classifyRecruitmentRol,
  isAangenomenStatus,
} from "@/lib/recruitment-rollen";
import { ensureStandardVacatures } from "@/lib/ensure-standard-vacatures";
import { pickSollicitatieMetaAttribution } from "@/lib/sollicitatie-meta-attribution";
import { fromZonedTime } from "date-fns-tz";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

const TZ = "Europe/Amsterdam";

function dayStartIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), TZ).toISOString();
}

function dayEndIso(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(
    new Date(y, m - 1, d, 23, 59, 59, 999),
    TZ
  ).toISOString();
}

type Agg = {
  id: string;
  name: string;
  spend: number;
  leads: number;
  impressions: number;
  clicks: number;
  campaign_id?: string | null;
  campaign_name?: string | null;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function cplOf(spend: number, leads: number): number | null {
  return leads > 0 ? round2(spend / leads) : null;
}

function ctrOf(clicks: number, impressions: number): number | null {
  return impressions > 0 ? round2((clicks / impressions) * 100) : null;
}

function pickBestCpl(
  rows: Array<{ id: string; name: string; spend: number; leads: number; cpl: number | null }>,
  minLeads = 2
) {
  const eligible = rows.filter(
    (r) => r.cpl != null && r.leads >= minLeads && r.spend > 0
  );
  if (!eligible.length) {
    const fallback = rows
      .filter((r) => r.cpl != null && r.leads > 0)
      .sort((a, b) => (a.cpl ?? 9999) - (b.cpl ?? 9999));
    return fallback[0] || null;
  }
  return eligible.sort((a, b) => (a.cpl ?? 9999) - (b.cpl ?? 9999))[0] || null;
}

/**
 * BANEN ads manager — Meta spend/ads + CRM sollicitaties/hires.
 */
export async function GET(req: NextRequest) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sp = req.nextUrl.searchParams;
    const defaultRange = defaultBanenRange(30);
    const since = sp.get("since")?.trim() || defaultRange.since;
    const until = sp.get("until")?.trim() || defaultRange.until;

    type AttrRow = {
      id: string;
      status: string;
      created_at?: string;
      updated_at?: string;
      functie: string | null;
      vacature_id?: string | null;
      meta_campaign_id?: string | null;
      meta_adset_id?: string | null;
      meta_ad_id?: string | null;
      raw_payload?: unknown;
    };

    const ATTR_SELECT =
      "id, status, created_at, updated_at, functie, vacature_id, meta_campaign_id, meta_adset_id, meta_ad_id, raw_payload";

    async function fetchSolRows(cols: string) {
      return getSupabaseAdmin()
        .from("sollicitaties")
        .select(cols)
        .gte("created_at", dayStartIso(since))
        .lte("created_at", dayEndIso(until));
    }

    /** Alle huidige aangenomen — CPH telt op huidige functie, niet alleen updated_at-venster. */
    async function fetchHireRows(cols: string) {
      return getSupabaseAdmin()
        .from("sollicitaties")
        .select(cols)
        .in("status", [
          "aangenomen_training_gepland",
          "aangenomen_actief",
          "aangenomen",
        ]);
    }

    function narrowSelect(cols: string, errMsg: string): string {
      const parts = cols.split(",").map((s) => s.trim());
      const keep = parts.filter((p) => !errMsg.includes(p));
      // Altijd basis behouden
      const required = ["id", "status", "functie"];
      const set = new Set([...required, ...keep]);
      return [...set].join(", ");
    }

    const [meta, solRes, hireRes0] = await Promise.all([
      fetchMetaBanenSpend({ since, until, level: "ad" }),
      fetchSolRows(ATTR_SELECT),
      fetchHireRows(ATTR_SELECT),
    ]);

    let solQuery = solRes;
    if (
      solQuery.error &&
      (solQuery.error.code === "42703" ||
        solQuery.error.message?.includes("column"))
    ) {
      solQuery = await fetchSolRows(
        narrowSelect(ATTR_SELECT, solQuery.error.message || "")
      );
    }
    if (solQuery.error && solQuery.error.code !== "42P01") {
      throw solQuery.error;
    }

    let hireQuery = hireRes0;
    if (
      hireQuery.error &&
      (hireQuery.error.code === "42703" ||
        hireQuery.error.message?.includes("column"))
    ) {
      hireQuery = await fetchHireRows(
        narrowSelect(ATTR_SELECT, hireQuery.error.message || "")
      );
    }
    if (hireQuery.error && hireQuery.error.code !== "42P01") {
      throw hireQuery.error;
    }

    function resolveMetaIds(row: AttrRow): {
      campaignId: string | null;
      adsetId: string | null;
      adId: string | null;
    } {
      let campaignId = row.meta_campaign_id?.trim() || null;
      let adsetId = row.meta_adset_id?.trim() || null;
      let adId = row.meta_ad_id?.trim() || null;
      if (
        (!campaignId || !adsetId || !adId) &&
        row.raw_payload &&
        typeof row.raw_payload === "object"
      ) {
        const fromPayload = pickSollicitatieMetaAttribution(
          row.raw_payload as Record<string, unknown>
        );
        campaignId = campaignId || fromPayload.meta_campaign_id;
        adsetId = adsetId || fromPayload.meta_adset_id;
        adId = adId || fromPayload.meta_ad_id;
      }
      return { campaignId, adsetId, adId };
    }

    const sollicitaties = (solQuery.data || []) as unknown as AttrRow[];
    const sollicitatiesCount = sollicitaties.length;

    // Één sollicitatie = max 1 hire (training of aangenomen, niet dubbel)
    const hires = ((hireQuery.data || []) as unknown as AttrRow[]).filter((r) =>
      isAangenomenStatus(r.status)
    );
    const hiresCount = hires.length;

    const appsByCampaign = new Map<string, number>();
    const appsByAd = new Map<string, number>();
    let appsAttributed = 0;
    for (const row of sollicitaties) {
      const { campaignId, adId } = resolveMetaIds(row);
      if (campaignId) {
        appsAttributed += 1;
        appsByCampaign.set(
          campaignId,
          (appsByCampaign.get(campaignId) || 0) + 1
        );
      }
      if (adId) {
        appsByAd.set(adId, (appsByAd.get(adId) || 0) + 1);
      }
    }

    const hiresByCampaign = new Map<string, number>();
    const hiresByAd = new Map<string, number>();
    const hiresByVacature = new Map<string, number>();
    for (const row of hires) {
      const vid = row.vacature_id || null;
      if (vid) {
        hiresByVacature.set(vid, (hiresByVacature.get(vid) || 0) + 1);
      }
      const { campaignId, adId } = resolveMetaIds(row);
      if (campaignId) {
        hiresByCampaign.set(
          campaignId,
          (hiresByCampaign.get(campaignId) || 0) + 1
        );
      }
      if (adId) {
        hiresByAd.set(adId, (hiresByAd.get(adId) || 0) + 1);
      }
    }

    const metaLeads = meta.days.reduce((n, d) => n + (d.leads || 0), 0);
    const spend = meta.totalSpend;
    const applications = sollicitatiesCount;
    const impressions = meta.days.reduce(
      (n, d) => n + (d.impressions || 0),
      0
    );
    const clicks = meta.days.reduce((n, d) => n + (d.clicks || 0), 0);

    // CPL op CRM-apps; fallback Meta results als er nog geen apps zijn
    const cplDenom = applications > 0 ? applications : metaLeads;
    const cpl = cplDenom > 0 ? round2(spend / cplDenom) : null;
    const cph = hiresCount > 0 ? round2(spend / hiresCount) : null;
    const attributionRate =
      sollicitatiesCount > 0
        ? round2((appsAttributed / sollicitatiesCount) * 100)
        : null;

    // Ad + campaign rollups from daily ad insights
    const byAd = new Map<string, Agg>();
    const byCampaign = new Map<string, Agg>();
    const byDay = new Map<
      string,
      { date: string; spend: number; leads: number }
    >();

    for (const d of meta.days) {
      const day = byDay.get(d.date) || {
        date: d.date,
        spend: 0,
        leads: 0,
      };
      day.spend = round2(day.spend + d.spend);
      day.leads += d.leads || 0;
      byDay.set(d.date, day);

      const cid = d.campaign_id || "unknown";
      const camp = byCampaign.get(cid) || {
        id: cid,
        name: d.campaign_name || cid,
        spend: 0,
        leads: 0,
        impressions: 0,
        clicks: 0,
      };
      camp.spend = round2(camp.spend + d.spend);
      camp.leads += d.leads || 0;
      camp.impressions += d.impressions || 0;
      camp.clicks += d.clicks || 0;
      if (d.campaign_name) camp.name = d.campaign_name;
      byCampaign.set(cid, camp);

      const aid = d.ad_id || `${cid}:unknown`;
      const ad = byAd.get(aid) || {
        id: aid,
        name: d.ad_name || aid,
        spend: 0,
        leads: 0,
        impressions: 0,
        clicks: 0,
        campaign_id: cid,
        campaign_name: d.campaign_name || null,
      };
      ad.spend = round2(ad.spend + d.spend);
      ad.leads += d.leads || 0;
      ad.impressions += d.impressions || 0;
      ad.clicks += d.clicks || 0;
      if (d.ad_name) ad.name = d.ad_name;
      if (d.campaign_name) ad.campaign_name = d.campaign_name;
      byAd.set(aid, ad);
    }

    const campaignsRaw = [...byCampaign.values()].sort(
      (a, b) => b.spend - a.spend
    );
    const adsRaw = [...byAd.values()].sort((a, b) => b.spend - a.spend);

    const sb = getSupabaseAdmin();
    let vacatures: { id: string; titel: string; rol: string; status: string }[] =
      [];
    try {
      const ensured = await ensureStandardVacatures(sb);
      vacatures = ensured.map((v) => ({
        id: v.id,
        titel: v.titel,
        rol: v.rol,
        status: v.status,
      }));
    } catch (vacErr) {
      const err = vacErr as { code?: string };
      if (err.code !== "42P01") throw vacErr;
      vacatures = [];
    }

    const { data: koppelData, error: koppelResError } = await sb
      .from("recruitment_campagne_koppelingen")
      .select("campaign_id, vacature_id, campaign_name");

    const koppelingen: Record<string, string | null> = {};
    if (!koppelResError) {
      for (const row of koppelData || []) {
        koppelingen[row.campaign_id as string] =
          (row.vacature_id as string) || null;
      }
    } else if (koppelResError.code !== "42P01") {
      throw koppelResError;
    }

    const vacatureById = new Map(
      vacatures.map((v) => [v.id, v] as const)
    );

    const campaigns = campaignsRaw.map((c) => {
      const campaignHires = hiresByCampaign.get(c.id) || 0;
      const crmApps = appsByCampaign.get(c.id) || 0;
      // CPL op CRM-apps als die er zijn, anders Meta results
      const cplDenom = crmApps > 0 ? crmApps : c.leads;
      const campaignCpl = cplOf(c.spend, cplDenom);
      const campaignCph =
        campaignHires > 0 ? round2(c.spend / campaignHires) : null;
      return {
        id: c.id,
        name: c.name,
        spend: c.spend,
        leads: c.leads,
        crm_apps: crmApps,
        impressions: c.impressions,
        clicks: c.clicks,
        ctr: ctrOf(c.clicks, c.impressions),
        vacature_id: koppelingen[c.id] || null,
        hires: campaignHires,
        cpl: campaignCpl,
        cph: campaignCph,
      };
    });

    const ads = adsRaw.map((a) => {
      const cid = a.campaign_id || "unknown";
      const camp = campaignsRaw.find((x) => x.id === cid);
      const adHires = hiresByAd.get(a.id) || 0;
      const crmApps = appsByAd.get(a.id) || 0;
      const cplDenom = crmApps > 0 ? crmApps : a.leads;
      return {
        id: a.id,
        name: a.name,
        campaign_id: cid,
        campaign_name: a.campaign_name || camp?.name || null,
        spend: a.spend,
        leads: a.leads,
        crm_apps: crmApps,
        impressions: a.impressions,
        clicks: a.clicks,
        ctr: ctrOf(a.clicks, a.impressions),
        vacature_id: koppelingen[cid] || null,
        hires: adHires,
        cpl: cplOf(a.spend, cplDenom),
        cph: adHires > 0 ? round2(a.spend / adHires) : null,
      };
    });

    // Per vacature rollup
    const byVacatureMap = new Map<
      string,
      {
        vacature_id: string;
        titel: string;
        rol: string;
        status: string;
        spend: number;
        leads: number;
        hires: number;
        campaigns: number;
      }
    >();
    for (const c of campaigns) {
      const vid = c.vacature_id;
      if (!vid) continue;
      const vac = vacatureById.get(vid);
      if (!vac) continue;
      const cur = byVacatureMap.get(vid) || {
        vacature_id: vid,
        titel: vac.titel,
        rol: vac.rol,
        status: vac.status,
        spend: 0,
        leads: 0,
        hires: 0,
        campaigns: 0,
      };
      cur.spend = round2(cur.spend + c.spend);
      cur.leads += c.leads;
      cur.campaigns += 1;
      byVacatureMap.set(vid, cur);
    }
    // Huidige functie wint (Collin: solliciteerde als setter, nu ZZP-verkoper → adviseur).
    const hiresByRol = new Map<string, number>();
    for (const row of hires) {
      const vac = row.vacature_id
        ? vacatureById.get(row.vacature_id)
        : null;
      const rol = classifyHireRol({
        functie: row.functie,
        vacatureRol: vac?.rol || null,
      });
      hiresByRol.set(rol, (hiresByRol.get(rol) || 0) + 1);
    }

    for (const [vid, row] of byVacatureMap) {
      // Hires op vacature: iedereen met die vacature_id die nóg als die rol telt
      // (of via functie als adviseur ondanks andere vacature — die gaan naar byRol).
      row.hires = hiresByVacature.get(vid) || 0;
    }
    const byVacature = [...byVacatureMap.values()]
      .map((v) => ({
        ...v,
        cpl: cplOf(v.spend, v.leads),
        cph: v.hires > 0 ? round2(v.spend / v.hires) : null,
      }))
      .sort((a, b) => b.spend - a.spend);

    // Per-rol: spend via gekoppelde campagnes; hires via huidige functie.
    const byRolMap = new Map<
      string,
      { rol: string; spend: number; leads: number; hires: number }
    >();
    for (const v of byVacature) {
      const rol = classifyRecruitmentRol(v.rol);
      const cur = byRolMap.get(rol) || {
        rol,
        spend: 0,
        leads: 0,
        hires: 0,
      };
      cur.spend = round2(cur.spend + v.spend);
      cur.leads += v.leads;
      byRolMap.set(rol, cur);
    }
    for (const [rol, n] of hiresByRol) {
      const cur = byRolMap.get(rol) || {
        rol,
        spend: 0,
        leads: 0,
        hires: 0,
      };
      cur.hires = n;
      byRolMap.set(rol, cur);
    }
    // Geen campagnekoppeling voor adviseur? Gebruik totale BANEN-spend voor die CPH.
    const adviseurRow = byRolMap.get("adviseur_sales");
    if (adviseurRow && adviseurRow.spend <= 0 && spend > 0) {
      adviseurRow.spend = spend;
      adviseurRow.leads = applications || metaLeads;
    }
    const byRol = [...byRolMap.values()]
      .map((r) => ({
        ...r,
        cpl: cplOf(r.spend, r.leads),
        cph: r.hires > 0 ? round2(r.spend / r.hires) : null,
      }))
      .sort((a, b) => b.spend - a.spend);

    const bestCplCampaign = pickBestCpl(campaigns);
    const bestCplAd = pickBestCpl(ads);
    const topResultsAd = [...ads]
      .filter((a) => a.leads > 0)
      .sort((a, b) => b.leads - a.leads || a.spend - b.spend)[0] || null;
    const topSpendCampaign = campaigns[0] || null;

    const series = [...byDay.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    function bestPayload(
      row: {
        id: string;
        name: string;
        spend: number;
        leads: number;
        cpl: number | null;
        campaign_name?: string | null;
      } | null
    ) {
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        spend: row.spend,
        leads: row.leads,
        cpl: row.cpl,
        campaign_name: row.campaign_name ?? null,
      };
    }

    return NextResponse.json({
      accountId: meta.accountId || metaBanenAdAccountId(),
      since,
      until,
      configured: meta.configured,
      metaOk: meta.ok,
      metaError: meta.error || null,
      spend,
      impressions,
      clicks,
      ctr: ctrOf(clicks, impressions),
      metaLeads,
      sollicitaties: sollicitatiesCount,
      applications,
      appsAttributed,
      attributionRate,
      hires: hiresCount,
      cpl,
      cph,
      campaigns,
      ads,
      byVacature,
      byRol,
      best: {
        cplCampaign: bestPayload(bestCplCampaign),
        cplAd: bestPayload(bestCplAd),
        resultsAd: bestPayload(topResultsAd),
        spendCampaign: bestPayload(topSpendCampaign),
      },
      series,
      vacatures,
      koppelingen,
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
