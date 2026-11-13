import { addDays, addWeeks, differenceInCalendarDays } from "date-fns";
import {
  normalizeMonteurRegios,
  provincieVanPostcode,
} from "@/lib/postcode-provincie";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
  type SchouwWeek,
} from "@/lib/schouw-week";

/**
 * Indicatie: installatie ≈ 7 weken na ondertekening offerte.
 * Geen uitbetaling, geen schouw.
 */
export const FORECAST_WEEKEN_NA_ONDERTEKENING = 7;

/** Kijkvenster groei: afgelopen N dagen. */
export const FORECAST_GROEI_DAGEN = 10;

/** Komende ~2 maanden in weeklijst (huidige week + 8). */
export const FORECAST_WEEK_COUNT = 9;

/** Indicatieve capaciteit: installaties per monteur per week (fallback). */
export const FORECAST_INSTALLS_PER_MONTEUR_WEEK = 4;

/** Capaciteit per installatiekoppel (2 monteurs = 1 team) per week. */
export const FORECAST_INSTALLS_PER_KOPPEL_WEEK = 4;

/** Week-op-week groei in de forecast (10%). */
export const FORECAST_WOW_GROEI = 0.1;

export type ForecastWeekCol = SchouwWeek & {
  key: string;
  label: string;
  kort: string;
};

export type ForecastOrderStatus = "definitief" | "concept";

export type ForecastOrder = {
  id: string;
  projectNummer: string | null;
  plaats: string | null;
  postcode: string | null;
  /** Adres voor reistijd (postcode + plaats of straat). */
  adres: string | null;
  regio: string;
  /** installatie_at gezet = definitief; anders verkocht/concept (≈7w). */
  status: ForecastOrderStatus;
  bron: "ondertekend_7w" | "installatie_at";
  ondertekendOp: string | null;
  verwachteInstallatieAt: string;
  weekKey: string;
  /** Verwachte week lag vóór nu → in huidige week gezet. */
  achterstallig?: boolean;
};

export type ForecastRegioGroup = {
  regio: string;
  aantal: number;
  orders: ForecastOrder[];
};

export type ForecastWeekGroup = {
  week: ForecastWeekCol;
  /** Pipeline (zonder groei). */
  aantal: number;
  /** Pipeline + 10% WoW-groei. */
  aantalMetGroei: number;
  regios: ForecastRegioGroup[];
  /** Vraag per regio incl. WoW-groei. */
  vraagMetGroei: Record<string, number>;
};

export type ForecastGroei = {
  dagenTerug: number;
  nieuweOndertekeningen: number;
  perDag: number;
  totDatum: string;
  dagenVooruit: number;
  verwachtNieuwTotDatum: number;
  bestaandInVenster: number;
  totaalVerwachtTotDatum: number;
};

export type ForecastPayload = {
  from: string;
  to: string;
  weeks: ForecastWeekCol[];
  weekGroups: ForecastWeekGroup[];
  totaalInVenster: number;
  totaalActief: number;
  zonderSchatting: number;
  regel: string;
  groei: ForecastGroei;
  /** Totaal per regio over het weekvenster. */
  regioTotalen: { regio: string; aantal: number }[];
  /** Capaciteit per provincie (bij voorkeur via koppels). */
  capaciteitPerRegio: {
    regio: string;
    monteurs: number;
    koppels: number;
    capPerWeek: number;
  }[];
  /** Unieke koppels/solo’s (niet gesommeerd over regio’s). */
  montageCapaciteit: {
    koppels: number;
    monteurs: number;
    capPerWeek: number;
  };
  installsPerMonteurWeek: number;
  installsPerKoppelWeek: number;
  wowGroei: number;
};

export function buildForecastWeeks(from: Date = new Date()): ForecastWeekCol[] {
  const start = schouwWeekFromDate(from);
  const out: ForecastWeekCol[] = [];
  let cursor = start;
  for (let i = 0; i < FORECAST_WEEK_COUNT; i++) {
    if (i > 0) {
      const mondayIso = schouwWeekToMondayIso(cursor.jaar, cursor.week);
      cursor = schouwWeekFromDate(addWeeks(new Date(mondayIso), 1));
    }
    out.push({
      ...cursor,
      key: schouwWeekValue(cursor.jaar, cursor.week),
      label: formatSchouwWeekLabel(cursor.jaar, cursor.week),
      kort: `Week ${cursor.week}`,
    });
  }
  return out;
}

/** Weeklijst van nu tot (excl.) einddatum — voor groei tot 1 jan. */
export function buildWeeksUntil(endExclusive: Date, from: Date = new Date()) {
  const start = schouwWeekFromDate(from);
  const endWeek = schouwWeekFromDate(addDays(endExclusive, -1));
  const endKey = schouwWeekValue(endWeek.jaar, endWeek.week);
  const out: ForecastWeekCol[] = [];
  let cursor = start;
  for (let i = 0; i < 60; i++) {
    const col: ForecastWeekCol = {
      ...cursor,
      key: schouwWeekValue(cursor.jaar, cursor.week),
      label: formatSchouwWeekLabel(cursor.jaar, cursor.week),
      kort: `Week ${cursor.week}`,
    };
    out.push(col);
    if (col.key === endKey) break;
    const mondayIso = schouwWeekToMondayIso(cursor.jaar, cursor.week);
    cursor = schouwWeekFromDate(addWeeks(new Date(mondayIso), 1));
  }
  return out;
}

export function forecastHorizonIso(from: Date = new Date()): {
  fromIso: string;
  toIso: string;
  weeks: ForecastWeekCol[];
} {
  const weeks = buildForecastWeeks(from);
  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;
  const fromIso = schouwWeekToMondayIso(first.jaar, first.week);
  const lastMonday = new Date(schouwWeekToMondayIso(last.jaar, last.week));
  const toIso = addWeeks(lastMonday, 1).toISOString();
  return { fromIso, toIso, weeks };
}

type ProjectLike = {
  id: string;
  project_nummer?: string | null;
  installatie_at?: string | null;
  created_at?: string | null;
  leads?:
    | {
        postcode?: string | null;
        plaats?: string | null;
        straat?: string | null;
        huisnummer?: string | null;
        toevoeging?: string | null;
      }
    | {
        postcode?: string | null;
        plaats?: string | null;
        straat?: string | null;
        huisnummer?: string | null;
        toevoeging?: string | null;
      }[]
    | null;
  offertes?:
    | { ondertekend_op?: string | null }
    | { ondertekend_op?: string | null }[]
    | null;
};

export function orderAdresFromLead(
  lead: {
    postcode?: string | null;
    plaats?: string | null;
    straat?: string | null;
    huisnummer?: string | null;
    toevoeging?: string | null;
  } | null
): string | null {
  if (!lead) return null;
  const straat = [lead.straat, lead.huisnummer, lead.toevoeging]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
  const pcPlaats = [lead.postcode, lead.plaats]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
  const full = [straat, pcPlaats].filter(Boolean).join(", ");
  return full || null;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  if (Array.isArray(v)) return v[0] || null;
  return v;
}

function ondertekendOp(p: ProjectLike): string | null {
  return one(p.offertes)?.ondertekend_op?.trim() || null;
}

/**
 * Indicatie installatie:
 * - als installatie_at gezet → die week
 * - anders ondertekend_op + 7 weken
 */
export function expectedInstallatie(p: ProjectLike): {
  at: string;
  week: SchouwWeek;
  bron: ForecastOrder["bron"];
  ondertekendOp: string | null;
} | null {
  const signed = ondertekendOp(p);

  if (p.installatie_at) {
    try {
      return {
        at: p.installatie_at,
        week: schouwWeekFromDate(p.installatie_at),
        bron: "installatie_at",
        ondertekendOp: signed,
      };
    } catch {
      /* fall through */
    }
  }

  if (!signed) return null;
  try {
    const at = addWeeks(
      new Date(signed),
      FORECAST_WEEKEN_NA_ONDERTEKENING
    ).toISOString();
    return {
      at,
      week: schouwWeekFromDate(at),
      bron: "ondertekend_7w",
      ondertekendOp: signed,
    };
  } catch {
    return null;
  }
}

function nextJan1(from: Date = new Date()): Date {
  const y = from.getFullYear();
  const candidate = new Date(Date.UTC(y + 1, 0, 1, 0, 0, 0));
  // Als we al in januari zijn en voorbij 1 jan, gebruik volgend jaar;
  // tot 1 jan = eerstvolgende 1 januari (als vandaag vóór 1 jan dit jaar… nooit;
  // als vandaag Nov 2026 → 1 jan 2027).
  const thisYearJan1 = new Date(Date.UTC(y, 0, 1, 0, 0, 0));
  if (from.getTime() < thisYearJan1.getTime()) return thisYearJan1;
  return candidate;
}

export function buildGroei(
  projects: ProjectLike[],
  bestaandInVenster: number,
  now: Date = new Date()
): ForecastGroei {
  const tot = nextJan1(now);
  const since = addDays(now, -FORECAST_GROEI_DAGEN);
  const sinceMs = since.getTime();

  let nieuwe = 0;
  for (const p of projects) {
    const signed = ondertekendOp(p);
    if (!signed) continue;
    const t = new Date(signed).getTime();
    if (Number.isFinite(t) && t >= sinceMs && t <= now.getTime()) {
      nieuwe += 1;
    }
  }

  const perDag = nieuwe / FORECAST_GROEI_DAGEN;
  const dagenVooruit = Math.max(
    0,
    differenceInCalendarDays(tot, now)
  );
  const verwachtNieuw = Math.round(perDag * dagenVooruit);

  return {
    dagenTerug: FORECAST_GROEI_DAGEN,
    nieuweOndertekeningen: nieuwe,
    perDag: Math.round(perDag * 100) / 100,
    totDatum: tot.toISOString().slice(0, 10),
    dagenVooruit,
    verwachtNieuwTotDatum: verwachtNieuw,
    bestaandInVenster,
    totaalVerwachtTotDatum: bestaandInVenster + verwachtNieuw,
  };
}

export type TgCap = {
  id?: string;
  partner_id?: string | null;
  actief?: boolean | null;
  kan_installatie?: boolean | null;
  regios?: unknown;
};

export type KoppelCap = {
  id?: string;
  partner_id?: string | null;
  actief?: boolean | null;
  monteur_1_id?: string | null;
  monteur_2_id?: string | null;
  monteur_1?: TgCap | TgCap[] | null;
  monteur_2?: TgCap | TgCap[] | null;
};

function unwrapTg(row: TgCap | TgCap[] | null | undefined): TgCap | null {
  if (!row) return null;
  return Array.isArray(row) ? row[0] || null : row;
}

export type MontageCapaciteitSummary = {
  koppels: number;
  monteurs: number;
  capPerWeek: number;
  perRegio: ForecastPayload["capaciteitPerRegio"];
  installsPerKoppelWeek: number;
  installsPerMonteurWeek: number;
};

/**
 * Montagecapaciteit o.b.v. actieve koppels (+ solo-monteurs buiten koppels)
 * en hun geselecteerde regio’s.
 */
export function summarizeMontageCapaciteit(
  teamgenoten: TgCap[],
  koppels: KoppelCap[] = [],
  opts?: {
    regio?: string | null;
    partnerId?: string | null;
    installsPerMonteurWeek?: number;
    installsPerKoppelWeek?: number;
  }
): MontageCapaciteitSummary {
  const installsPerMonteurWeek =
    opts?.installsPerMonteurWeek ?? FORECAST_INSTALLS_PER_MONTEUR_WEEK;
  const installsPerKoppelWeek =
    opts?.installsPerKoppelWeek ?? FORECAST_INSTALLS_PER_KOPPEL_WEEK;
  const regioFilter = (opts?.regio || "").trim() || null;
  const partnerId = (opts?.partnerId || "").trim() || null;

  const tgs = partnerId
    ? teamgenoten.filter((t) => t.partner_id === partnerId)
    : teamgenoten;
  const kps = partnerId
    ? koppels.filter((k) => k.partner_id === partnerId)
    : koppels;

  const activeKoppels = kps.filter((k) => k.actief !== false);
  const inKoppel = new Set<string>();
  let koppelsCount = 0;

  for (const k of activeKoppels) {
    const m1 = unwrapTg(k.monteur_1);
    const m2 = unwrapTg(k.monteur_2);
    if (k.monteur_1_id) inKoppel.add(k.monteur_1_id);
    if (k.monteur_2_id) inKoppel.add(k.monteur_2_id);

    const regios = new Set<string>([
      ...normalizeMonteurRegios(m1?.regios),
      ...normalizeMonteurRegios(m2?.regios),
    ]);
    if (regioFilter && !regios.has(regioFilter)) continue;
    koppelsCount += 1;
  }

  let monteursCount = 0;
  for (const tg of tgs) {
    if (tg.actief === false) continue;
    if (tg.kan_installatie === false) continue;
    if (tg.id && inKoppel.has(tg.id)) continue;
    const regios = normalizeMonteurRegios(tg.regios) as string[];
    if (regioFilter) {
      if (!regios.includes(regioFilter)) continue;
    }
    monteursCount += 1;
  }

  const perRegio = buildCapaciteitPerRegio(
    tgs,
    kps,
    installsPerMonteurWeek,
    installsPerKoppelWeek
  ).filter((r) => (regioFilter ? r.regio === regioFilter : true));

  return {
    koppels: koppelsCount,
    monteurs: monteursCount,
    capPerWeek:
      koppelsCount * installsPerKoppelWeek +
      monteursCount * installsPerMonteurWeek,
    perRegio,
    installsPerKoppelWeek,
    installsPerMonteurWeek,
  };
}

export function buildCapaciteitPerRegio(
  teamgenoten: TgCap[],
  koppels: KoppelCap[] = [],
  installsPerMonteurWeek: number = FORECAST_INSTALLS_PER_MONTEUR_WEEK,
  installsPerKoppelWeek: number = FORECAST_INSTALLS_PER_KOPPEL_WEEK
): ForecastPayload["capaciteitPerRegio"] {
  const monteurs = new Map<string, number>();
  const koppelsMap = new Map<string, number>();

  const activeKoppels = koppels.filter((k) => k.actief !== false);
  const inKoppel = new Set<string>();

  for (const k of activeKoppels) {
    const m1 = unwrapTg(k.monteur_1);
    const m2 = unwrapTg(k.monteur_2);
    if (k.monteur_1_id) inKoppel.add(k.monteur_1_id);
    if (k.monteur_2_id) inKoppel.add(k.monteur_2_id);

    const regios = new Set<string>([
      ...normalizeMonteurRegios(m1?.regios),
      ...normalizeMonteurRegios(m2?.regios),
    ]);
    for (const regio of regios) {
      koppelsMap.set(regio, (koppelsMap.get(regio) || 0) + 1);
    }
  }

  for (const tg of teamgenoten) {
    if (tg.actief === false) continue;
    if (tg.kan_installatie === false) continue;
    if (tg.id && inKoppel.has(tg.id)) continue; // al in koppel meegeteld
    const regios = normalizeMonteurRegios(tg.regios);
    for (const regio of regios) {
      monteurs.set(regio, (monteurs.get(regio) || 0) + 1);
    }
  }

  const allRegios = new Set([...monteurs.keys(), ...koppelsMap.keys()]);
  return [...allRegios]
    .map((regio) => {
      const m = monteurs.get(regio) || 0;
      const k = koppelsMap.get(regio) || 0;
      return {
        regio,
        monteurs: m,
        koppels: k,
        capPerWeek: k * installsPerKoppelWeek + m * installsPerMonteurWeek,
      };
    })
    .sort((a, b) => a.regio.localeCompare(b.regio, "nl"));
}

/** Verdeel weekvolume over regio’s o.b.v. pipeline-aandeel. */
function regioShares(
  regioTotalen: { regio: string; aantal: number }[]
): Map<string, number> {
  const total = regioTotalen.reduce((s, r) => s + r.aantal, 0);
  const shares = new Map<string, number>();
  if (total <= 0) return shares;
  for (const r of regioTotalen) {
    shares.set(r.regio, r.aantal / total);
  }
  return shares;
}

export function aggregateForecast(
  projects: ProjectLike[],
  weeks: ForecastWeekCol[],
  now: Date = new Date(),
  teamgenoten: TgCap[] = [],
  koppels: KoppelCap[] = []
): Omit<ForecastPayload, "from" | "to" | "weeks" | "regel"> {
  const weekKeys = new Set(weeks.map((w) => w.key));
  const acc = new Map<string, Map<string, ForecastOrder[]>>();
  let zonderSchatting = 0;

  // Ook tellen tot 1 jan voor "bestaand" groei-totaal
  const totJan1 = nextJan1(now);
  const weeksTotJan = buildWeeksUntil(totJan1, now);
  const keysTotJan = new Set(weeksTotJan.map((w) => w.key));
  let bestaandTotJan = 0;

  const firstWeekKey = weeks[0]?.key || null;

  for (const p of projects) {
    const expected = expectedInstallatie(p);
    if (!expected) {
      zonderSchatting += 1;
      continue;
    }
    let weekKey = schouwWeekValue(expected.week.jaar, expected.week.week);
    let achterstallig = false;

    // Achterstallig (verwacht vóór deze week) → huidige week.
    if (firstWeekKey && weeks[0]) {
      const first = weeks[0];
      const expMonday = new Date(
        schouwWeekToMondayIso(expected.week.jaar, expected.week.week)
      ).getTime();
      const curMonday = new Date(
        schouwWeekToMondayIso(first.jaar, first.week)
      ).getTime();
      if (expMonday < curMonday) {
        weekKey = firstWeekKey;
        achterstallig = true;
      }
    }

    if (keysTotJan.has(weekKey) || weekKey === firstWeekKey) {
      bestaandTotJan += 1;
    }

    if (!weekKeys.has(weekKey)) continue;

    const lead = one(p.leads);
    const regio = provincieVanPostcode(lead?.postcode);
    const order: ForecastOrder = {
      id: p.id,
      projectNummer: p.project_nummer || null,
      plaats: lead?.plaats?.trim() || null,
      postcode: lead?.postcode?.trim() || null,
      adres: orderAdresFromLead(lead),
      regio,
      status: expected.bron === "installatie_at" ? "definitief" : "concept",
      bron: expected.bron,
      ondertekendOp: expected.ondertekendOp,
      verwachteInstallatieAt: expected.at,
      weekKey,
      achterstallig,
    };

    let byRegio = acc.get(weekKey);
    if (!byRegio) {
      byRegio = new Map();
      acc.set(weekKey, byRegio);
    }
    const list = byRegio.get(regio) || [];
    list.push(order);
    byRegio.set(regio, list);
  }

  const pipelineWeekGroups = weeks.map((week) => {
    const byRegio = acc.get(week.key) || new Map();
    const regios: ForecastRegioGroup[] = [...byRegio.entries()]
      .map(([regio, orders]) => ({
        regio,
        aantal: orders.length,
        orders: (orders as ForecastOrder[]).sort((a, b) =>
          (a.projectNummer || "").localeCompare(b.projectNummer || "", "nl")
        ),
      }))
      .sort(
        (a, b) => b.aantal - a.aantal || a.regio.localeCompare(b.regio, "nl")
      );

    return {
      week,
      aantal: regios.reduce((s, r) => s + r.aantal, 0),
      regios,
    };
  });

  const regioMap = new Map<string, number>();
  for (const g of pipelineWeekGroups) {
    for (const r of g.regios) {
      regioMap.set(r.regio, (regioMap.get(r.regio) || 0) + r.aantal);
    }
  }
  const regioTotalen = [...regioMap.entries()]
    .map(([regio, aantal]) => ({ regio, aantal }))
    .sort((a, b) => b.aantal - a.aantal || a.regio.localeCompare(b.regio, "nl"));

  const groei = buildGroei(projects, bestaandTotJan, now);
  const shares = regioShares(regioTotalen);
  const baseWeekVolume = Math.max(
    groei.perDag * 7,
    pipelineWeekGroups.length > 0
      ? totaalGemiddelde(
          pipelineWeekGroups.map((g) => g.aantal).filter((n) => n > 0)
        )
      : 0
  );

  const weekGroups: ForecastWeekGroup[] = pipelineWeekGroups.map((g, i) => {
    const factor = Math.pow(1 + FORECAST_WOW_GROEI, i);
    const projectedTotal = Math.round(baseWeekVolume * factor);
    const vraagMetGroei: Record<string, number> = {};
    const regioKeys = new Set([
      ...g.regios.map((r) => r.regio),
      ...shares.keys(),
    ]);
    for (const regio of regioKeys) {
      const pipeline = g.regios.find((r) => r.regio === regio)?.aantal || 0;
      const share = shares.get(regio) || 0;
      const grown = Math.round(projectedTotal * share);
      vraagMetGroei[regio] = Math.max(pipeline, grown);
    }
    // Zorg dat som ≈ max(pipeline, projected)
    const grownSum = Object.values(vraagMetGroei).reduce((s, n) => s + n, 0);
    const aantalMetGroei = Math.max(g.aantal, grownSum, projectedTotal);

    return {
      ...g,
      aantalMetGroei,
      vraagMetGroei,
    };
  });

  const totaalInVenster = weekGroups.reduce((s, g) => s + g.aantalMetGroei, 0);

  const regioGroeiMap = new Map<string, number>();
  for (const g of weekGroups) {
    for (const [regio, n] of Object.entries(g.vraagMetGroei)) {
      regioGroeiMap.set(regio, (regioGroeiMap.get(regio) || 0) + n);
    }
  }
  const regioTotalenMetGroei = [...regioGroeiMap.entries()]
    .map(([regio, aantal]) => ({ regio, aantal }))
    .sort((a, b) => b.aantal - a.aantal || a.regio.localeCompare(b.regio, "nl"));

  const capaciteitPerRegio = buildCapaciteitPerRegio(teamgenoten, koppels);
  const montage = summarizeMontageCapaciteit(teamgenoten, koppels);

  return {
    weekGroups,
    totaalInVenster,
    totaalActief: projects.length,
    zonderSchatting,
    groei,
    regioTotalen: regioTotalenMetGroei,
    capaciteitPerRegio,
    montageCapaciteit: {
      koppels: montage.koppels,
      monteurs: montage.monteurs,
      capPerWeek: montage.capPerWeek,
    },
    installsPerMonteurWeek: FORECAST_INSTALLS_PER_MONTEUR_WEEK,
    installsPerKoppelWeek: FORECAST_INSTALLS_PER_KOPPEL_WEEK,
    wowGroei: FORECAST_WOW_GROEI,
  };
}

function totaalGemiddelde(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}
