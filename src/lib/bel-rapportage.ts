/**
 * Bel/callcenter-rapportage:zelfde week/maand-structuur als marketing/sales,
 * met bel-conversieketen (gebeld → ingepland / L→A) per beller.
 */

import { addDays, addWeeks, format } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { isAdminEmail } from "@/lib/admin-adviseur";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isGeenInteresseStatus } from "@/lib/labels";
import { round2, safeDiv } from "@/lib/management-dashboard/periods";
import { normalizeRol } from "@/lib/rollen";
import {
  attributedBellerIdForLead,
  eersteNieuweHuisbezoekIdPerLead,
  huisbezoekLeadIdsOpDag,
  inAmsterdamDayRange,
  isHuisbezoekAfspraak,
  isHuisbezoekSoort,
  type BelConversieAfspraak,
  type BelConversieLead,
} from "@/lib/bel-conversie";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";

export type BelMetrics = {
  gebeld: number;
  ingepland: number;
  geenInteresse: number;
  geenContact: number;
  /** Geannuleerde 1e huisbezoeken die in de periode zijn ingezet */
  geannuleerd: number;
  /**
   * Uitval % = geannuleerd ÷ (ingepland + geannuleerd).
   * Hoeveel van de geplaatste huisbezoeken later uitvielen.
   */
  annuleringsPct: number | null;
  /** Non-nieuw L→A % (zelfde definitie als bel-conversie UI) */
  leadToAppt: number | null;
  /** bruto: ingepland / gebeld */
  conv_gebeld_ingepland_pct: number | null;
};

export type BelBellerRow = BelMetrics & {
  key: string;
  label: string;
};

export type BelWeekBucket = BelMetrics & {
  weekKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  bellers: BelBellerRow[];
};

export type BelMonthBucket = BelMetrics & {
  monthKey: string;
  label: string;
  startYmd: string;
  endYmd: string;
  weeks: BelWeekBucket[];
};

export type BelRapportage = {
  startYmd: string;
  endYmd: string;
  periodLabel: string;
  totals: BelMetrics;
  series: BelWeekBucket[];
  months: BelMonthBucket[];
};

type Acc = {
  gebeld: number;
  ingepland: number;
  geenInteresse: number;
  geenContact: number;
  geannuleerd: number;
  nonNieuwGebeld: number;
  nonNieuwIngepland: number;
};

function newAcc(): Acc {
  return {
    gebeld: 0,
    ingepland: 0,
    geenInteresse: 0,
    geenContact: 0,
    geannuleerd: 0,
    nonNieuwGebeld: 0,
    nonNieuwIngepland: 0,
  };
}

function addAcc(a: Acc, b: Acc): Acc {
  return {
    gebeld: a.gebeld + b.gebeld,
    ingepland: a.ingepland + b.ingepland,
    geenInteresse: a.geenInteresse + b.geenInteresse,
    geenContact: a.geenContact + b.geenContact,
    geannuleerd: a.geannuleerd + b.geannuleerd,
    nonNieuwGebeld: a.nonNieuwGebeld + b.nonNieuwGebeld,
    nonNieuwIngepland: a.nonNieuwIngepland + b.nonNieuwIngepland,
  };
}

function finalizeMetrics(a: Acc): BelMetrics {
  const l2a = safeDiv(a.nonNieuwIngepland, a.nonNieuwGebeld);
  const bruto = safeDiv(a.ingepland, a.gebeld);
  const uitval = safeDiv(a.geannuleerd, a.ingepland + a.geannuleerd);
  return {
    gebeld: a.gebeld,
    ingepland: a.ingepland,
    geenInteresse: a.geenInteresse,
    geenContact: a.geenContact,
    geannuleerd: a.geannuleerd,
    annuleringsPct: uitval != null ? round2(uitval * 100) : null,
    leadToAppt: l2a != null ? round2(l2a * 100) : null,
    conv_gebeld_ingepland_pct: bruto != null ? round2(bruto * 100) : null,
  };
}

function isGeenContactStatus(status: string | null | undefined): boolean {
  const s = (status || "").trim().toLowerCase();
  return s === "geen_contact" || s === "vervolg_geen_contact";
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

function amsDayBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  return {
    start: fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ),
    end: fromZonedTime(new Date(y, m - 1, d, 23, 59, 59, 999), AMSTERDAM_TZ),
  };
}

/** Default: 12 ISO-weken t/m vandaag (Amsterdam). */
export function defaultBelRange(now = new Date()): {
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

export function buildBelRapportage(opts: {
  startYmd: string;
  endYmd: string;
  leads: BelConversieLead[];
  afspraken: BelConversieAfspraak[];
  huisbezoekHistorie?: BelConversieAfspraak[];
  adviseurs: {
    id: string;
    naam: string;
    rol?: string | null;
    actief?: boolean;
    email?: string | null;
  }[];
  /** Alleen deze beller (lock voor rol=beller) */
  bellerId?: string | null;
}): BelRapportage {
  const { startYmd, endYmd } = opts;
  const historie = opts.huisbezoekHistorie ?? opts.afspraken;

  // Alleen beller/backoffice in bel-regels; adviseurs/admin krijgen geen credit.
  const allowedCallerIds = new Set<string>();
  const skipNonCallerIds = new Set<string>();
  const naamById = new Map<string, string>();
  const activeBellerIds: string[] = [];
  for (const a of opts.adviseurs) {
    naamById.set(a.id, a.naam);
    const rol = normalizeRol(a.rol);
    if (rol === "admin" || isAdminEmail(a.email)) {
      skipNonCallerIds.add(a.id);
      continue;
    }
    if (rol === "beller" || rol === "backoffice") {
      allowedCallerIds.add(a.id);
      if (a.actief !== false) activeBellerIds.push(a.id);
    } else {
      skipNonCallerIds.add(a.id);
    }
  }
  const soloBellerId =
    activeBellerIds.length === 1 ? activeBellerIds[0] : null;
  const orphanFallback = soloBellerId || null;
  const filterBeller = opts.bellerId?.trim() || null;

  const weeks = listWeekWindows(startYmd, endYmd);
  const weekAcc = new Map<string, Acc>();
  const weekBelAcc = new Map<string, Map<string, Acc>>();
  for (const w of weeks) {
    weekAcc.set(w.weekKey, newAcc());
    weekBelAcc.set(w.weekKey, new Map());
  }

  function ensureBel(weekKey: string, belId: string): Acc {
    const map = weekBelAcc.get(weekKey)!;
    if (!map.has(belId)) map.set(belId, newAcc());
    return map.get(belId)!;
  }

  for (const w of weeks) {
    const { start } = amsDayBounds(w.startYmd);
    const { end } = amsDayBounds(w.endYmd);
    const eersteIds = eersteNieuweHuisbezoekIdPerLead(historie);
    const ingeplandIds = huisbezoekLeadIdsOpDag(
      opts.afspraken,
      start,
      end,
      historie
    );

    const ingeplandDoorByLead = new Map<string, string>();
    for (const a of opts.afspraken) {
      if (!isHuisbezoekAfspraak(a)) continue;
      if (eersteIds.get(a.lead_id) !== a.id) continue;
      const door = (a.ingepland_door_id || "").trim();
      if (!door || !a.created_at) continue;
      if (!inAmsterdamDayRange(a.created_at, start, end)) continue;
      if (!ingeplandDoorByLead.has(a.lead_id)) {
        ingeplandDoorByLead.set(a.lead_id, door);
      }
    }

    const byId = new Map<string, BelConversieLead>();
    for (const l of opts.leads) {
      const gebeldDag = inAmsterdamDayRange(l.laatst_gebeld_at, start, end);
      const ingeplandDag = ingeplandIds.has(l.id);
      if (!gebeldDag && !ingeplandDag) continue;
      byId.set(l.id, l);
    }

    const wa = weekAcc.get(w.weekKey)!;

    for (const l of byId.values()) {
      const isIngepland = ingeplandIds.has(l.id);
      const belId =
        attributedBellerIdForLead({
          lead: l,
          isIngepland,
          ingeplandDoorId: ingeplandDoorByLead.get(l.id),
          fallbackBellerId: orphanFallback,
          skipAdminIds: skipNonCallerIds,
        }) || "__onbekend__";

      if (filterBeller && belId !== filterBeller) continue;

      const aa = ensureBel(w.weekKey, belId);
      wa.gebeld += 1;
      aa.gebeld += 1;

      if (isIngepland) {
        wa.ingepland += 1;
        aa.ingepland += 1;
      } else if (isGeenInteresseStatus(l.status)) {
        wa.geenInteresse += 1;
        aa.geenInteresse += 1;
      } else if (isGeenContactStatus(l.status)) {
        wa.geenContact += 1;
        aa.geenContact += 1;
      }

      const status = (l.status || "").trim().toLowerCase();
      if (status && status !== "nieuw") {
        wa.nonNieuwGebeld += 1;
        aa.nonNieuwGebeld += 1;
        if (isIngepland) {
          wa.nonNieuwIngepland += 1;
          aa.nonNieuwIngepland += 1;
        }
      }
    }

    // Uitval: nieuw-huisbezoeken die deze beller in de week inzette en die
    // geannuleerd zijn (ongeacht herplanning erna).
    for (const a of opts.afspraken) {
      if (!isHuisbezoekSoort(a)) continue;
      if (a.status !== "geannuleerd") continue;
      if (!a.created_at) continue;
      if (!inAmsterdamDayRange(a.created_at, start, end)) continue;

      const door = (a.ingepland_door_id || "").trim();
      let belId = door || "";
      if (!belId || skipNonCallerIds.has(belId)) {
        belId = orphanFallback || "__onbekend__";
      }
      if (!allowedCallerIds.has(belId) && belId !== "__onbekend__") {
        belId = orphanFallback || "__onbekend__";
      }
      if (filterBeller && belId !== filterBeller) continue;

      const aa = ensureBel(w.weekKey, belId);
      wa.geannuleerd += 1;
      aa.geannuleerd += 1;
    }
  }

  const series: BelWeekBucket[] = weeks.map((w) => {
    const acc = weekAcc.get(w.weekKey) || newAcc();
    const bells = weekBelAcc.get(w.weekKey) || new Map();
    const bellerRows: BelBellerRow[] = [...bells.entries()]
      .filter(
        ([key]) => key === "__onbekend__" || allowedCallerIds.has(key)
      )
      .map(([key, a]) => ({
        key,
        label:
          key === "__onbekend__"
            ? "Onbekend"
            : naamById.get(key) || key,
        ...finalizeMetrics(a),
      }))
      .filter(
        (r) =>
          r.gebeld > 0 ||
          r.ingepland > 0 ||
          r.geenInteresse > 0 ||
          r.geenContact > 0 ||
          r.geannuleerd > 0
      )
      .sort(
        (a, b) =>
          b.ingepland - a.ingepland ||
          b.gebeld - a.gebeld ||
          a.label.localeCompare(b.label, "nl")
      );
    return {
      weekKey: w.weekKey,
      label: w.label,
      startYmd: w.startYmd,
      endYmd: w.endYmd,
      ...finalizeMetrics(acc),
      bellers: bellerRows,
    };
  });

  const monthMap = new Map<string, BelWeekBucket[]>();
  for (const wk of series) {
    const mk = monthKeyFromYmd(wk.startYmd);
    if (!monthMap.has(mk)) monthMap.set(mk, []);
    monthMap.get(mk)!.push(wk);
  }

  const months: BelMonthBucket[] = [...monthMap.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, weekList]) => {
      const sorted = [...weekList].sort((a, b) =>
        b.startYmd.localeCompare(a.startYmd)
      );
      const sum = sorted.reduce((s, w) => {
        // Reconstruct Acc from metrics is lossy for nonNieuw — re-sum via weekAcc
        const a = weekAcc.get(w.weekKey) || newAcc();
        return addAcc(s, a);
      }, newAcc());
      return {
        monthKey,
        label: monthLabel(monthKey),
        startYmd: sorted[sorted.length - 1]?.startYmd || startYmd,
        endYmd: sorted[0]?.endYmd || endYmd,
        ...finalizeMetrics(sum),
        weeks: sorted,
      };
    });

  const totals = finalizeMetrics(
    series.reduce((s, w) => addAcc(s, weekAcc.get(w.weekKey) || newAcc()), newAcc())
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
