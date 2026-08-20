import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import {
  endOfWeek,
  getISOWeek,
  startOfWeek,
} from "date-fns";
import { nl } from "date-fns/locale";
import { STANDAARD_INSTALLATIEKOSTEN, hardwareKostenVoorRegels } from "@/lib/project-kosten";
import { factuurIsBetaald } from "@/lib/aanbetaling";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";

const TZ = "Europe/Amsterdam";

function amsStartOfDay(year: number, month1: number, day: number): Date {
  return fromZonedTime(new Date(year, month1 - 1, day, 0, 0, 0, 0), TZ);
}

function amsEndOfDay(year: number, month1: number, day: number): Date {
  return fromZonedTime(new Date(year, month1 - 1, day, 23, 59, 59, 999), TZ);
}

function amsStartOfMonth(year: number, month1: number): Date {
  return amsStartOfDay(year, month1, 1);
}

function amsEndOfMonth(year: number, month1: number): Date {
  const last = new Date(year, month1, 0).getDate();
  return amsEndOfDay(year, month1, last);
}

function amsStartOfYear(year: number): Date {
  return amsStartOfDay(year, 1, 1);
}

function amsEndOfYear(year: number): Date {
  return amsEndOfDay(year, 12, 31);
}

function amsYmd(d: Date) {
  return {
    y: Number(formatInTimeZone(d, TZ, "yyyy")),
    m: Number(formatInTimeZone(d, TZ, "M")),
    d: Number(formatInTimeZone(d, TZ, "d")),
  };
}

export type RapportageMetrics = {
  leads: number;
  /** Unieke leads met een niet-geannuleerde afspraak (voor conversie). */
  afspraken: number;
  /** Alle afspraken in de periode, inclusief geannuleerd. */
  brutoAfspraken: number;
  /** Afspraken die niet geannuleerd zijn. */
  nettoAfspraken: number;
  /** Geannuleerd ÷ bruto, in procenten. */
  uitvalPct: number;
  deals: number;
  conversieAfspraak: number;
  conversieDeal: number;
  omzetExBtw: number;
  projectkosten: number;
  inkoop: number;
  omzet: number;
  betaaldeOmzet: number;
  adSpend: number;
  winst: number;
};

export type RapportageNode = {
  key: string;
  level: "year" | "month" | "week" | "day";
  label: string;
  start: string;
  end: string;
  isCurrent: boolean;
  metrics: RapportageMetrics;
  children?: RapportageNode[];
};

export function emptyMetrics(): RapportageMetrics {
  return {
    leads: 0,
    afspraken: 0,
    brutoAfspraken: 0,
    nettoAfspraken: 0,
    uitvalPct: 0,
    deals: 0,
    conversieAfspraak: 0,
    conversieDeal: 0,
    omzetExBtw: 0,
    projectkosten: 0,
    inkoop: 0,
    omzet: 0,
    betaaldeOmzet: 0,
    adSpend: 0,
    winst: 0,
  };
}

export function finalizeMetrics(m: RapportageMetrics): RapportageMetrics {
  const omzet = round2(m.omzetExBtw);
  const winst = round2(m.omzetExBtw - m.projectkosten - m.inkoop - m.adSpend);
  return {
    ...m,
    omzetExBtw: round2(m.omzetExBtw),
    projectkosten: round2(m.projectkosten),
    inkoop: round2(m.inkoop),
    omzet,
    betaaldeOmzet: round2(m.betaaldeOmzet),
    adSpend: round2(m.adSpend),
    winst,
    conversieAfspraak:
      m.leads > 0 ? Math.round((m.afspraken / m.leads) * 1000) / 10 : 0,
    conversieDeal:
      m.leads > 0 ? Math.round((m.deals / m.leads) * 1000) / 10 : 0,
    uitvalPct:
      m.brutoAfspraken > 0
        ? Math.round(
            ((m.brutoAfspraken - m.nettoAfspraken) / m.brutoAfspraken) * 1000
          ) / 10
        : 0,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function addMetrics(a: RapportageMetrics, b: RapportageMetrics): RapportageMetrics {
  return {
    leads: a.leads + b.leads,
    afspraken: a.afspraken + b.afspraken,
    brutoAfspraken: a.brutoAfspraken + b.brutoAfspraken,
    nettoAfspraken: a.nettoAfspraken + b.nettoAfspraken,
    uitvalPct: 0,
    deals: a.deals + b.deals,
    conversieAfspraak: 0,
    conversieDeal: 0,
    omzetExBtw: a.omzetExBtw + b.omzetExBtw,
    projectkosten: a.projectkosten + b.projectkosten,
    inkoop: a.inkoop + b.inkoop,
    omzet: 0,
    betaaldeOmzet: a.betaaldeOmzet + b.betaaldeOmzet,
    adSpend: a.adSpend + b.adSpend,
    winst: 0,
  };
}

function dayKey(d: Date) {
  return formatInTimeZone(d, TZ, "yyyy-MM-dd");
}

function inRange(iso: string, start: Date, end: Date) {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function factuurBetaalIso(f: {
  status: string;
  betaald_op: string | null;
  factuurdatum: string;
}): string | null {
  if (f.status === "concept" || f.status === "vervallen") return null;
  if (!factuurIsBetaald(f.status, f.betaald_op)) return null;
  const raw = f.betaald_op || f.factuurdatum;
  if (!raw) return null;
  if (raw.length <= 10) return `${raw}T12:00:00+02:00`;
  return raw;
}

export type RapportageRaw = {
  leads: { id: string; created_at: string; status: string; adviseur_id: string | null }[];
  afspraken: {
    id: string;
    lead_id: string;
    adviseur_id: string | null;
    start_at: string;
    status: string;
    soort?: string | null;
  }[];
  offertes: {
    id: string;
    lead_id: string;
    status: string;
    ondertekend_op: string | null;
    created_at: string;
    subtotaal_ex_btw: number;
    adviseur_id: string | null;
    regels?: { omschrijving?: string | null; aantal?: number | null }[];
  }[];
  projecten: {
    id: string;
    lead_id: string;
    offerte_id: string | null;
    created_at: string;
    projectkosten: number;
    adviseur_id: string | null;
  }[];
  kosten: {
    datum: string;
    soort: "ad_spend" | "sales";
    bedrag: number;
    adviseur_id: string | null;
  }[];
  facturen: {
    id: string;
    lead_id: string;
    status: string;
    bedrag_ex_btw: number;
    betaald_op: string | null;
    factuurdatum: string;
    adviseur_id: string | null;
  }[];
};

export function buildRapportageTree(
  raw: RapportageRaw,
  adviseurId: string | null
): RapportageNode[] {
  const leads = adviseurId
    ? raw.leads.filter((l) => l.adviseur_id === adviseurId)
    : raw.leads;
  const afspraken = (adviseurId
    ? raw.afspraken.filter((a) => a.adviseur_id === adviseurId)
    : raw.afspraken
  ).filter((a) => afspraakBlokkeertAgenda(a.soort));
  const offertes = adviseurId
    ? raw.offertes.filter((o) => o.adviseur_id === adviseurId)
    : raw.offertes;
  const projecten = adviseurId
    ? raw.projecten.filter((p) => p.adviseur_id === adviseurId)
    : raw.projecten;
  const kosten = adviseurId
    ? raw.kosten.filter((k) => !k.adviseur_id || k.adviseur_id === adviseurId)
    : raw.kosten;
  const facturen = adviseurId
    ? (raw.facturen || []).filter((f) => f.adviseur_id === adviseurId)
    : raw.facturen || [];

  const signed = offertes.filter(
    (o) => o.status === "ondertekend" && o.ondertekend_op
  );

  const now = new Date();
  const nowParts = amsYmd(now);
  const years = new Map<number, true>();

  for (const l of leads) {
    years.set(Number(formatInTimeZone(l.created_at, TZ, "yyyy")), true);
  }
  for (const a of afspraken) {
    years.set(Number(formatInTimeZone(a.start_at, TZ, "yyyy")), true);
  }
  for (const o of signed) {
    years.set(Number(formatInTimeZone(o.ondertekend_op!, TZ, "yyyy")), true);
  }
  for (const k of kosten) {
    years.set(Number(k.datum.slice(0, 4)), true);
  }
  for (const f of facturen) {
    const iso = factuurBetaalIso(f);
    if (!iso) continue;
    years.set(Number(formatInTimeZone(iso, TZ, "yyyy")), true);
  }
  years.set(nowParts.y, true);

  const yearList = [...years.keys()].sort((a, b) => b - a);

  function metricsFor(start: Date, end: Date): RapportageMetrics {
    const m = emptyMetrics();
    for (const l of leads) {
      if (inRange(l.created_at, start, end)) m.leads += 1;
    }
    const afspraakLeads = new Set<string>();
    for (const a of afspraken) {
      if (!inRange(a.start_at, start, end)) continue;
      m.brutoAfspraken += 1;
      if (a.status !== "geannuleerd") {
        m.nettoAfspraken += 1;
        afspraakLeads.add(a.lead_id);
      }
    }
    m.afspraken = afspraakLeads.size;
    for (const o of signed) {
      if (!inRange(o.ondertekend_op!, start, end)) continue;
      m.deals += 1;
      m.omzetExBtw += Number(o.subtotaal_ex_btw) || 0;
      const project = projecten.find((p) => p.offerte_id === o.id);
      const kosten = Number(project?.projectkosten) || 0;
      m.projectkosten +=
        kosten > 0 ? kosten : STANDAARD_INSTALLATIEKOSTEN;
      m.inkoop += hardwareKostenVoorRegels(o.regels || []).totaal;
    }
    for (const k of kosten) {
      const iso = `${k.datum}T12:00:00+02:00`;
      if (!inRange(iso, start, end)) continue;
      if (k.soort === "ad_spend") m.adSpend += Number(k.bedrag) || 0;
    }
    for (const f of facturen) {
      const iso = factuurBetaalIso(f);
      if (!iso || !inRange(iso, start, end)) continue;
      m.betaaldeOmzet += Number(f.bedrag_ex_btw) || 0;
    }
    return finalizeMetrics(m);
  }

  return yearList.map((year) => {
    const yStart = amsStartOfYear(year);
    // Huidig jaar: alleen t/m vandaag — anders tellen toekomstige afspraken
    // mee in het jaartotaal terwijl die maanden nog niet zichtbaar zijn.
    const yEnd =
      year === nowParts.y
        ? amsEndOfDay(nowParts.y, nowParts.m, nowParts.d)
        : amsEndOfYear(year);
    const months: RapportageNode[] = [];
    const lastMonth = year === nowParts.y ? nowParts.m : 12;

    for (let month1 = 1; month1 <= lastMonth; month1++) {
      const mStart = amsStartOfMonth(year, month1);
      const mEndRaw = amsEndOfMonth(year, month1);
      const mEnd =
        year === nowParts.y && month1 === nowParts.m ? yEnd : mEndRaw;

      const weeks: RapportageNode[] = [];
      const localMonthStart = toZonedTime(mStart, TZ);
      let cursor = startOfWeek(localMonthStart, { weekStartsOn: 1 });
      const localMonthEnd = toZonedTime(mEnd, TZ);

      while (cursor <= localMonthEnd) {
        const cursorParts = {
          y: cursor.getFullYear(),
          m: cursor.getMonth() + 1,
          d: cursor.getDate(),
        };
        const weekStartLocal = cursor < localMonthStart ? localMonthStart : cursor;
        const weekEndLocalRaw = endOfWeek(cursor, { weekStartsOn: 1 });
        const weekEndLocal =
          weekEndLocalRaw > localMonthEnd ? localMonthEnd : weekEndLocalRaw;

        const wStart = amsStartOfDay(
          weekStartLocal.getFullYear(),
          weekStartLocal.getMonth() + 1,
          weekStartLocal.getDate()
        );
        let wEnd = amsEndOfDay(
          weekEndLocal.getFullYear(),
          weekEndLocal.getMonth() + 1,
          weekEndLocal.getDate()
        );
        if (wEnd > mEnd) wEnd = mEnd;

        if (wStart <= now) {
          const days: RapportageNode[] = [];
          let dCursor = new Date(weekStartLocal);
          while (dCursor <= weekEndLocal) {
            const dp = {
              y: dCursor.getFullYear(),
              m: dCursor.getMonth() + 1,
              d: dCursor.getDate(),
            };
            const dStart = amsStartOfDay(dp.y, dp.m, dp.d);
            let dEnd = amsEndOfDay(dp.y, dp.m, dp.d);
            if (dEnd > mEnd) dEnd = mEnd;
            if (dStart <= now) {
              const label = formatInTimeZone(dStart, TZ, "EEE d MMM", {
                locale: nl,
              });
              days.push({
                key: `day-${dayKey(dStart)}`,
                level: "day",
                label,
                start: dStart.toISOString(),
                end: dEnd.toISOString(),
                isCurrent: dayKey(dStart) === dayKey(now),
                metrics: metricsFor(dStart, dEnd),
              });
            }
            dCursor = new Date(
              dCursor.getFullYear(),
              dCursor.getMonth(),
              dCursor.getDate() + 1
            );
          }
          days.reverse();
          const weekNum = getISOWeek(cursor);
          const weekLabel = `W${weekNum} · ${formatInTimeZone(wStart, TZ, "d MMM", { locale: nl })} – ${formatInTimeZone(wEnd, TZ, "d MMM", { locale: nl })}`;
          weeks.push({
            key: `week-${year}-W${weekNum}-${dayKey(wStart)}`,
            level: "week",
            label: weekLabel,
            start: wStart.toISOString(),
            end: wEnd.toISOString(),
            isCurrent: now >= wStart && now <= wEnd,
            metrics: metricsFor(wStart, wEnd),
            children: days,
          });
        }

        cursor = new Date(
          cursorParts.y,
          cursorParts.m - 1,
          cursorParts.d + 7
        );
      }

      months.push({
        key: `month-${year}-${String(month1).padStart(2, "0")}`,
        level: "month",
        label: `${year}-${String(month1).padStart(2, "0")}`,
        start: mStart.toISOString(),
        end: mEnd.toISOString(),
        isCurrent: nowParts.y === year && nowParts.m === month1,
        metrics: metricsFor(mStart, mEnd),
        children: weeks,
      });
    }

    return {
      key: `year-${year}`,
      level: "year" as const,
      label: String(year),
      start: yStart.toISOString(),
      end: yEnd.toISOString(),
      isCurrent: nowParts.y === year,
      metrics: metricsFor(yStart, yEnd),
      children: months,
    };
  });
}
