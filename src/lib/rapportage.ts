import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  getISOWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { nl } from "date-fns/locale";

const TZ = "Europe/Amsterdam";

export type RapportageMetrics = {
  leads: number;
  deals: number;
  conversie: number;
  bemVol: number;
  omzetExBtw: number;
  projectkosten: number;
  omzet: number;
  omzetPerDeal: number;
  salesKosten: number;
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
    deals: 0,
    conversie: 0,
    bemVol: 0,
    omzetExBtw: 0,
    projectkosten: 0,
    omzet: 0,
    omzetPerDeal: 0,
    salesKosten: 0,
    adSpend: 0,
    winst: 0,
  };
}

export function finalizeMetrics(m: RapportageMetrics): RapportageMetrics {
  const omzet = round2(m.omzetExBtw - m.projectkosten);
  const winst = round2(m.omzetExBtw - m.projectkosten - m.adSpend - m.salesKosten);
  return {
    ...m,
    omzetExBtw: round2(m.omzetExBtw),
    projectkosten: round2(m.projectkosten),
    omzet,
    omzetPerDeal: m.deals > 0 ? round2(omzet / m.deals) : 0,
    salesKosten: round2(m.salesKosten),
    adSpend: round2(m.adSpend),
    winst,
    conversie: m.leads > 0 ? Math.round((m.deals / m.leads) * 1000) / 10 : 0,
    bemVol: round2(m.omzetExBtw),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function addMetrics(a: RapportageMetrics, b: RapportageMetrics): RapportageMetrics {
  return {
    leads: a.leads + b.leads,
    deals: a.deals + b.deals,
    conversie: 0,
    bemVol: 0,
    omzetExBtw: a.omzetExBtw + b.omzetExBtw,
    projectkosten: a.projectkosten + b.projectkosten,
    omzet: 0,
    omzetPerDeal: 0,
    salesKosten: a.salesKosten + b.salesKosten,
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

export type RapportageRaw = {
  leads: { id: string; created_at: string; status: string; adviseur_id: string | null }[];
  offertes: {
    id: string;
    lead_id: string;
    status: string;
    ondertekend_op: string | null;
    created_at: string;
    subtotaal_ex_btw: number;
    adviseur_id: string | null;
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
};

export function buildRapportageTree(
  raw: RapportageRaw,
  adviseurId: string | null
): RapportageNode[] {
  const leads = adviseurId
    ? raw.leads.filter((l) => l.adviseur_id === adviseurId)
    : raw.leads;
  const offertes = adviseurId
    ? raw.offertes.filter((o) => o.adviseur_id === adviseurId)
    : raw.offertes;
  const projecten = adviseurId
    ? raw.projecten.filter((p) => p.adviseur_id === adviseurId)
    : raw.projecten;
  const kosten = adviseurId
    ? raw.kosten.filter((k) => !k.adviseur_id || k.adviseur_id === adviseurId)
    : raw.kosten;

  const signed = offertes.filter(
    (o) => o.status === "ondertekend" && o.ondertekend_op
  );

  const now = toZonedTime(new Date(), TZ);
  const years = new Map<number, Date>();

  for (const l of leads) {
    const y = Number(formatInTimeZone(l.created_at, TZ, "yyyy"));
    years.set(y, new Date(Date.UTC(y, 0, 1)));
  }
  for (const o of signed) {
    const y = Number(formatInTimeZone(o.ondertekend_op!, TZ, "yyyy"));
    years.set(y, new Date(Date.UTC(y, 0, 1)));
  }
  for (const k of kosten) {
    const y = Number(k.datum.slice(0, 4));
    years.set(y, new Date(Date.UTC(y, 0, 1)));
  }
  // Altijd huidig jaar tonen
  years.set(now.getFullYear(), new Date(Date.UTC(now.getFullYear(), 0, 1)));

  const yearList = [...years.keys()].sort((a, b) => b - a);

  function metricsFor(start: Date, end: Date): RapportageMetrics {
    const m = emptyMetrics();
    for (const l of leads) {
      if (inRange(l.created_at, start, end)) m.leads += 1;
    }
    for (const o of signed) {
      if (!inRange(o.ondertekend_op!, start, end)) continue;
      m.deals += 1;
      m.omzetExBtw += Number(o.subtotaal_ex_btw) || 0;
    }
    for (const p of projecten) {
      // projectkosten tellen mee in de periode van de gekoppelde deal/offerte of project created
      const signedOff = signed.find((o) => o.id === p.offerte_id);
      const when = signedOff?.ondertekend_op || p.created_at;
      if (!inRange(when, start, end)) continue;
      m.projectkosten += Number(p.projectkosten) || 0;
    }
    for (const k of kosten) {
      const iso = `${k.datum}T12:00:00+02:00`;
      if (!inRange(iso, start, end)) continue;
      if (k.soort === "ad_spend") m.adSpend += Number(k.bedrag) || 0;
      if (k.soort === "sales") m.salesKosten += Number(k.bedrag) || 0;
    }
    return finalizeMetrics(m);
  }

  return yearList.map((year) => {
    const yStart = startOfYear(new Date(year, 0, 1));
    const yEnd = endOfYear(new Date(year, 0, 1));
    const months: RapportageNode[] = [];

    for (let month = 0; month < 12; month++) {
      const mStart = startOfMonth(new Date(year, month, 1));
      const mEnd = endOfMonth(mStart);
      if (mStart > now && year === now.getFullYear()) break;
      if (mEnd < new Date(year, 0, 1)) continue;

      const weeks: RapportageNode[] = [];
      let cursor = startOfWeek(mStart, { weekStartsOn: 1 });
      while (cursor <= mEnd) {
        const wStart = cursor < mStart ? mStart : cursor;
        const wEndRaw = endOfWeek(cursor, { weekStartsOn: 1 });
        const wEnd = wEndRaw > mEnd ? mEnd : wEndRaw;
        if (wStart <= now) {
          const days: RapportageNode[] = [];
          let d = startOfDay(wStart);
          while (d <= wEnd) {
            if (d <= now) {
              const dStart = startOfDay(d);
              const dEnd = endOfDay(d);
              const label = formatInTimeZone(d, TZ, "EEE d MMM", { locale: nl });
              days.push({
                key: `day-${dayKey(d)}`,
                level: "day",
                label,
                start: dStart.toISOString(),
                end: dEnd.toISOString(),
                isCurrent: dayKey(d) === dayKey(now),
                metrics: metricsFor(dStart, dEnd),
              });
            }
            d = new Date(d.getTime() + 86400000);
          }
          days.reverse(); // recentste dag eerst
          const weekNum = getISOWeek(cursor);
          const weekLabel = `W${weekNum} · ${formatInTimeZone(wStart, TZ, "d MMM", { locale: nl })} – ${formatInTimeZone(wEnd, TZ, "d MMM", { locale: nl })}`;
          weeks.push({
            key: `week-${year}-W${weekNum}-${dayKey(wStart)}`,
            level: "week",
            label: weekLabel,
            start: wStart.toISOString(),
            end: endOfDay(wEnd).toISOString(),
            isCurrent:
              now >= wStart && now <= endOfDay(wEnd),
            metrics: metricsFor(wStart, endOfDay(wEnd)),
            children: days,
          });
        }
        cursor = new Date(cursor.getTime() + 7 * 86400000);
      }

      const monthMetrics = weeks.reduce(
        (acc, w) => addMetrics(acc, w.metrics),
        emptyMetrics()
      );
      months.push({
        key: `month-${year}-${String(month + 1).padStart(2, "0")}`,
        level: "month",
        label: `${year}-${String(month + 1).padStart(2, "0")}`,
        start: mStart.toISOString(),
        end: mEnd.toISOString(),
        isCurrent:
          now.getFullYear() === year && now.getMonth() === month,
        metrics: finalizeMetrics(monthMetrics),
        children: weeks,
      });
    }

    months.reverse(); // recentste maand eerst within display - actually keep chrono ascending for expand, or reverse for recent first like screenshot
    // Screenshot shows 2026 then expanding to months - years desc, months can be ascending with current near end or descending
    const yearMetrics = months.reduce(
      (acc, m) => addMetrics(acc, m.metrics),
      emptyMetrics()
    );

    return {
      key: `year-${year}`,
      level: "year" as const,
      label: String(year),
      start: yStart.toISOString(),
      end: yEnd.toISOString(),
      isCurrent: now.getFullYear() === year,
      metrics: finalizeMetrics(yearMetrics),
      children: months,
    };
  });
}
