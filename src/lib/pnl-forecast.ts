/**
 * Forecast voor de volgende kalendermaand op de projected P&L.
 * Driver = open agenda-slots. Leads, orders en omzet volgen de
 * ingestelde adviseur-doelen. Kosten volgen de recente order-mix
 * (inkoop, installatie, ads) en de commissieregels.
 */

import { getISOWeekYear } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseAdminTargetsStore, resolvePersonTargets } from "@/lib/admin-targets";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  loadAfblokkingen,
  loadSlotVrijgaven,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import { countPlanbareSlotsBreakdown } from "@/lib/dashboard-v2/capacity";
import { AMSTERDAM_TZ } from "@/lib/format";
import { DEFAULT_INSTALLATIE_STANDAARD } from "@/lib/inkoop";
import { commissiePctToFraction } from "@/lib/netto-boord";
import { EDERGY_PER_AANVRAAG_INC } from "@/lib/edergy-tarief";
import { normalizeProjectStatus } from "@/lib/labels";
import {
  BELLER_PER_INGEPLANDE_AFSPRAAK,
  OPS_MANAGER_FIXED_PER_WEEK,
  OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK,
} from "@/lib/ops-commissie";
import { hardwareKostenVoorRegels } from "@/lib/project-kosten";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import type { PnlMetrics } from "@/lib/projected-pnl";

export type PnlForecastWeek = PnlMetrics & {
  weekKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  /** Leads die nog binnen moeten om de vrije slots te vullen. */
  leads: number;
  /** Open (planbare) slots in dit weekdeel. */
  slots: number;
  /** Daarvan nog leeg. */
  slotsVrij: number;
};

export type PnlForecast = {
  monthKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  /** Standaard lead→afspraak % uit de doelen. */
  leadToApptPct: number;
  /** Standaard afspraak→sale % uit de doelen. */
  afspraakToSalePct: number;
  /** Standaard gem. orderwaarde excl. btw. */
  gemOrderwaarde: number;
  /** Inkoop als % van omzet, uit recente orders. */
  inkoopPct: number;
  installatiePerOrder: number;
  /** Ad spend per lead, uit de laatste 90 dagen. */
  cpl: number;
  leads: number;
  slots: number;
  slotsVrij: number;
  weeks: PnlForecastWeek[];
  totals: PnlMetrics;
};

type AdviseurRow = {
  id: string;
  naam: string;
  email: string | null;
  rol: string | null;
  actief: boolean;
  startdatum: string | null;
  commissie_pct: number | null;
};

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function noon(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function finalize(a: {
  orders: number;
  omzet: number;
  inkoop: number;
  installatie: number;
  sales_commissie: number;
  ops_commissie: number;
  ad_spend: number;
  edergy: number;
}): PnlMetrics {
  const omzet = round2(a.omzet);
  const inkoop = round2(a.inkoop);
  const installatie = round2(a.installatie);
  const sales_commissie = round2(a.sales_commissie);
  const ops_commissie = round2(a.ops_commissie);
  const ad_spend = round2(a.ad_spend);
  const edergy = round2(a.edergy);
  const totale_kosten = round2(
    inkoop + installatie + sales_commissie + ops_commissie + ad_spend + edergy
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
    edergy,
    totale_kosten,
    brutowinst,
    marge_pct,
  };
}

function emptyAcc() {
  return {
    orders: 0,
    omzet: 0,
    inkoop: 0,
    installatie: 0,
    sales_commissie: 0,
    ops_commissie: 0,
    ad_spend: 0,
    edergy: 0,
  };
}

function nextMonthRange(now: Date): {
  monthKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
} {
  const z = toZonedTime(now, AMSTERDAM_TZ);
  const y = z.getMonth() === 11 ? z.getFullYear() + 1 : z.getFullYear();
  const m = (z.getMonth() + 1) % 12;
  const monthKey = `${y}-${String(m + 1).padStart(2, "0")}`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const startYmd = `${monthKey}-01`;
  const endYmd = `${monthKey}-${String(lastDay).padStart(2, "0")}`;
  const label = formatInTimeZone(noon(startYmd), AMSTERDAM_TZ, "MMMM yyyy", {
    locale: nl,
  });
  return { monthKey, label, startYmd, endYmd };
}

function weekSlices(
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
  for (let i = 0; i < 8; i++) {
    const info = schouwWeekFromDate(noon(cursor));
    const weekKey = schouwWeekValue(info.jaar, info.week);
    const mon = String(schouwWeekToMondayIso(info.jaar, info.week)).slice(0, 10);
    const sunDate = noon(mon);
    sunDate.setTime(sunDate.getTime() + 6 * 86_400_000);
    const sun = ymdAmsterdam(sunDate);
    const sliceStart = mon < startYmd ? startYmd : mon;
    const sliceEnd = sun > endYmd ? endYmd : sun;
    if (weekdaysInSlice(sliceStart, sliceEnd) > 0) {
      const base = formatSchouwWeekLabel(info.jaar, info.week);
      const partial = sliceStart !== mon || sliceEnd !== sun;
      const dag = formatInTimeZone(noon(sliceStart), AMSTERDAM_TZ, "d MMM", {
        locale: nl,
      });
      const dagEnd = formatInTimeZone(noon(sliceEnd), AMSTERDAM_TZ, "d MMM", {
        locale: nl,
      });
      out.push({
        weekKey,
        label: partial
          ? `${base} · ${sliceStart === sliceEnd ? dag : `${dag} – ${dagEnd}`}`
          : base,
        startYmd: sliceStart,
        endYmd: sliceEnd,
      });
    }
    if (sliceEnd >= endYmd) break;
    cursor = ymdAmsterdam(new Date(noon(mon).getTime() + 7 * 86_400_000));
  }
  return out;
}

function weekdaysInSlice(startYmd: string, endYmd: string): number {
  let n = 0;
  let cursor = startYmd;
  for (let i = 0; i < 8 && cursor <= endYmd; i++) {
    const dow = toZonedTime(noon(cursor), AMSTERDAM_TZ).getDay();
    if (dow >= 1 && dow <= 5) n += 1;
    const next = new Date(noon(cursor).getTime() + 86_400_000);
    cursor = ymdAmsterdam(next);
  }
  return n;
}

function ymdOf(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
}

export async function buildPnlMonthForecast(
  sb: SupabaseClient,
  now: Date = new Date()
): Promise<PnlForecast> {
  const month = nextMonthRange(now);
  const weeks = weekSlices(month.startYmd, month.endYmd);
  const lookbackEnd = ymdAmsterdam(now);
  const lookbackStart = ymdAmsterdam(
    new Date(now.getTime() - 90 * 86_400_000)
  );

  const yStart = getISOWeekYear(toZonedTime(noon(month.startYmd), AMSTERDAM_TZ));
  const yEnd = getISOWeekYear(toZonedTime(noon(month.endYmd), AMSTERDAM_TZ));
  const jaren = [...new Set([yStart - 1, yStart, yEnd, yEnd + 1])];

  const fromIso = noon(month.startYmd).toISOString();
  const toIso = (() => {
    const [y, m, d] = month.endYmd.split("-").map(Number);
    return fromZonedTime(
      new Date(y, m - 1, d, 23, 59, 59),
      AMSTERDAM_TZ
    ).toISOString();
  })();
  const histFrom = (() => {
    const [y, m, d] = lookbackStart.split("-").map(Number);
    return fromZonedTime(new Date(y, m - 1, d, 0, 0, 0), AMSTERDAM_TZ).toISOString();
  })();
  const histTo = (() => {
    const [y, m, d] = lookbackEnd.split("-").map(Number);
    return fromZonedTime(
      new Date(y, m - 1, d, 23, 59, 59),
      AMSTERDAM_TZ
    ).toISOString();
  })();

  const [adviseursRes, doelenRes, afspraken, offertes, projects, leadsHist, metaRaw] =
    await Promise.all([
      sb
        .from("adviseurs")
        .select("id, naam, email, rol, actief, startdatum, commissie_pct")
        .eq("actief", true),
      sb
        .from("dashboard_instellingen")
        .select("dashboard_v2_doelen, standaard_installatie")
        .eq("actief", true)
        .limit(1)
        .maybeSingle(),
      fetchAllRows<{
        adviseur_id: string | null;
        start_at: string;
        status: string | null;
        soort: string | null;
      }>((from, to) =>
        sb
          .from("afspraken")
          .select("adviseur_id, start_at, status, soort")
          .gte("start_at", fromIso)
          .lte("start_at", toIso)
          .neq("status", "geannuleerd")
          .order("start_at", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<{
        id: string;
        subtotaal_ex_btw: number | null;
        offerte_regels?: { omschrijving?: string | null; aantal?: number | null }[];
      }>((from, to) =>
        sb
          .from("offertes")
          .select(
            "id, subtotaal_ex_btw, offerte_regels(omschrijving, aantal)"
          )
          .eq("status", "ondertekend")
          .not("ondertekend_op", "is", null)
          .gte("ondertekend_op", histFrom)
          .lte("ondertekend_op", histTo)
          .order("ondertekend_op", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<{
        offerte_id: string | null;
        status: string | null;
        projectkosten: number | null;
        betaalwijze?: string | null;
        financiering_status?: string | null;
      }>((from, to) =>
        sb
          .from("projecten")
          .select(
            "offerte_id, status, projectkosten, betaalwijze, financiering_status"
          )
          .not("offerte_id", "is", null)
          .range(from, to)
      ),
      sb
        .from("leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", histFrom)
        .lte("created_at", histTo),
      fetchAllRows<{ level: string; spend: number }>((from, to) =>
        sb
          .from("meta_ad_spend")
          .select("level, spend")
          .gte("datum", lookbackStart)
          .lte("datum", lookbackEnd)
          .in("level", ["campaign", "account"])
          .range(from, to)
      ).catch(() => [] as { level: string; spend: number }[]),
    ]);

  const adviseurs: AdviseurRow[] = (adviseursRes.data || [])
    .map((a) => ({
      id: a.id as string,
      naam: (a.naam as string) || "Adviseur",
      email: (a.email as string | null) ?? null,
      rol: (a.rol as string | null) ?? null,
      actief: a.actief !== false,
      startdatum: (a.startdatum as string | null) ?? null,
      commissie_pct: (a.commissie_pct as number | null) ?? null,
    }))
    .filter((a) => isPlanbaarAdviseur(a));

  const store = parseAdminTargetsStore(
    (doelenRes.data as { dashboard_v2_doelen?: unknown } | null)
      ?.dashboard_v2_doelen
  );
  const rateBase = store.defaults.adviseur;
  const standaardInstallatie =
    Number(
      (doelenRes.data as { standaard_installatie?: number | null } | null)
        ?.standaard_installatie
    ) || DEFAULT_INSTALLATIE_STANDAARD;

  const skipOfferte = new Set<string>();
  const projectByOfferte = new Map<
    string,
    {
      projectkosten: number | null;
      betaalwijze?: string | null;
      financiering_status?: string | null;
    }
  >();
  for (const p of projects) {
    if (!p.offerte_id) continue;
    projectByOfferte.set(p.offerte_id, p);
    const status = normalizeProjectStatus(p.status);
    if (status === "annulering" || status === "hold_sales_actie") {
      skipOfferte.add(p.offerte_id);
    }
  }

  let histOmzet = 0;
  let histInkoop = 0;
  let histInstallatie = 0;
  let histOrders = 0;
  let histWarmtefonds = 0;
  for (const o of offertes) {
    if (skipOfferte.has(o.id)) continue;
    const omzet = Number(o.subtotaal_ex_btw) || 0;
    if (omzet <= 0) continue;
    histOrders += 1;
    const proj = projectByOfferte.get(o.id);
    if (
      proj?.betaalwijze === "warmtefonds" ||
      Boolean((proj?.financiering_status || "").trim())
    ) {
      histWarmtefonds += 1;
    }
    histOmzet += omzet;
    histInkoop += hardwareKostenVoorRegels(o.offerte_regels || []).totaal;
    histInstallatie +=
      proj && Number(proj.projectkosten) > 0
        ? Number(proj.projectkosten)
        : standaardInstallatie;
  }
  const inkoopRatio = histOmzet > 0 ? histInkoop / histOmzet : 0;
  const installatiePerOrder =
    histOrders > 0 ? histInstallatie / histOrders : standaardInstallatie;
  const warmtefondsAandeel =
    histOrders > 0 ? histWarmtefonds / histOrders : 0;

  const campSpend = metaRaw
    .filter((r) => r.level === "campaign")
    .reduce((s, r) => s + (Number(r.spend) || 0), 0);
  const accountSpend = metaRaw
    .filter((r) => r.level === "account")
    .reduce((s, r) => s + (Number(r.spend) || 0), 0);
  const adSpend = campSpend > 0 ? campSpend : accountSpend;
  const histLeads = leadsHist.count || 0;
  const cpl = histLeads > 0 ? adSpend / histLeads : 0;

  const ids = adviseurs.map((a) => a.id);
  const [unavailable, afblokkingen, vrijgaven] = await Promise.all([
    loadUnavailable(sb, ids, jaren),
    loadAfblokkingen(sb, {
      adviseurIds: ids,
      van: month.startYmd,
      tot: month.endYmd,
    }),
    loadSlotVrijgaven(sb, {
      adviseurIds: ids,
      van: month.startYmd,
      tot: month.endYmd,
    }),
  ]);

  const planned = new Map<string, number>();
  for (const a of afspraken) {
    if ((a.soort || "").trim() !== "nieuw") continue;
    if (!a.adviseur_id || !a.start_at) continue;
    const ymd = ymdOf(a.start_at);
    const info = schouwWeekFromDate(noon(ymd));
    const key = `${a.adviseur_id}:${schouwWeekValue(info.jaar, info.week)}`;
    planned.set(key, (planned.get(key) || 0) + 1);
  }

  const built: PnlForecastWeek[] = weeks.map((w) => {
    const slotsBreak = countPlanbareSlotsBreakdown({
      startYmd: w.startYmd,
      endYmd: w.endYmd,
      adviseurs,
      unavailableByAdviseur: unavailable,
      afblokkingen,
      vrijgaven,
    });
    const openById = new Map(
      slotsBreak.perAdviseur.map((row) => [row.id, row.open])
    );
    const acc = emptyAcc();
    let leads = 0;
    let slots = 0;
    let slotsVrij = 0;
    for (const adv of adviseurs) {
      const open = openById.get(adv.id) || 0;
      if (open <= 0) continue;
      const booked = Math.min(open, planned.get(`${adv.id}:${w.weekKey}`) || 0);
      const vrij = Math.max(0, open - booked);
      const targets = resolvePersonTargets(store, "adviseur", adv.id).effective;
      const l2a = Math.max(0, Math.min(100, targets.leadToAppt));
      const close = Math.max(0, Math.min(100, targets.afspraakToSale));
      const aov =
        targets.gemOrderwaarde > 0
          ? targets.gemOrderwaarde
          : histOrders > 0
            ? histOmzet / histOrders
            : 0;
      const advLeads = l2a > 0 ? Math.ceil((vrij * 100) / l2a) : 0;
      const advOrders = Math.round((open * close) / 100);
      const advOmzet = advOrders * aov;
      leads += advLeads;
      slots += open;
      slotsVrij += vrij;
      acc.orders += advOrders;
      acc.omzet += advOmzet;
      acc.installatie += advOrders * installatiePerOrder;
      acc.sales_commissie +=
        advOmzet * commissiePctToFraction(adv.commissie_pct);
    }
    acc.inkoop = acc.omzet * inkoopRatio;
    acc.ad_spend = leads * cpl;
    acc.edergy = acc.orders * warmtefondsAandeel * EDERGY_PER_AANVRAAG_INC;
    // Nog te vullen slots plant Sharath in: €10 voor hem, €2,50 bonus voor Tarik.
    acc.ops_commissie +=
      slotsVrij *
      (BELLER_PER_INGEPLANDE_AFSPRAAK +
        OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK);
    const dagen = weekdaysInSlice(w.startYmd, w.endYmd);
    acc.ops_commissie += OPS_MANAGER_FIXED_PER_WEEK * (dagen / 5);
    const metrics = finalize(acc);
    return {
      ...w,
      ...metrics,
      leads,
      slots,
      slotsVrij,
    };
  });

  const sum = emptyAcc();
  let leads = 0;
  let slots = 0;
  let slotsVrij = 0;
  for (const w of built) {
    leads += w.leads;
    slots += w.slots;
    slotsVrij += w.slotsVrij;
    sum.orders += w.orders;
    sum.omzet += w.omzet;
    sum.inkoop += w.inkoop;
    sum.installatie += w.installatie;
    sum.sales_commissie += w.sales_commissie;
    sum.ops_commissie += w.ops_commissie;
    sum.ad_spend += w.ad_spend;
    sum.edergy += w.edergy;
  }

  return {
    ...month,
    leadToApptPct: rateBase.leadToAppt,
    afspraakToSalePct: rateBase.afspraakToSale,
    gemOrderwaarde: rateBase.gemOrderwaarde,
    inkoopPct: Math.round(inkoopRatio * 1000) / 10,
    installatiePerOrder: round2(installatiePerOrder),
    cpl: round2(cpl),
    leads,
    slots,
    slotsVrij,
    weeks: built,
    totals: finalize(sum),
  };
}

async function loadUnavailable(
  sb: SupabaseClient,
  adviseurIds: string[],
  jaren: number[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!adviseurIds.length || !jaren.length) return map;
  const { data, error } = await sb
    .from("adviseur_beschikbaarheid")
    .select("adviseur_id, jaar, week, beschikbaar")
    .in("adviseur_id", adviseurIds)
    .in("jaar", jaren)
    .eq("beschikbaar", false);
  if (error) {
    if (
      error.code === "42703" ||
      error.code === "42P01" ||
      error.message?.includes("adviseur_beschikbaarheid")
    ) {
      return map;
    }
    throw error;
  }
  for (const row of data || []) {
    const aid = row.adviseur_id as string;
    const key = weekKeyString(row.jaar as number, row.week as number);
    if (!map.has(aid)) map.set(aid, new Set());
    map.get(aid)!.add(key);
  }
  return map;
}
