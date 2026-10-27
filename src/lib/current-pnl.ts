/**
 * Current P&L op daadwerkelijk betaalde facturen (betaald_op):
 * omzet − inkoop − installatie − salescommissie − commissie ops − ad spend.
 * Commissies obv ingestelde commissie_pct van de verkoper.
 */

import { addDays, addWeeks, format } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findDefaultBackofficeMedewerkerId } from "@/lib/admin-adviseur";
import { factuurIsBetaald } from "@/lib/aanbetaling";
import { AMSTERDAM_TZ } from "@/lib/format";
import { DEFAULT_INSTALLATIE_STANDAARD } from "@/lib/inkoop";
import { hardwareKostenVoorRegels } from "@/lib/project-kosten";
import { commissiePctToFraction } from "@/lib/netto-boord";
import { normalizeProjectStatus } from "@/lib/labels";
import {
  computeOpsCommissieForWindow,
  type OpsCommissieAdviseur,
  type OpsCommissieAfspraak,
  type OpsCommissieBreakdown,
} from "@/lib/ops-commissie";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import {
  linesFromMetrics,
  type PnlMetrics,
  type PnlMonthBucket,
  type PnlWeekBucket,
  type ProjectedPnlRapportage,
} from "@/lib/projected-pnl";

export type {
  PnlMetrics,
  PnlMonthBucket,
  PnlWeekBucket,
} from "@/lib/projected-pnl";

export type CurrentPnlRapportage = ProjectedPnlRapportage;

type KostenRow = {
  datum: string;
  soort: string;
  bedrag: number;
};

type FactuurRow = {
  id: string;
  offerte_id: string | null;
  lead_id: string | null;
  status: string;
  bedrag_ex_btw: number | null;
  betaald_op: string | null;
  factuurdatum: string | null;
  credit_van_factuur_id?: string | null;
};

type OfferteRow = {
  id: string;
  lead_id: string | null;
  subtotaal_ex_btw: number | null;
  leads?:
    | { adviseur_id?: string | null }
    | { adviseur_id?: string | null }[]
    | null;
  offerte_regels?: {
    omschrijving?: string | null;
    aantal?: number | null;
    product_id?: string | null;
  }[];
};

type ProjectRow = {
  offerte_id: string | null;
  status: string | null;
  projectkosten: number | null;
};

type MetaRow = {
  datum: string;
  level: string;
  campaign_id?: string | null;
  spend: number;
};

type Acc = {
  orders: number;
  omzet: number;
  inkoop: number;
  installatie: number;
  sales_commissie: number;
  ops_commissie: number;
  ad_spend: number;
};

function newAcc(): Acc {
  return {
    orders: 0,
    omzet: 0,
    inkoop: 0,
    installatie: 0,
    sales_commissie: 0,
    ops_commissie: 0,
    ad_spend: 0,
  };
}

function addAcc(a: Acc, b: Acc): Acc {
  return {
    orders: a.orders + b.orders,
    omzet: a.omzet + b.omzet,
    inkoop: a.inkoop + b.inkoop,
    installatie: a.installatie + b.installatie,
    sales_commissie: a.sales_commissie + b.sales_commissie,
    ops_commissie: a.ops_commissie + b.ops_commissie,
    ad_spend: a.ad_spend + b.ad_spend,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function finalize(a: Acc): PnlMetrics {
  const omzet = round2(a.omzet);
  const inkoop = round2(a.inkoop);
  const installatie = round2(a.installatie);
  const sales_commissie = round2(a.sales_commissie);
  const ops_commissie = round2(a.ops_commissie);
  const ad_spend = round2(a.ad_spend);
  const totale_kosten = round2(
    inkoop + installatie + sales_commissie + ops_commissie + ad_spend
  );
  const brutowinst = round2(omzet - totale_kosten);
  const marge_pct =
    omzet > 0 ? Math.round((brutowinst / omzet) * 1000) / 10 : null;
  return {
    orders: a.orders,
    omzet,
    inkoop,
    installatie,
    sales_commissie,
    ops_commissie,
    ad_spend,
    totale_kosten,
    brutowinst,
    marge_pct,
  };
}

function metricsToAcc(m: PnlMetrics): Acc {
  return {
    orders: m.orders,
    omzet: m.omzet,
    inkoop: m.inkoop,
    installatie: m.installatie,
    sales_commissie: m.sales_commissie,
    ops_commissie: m.ops_commissie,
    ad_spend: m.ad_spend,
  };
}

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function noonAmsterdamFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
}

function shiftYmd(ymd: string, deltaDays: number): string {
  return ymdAmsterdam(addDays(noonAmsterdamFromYmd(ymd), deltaDays));
}

function ymdFromIso(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
}

function asYmd(value: string | null | undefined): string {
  const s = (value || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  try {
    return ymdFromIso(s);
  } catch {
    return "";
  }
}

function inYmdRange(ymd: string, start: string, end: string): boolean {
  const d = asYmd(ymd);
  return Boolean(d) && d >= start && d <= end;
}

/** Betaaldatum van een factuur (Amsterdam ymd), of null als niet betaald. */
function factuurBetaalYmd(f: FactuurRow): string | null {
  if (f.status === "concept" || f.status === "vervallen") return null;
  if (!factuurIsBetaald(f.status, f.betaald_op)) return null;
  const raw = f.betaald_op || f.factuurdatum;
  if (!raw) return null;
  return asYmd(raw) || null;
}

export function defaultCurrentPnlRange(now = new Date()): {
  startYmd: string;
  endYmd: string;
} {
  const today = ymdAmsterdam(toZonedTime(now, AMSTERDAM_TZ));
  const endInfo = schouwWeekFromDate(noonAmsterdamFromYmd(today));
  const endMonday = String(
    schouwWeekToMondayIso(endInfo.jaar, endInfo.week)
  ).slice(0, 10);
  const startMonday = ymdAmsterdam(
    addWeeks(noonAmsterdamFromYmd(endMonday), -11)
  );
  return { startYmd: startMonday, endYmd: today };
}

function listWeekWindows(
  startYmd: string,
  endYmd: string
): { weekKey: string; label: string; startYmd: string; endYmd: string }[] {
  const out: {
    weekKey: string;
    label: string;
    startYmd: string;
    endYmd: string;
  }[] = [];
  let cursor = startYmd;
  const endInfo = schouwWeekFromDate(noonAmsterdamFromYmd(endYmd));
  const lastKey = schouwWeekValue(endInfo.jaar, endInfo.week);
  for (let i = 0; i < 60; i++) {
    const info = schouwWeekFromDate(noonAmsterdamFromYmd(cursor));
    const weekKey = schouwWeekValue(info.jaar, info.week);
    const mon = String(schouwWeekToMondayIso(info.jaar, info.week)).slice(
      0,
      10
    );
    const sun = shiftYmd(mon, 6);
    out.push({
      weekKey,
      label: formatSchouwWeekLabel(info.jaar, info.week),
      startYmd: mon,
      endYmd: sun > endYmd ? endYmd : sun,
    });
    if (weekKey === lastKey) break;
    cursor = shiftYmd(mon, 7);
  }
  return out;
}

function monthKeyFromYmd(ymd: string): string {
  return ymd.slice(0, 7);
}

function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = fromZonedTime(new Date(y, m - 1, 1, 12, 0, 0), AMSTERDAM_TZ);
  return formatInTimeZone(d, AMSTERDAM_TZ, "MMMM yyyy", { locale: nl });
}

export async function buildCurrentPnl(
  sb: SupabaseClient,
  startYmd: string,
  endYmd: string
): Promise<CurrentPnlRapportage> {
  const fromIso = fromZonedTime(
    (() => {
      const [y, m, d] = startYmd.split("-").map(Number);
      return new Date(y, m - 1, d, 0, 0, 0, 0);
    })(),
    AMSTERDAM_TZ
  ).toISOString();
  const toIso = fromZonedTime(
    (() => {
      const [y, m, d] = endYmd.split("-").map(Number);
      return new Date(y, m - 1, d, 23, 59, 59, 999);
    })(),
    AMSTERDAM_TZ
  ).toISOString();

  const [
    facturenRaw,
    projects,
    metaSpendRaw,
    kostenRaw,
    adviseursRes,
    instRes,
    afsprakenRaw,
  ] = await Promise.all([
      // Breed ophalen op factuurdatum/betaald_op-prefix; exacte betaal-ymd filteren we in JS
      fetchAllRows<FactuurRow>((fromIdx, toIdx) =>
        sb
          .from("facturen")
          .select(
            "id, offerte_id, lead_id, status, bedrag_ex_btw, betaald_op, factuurdatum, credit_van_factuur_id"
          )
          .neq("status", "concept")
          .neq("status", "vervallen")
          .or(
            `betaald_op.gte.${startYmd},factuurdatum.gte.${startYmd}`
          )
          .order("factuurdatum", { ascending: true })
          .range(fromIdx, toIdx)
      ),
      fetchAllRows<ProjectRow>((fromIdx, toIdx) =>
        sb
          .from("projecten")
          .select("offerte_id, status, projectkosten")
          .not("offerte_id", "is", null)
          .range(fromIdx, toIdx)
      ),
      fetchAllRows<MetaRow>((fromIdx, toIdx) =>
        sb
          .from("meta_ad_spend")
          .select("datum, level, campaign_id, spend")
          .gte("datum", startYmd)
          .lte("datum", endYmd)
          .order("datum", { ascending: true })
          .range(fromIdx, toIdx)
      ).catch(() => [] as MetaRow[]),
      fetchAllRows<KostenRow>((fromIdx, toIdx) =>
        sb
          .from("rapportage_kosten")
          .select("datum, soort, bedrag")
          .eq("soort", "ad_spend")
          .gte("datum", startYmd)
          .lte("datum", endYmd)
          .order("datum", { ascending: true })
          .range(fromIdx, toIdx)
      ).catch(() => [] as KostenRow[]),
      sb
        .from("adviseurs")
        .select("id, naam, email, rol, actief, commissie_pct"),
      sb
        .from("dashboard_instellingen")
        .select("standaard_installatie")
        .eq("actief", true)
        .limit(1)
        .maybeSingle(),
      fetchAllRows<OpsCommissieAfspraak>((fromIdx, toIdx) =>
        sb
          .from("afspraken")
          .select(
            "id, lead_id, created_at, status, soort, ingepland_door_id"
          )
          .eq("soort", "nieuw")
          .gte("created_at", fromIso)
          .lte("created_at", toIso)
          .order("created_at", { ascending: true })
          .range(fromIdx, toIdx)
      ).catch(() => [] as OpsCommissieAfspraak[]),
    ]);

  const facturen = facturenRaw.filter((f) => {
    const ymd = factuurBetaalYmd(f);
    return ymd != null && inYmdRange(ymd, startYmd, endYmd);
  });

  const offerteIds = [
    ...new Set(
      facturen
        .map((f) => (f.offerte_id || "").trim())
        .filter(Boolean)
    ),
  ];

  let offertes: OfferteRow[] = [];
  if (offerteIds.length > 0) {
    // Chunk in case of large IN lists
    const chunkSize = 200;
    for (let i = 0; i < offerteIds.length; i += chunkSize) {
      const chunk = offerteIds.slice(i, i + chunkSize);
      const rows = await fetchAllRows<OfferteRow>((fromIdx, toIdx) =>
        sb
          .from("offertes")
          .select(
            "id, lead_id, subtotaal_ex_btw, leads(adviseur_id), offerte_regels(omschrijving, aantal, product_id)"
          )
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(fromIdx, toIdx)
      ).catch(() => [] as OfferteRow[]);
      offertes = offertes.concat(rows);
    }
  }

  const offerteById = new Map(offertes.map((o) => [o.id, o]));

  const metaCampaigns = metaSpendRaw.filter((m) => m.level === "campaign");
  const metaAccount = metaSpendRaw.filter((m) => m.level === "account");
  const metaCampTotal = metaCampaigns.reduce(
    (s, m) => s + (Number(m.spend) || 0),
    0
  );
  const metaAccountTotal = metaAccount.reduce(
    (s, m) => s + (Number(m.spend) || 0),
    0
  );
  const metaSpend =
    metaCampTotal > 0
      ? metaCampaigns
      : metaAccountTotal > 0
        ? metaAccount
        : metaCampaigns;

  const standaardInstallatie =
    Number(
      (instRes.data as { standaard_installatie?: number | null } | null)
        ?.standaard_installatie
    ) || DEFAULT_INSTALLATIE_STANDAARD;

  const commissieMap = new Map<string, number>();
  const opsAdviseurs: OpsCommissieAdviseur[] = [];
  const adviseursForTarik: {
    id: string;
    naam: string;
    email: string | null;
    actief: boolean;
  }[] = [];
  for (const a of adviseursRes.data || []) {
    const row = a as {
      id: string;
      naam?: string | null;
      email?: string | null;
      rol?: string | null;
      actief?: boolean | null;
      commissie_pct?: number | null;
    };
    const naam = row.naam?.trim() || "Medewerker";
    commissieMap.set(row.id, commissiePctToFraction(row.commissie_pct));
    opsAdviseurs.push({
      id: row.id,
      naam,
      rol: row.rol ?? null,
      actief: row.actief ?? null,
    });
    adviseursForTarik.push({
      id: row.id,
      naam,
      email: row.email ?? null,
      actief: row.actief !== false,
    });
  }
  const tarikId = findDefaultBackofficeMedewerkerId(adviseursForTarik);
  const tarikNaam =
    opsAdviseurs.find((a) => a.id === tarikId)?.naam || "Tarik";
  const afspraken = afsprakenRaw as OpsCommissieAfspraak[];
  const opsDetailByWeek = new Map<string, OpsCommissieBreakdown>();

  const geannuleerdOfferteIds = new Set<string>();
  const projectByOfferte = new Map<string, ProjectRow>();
  for (const p of projects) {
    if (!p.offerte_id) continue;
    projectByOfferte.set(p.offerte_id, p);
    if (normalizeProjectStatus(p.status) === "annulering") {
      geannuleerdOfferteIds.add(p.offerte_id);
    }
  }

  const weeks = listWeekWindows(startYmd, endYmd);
  const weekAcc = new Map<string, Acc>();
  const monthAcc = new Map<string, Acc>();
  for (const w of weeks) weekAcc.set(w.weekKey, newAcc());

  function weekKeyForYmd(ymd: string): string | null {
    if (!inYmdRange(ymd, startYmd, endYmd)) return null;
    const info = schouwWeekFromDate(noonAmsterdamFromYmd(ymd));
    return schouwWeekValue(info.jaar, info.week);
  }

  function touch(ymd: string): Acc | null {
    const wk = weekKeyForYmd(ymd);
    if (!wk || !weekAcc.has(wk)) return null;
    const mk = monthKeyFromYmd(ymd);
    if (!monthAcc.has(mk)) monthAcc.set(mk, newAcc());
    return weekAcc.get(wk)!;
  }

  for (const f of facturen) {
    const ymd = factuurBetaalYmd(f);
    if (!ymd) continue;
    const wa = touch(ymd);
    if (!wa) continue;
    const mk = monthKeyFromYmd(ymd);
    const ma = monthAcc.get(mk)!;

    const paid = Number(f.bedrag_ex_btw) || 0;
    const isCredit = Boolean(f.credit_van_factuur_id);
    const oid = (f.offerte_id || "").trim();
    const offerte = oid ? offerteById.get(oid) : undefined;

    // Annuleringen: omzet nog meetellen (restitutie via credit), geen COGS-toekenning
    const geannuleerd = oid ? geannuleerdOfferteIds.has(oid) : false;

    const orderOmzet = Number(offerte?.subtotaal_ex_btw) || 0;
    const fullInkoop = offerte
      ? hardwareKostenVoorRegels(offerte.offerte_regels || []).totaal
      : 0;
    const proj = oid ? projectByOfferte.get(oid) : undefined;
    const fullInstallatie =
      proj && Number(proj.projectkosten) > 0
        ? Number(proj.projectkosten)
        : standaardInstallatie;

    // Pro-rata COGS obv betaald aandeel van de order (credits = negatief)
    const share =
      !geannuleerd && orderOmzet > 0 ? paid / orderOmzet : paid !== 0 ? 1 : 0;
    const inkoop = geannuleerd ? 0 : fullInkoop * share;
    const installatie = geannuleerd ? 0 : fullInstallatie * share;

    const leadJoin = Array.isArray(offerte?.leads)
      ? offerte?.leads[0]
      : offerte?.leads;
    const aid = (leadJoin?.adviseur_id || "").trim() || null;
    const frac = aid
      ? commissieMap.get(aid) ?? commissiePctToFraction(null)
      : commissiePctToFraction(null);
    // Commissie over betaalde omzet × verkoper-%
    const commissie = paid * frac;

    if (!isCredit) {
      wa.orders += 1;
      ma.orders += 1;
    }

    wa.omzet += paid;
    wa.inkoop += inkoop;
    wa.installatie += installatie;
    wa.sales_commissie += commissie;
    ma.omzet += paid;
    ma.inkoop += inkoop;
    ma.installatie += installatie;
    ma.sales_commissie += commissie;
  }

  let metaApplied = 0;
  for (const m of metaSpend) {
    const datum = asYmd(m.datum);
    if (!inYmdRange(datum, startYmd, endYmd)) continue;
    const wa = touch(datum);
    if (!wa) continue;
    const mk = monthKeyFromYmd(datum);
    const ma = monthAcc.get(mk)!;
    const spend = Number(m.spend) || 0;
    wa.ad_spend += spend;
    ma.ad_spend += spend;
    metaApplied += spend;
  }

  if (metaApplied <= 0) {
    for (const k of kostenRaw) {
      if (k.soort !== "ad_spend") continue;
      const datum = asYmd(k.datum);
      if (!inYmdRange(datum, startYmd, endYmd)) continue;
      const wa = touch(datum);
      if (!wa) continue;
      const mk = monthKeyFromYmd(datum);
      const ma = monthAcc.get(mk)!;
      const spend = Number(k.bedrag) || 0;
      wa.ad_spend += spend;
      ma.ad_spend += spend;
    }
  }

  // Commissie ops per schouwweek (bellers + Tarik vast/bonus)
  for (const w of weeks) {
    const detail = computeOpsCommissieForWindow({
      afspraken,
      historie: afspraken,
      adviseurs: opsAdviseurs,
      startYmd: w.startYmd,
      endYmd: w.endYmd,
      tarikId,
      tarikNaam,
      includeVast: true,
    });
    opsDetailByWeek.set(w.weekKey, detail);
    const wa = weekAcc.get(w.weekKey);
    if (wa) wa.ops_commissie += detail.totaal;
    const mk = monthKeyFromYmd(w.startYmd);
    if (!monthAcc.has(mk)) monthAcc.set(mk, newAcc());
    monthAcc.get(mk)!.ops_commissie += detail.totaal;
  }

  const series: PnlWeekBucket[] = weeks.map((w) => {
    const opsDetail = opsDetailByWeek.get(w.weekKey) || null;
    const m = finalize(weekAcc.get(w.weekKey) || newAcc());
    return {
      weekKey: w.weekKey,
      label: w.label,
      startYmd: w.startYmd,
      endYmd: w.endYmd,
      ...m,
      opsDetail,
      lines: linesFromMetrics(m, opsDetail),
    };
  });

  const monthKeys = [
    ...new Set([
      ...monthAcc.keys(),
      ...series.map((w) => monthKeyFromYmd(w.startYmd)),
    ]),
  ].sort((a, b) => b.localeCompare(a));

  const months: PnlMonthBucket[] = monthKeys
    .map((monthKey) => {
      const [y, mo] = monthKey.split("-").map(Number);
      const monthStart = `${monthKey}-01`;
      const lastDay = new Date(y, mo, 0).getDate();
      const monthEnd = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
      const weekList = series
        .filter((w) => w.startYmd <= monthEnd && w.endYmd >= monthStart)
        .sort((a, b) => b.startYmd.localeCompare(a.startYmd));
      const sum = finalize(monthAcc.get(monthKey) || newAcc());
      return {
        monthKey,
        label: monthLabel(monthKey),
        startYmd: monthStart < startYmd ? startYmd : monthStart,
        endYmd: monthEnd > endYmd ? endYmd : monthEnd,
        ...sum,
        weeks: weekList,
      };
    })
    .filter(
      (m) =>
        m.orders > 0 ||
        m.omzet > 0 ||
        m.ad_spend > 0 ||
        m.ops_commissie > 0 ||
        m.weeks.some(
          (w) =>
            w.orders > 0 ||
            w.omzet > 0 ||
            w.ad_spend > 0 ||
            w.ops_commissie > 0
        )
    );

  const totals = finalize(
    series.reduce((s, w) => addAcc(s, metricsToAcc(w)), newAcc())
  );

  const periodLabel =
    startYmd === endYmd
      ? startYmd
      : `${format(noonAmsterdamFromYmd(startYmd), "d MMM", { locale: nl })} – ${format(noonAmsterdamFromYmd(endYmd), "d MMM yyyy", { locale: nl })}`;

  return {
    startYmd,
    endYmd,
    periodLabel,
    totals,
    series,
    months,
  };
}
