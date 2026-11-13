import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fromZonedTime } from "date-fns-tz";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { readCreativeLibrary } from "@/lib/creative-library-store";
import { AMSTERDAM_TZ } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import {
  buildMarketingRapportage,
  defaultMarketingRange,
  type MarketingAfspraak,
  type MarketingLead,
  type MarketingMetaRow,
  type MarketingOfferte,
} from "@/lib/marketing-rapportage";
import {
  fetchMarketingMetaRowsFromInsights,
  metaAdsSpendConfigured,
} from "@/lib/meta-ads-spend";
import { fetchTikTokCampaignRows } from "@/lib/tiktok-ads-spend";
import { fetchMetaAdCreatives } from "@/lib/meta-ad-creatives";
import {
  bestByCpa,
  bestByCpd,
  bestByCpl,
  metricRow,
  type PerformanceMetricRow,
} from "@/lib/performance-marketing";
import { todayConversieYmd } from "@/lib/conversie-period";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";
export const maxDuration = 60;

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * GET /api/performance-marketing
 * Admin-only: CPL/CPA/CPD ranking + Meta creatives + interne library.
 */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    const { data: me } = await sb
      .from("adviseurs")
      .select("rol")
      .eq("id", session.adviseurId)
      .maybeSingle();
    if (normalizeRol(me?.rol) !== "admin") {
      return NextResponse.json({ error: "Alleen admin" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    let from = sp.get("from")?.trim() || "";
    let to = sp.get("to")?.trim() || "";
    if (!from || !to) {
      const def = defaultMarketingRange();
      from = from || def.startYmd;
      to = to || def.endYmd;
    }
    const today = todayConversieYmd();
    if (to > today) to = today;
    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }

    const fromIso = fromZonedTime(`${from}T00:00:00`, AMSTERDAM_TZ).toISOString();
    const toIso = fromZonedTime(`${to}T23:59:59.999`, AMSTERDAM_TZ).toISOString();
    const cfg = metaAdsSpendConfigured();

    const [leadsInRange, offertes, afspraken, metaSpendDb, liveMeta, tiktok] =
      await Promise.all([
        fetchAllRows<MarketingLead>((fromIdx, toIdx) =>
          sb
            .from("leads")
            .select(
              "id, created_at, campaign_name, utm_campaign, ad_name, bron, utm_source, lander"
            )
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .order("created_at", { ascending: true })
            .range(fromIdx, toIdx)
        ),
        fetchAllRows<MarketingOfferte>((fromIdx, toIdx) =>
          sb
            .from("offertes")
            .select("id, lead_id, status, ondertekend_op, subtotaal_ex_btw")
            .eq("status", "ondertekend")
            .not("ondertekend_op", "is", null)
            .gte("ondertekend_op", fromIso)
            .lte("ondertekend_op", toIso)
            .order("ondertekend_op", { ascending: true })
            .range(fromIdx, toIdx)
        ),
        fetchAllRows<MarketingAfspraak>((fromIdx, toIdx) =>
          sb
            .from("afspraken")
            .select("id, lead_id, created_at, start_at, status, soort")
            .gte("created_at", fromIso)
            .lte("created_at", toIso)
            .neq("status", "geannuleerd")
            .order("created_at", { ascending: true })
            .range(fromIdx, toIdx)
        ).catch(() => [] as MarketingAfspraak[]),
        (async () => {
          try {
            return await fetchAllRows<MarketingMetaRow>((fromIdx, toIdx) =>
              sb
                .from("meta_ad_spend")
                .select(
                  "datum, level, campaign_id, campaign_name, ad_id, ad_name, spend, leads"
                )
                .in("level", ["campaign", "ad"])
                .gte("datum", from)
                .lte("datum", to)
                .order("datum", { ascending: true })
                .range(fromIdx, toIdx)
            );
          } catch {
            return [] as MarketingMetaRow[];
          }
        })(),
        cfg.ok
          ? withTimeout(
              fetchMarketingMetaRowsFromInsights({ since: from, until: to }),
              12_000,
              {
                ok: false as const,
                rows: [] as Awaited<
                  ReturnType<typeof fetchMarketingMetaRowsFromInsights>
                >["rows"],
                error: "timeout",
              }
            )
          : Promise.resolve({
              ok: false as const,
              rows: [] as MarketingMetaRow[],
              error: "not_configured",
            }),
        withTimeout(fetchTikTokCampaignRows({ since: from, until: to }), 8_000, {
          configured: false,
          rows: [] as MarketingMetaRow[],
          error: "timeout",
          advertiserIds: [] as string[],
        }),
      ]);

    const leadIdsNeeded = new Set([
      ...offertes.map((o) => o.lead_id),
      ...afspraken.map((a) => a.lead_id),
    ]);
    const known = new Set(leadsInRange.map((l) => l.id));
    const missing = [...leadIdsNeeded].filter((id) => !known.has(id));
    const extraLeads: MarketingLead[] = [];
    for (let i = 0; i < missing.length; i += 200) {
      const chunk = missing.slice(i, i + 200);
      const { data } = await sb
        .from("leads")
        .select(
          "id, created_at, campaign_name, utm_campaign, ad_name, bron, utm_source, lander"
        )
        .in("id", chunk);
      extraLeads.push(...((data || []) as MarketingLead[]));
    }
    const leads = [...leadsInRange, ...extraLeads];

    const liveCampLeads = liveMeta.ok
      ? liveMeta.rows
          .filter((r) => r.level === "campaign")
          .reduce((s, r) => s + (r.leads || 0), 0)
      : 0;
    const metaSpendFinal: MarketingMetaRow[] = (
      liveMeta.ok && liveMeta.rows.length > 0 ? liveMeta.rows : metaSpendDb
    ).map((row) => ({ ...row, source: "Meta" as const }));

    const rapportage = buildMarketingRapportage({
      startYmd: from,
      endYmd: to,
      leads,
      offertes,
      afspraken,
      metaSpend: [...metaSpendFinal, ...tiktok.rows],
      metaConfigured: cfg.ok,
      metaLeadsFromApi: liveCampLeads > 0,
      tiktokConfigured: tiktok.configured,
      tiktokError: tiktok.error || null,
    });

    const campaignsAcc = new Map<
      string,
      {
        source: string;
        label: string;
        spend: number;
        leads: number;
        afspraken: number;
        deals: number;
        omzet: number;
        ads: Map<
          string,
          {
            label: string;
            spend: number;
            leads: number;
            afspraken: number;
            deals: number;
            omzet: number;
          }
        >;
      }
    >();

    for (const w of rapportage.series) {
      for (const c of w.campaigns || []) {
        const key = `${c.source}::${c.key}`;
        const cur = campaignsAcc.get(key) || {
          source: c.source,
          label: c.label,
          spend: 0,
          leads: 0,
          afspraken: 0,
          deals: 0,
          omzet: 0,
          ads: new Map(),
        };
        cur.spend += c.spend;
        cur.leads += c.leads;
        cur.afspraken += c.afspraken;
        cur.deals += c.deals;
        cur.omzet += c.omzet;
        for (const a of c.ads || []) {
          const ad = cur.ads.get(a.key) || {
            label: a.label,
            spend: 0,
            leads: 0,
            afspraken: 0,
            deals: 0,
            omzet: 0,
          };
          ad.spend += a.spend;
          ad.leads += a.leads;
          ad.afspraken += a.afspraken;
          ad.deals += a.deals;
          ad.omzet += a.omzet;
          cur.ads.set(a.key, ad);
        }
        campaignsAcc.set(key, cur);
      }
    }

    const campaigns: PerformanceMetricRow[] = [];
    const ads: PerformanceMetricRow[] = [];
    for (const [key, c] of campaignsAcc) {
      campaigns.push(
        metricRow({
          key,
          label: c.label,
          platform: c.source,
          level: "campaign",
          spend: c.spend,
          leads: c.leads,
          afspraken: c.afspraken,
          deals: c.deals,
          omzet: c.omzet,
        })
      );
      for (const [adKey, a] of c.ads) {
        ads.push(
          metricRow({
            key: `${key}::${adKey}`,
            label: a.label,
            platform: c.source,
            level: "ad",
            parentKey: key,
            spend: a.spend,
            leads: a.leads,
            afspraken: a.afspraken,
            deals: a.deals,
            omzet: a.omzet,
          })
        );
      }
    }

    const channelAcc = new Map<
      string,
      {
        spend: number;
        leads: number;
        afspraken: number;
        deals: number;
        omzet: number;
      }
    >();
    for (const c of campaigns) {
      const cur = channelAcc.get(c.channel) || {
        spend: 0,
        leads: 0,
        afspraken: 0,
        deals: 0,
        omzet: 0,
      };
      cur.spend += c.spend;
      cur.leads += c.leads;
      cur.afspraken += c.afspraken;
      cur.deals += c.deals;
      cur.omzet += c.omzet;
      channelAcc.set(c.channel, cur);
    }
    const channels: PerformanceMetricRow[] = [...channelAcc.entries()].map(
      ([ch, m]) =>
        metricRow({
          key: ch,
          label: ch === "social" ? "Social" : ch === "native" ? "Native" : ch === "search" ? "Search" : ch,
          platform: ch,
          level: "channel",
          ...m,
        })
    );

    const platformAcc = new Map<
      string,
      {
        spend: number;
        leads: number;
        afspraken: number;
        deals: number;
        omzet: number;
      }
    >();
    for (const c of campaigns) {
      const cur = platformAcc.get(c.platform) || {
        spend: 0,
        leads: 0,
        afspraken: 0,
        deals: 0,
        omzet: 0,
      };
      cur.spend += c.spend;
      cur.leads += c.leads;
      cur.afspraken += c.afspraken;
      cur.deals += c.deals;
      cur.omzet += c.omzet;
      platformAcc.set(c.platform, cur);
    }
    const platforms: PerformanceMetricRow[] = [...platformAcc.entries()].map(
      ([p, m]) =>
        metricRow({
          key: p,
          label: p,
          platform: p,
          level: "channel",
          ...m,
        })
    );

    const sortCpa = (rows: PerformanceMetricRow[]) =>
      [...rows]
        .filter((r) => r.spend > 0 && r.afspraken > 0)
        .sort((a, b) => (a.cpa ?? 1e9) - (b.cpa ?? 1e9));

    // Library is local JSON — always available even if Meta hangs.
    const library = readCreativeLibrary();

    let metaCreatives: Awaited<
      ReturnType<typeof fetchMetaAdCreatives>
    >["rows"] = [];
    try {
      const fetched = await withTimeout(
        Promise.all([
          fetchMetaAdCreatives({
            adIds: ["120250328001100109"],
            limit: 20,
          }),
          fetchMetaAdCreatives({ limit: 12 }),
        ]),
        10_000,
        null
      );
      if (fetched) {
        const [creatives, more] = fetched;
        const creativeById = new Map<string, (typeof more.rows)[0]>();
        for (const r of [...creatives.rows, ...more.rows]) {
          creativeById.set(r.adId, r);
        }
        metaCreatives = [...creativeById.values()];
      }
    } catch {
      metaCreatives = [];
    }

    const t = rapportage.totals;
    return NextResponse.json({
      from,
      to,
      totals: metricRow({
        key: "total",
        label: "Totaal",
        platform: "All",
        level: "channel",
        spend: t.spend,
        leads: t.leads,
        afspraken: t.afspraken,
        deals: t.deals,
        omzet: t.omzet,
      }),
      best: {
        cplCampaign: bestByCpl(campaigns),
        cpaCampaign: bestByCpa(campaigns),
        cpdCampaign: bestByCpd(campaigns),
        cplAd: bestByCpl(ads, 5),
        cpaAd: bestByCpa(ads, 2),
        cpdAd: bestByCpd(ads, 1),
      },
      channels,
      platforms,
      campaigns: sortCpa(campaigns),
      ads: sortCpa(ads).slice(0, 40),
      metaCreatives,
      library,
      metaConfigured: cfg.ok,
      tiktokConfigured: tiktok.configured,
      tiktokError: tiktok.error || null,
      publishEnabled: false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
