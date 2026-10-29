/**
 * Maandelijkse adviseur-leaderboard (kalendermaand).
 * Ranking: sales → aanbetalingen → conversie → gelopen.
 */

import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  factuurIsBetaald,
  isAanbetalingFactuurOmschrijving,
} from "@/lib/aanbetaling";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  conversieMonthRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import { buildSalesRapportage } from "@/lib/sales-rapportage";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

export type MaandLeaderboardRow = {
  rank: number;
  adviseur_id: string;
  naam: string;
  sales: number;
  aanbetalingen: number;
  gelopen: number;
  ingepland: number;
  /** sales / gelopen */
  conversie_pct: number | null;
};

export type MaandLeaderboard = {
  monthKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  rows: MaandLeaderboardRow[];
};

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function noonAmsterdamFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = fromZonedTime(new Date(y, m - 1, 1, 12, 0, 0), AMSTERDAM_TZ);
  return formatInTimeZone(d, AMSTERDAM_TZ, "MMMM yyyy", { locale: nl });
}

function pct(num: number, den: number): number | null {
  if (den <= 0) return null;
  return Math.round((num / den) * 1000) / 10;
}

function rangeIso(startYmd: string, endYmd: string): {
  fromIso: string;
  toIso: string;
} {
  return {
    fromIso: noonAmsterdamFromYmd(startYmd).toISOString(),
    toIso: fromZonedTime(
      (() => {
        const [y, m, d] = endYmd.split("-").map(Number);
        return new Date(y, m - 1, d, 23, 59, 59, 999);
      })(),
      AMSTERDAM_TZ
    ).toISOString(),
  };
}

async function loadAanbetalingenByAdviseur(
  sb: SupabaseClient,
  startYmd: string,
  endYmd: string
): Promise<Map<string, number>> {
  const { fromIso, toIso } = rangeIso(startYmd, endYmd);
  const facturen = await fetchAllRows<{
    id: string;
    status: string;
    betaald_op: string | null;
    omschrijving: string | null;
    credit_van_factuur_id: string | null;
    lead_id: string | null;
    leads?:
      | { adviseur_id?: string | null }
      | { adviseur_id?: string | null }[]
      | null;
  }>((fromIdx, toIdx) =>
    sb
      .from("facturen")
      .select(
        "id, status, betaald_op, omschrijving, credit_van_factuur_id, lead_id, leads(adviseur_id)"
      )
      .not("betaald_op", "is", null)
      .gte("betaald_op", fromIso)
      .lte("betaald_op", toIso)
      .is("credit_van_factuur_id", null)
      .order("betaald_op", { ascending: true })
      .range(fromIdx, toIdx)
  );

  const counts = new Map<string, number>();
  for (const f of facturen) {
    if (!factuurIsBetaald(f.status, f.betaald_op)) continue;
    if (!isAanbetalingFactuurOmschrijving(f.omschrijving)) continue;
    const lead = Array.isArray(f.leads) ? f.leads[0] : f.leads;
    const aid = lead?.adviseur_id?.trim();
    if (!aid) continue;
    counts.set(aid, (counts.get(aid) || 0) + 1);
  }
  return counts;
}

/**
 * Leaderboard voor kalendermaand (default: huidige maand t/m vandaag).
 */
export async function buildMaandLeaderboard(
  sb: SupabaseClient,
  opts?: { monthKey?: string; now?: Date }
): Promise<MaandLeaderboard> {
  const now = opts?.now ?? new Date();
  const today = todayConversieYmd();
  const monthKey =
    opts?.monthKey && /^\d{4}-\d{2}$/.test(opts.monthKey)
      ? opts.monthKey
      : ymdAmsterdam(toZonedTime(now, AMSTERDAM_TZ)).slice(0, 7);

  const range = conversieMonthRangeContaining(`${monthKey}-01`);
  const startYmd = range.startYmd;
  let endYmd = range.endYmd;
  if (endYmd > today) endYmd = today;

  const [rapportage, aanbetalingen, adviseurs] = await Promise.all([
    buildSalesRapportage(sb, startYmd, endYmd),
    loadAanbetalingenByAdviseur(sb, startYmd, endYmd),
    sb
      .from("adviseurs")
      .select("id, naam, actief, rol, email")
      .then((r) => r.data || []),
  ]);

  type Acc = {
    sales: number;
    gelopen: number;
    ingepland: number;
    naam: string;
  };
  const byId = new Map<string, Acc>();

  for (const a of adviseurs) {
    if (!isPlanbaarAdviseur(a)) continue;
    byId.set(a.id, {
      sales: 0,
      gelopen: 0,
      ingepland: 0,
      naam: a.naam || "Onbekend",
    });
  }

  for (const week of rapportage.series) {
    for (const row of week.adviseurs) {
      if (row.key === "__onbekend__") continue;
      const cur = byId.get(row.key) || {
        sales: 0,
        gelopen: 0,
        ingepland: 0,
        naam: row.label,
      };
      cur.sales += row.sales;
      cur.gelopen += row.gelopen;
      cur.ingepland += row.ingepland;
      if (!byId.has(row.key)) byId.set(row.key, cur);
      else {
        cur.naam = byId.get(row.key)!.naam || row.label;
        byId.set(row.key, cur);
      }
    }
  }

  const rows: MaandLeaderboardRow[] = [...byId.entries()]
    .map(([adviseur_id, a]) => {
      const aanbetalingenCount = aanbetalingen.get(adviseur_id) || 0;
      return {
        rank: 0,
        adviseur_id,
        naam: a.naam,
        sales: a.sales,
        aanbetalingen: aanbetalingenCount,
        gelopen: a.gelopen,
        ingepland: a.ingepland,
        conversie_pct: pct(a.sales, a.gelopen),
      };
    })
    .filter(
      (r) =>
        r.sales > 0 ||
        r.aanbetalingen > 0 ||
        r.gelopen > 0 ||
        r.ingepland > 0
    )
    .sort(
      (a, b) =>
        b.sales - a.sales ||
        b.aanbetalingen - a.aanbetalingen ||
        (b.conversie_pct ?? 0) - (a.conversie_pct ?? 0) ||
        b.gelopen - a.gelopen ||
        a.naam.localeCompare(b.naam, "nl")
    )
    .map((r, i) => ({ ...r, rank: i + 1 }));

  return {
    monthKey,
    label: monthLabel(monthKey),
    startYmd,
    endYmd,
    rows,
  };
}
