/**
 * Kasforecast op getekende orders.
 * Warmtefonds komt ongeveer 5 weken na ondertekening binnen.
 * Installatie is ongeveer 6 weken na ondertekening: die week gaan
 * salescommissie, installatie en inkoop eruit.
 * Hold en annulering leveren niets op en kosten ook niets.
 */

import { addWeeks } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ } from "@/lib/format";
import { DEFAULT_INSTALLATIE_STANDAARD } from "@/lib/inkoop";
import { hardwareKostenVoorRegels } from "@/lib/project-kosten";
import { normalizeProjectStatus, projectStatusLabel } from "@/lib/labels";
import { commissiePctToFraction } from "@/lib/netto-boord";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import type { ProjectStatus } from "@/types/database";

/** WF-uitbetaling t.o.v. ondertekening. */
const WF_IN_WEKEN = 5;
/** Installatie (en dus uitgaande kosten) t.o.v. ondertekening, als er nog geen datum staat. */
const INSTALL_WEKEN = 6;
/** Eigen middelen zonder open factuurdatum: kort na ondertekening. */
const EM_IN_WEKEN = 2;

const GELD_BINNEN = new Set<ProjectStatus>([
  "restfactuur_betaald",
  "materiaal_besteld",
  "installatie_ingepland",
  "installatie_voltooid",
  "review_gevraagd",
  "afgerond",
  "service",
]);

const GEINSTALLEERD = new Set<ProjectStatus>([
  "installatie_voltooid",
  "review_gevraagd",
  "afgerond",
  "service",
]);

export type CashflowOrder = {
  offerteId: string;
  projectId: string | null;
  projectNummer: string | null;
  klant: string;
  vorm: "wf" | "em";
  status: string | null;
  statusLabel: string | null;
  /** hold | annulering | open */
  uitsluiting: "hold" | "annulering" | null;
  omzetEx: number;
  /** Nog te ontvangen. 0 bij hold, annulering of al betaald. */
  inkomend: number;
  inDatum: string | null;
  inLabel: string;
  commissie: number;
  installatie: number;
  inkoop: number;
  uitgaand: number;
  uitDatum: string | null;
  uitLabel: string;
  netto: number;
};

export type CashflowWeek = {
  weekKey: string;
  label: string;
  startYmd: string;
  inkomend: number;
  commissie: number;
  installatie: number;
  inkoop: number;
  uitgaand: number;
  netto: number;
};

export type CashflowForecast = {
  vandaag: string;
  orders: CashflowOrder[];
  weeks: CashflowWeek[];
  totaalIn: number;
  totaalUit: number;
  totaalNetto: number;
  holdOmzet: number;
  annuleringOmzet: number;
  holdAantal: number;
  annuleringAantal: number;
};

type OfferteRow = {
  id: string;
  ondertekend_op: string | null;
  subtotaal_ex_btw: number | null;
  financiering_voorbehoud?: boolean | null;
  leads?:
    | { naam?: string | null; adviseur_id?: string | null }
    | { naam?: string | null; adviseur_id?: string | null }[]
    | null;
  offerte_regels?: { omschrijving?: string | null; aantal?: number | null }[] | null;
};

type ProjectRow = {
  id: string;
  project_nummer?: string | null;
  offerte_id: string | null;
  status: string | null;
  projectkosten?: number | null;
  installatie_at?: string | null;
  installatie_voltooid_at?: string | null;
  financiering_status?: string | null;
  betaalwijze?: string | null;
  inkoop_leverancier_betaald_op?: string | null;
  updated_at?: string | null;
  leads?: { naam?: string | null } | { naam?: string | null }[] | null;
};

type FactuurRow = {
  offerte_id: string | null;
  status: string | null;
  bedrag_ex_btw: number | null;
  credit_van_factuur_id?: string | null;
  vervaldatum?: string | null;
  afgesproken_betaaldatum?: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ymd(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function addWeeksYmd(start: string, weeks: number): string {
  const [y, m, d] = start.split("-").map(Number);
  const base = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ);
  return formatInTimeZone(addWeeks(base, weeks), AMSTERDAM_TZ, "yyyy-MM-dd");
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function bucketYmd(datum: string, vandaag: string): string {
  return datum < vandaag ? vandaag : datum;
}

function weekOf(ymdValue: string): { weekKey: string; label: string; startYmd: string } {
  const [y, m, d] = ymdValue.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ);
  const info = schouwWeekFromDate(noon);
  return {
    weekKey: schouwWeekValue(info.jaar, info.week),
    label: formatSchouwWeekLabel(info.jaar, info.week),
    startYmd: ymd(schouwWeekToMondayIso(info.jaar, info.week)) || ymdValue,
  };
}

function nextWeekKey(weekKey: string): string | null {
  const monday = schouwWeekToMondayIso(
    Number(weekKey.slice(0, 4)),
    Number(weekKey.slice(6))
  );
  const next = addWeeksYmd(ymd(monday) || "", 1);
  if (!next) return null;
  return weekOf(next).weekKey;
}

export async function buildCashflowForecast(
  sb: SupabaseClient,
  now = new Date()
): Promise<CashflowForecast> {
  const vandaag = formatInTimeZone(now, AMSTERDAM_TZ, "yyyy-MM-dd");

  const [offertes, projects, facturen, adviseursRes, instRes] = await Promise.all([
    fetchAllRows<OfferteRow>((from, to) =>
      sb
        .from("offertes")
        .select(
          "id, ondertekend_op, subtotaal_ex_btw, financiering_voorbehoud, leads(naam, adviseur_id), offerte_regels(omschrijving, aantal)"
        )
        .eq("status", "ondertekend")
        .not("ondertekend_op", "is", null)
        .order("ondertekend_op", { ascending: false })
        .range(from, to)
    ),
    fetchAllRows<ProjectRow>((from, to) =>
      sb
        .from("projecten")
        .select(
          "id, project_nummer, offerte_id, status, projectkosten, installatie_at, installatie_voltooid_at, financiering_status, betaalwijze, inkoop_leverancier_betaald_op, updated_at, leads(naam)"
        )
        .not("offerte_id", "is", null)
        .order("updated_at", { ascending: false })
        .range(from, to)
    ),
    fetchAllRows<FactuurRow>((from, to) =>
      sb
        .from("facturen")
        .select(
          "offerte_id, status, bedrag_ex_btw, credit_van_factuur_id, vervaldatum, afgesproken_betaaldatum"
        )
        .not("offerte_id", "is", null)
        .order("created_at", { ascending: false })
        .range(from, to)
    ).catch(() => [] as FactuurRow[]),
    sb.from("adviseurs").select("id, commissie_pct"),
    sb
      .from("dashboard_instellingen")
      .select("standaard_installatie")
      .eq("actief", true)
      .limit(1)
      .maybeSingle(),
  ]);

  const standaardInstallatie =
    Number(
      (instRes.data as { standaard_installatie?: number | null } | null)
        ?.standaard_installatie
    ) || DEFAULT_INSTALLATIE_STANDAARD;

  const commissieMap = new Map<string, number>();
  for (const row of (adviseursRes.data || []) as {
    id: string;
    commissie_pct?: number | null;
  }[]) {
    commissieMap.set(row.id, commissiePctToFraction(row.commissie_pct));
  }

  const projectsByOfferte = new Map<string, ProjectRow[]>();
  for (const project of projects) {
    if (!project.offerte_id) continue;
    const list = projectsByOfferte.get(project.offerte_id) || [];
    list.push(project);
    projectsByOfferte.set(project.offerte_id, list);
  }

  const paidByOfferte = new Map<string, number>();
  const emDateByOfferte = new Map<string, string>();
  for (const factuur of facturen) {
    const oid = factuur.offerte_id;
    if (!oid) continue;
    const bedrag = Number(factuur.bedrag_ex_btw) || 0;
    const credit = Boolean(factuur.credit_van_factuur_id);
    if (factuur.status === "betaald") {
      paidByOfferte.set(
        oid,
        (paidByOfferte.get(oid) || 0) + (credit ? -bedrag : bedrag)
      );
    }
    if (!credit && factuur.status !== "betaald") {
      const due =
        ymd(factuur.afgesproken_betaaldatum) || ymd(factuur.vervaldatum);
      if (!due) continue;
      const prev = emDateByOfferte.get(oid);
      if (!prev || due < prev) emDateByOfferte.set(oid, due);
    }
  }

  const orders: CashflowOrder[] = [];

  for (const offerte of offertes) {
    const getekend = ymd(offerte.ondertekend_op);
    if (!getekend) continue;
    const omzetEx = round2(Number(offerte.subtotaal_ex_btw) || 0);
    if (omzetEx <= 0) continue;

    const linked = projectsByOfferte.get(offerte.id) || [];
    const project =
      linked.find((p) => {
        const status = normalizeProjectStatus(p.status);
        return status !== "annulering" && status !== "hold_sales_actie";
      }) || linked[0] || null;

    const status = project ? normalizeProjectStatus(project.status) : null;
    const lead = one(offerte.leads);
    const projectLead = one(project?.leads);
    const klant = (projectLead?.naam || lead?.naam || "Onbekend").trim();
    const wf =
      offerte.financiering_voorbehoud === true ||
      project?.betaalwijze === "warmtefonds";

    const uitsluiting: CashflowOrder["uitsluiting"] =
      status === "annulering"
        ? "annulering"
        : status === "hold_sales_actie"
          ? "hold"
          : null;

    const geldBinnen =
      !uitsluiting &&
      (project?.financiering_status === "uitbetaald" ||
        (status != null && GELD_BINNEN.has(status)) ||
        (paidByOfferte.get(offerte.id) || 0) >= omzetEx * 0.95);
    const betaald = Math.max(0, paidByOfferte.get(offerte.id) || 0);
    const inkomend = uitsluiting || geldBinnen ? 0 : round2(Math.max(0, omzetEx - betaald));

    const inDatumRaw = wf
      ? addWeeksYmd(getekend, WF_IN_WEKEN)
      : emDateByOfferte.get(offerte.id) || addWeeksYmd(getekend, EM_IN_WEKEN);

    const geinstalleerd =
      Boolean(project?.installatie_voltooid_at) ||
      (status != null && GEINSTALLEERD.has(status));

    const frac = lead?.adviseur_id
      ? commissieMap.get(lead.adviseur_id) ?? commissiePctToFraction(null)
      : commissiePctToFraction(null);
    const commissie =
      uitsluiting || geinstalleerd ? 0 : round2(omzetEx * frac);
    const installatie =
      uitsluiting || geinstalleerd
        ? 0
        : round2(
            project && Number(project.projectkosten) > 0
              ? Number(project.projectkosten)
              : standaardInstallatie
          );
    const inkoop =
      uitsluiting || geinstalleerd || project?.inkoop_leverancier_betaald_op
        ? 0
        : round2(hardwareKostenVoorRegels(offerte.offerte_regels || []).totaal);
    const uitgaand = round2(commissie + installatie + inkoop);
    const uitDatumRaw =
      ymd(project?.installatie_at) || addWeeksYmd(getekend, INSTALL_WEKEN);

    const nogRelevant =
      uitsluiting != null || inkomend > 0 || uitgaand > 0;
    if (!nogRelevant) continue;

    orders.push({
      offerteId: offerte.id,
      projectId: project?.id || null,
      projectNummer: project?.project_nummer || null,
      klant,
      vorm: wf ? "wf" : "em",
      status,
      statusLabel: status ? projectStatusLabel[status] || status : null,
      uitsluiting,
      omzetEx,
      inkomend,
      inDatum: inkomend > 0 ? inDatumRaw : null,
      inLabel:
        inkomend <= 0
          ? uitsluiting === "hold"
            ? "Hold — telt niet"
            : uitsluiting === "annulering"
              ? "Geannuleerd"
              : "Al binnen"
          : `${wf ? "Warmtefonds · 5 wk na tekenen" : "Eigen middelen"}${
              inDatumRaw < vandaag ? " · nog niet binnen" : ""
            }`,
      commissie,
      installatie,
      inkoop,
      uitgaand,
      uitDatum: uitgaand > 0 ? uitDatumRaw : null,
      uitLabel:
        uitgaand <= 0
          ? geinstalleerd
            ? "Al geïnstalleerd"
            : "Geen uitgaand"
          : project?.installatie_at
            ? "Geplande installatie"
            : "6 wk na tekenen",
      netto: round2(inkomend - uitgaand),
    });
  }

  orders.sort((a, b) => {
    const ad = a.inDatum || a.uitDatum || "9999";
    const bd = b.inDatum || b.uitDatum || "9999";
    return ad.localeCompare(bd) || a.klant.localeCompare(b.klant, "nl");
  });

  const weekMap = new Map<string, CashflowWeek>();
  function touch(datum: string): CashflowWeek {
    const meta = weekOf(bucketYmd(datum, vandaag));
    let row = weekMap.get(meta.weekKey);
    if (!row) {
      row = {
        weekKey: meta.weekKey,
        label: meta.label,
        startYmd: meta.startYmd,
        inkomend: 0,
        commissie: 0,
        installatie: 0,
        inkoop: 0,
        uitgaand: 0,
        netto: 0,
      };
      weekMap.set(meta.weekKey, row);
    }
    return row;
  }

  for (const order of orders) {
    if (order.inkomend > 0 && order.inDatum) {
      touch(order.inDatum).inkomend += order.inkomend;
    }
    if (order.uitgaand > 0 && order.uitDatum) {
      const week = touch(order.uitDatum);
      week.commissie += order.commissie;
      week.installatie += order.installatie;
      week.inkoop += order.inkoop;
      week.uitgaand += order.uitgaand;
    }
  }

  const keys = [...weekMap.keys()].sort();
  if (keys.length > 1 && keys.length <= 40) {
    let cursor = keys[0]!;
    const last = keys[keys.length - 1]!;
    while (cursor && cursor < last) {
      if (!weekMap.has(cursor)) {
        const meta = weekOf(ymd(schouwWeekToMondayIso(
          Number(cursor.slice(0, 4)),
          Number(cursor.slice(6))
        )) || vandaag);
        weekMap.set(cursor, {
          weekKey: cursor,
          label: meta.label,
          startYmd: meta.startYmd,
          inkomend: 0,
          commissie: 0,
          installatie: 0,
          inkoop: 0,
          uitgaand: 0,
          netto: 0,
        });
      }
      const nxt = nextWeekKey(cursor);
      if (!nxt || nxt === cursor) break;
      cursor = nxt;
    }
  }

  const weeks = [...weekMap.values()]
    .sort((a, b) => a.startYmd.localeCompare(b.startYmd))
    .map((week) => ({
      ...week,
      inkomend: round2(week.inkomend),
      commissie: round2(week.commissie),
      installatie: round2(week.installatie),
      inkoop: round2(week.inkoop),
      uitgaand: round2(week.uitgaand),
      netto: round2(week.inkomend - week.uitgaand),
    }));

  let holdOmzet = 0;
  let annuleringOmzet = 0;
  let holdAantal = 0;
  let annuleringAantal = 0;
  let totaalIn = 0;
  let totaalUit = 0;
  for (const order of orders) {
    totaalIn += order.inkomend;
    totaalUit += order.uitgaand;
    if (order.uitsluiting === "hold") {
      holdOmzet += order.omzetEx;
      holdAantal += 1;
    }
    if (order.uitsluiting === "annulering") {
      annuleringOmzet += order.omzetEx;
      annuleringAantal += 1;
    }
  }

  return {
    vandaag,
    orders,
    weeks,
    totaalIn: round2(totaalIn),
    totaalUit: round2(totaalUit),
    totaalNetto: round2(totaalIn - totaalUit),
    holdOmzet: round2(holdOmzet),
    annuleringOmzet: round2(annuleringOmzet),
    holdAantal,
    annuleringAantal,
  };
}
