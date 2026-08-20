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
import { STANDAARD_INSTALLATIEKOSTEN, hardwareKostenVoorRegels } from "@/lib/project-kosten";
import { factuurIsBetaald } from "@/lib/aanbetaling";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";

const TZ = "Europe/Amsterdam";

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

  const now = toZonedTime(new Date(), TZ);
  const years = new Map<number, Date>();

  for (const l of leads) {
    const y = Number(formatInTimeZone(l.created_at, TZ, "yyyy"));
    years.set(y, new Date(Date.UTC(y, 0, 1)));
  }
  for (const a of afspraken) {
    const y = Number(formatInTimeZone(a.start_at, TZ, "yyyy"));
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
  for (const f of facturen) {
    const iso = factuurBetaalIso(f);
    if (!iso) continue;
    const y = Number(formatInTimeZone(iso, TZ, "yyyy"));
    years.set(y, new Date(Date.UTC(y, 0, 1)));
  }
  years.set(now.getFullYear(), new Date(Date.UTC(now.getFullYear(), 0, 1)));

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
    const yStart = startOfYear(new Date(year, 0, 1));
    const yEnd = endOfYear(new Date(year, 0, 1));
    const months: RapportageNode[] = [];

    for (let month = 0; month < 12; month++) {
      const mStart = startOfMonth(new Date(year, month, 1));
      const mEnd = endOfMonth(mStart);
      if (mStart > now && year === now.getFullYear()) break;

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
          days.reverse();
          const weekNum = getISOWeek(cursor);
          const weekLabel = `W${weekNum} · ${formatInTimeZone(wStart, TZ, "d MMM", { locale: nl })} – ${formatInTimeZone(wEnd, TZ, "d MMM", { locale: nl })}`;
          weeks.push({
            key: `week-${year}-W${weekNum}-${dayKey(wStart)}`,
            level: "week",
            label: weekLabel,
            start: wStart.toISOString(),
            end: endOfDay(wEnd).toISOString(),
            isCurrent: now >= wStart && now <= endOfDay(wEnd),
            metrics: metricsFor(wStart, endOfDay(wEnd)),
            children: days,
          });
        }
        cursor = new Date(cursor.getTime() + 7 * 86400000);
      }

      months.push({
        key: `month-${year}-${String(month + 1).padStart(2, "0")}`,
        level: "month",
        label: `${year}-${String(month + 1).padStart(2, "0")}`,
        start: mStart.toISOString(),
        end: mEnd.toISOString(),
        isCurrent: now.getFullYear() === year && now.getMonth() === month,
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
      isCurrent: now.getFullYear() === year,
      metrics: metricsFor(yStart, yEnd),
      children: months,
    };
  });
}
