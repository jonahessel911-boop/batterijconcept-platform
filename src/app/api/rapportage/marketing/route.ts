import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import {
  buildMarketingRapportage,
  defaultMarketingRange,
  type MarketingAfspraak,
  type MarketingLead,
  type MarketingMetaRow,
  type MarketingOfferte,
} from "@/lib/marketing-rapportage";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import { weekKeyString } from "@/lib/adviseur-beschikbaarheid";
import {
  leadsNeededForForwardHorizon,
  type CeoPlanbaarAdviseur,
} from "@/lib/ceo-unit-targets";
import { getDaysInMonth } from "date-fns";
import {
  conversieMonthRangeContaining,
  conversieWeekRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import {
  metaAdsSpendConfigured,
  syncMetaAdSpendCampaignDetail,
} from "@/lib/meta-ads-spend";
import {
  parseSchouwWeekValue,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const runtime = "nodejs";

/**
 * GET /api/rapportage/marketing
 * Query:
 *   from, to — yyyy-MM-dd (Amsterdam)
 *   week — 2026-W43
 *   month — 2026-10
 *   sync=1 — trigger Meta campaign sync for range (best-effort)
 */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sp = req.nextUrl.searchParams;
    const weekParam = sp.get("week")?.trim() || "";
    const monthParam = sp.get("month")?.trim() || "";
    let from = sp.get("from")?.trim() || "";
    let to = sp.get("to")?.trim() || "";
    const doSync = sp.get("sync") === "1";

    if (weekParam) {
      const parsed = parseSchouwWeekValue(weekParam);
      if (parsed) {
        const mon = String(
          schouwWeekToMondayIso(parsed.jaar, parsed.week)
        ).slice(0, 10);
        const range = conversieWeekRangeContaining(mon);
        from = range.startYmd;
        to = range.endYmd;
      }
    } else if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const range = conversieMonthRangeContaining(`${monthParam}-01`);
      from = range.startYmd;
      to = range.endYmd;
    } else if (!from || !to) {
      const def = defaultMarketingRange();
      from = from || def.startYmd;
      to = to || def.endYmd;
    }

    if (from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }

    // Cap end at vandaag (Amsterdam) — huidige dag telt mee in spend
    const today = todayConversieYmd();
    if (to > today) to = today;

    const cfg = metaAdsSpendConfigured();
    const sb = getSupabaseAdmin();

    // Peek: oude sync had vaak 1 campagne (lead-only) → forceer account-wide sync
    let syncInfo: { upserted?: number; error?: string; forced?: boolean } | null =
      null;
    if (cfg.ok) {
      const { data: peek } = await sb
        .from("meta_ad_spend")
        .select("campaign_id")
        .eq("level", "campaign")
        .gte("datum", from)
        .lte("datum", to)
        .limit(200);
      const distinct = new Set(
        (peek || [])
          .map((r) => (r.campaign_id as string | null) || "")
          .filter(Boolean)
      );
      const needsFullSync = doSync || distinct.size <= 1;
      // Huidige dag altijd meenemen (Meta Insights live tot vandaag)
      const includesToday = to >= today;
      if (needsFullSync) {
        const synced = await syncMetaAdSpendCampaignDetail({
          since: from,
          until: to,
        });
        syncInfo = {
          upserted: synced.upserted,
          error: synced.error,
          forced: !doSync && distinct.size <= 1,
        };
      } else if (includesToday) {
        const synced = await syncMetaAdSpendCampaignDetail({
          since: today,
          until: today,
        });
        syncInfo = {
          upserted: synced.upserted,
          error: synced.error,
          forced: true,
        };
      }
    }

    const fromIso = fromZonedTime(
      (() => {
        const [y, m, d] = from.split("-").map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
      })(),
      AMSTERDAM_TZ
    ).toISOString();
    const toIso = fromZonedTime(
      (() => {
        const [y, m, d] = to.split("-").map(Number);
        return new Date(y, m - 1, d, 23, 59, 59, 999);
      })(),
      AMSTERDAM_TZ
    ).toISOString();

    const [leadsInRange, offertes, afsprakenRaw, metaSpend, syncRes] =
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
        fetchAllRows<MarketingMetaRow>((fromIdx, toIdx) =>
          sb
            .from("meta_ad_spend")
            .select(
              "datum, level, campaign_id, campaign_name, ad_id, ad_name, spend"
            )
            .in("level", ["campaign", "ad"])
            .gte("datum", from)
            .lte("datum", to)
            .order("datum", { ascending: true })
            .range(fromIdx, toIdx)
        ).catch(() => [] as MarketingMetaRow[]),
        sb
          .from("dashboard_instellingen")
          .select("meta_laatste_sync_at")
          .eq("actief", true)
          .limit(1)
          .maybeSingle(),
      ]);

    const afspraken = afsprakenRaw;

    // Leads buiten created_at-range (deals/afspraken): campagne-key nog ophalen
    const leadIdsNeeded = new Set<string>([
      ...offertes.map((o) => o.lead_id),
      ...afspraken.map((a) => a.lead_id),
    ]);
    const knownLeadIds = new Set(leadsInRange.map((l) => l.id));
    const missingLeadIds = [...leadIdsNeeded].filter(
      (id) => !knownLeadIds.has(id)
    );
    let extraLeads: MarketingLead[] = [];
    if (missingLeadIds.length > 0) {
      // .in() max ~chunks: page in batches of 200
      for (let i = 0; i < missingLeadIds.length; i += 200) {
        const chunk = missingLeadIds.slice(i, i + 200);
        const { data: extra } = await sb
          .from("leads")
          .select(
            "id, created_at, campaign_name, utm_campaign, ad_name, bron, utm_source, lander"
          )
          .in("id", chunk);
        if (extra?.length) {
          extraLeads = extraLeads.concat(extra as MarketingLead[]);
        }
      }
    }

    const leads = [...leadsInRange, ...extraLeads];

    const result = buildMarketingRapportage({
      startYmd: from,
      endYmd: to,
      leads,
      offertes,
      afspraken,
      metaSpend,
      metaConfigured: cfg.ok,
      // TikTok Ads reporting UX klaar; spend-sync volgt tot API-keys live zijn
      tiktokConfigured: false,
      tiktokSpend: 0,
      lastSyncAt:
        (syncRes.data as { meta_laatste_sync_at?: string | null } | null)
          ?.meta_laatste_sync_at || null,
    });

    // Oranje lijn: leads nodig per bucket (week = 7d vooruit, maand = dagen in maand)
    try {
      const { data: advRows } = await sb
        .from("adviseurs")
        .select("id, naam, email, rol, actief, startdatum")
        .eq("actief", true);
      const adviseursCap: CeoPlanbaarAdviseur[] = (advRows || [])
        .filter((a) =>
          isPlanbaarAdviseur({
            naam: a.naam as string,
            email: (a.email as string | null) ?? null,
            actief: a.actief !== false,
            rol: (a.rol as string | null) ?? null,
          })
        )
        .map((a) => ({
          id: a.id as string,
          naam: (a.naam as string) || "Adviseur",
          email: (a.email as string | null) ?? null,
          rol: (a.rol as string | null) ?? null,
          actief: a.actief !== false,
          startdatum: (a.startdatum as string | null) ?? null,
        }));
      const adviseurIds = adviseursCap.map((a) => a.id);
      const jaren = new Set<number>();
      for (const w of result.series) {
        jaren.add(Number(w.startYmd.slice(0, 4)));
        jaren.add(Number(w.endYmd.slice(0, 4)));
      }
      for (const m of result.months) {
        jaren.add(Number(m.startYmd.slice(0, 4)));
        jaren.add(Number(m.endYmd.slice(0, 4)));
      }
      jaren.add(Number(today.slice(0, 4)));
      const unavailableByAdviseur = new Map<string, Set<string>>();
      if (adviseurIds.length > 0 && jaren.size > 0) {
        const { data: unav } = await sb
          .from("adviseur_beschikbaarheid")
          .select("adviseur_id, jaar, week, beschikbaar")
          .in("adviseur_id", adviseurIds)
          .in("jaar", [...jaren])
          .eq("beschikbaar", false);
        for (const row of unav || []) {
          const aid = row.adviseur_id as string;
          const key = weekKeyString(row.jaar as number, row.week as number);
          if (!unavailableByAdviseur.has(aid)) {
            unavailableByAdviseur.set(aid, new Set());
          }
          unavailableByAdviseur.get(aid)!.add(key);
        }
      }

      for (const w of result.series) {
        const asOf = w.startYmd > today ? today : w.startYmd;
        const need = await leadsNeededForForwardHorizon(sb, {
          todayYmd: asOf,
          forwardDays: 7,
          lookbackDays: 7,
          adviseursCap,
          unavailableByAdviseur,
        });
        w.leadsNodig = need.targetLeads;
        // Altijd ÷ 7 (volle week), niet ÷ aantal dagen tot vandaag
        const dailyNeed = Math.ceil(need.targetLeads / 7);
        for (const d of w.days || []) {
          d.leadsNodig = dailyNeed;
        }
      }
      for (const m of result.months) {
        const [y, mo] = m.monthKey.split("-").map(Number);
        const days = getDaysInMonth(new Date(y, mo - 1, 1));
        const asOf = m.startYmd > today ? today : m.startYmd;
        const need = await leadsNeededForForwardHorizon(sb, {
          todayYmd: asOf,
          forwardDays: days,
          lookbackDays: Math.min(14, days),
          adviseursCap,
          unavailableByAdviseur,
        });
        m.leadsNodig = need.targetLeads;
      }

      // Zelfde capaciteitslijn op per-source series/months
      for (const slice of result.bySource || []) {
        for (let i = 0; i < slice.series.length; i++) {
          const overall = result.series[i];
          if (!overall) continue;
          slice.series[i]!.leadsNodig = overall.leadsNodig ?? null;
          const days = slice.series[i]!.days || [];
          const overallDays = overall.days || [];
          for (let d = 0; d < days.length; d++) {
            days[d]!.leadsNodig = overallDays[d]?.leadsNodig ?? null;
          }
        }
        for (const m of slice.months) {
          const overall = result.months.find(
            (x) => x.monthKey === m.monthKey
          );
          m.leadsNodig = overall?.leadsNodig ?? null;
        }
      }
    } catch {
      // Capaciteit optioneel — grafiek blijft werken zonder lijn
    }

    return NextResponse.json({
      ok: true,
      ...result,
      metaMissing: cfg.ok ? [] : cfg.missing,
      sync: syncInfo,
      metaCampaigns: [
        ...new Set(
          metaSpend
            .map((m) => (m.campaign_name || "").trim())
            .filter(Boolean)
        ),
      ],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Marketing laden mislukt") },
      { status: 500 }
    );
  }
}
