/**
 * Echte doorlooptijden voor capaciteitssturing.
 * Bron: project-/offerte-timestamps i.p.v. vaste ±5 weken.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

/** Fallback zolang er te weinig samples zijn. */
export const WF_FALLBACK_DAYS = 35;
export const MIN_SAMPLES_FOR_EMPIRICAL = 5;

export type DoorlooptijdSegment = {
  id: string;
  label: string;
  /** Aantal projecten met beide timestamps. */
  n: number;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  meanDays: number | null;
};

export type DoorlooptijdRow = {
  projectId: string;
  projectNummer: string | null;
  klant: string | null;
  ondertekendOp: string;
  warmtefondsAangevraagdAt: string | null;
  warmtefondsAfspraakAt: string | null;
  warmtefondsUitbetaaldAt: string | null;
  schouwAt: string | null;
  materiaalLeverdatum: string | null;
  installatieAt: string | null;
  daysOndertekenTotUitbetaald: number | null;
  daysOndertekenTotInstallatie: number | null;
  daysUitbetaaldTotInstallatie: number | null;
  daysOndertekenTotLevering: number | null;
};

export type DoorlooptijdenReport = {
  fallbackDays: number;
  empiricalWfDays: number;
  empiricalWfWeeks: number;
  sampleSizeWf: number;
  segments: DoorlooptijdSegment[];
  recent: DoorlooptijdRow[];
};

type ProjectSample = {
  id: string;
  project_nummer: string | null;
  status: string | null;
  betaalwijze: string | null;
  warmtefonds_aangevraagd_at: string | null;
  warmtefonds_afspraak_at: string | null;
  warmtefonds_uitbetaald_at: string | null;
  financiering_status: string | null;
  schouw_at: string | null;
  materiaal_leverdatum: string | null;
  installatie_at: string | null;
  leads:
    | { naam?: string | null; status?: string | null }
    | { naam?: string | null; status?: string | null }[]
    | null;
  offertes:
    | {
        ondertekend_op?: string | null;
        financiering_voorbehoud?: boolean | null;
      }
    | {
        ondertekend_op?: string | null;
        financiering_voorbehoud?: boolean | null;
      }[]
    | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function isWf(p: ProjectSample): boolean {
  const lead = one(p.leads);
  const off = one(p.offertes);
  if (lead?.status === "sale_eigen_middelen") return false;
  if (lead?.status === "sale_financiering") return true;
  if (p.betaalwijze === "eigen_middelen") return false;
  if (p.betaalwijze === "warmtefonds") return true;
  return Boolean(off?.financiering_voorbehoud);
}

function dayDiff(fromIso: string, toIso: string): number | null {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000);
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return Math.round(sorted[lo] * (1 - w) + sorted[hi] * w);
}

function stats(values: number[]): {
  n: number;
  medianDays: number | null;
  p25Days: number | null;
  p75Days: number | null;
  meanDays: number | null;
} {
  const sorted = [...values].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sorted.length === 0) {
    return {
      n: 0,
      medianDays: null,
      p25Days: null,
      p75Days: null,
      meanDays: null,
    };
  }
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    medianDays: percentile(sorted, 0.5),
    p25Days: percentile(sorted, 0.25),
    p75Days: percentile(sorted, 0.75),
    meanDays: Math.round(sum / sorted.length),
  };
}

function segment(
  id: string,
  label: string,
  values: number[]
): DoorlooptijdSegment {
  return { id, label, ...stats(values) };
}

async function fetchProjectSamples(
  sb: SupabaseClient
): Promise<ProjectSample[]> {
  const full =
    "id, project_nummer, status, betaalwijze, warmtefonds_aangevraagd_at, warmtefonds_afspraak_at, warmtefonds_uitbetaald_at, financiering_status, schouw_at, materiaal_leverdatum, installatie_at, leads(naam, status), offertes(ondertekend_op, financiering_voorbehoud)";
  const soft =
    "id, project_nummer, status, betaalwijze, warmtefonds_aangevraagd_at, warmtefonds_afspraak_at, financiering_status, schouw_at, materiaal_leverdatum, installatie_at, leads(naam, status), offertes(ondertekend_op, financiering_voorbehoud)";
  try {
    return await fetchAllRows<ProjectSample>(
      (from, to) =>
        sb
          .from("projecten")
          .select(full)
          .not("status", "eq", "annulering")
          .order("updated_at", { ascending: false })
          .range(from, to) as PromiseLike<{
          data: ProjectSample[] | null;
          error: { message?: string; code?: string } | null;
        }>
    );
  } catch {
    return await fetchAllRows<ProjectSample>(
      (from, to) =>
        sb
          .from("projecten")
          .select(soft)
          .not("status", "eq", "annulering")
          .order("updated_at", { ascending: false })
          .range(from, to) as PromiseLike<{
          data: ProjectSample[] | null;
          error: { message?: string; code?: string } | null;
        }>
    );
  }
}

export async function buildDoorlooptijdenReport(
  sb: SupabaseClient
): Promise<DoorlooptijdenReport> {
  const rows = await fetchProjectSamples(sb);

  const ondertekenTotUit: number[] = [];
  const ondertekenTotAanvraag: number[] = [];
  const aanvraagTotUit: number[] = [];
  const ondertekenTotSchouw: number[] = [];
  const ondertekenTotInstall: number[] = [];
  const uitTotInstall: number[] = [];
  const ondertekenTotLever: number[] = [];
  const recent: DoorlooptijdRow[] = [];

  for (const p of rows) {
    if (!isWf(p)) continue;
    const off = one(p.offertes);
    const ondertekend = off?.ondertekend_op?.trim() || null;
    if (!ondertekend) continue;

    const lead = one(p.leads);
    const dUit = p.warmtefonds_uitbetaald_at
      ? dayDiff(ondertekend, p.warmtefonds_uitbetaald_at)
      : null;
    const dAanvraag = p.warmtefonds_aangevraagd_at
      ? dayDiff(ondertekend, p.warmtefonds_aangevraagd_at)
      : null;
    const dAanvraagTotUit =
      p.warmtefonds_aangevraagd_at && p.warmtefonds_uitbetaald_at
        ? dayDiff(p.warmtefonds_aangevraagd_at, p.warmtefonds_uitbetaald_at)
        : null;
    const dSchouw = p.schouw_at ? dayDiff(ondertekend, p.schouw_at) : null;
    const dInstall = p.installatie_at
      ? dayDiff(ondertekend, p.installatie_at)
      : null;
    const dUitInstall =
      p.warmtefonds_uitbetaald_at && p.installatie_at
        ? dayDiff(p.warmtefonds_uitbetaald_at, p.installatie_at)
        : null;
    const dLever = p.materiaal_leverdatum
      ? dayDiff(ondertekend, p.materiaal_leverdatum)
      : null;

    if (dUit != null) ondertekenTotUit.push(dUit);
    if (dAanvraag != null) ondertekenTotAanvraag.push(dAanvraag);
    if (dAanvraagTotUit != null) aanvraagTotUit.push(dAanvraagTotUit);
    if (dSchouw != null) ondertekenTotSchouw.push(dSchouw);
    if (dInstall != null) ondertekenTotInstall.push(dInstall);
    if (dUitInstall != null) uitTotInstall.push(dUitInstall);
    if (dLever != null) ondertekenTotLever.push(dLever);

    if (
      dUit != null ||
      dInstall != null ||
      dLever != null ||
      p.financiering_status === "uitbetaald"
    ) {
      recent.push({
        projectId: p.id,
        projectNummer: p.project_nummer,
        klant: lead?.naam?.trim() || null,
        ondertekendOp: ondertekend,
        warmtefondsAangevraagdAt: p.warmtefonds_aangevraagd_at,
        warmtefondsAfspraakAt: p.warmtefonds_afspraak_at,
        warmtefondsUitbetaaldAt: p.warmtefonds_uitbetaald_at,
        schouwAt: p.schouw_at,
        materiaalLeverdatum: p.materiaal_leverdatum,
        installatieAt: p.installatie_at,
        daysOndertekenTotUitbetaald: dUit,
        daysOndertekenTotInstallatie: dInstall,
        daysUitbetaaldTotInstallatie: dUitInstall,
        daysOndertekenTotLevering: dLever,
      });
    }
  }

  recent.sort((a, b) => {
    const aa = a.warmtefondsUitbetaaldAt || a.ondertekendOp;
    const bb = b.warmtefondsUitbetaaldAt || b.ondertekendOp;
    return bb.localeCompare(aa);
  });

  const wfStats = stats(ondertekenTotUit);
  const empiricalWfDays =
    wfStats.n >= MIN_SAMPLES_FOR_EMPIRICAL && wfStats.medianDays != null
      ? wfStats.medianDays
      : WF_FALLBACK_DAYS;

  return {
    fallbackDays: WF_FALLBACK_DAYS,
    empiricalWfDays,
    empiricalWfWeeks: Math.max(1, Math.round(empiricalWfDays / 7)),
    sampleSizeWf: wfStats.n,
    segments: [
      segment(
        "onderteken_tot_uitbetaald",
        "Offerte ondertekend → WF uitbetaald",
        ondertekenTotUit
      ),
      segment(
        "onderteken_tot_aanvraag",
        "Ondertekend → WF aangevraagd",
        ondertekenTotAanvraag
      ),
      segment(
        "aanvraag_tot_uitbetaald",
        "WF aangevraagd → uitbetaald",
        aanvraagTotUit
      ),
      segment(
        "onderteken_tot_schouw",
        "Ondertekend → schouw",
        ondertekenTotSchouw
      ),
      segment(
        "onderteken_tot_installatie",
        "Ondertekend → installatie",
        ondertekenTotInstall
      ),
      segment(
        "uitbetaald_tot_installatie",
        "WF uitbetaald → installatie",
        uitTotInstall
      ),
      segment(
        "onderteken_tot_materiaallevering",
        "Ondertekend → materiaallevering",
        ondertekenTotLever
      ),
    ],
    recent: recent.slice(0, 80),
  };
}

/** Dagen tot verwachte WF-uitbetaling (empirisch of fallback). */
export async function resolveEmpiricalWfDays(
  sb: SupabaseClient
): Promise<{ days: number; weeks: number; n: number; empirical: boolean }> {
  try {
    const report = await buildDoorlooptijdenReport(sb);
    return {
      days: report.empiricalWfDays,
      weeks: report.empiricalWfWeeks,
      n: report.sampleSizeWf,
      empirical: report.sampleSizeWf >= MIN_SAMPLES_FOR_EMPIRICAL,
    };
  } catch {
    return {
      days: WF_FALLBACK_DAYS,
      weeks: Math.round(WF_FALLBACK_DAYS / 7),
      n: 0,
      empirical: false,
    };
  }
}
