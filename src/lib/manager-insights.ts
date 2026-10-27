/**
 * Manager Insights: actiepunten per unit (Leads · Bellen · Sales)
 * obv targets + capaciteit + regio vs planning-diagnose.
 */

import { addDays, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  DEFAULT_TARGETS,
  parseAdminTargetsStore,
  resolvePersonTargets,
} from "@/lib/admin-targets";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeRol } from "@/lib/rollen";
import {
  postcodeFromAdres,
  provincieVanPostcode,
} from "@/lib/postcode-provincie";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

export type InsightSeverity = "kritiek" | "aandacht" | "ok" | "info";

export type ManagerInsight = {
  id: string;
  unit: "leads" | "bellen" | "sales";
  severity: InsightSeverity;
  title: string;
  detail: string;
  /** Korte diagnose / oorzaak */
  diagnose: string | null;
  /** Meetcijfers voor de UI */
  metrics?: { label: string; value: string }[];
};

export type ManagerInsightsResult = {
  generatedAt: string;
  periodLabel: string;
  units: {
    id: "leads" | "bellen" | "sales";
    label: string;
    summary: string;
    insights: ManagerInsight[];
  }[];
};

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function amsBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  return {
    start: fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ),
    end: fromZonedTime(new Date(y, m - 1, d, 23, 59, 59, 999), AMSTERDAM_TZ),
  };
}

function pctDelta(actual: number, target: number): number | null {
  if (target <= 0) return null;
  return Math.round(((actual - target) / target) * 1000) / 10;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
}

function isNieuw(soort: string | null | undefined): boolean {
  return normalizeAfspraakSoort(soort) === "nieuw";
}

type AdvRow = {
  id: string;
  naam: string;
  actief?: boolean | null;
  rol?: string | null;
  email?: string | null;
  start_adres?: string | null;
  startdatum?: string | null;
};

type LeadRow = {
  id: string;
  created_at: string;
  postcode?: string | null;
  status?: string | null;
  laatst_gebeld_at?: string | null;
  laatst_gebeld_door?: string | null;
  beller_id?: string | null;
  bel_claimed_by?: string | null;
};

type AfsRow = {
  id: string;
  adviseur_id: string | null;
  lead_id: string;
  start_at: string;
  created_at: string | null;
  status: string | null;
  soort: string | null;
  ingepland_door_id?: string | null;
};

/**
 * Bouw manager insights voor de huidige week (Amsterdam).
 */
export async function buildManagerInsights(
  sb: SupabaseClient,
  now = new Date()
): Promise<ManagerInsightsResult> {
  const z = toZonedTime(now, AMSTERDAM_TZ);
  const monLocal = startOfWeek(z, { weekStartsOn: 1 });
  const weekStartYmd = ymdAmsterdam(
    fromZonedTime(
      new Date(
        monLocal.getFullYear(),
        monLocal.getMonth(),
        monLocal.getDate(),
        12,
        0,
        0
      ),
      AMSTERDAM_TZ
    )
  );
  const weekEndYmd = ymdAmsterdam(
    addDays(noonFromYmd(weekStartYmd), 6)
  );
  const lookbackStartYmd = ymdAmsterdam(addDays(noonFromYmd(weekStartYmd), -21));
  const todayYmd = ymdAmsterdam(now);

  const weekEndIso = amsBounds(weekEndYmd).end.toISOString();
  const lookbackIso = amsBounds(lookbackStartYmd).start.toISOString();
  const todayEndIso = amsBounds(todayYmd).end.toISOString();

  const [{ data: adviseursRaw }, { data: goalsRow }, leads, afspraken] =
    await Promise.all([
      sb
        .from("adviseurs")
        .select("id, naam, actief, rol, email, start_adres, startdatum")
        .eq("actief", true)
        .order("naam"),
      sb
        .from("dashboard_instellingen")
        .select("dashboard_v2_doelen")
        .eq("actief", true)
        .limit(1)
        .maybeSingle(),
      fetchAllRows<LeadRow>((fromIdx, toIdx) =>
        sb
          .from("leads")
          .select(
            "id, created_at, postcode, status, laatst_gebeld_at, laatst_gebeld_door, beller_id, bel_claimed_by"
          )
          .gte("created_at", lookbackIso)
          .lte("created_at", todayEndIso)
          .order("created_at", { ascending: true })
          .range(fromIdx, toIdx)
      ),
      fetchAllRows<AfsRow>((fromIdx, toIdx) =>
        sb
          .from("afspraken")
          .select(
            "id, adviseur_id, lead_id, start_at, created_at, status, soort, ingepland_door_id"
          )
          .gte("start_at", lookbackIso)
          .lte("start_at", weekEndIso)
          .neq("status", "geannuleerd")
          .order("start_at", { ascending: true })
          .range(fromIdx, toIdx)
      ),
    ]);

  const store = parseAdminTargetsStore(
    (goalsRow as { dashboard_v2_doelen?: unknown } | null)?.dashboard_v2_doelen
  );
  const teamTargets = store.defaults.team || DEFAULT_TARGETS.team;
  const defaultAdv = store.defaults.adviseur || DEFAULT_TARGETS.adviseur;
  const defaultBel = store.defaults.beller || DEFAULT_TARGETS.beller;

  const allAdv = (adviseursRaw || []) as AdvRow[];
  const salesAdviseurs = allAdv.filter((a) => isPlanbaarAdviseur(a));
  const bellers = allAdv.filter((a) => {
    const r = normalizeRol(a.rol);
    return r === "beller" || r === "backoffice";
  });

  // —— Leads deze week vs target ——
  const leadsDezeWeek = leads.filter((l) => {
    const ymd = formatInTimeZone(
      new Date(l.created_at),
      AMSTERDAM_TZ,
      "yyyy-MM-dd"
    );
    return ymd >= weekStartYmd && ymd <= todayYmd;
  });
  const daysElapsed = Math.max(
    1,
    Math.round(
      (noonFromYmd(todayYmd).getTime() - noonFromYmd(weekStartYmd).getTime()) /
        86_400_000
    ) + 1
  );
  const daysInWeek = 7;
  const leadTargetWeek = teamTargets.leads || DEFAULT_TARGETS.team.leads;
  const leadPaceTarget = (leadTargetWeek * daysElapsed) / daysInWeek;
  const leadDelta = pctDelta(leadsDezeWeek.length, leadPaceTarget);

  const leadsInsights: ManagerInsight[] = [];
  if (leadDelta != null && leadDelta < -15) {
    leadsInsights.push({
      id: "leads-achter",
      unit: "leads",
      severity: leadDelta < -35 ? "kritiek" : "aandacht",
      title: `Leads ${fmtPct(leadDelta)} achter op weekdoel`,
      detail: `${leadsDezeWeek.length} leads t/m vandaag vs tempo-doel ~${Math.round(leadPaceTarget)} (weekdoel ${leadTargetWeek}).`,
      diagnose: "Leadvolume te laag t.o.v. target — check Meta spend / CPL of belbaar volume.",
      metrics: [
        { label: "Actual", value: String(leadsDezeWeek.length) },
        { label: "Tempo-doel", value: `~${Math.round(leadPaceTarget)}` },
        { label: "Weekdoel", value: String(leadTargetWeek) },
      ],
    });
  } else if (leadDelta != null && leadDelta > 15) {
    leadsInsights.push({
      id: "leads-voor",
      unit: "leads",
      severity: "ok",
      title: `Leads ${fmtPct(leadDelta)} voor op weekdoel`,
      detail: `${leadsDezeWeek.length} leads t/m vandaag vs tempo-doel ~${Math.round(leadPaceTarget)}.`,
      diagnose: "Leadinstroom loopt voor — zorg dat belcapaciteit en agenda’s meegroeien.",
      metrics: [
        { label: "Actual", value: String(leadsDezeWeek.length) },
        { label: "Tempo-doel", value: `~${Math.round(leadPaceTarget)}` },
      ],
    });
  } else {
    leadsInsights.push({
      id: "leads-op-schema",
      unit: "leads",
      severity: "info",
      title: "Leads rond weekdoel",
      detail: `${leadsDezeWeek.length} leads t/m vandaag (tempo-doel ~${Math.round(leadPaceTarget)}, week ${leadTargetWeek}).`,
      diagnose: null,
      metrics: [
        { label: "Actual", value: String(leadsDezeWeek.length) },
        { label: "Weekdoel", value: String(leadTargetWeek) },
      ],
    });
  }

  // —— Bellen: gebeld/ingepland deze week per beller vs doel ——
  const belInsights: ManagerInsight[] = [];
  const afsIngeplandDezeWeek = afspraken.filter((a) => {
    if (!isNieuw(a.soort)) return false;
    const at = a.created_at || a.start_at;
    const ymd = formatInTimeZone(new Date(at), AMSTERDAM_TZ, "yyyy-MM-dd");
    return ymd >= weekStartYmd && ymd <= todayYmd;
  });

  const knownPlannerIds = new Set([
    ...bellers.map((b) => b.id),
    ...salesAdviseurs.map((s) => s.id),
  ]);
  const ingeplandByBeller = new Map<string, number>();
  for (const a of afsIngeplandDezeWeek) {
    const id = (a.ingepland_door_id || "").trim();
    if (!id || !knownPlannerIds.has(id)) continue;
    ingeplandByBeller.set(id, (ingeplandByBeller.get(id) || 0) + 1);
  }

  let teamBelDoel = 0;
  for (const b of bellers) {
    const { effective } = resolvePersonTargets(store, "beller", b.id);
    teamBelDoel += effective.afsprakenGepland || defaultBel.afsprakenGepland;
  }
  if (teamBelDoel <= 0) {
    teamBelDoel = defaultBel.afsprakenGepland * Math.max(1, bellers.length);
  }
  const teamBelPace = (teamBelDoel * daysElapsed) / daysInWeek;
  const teamBelActual = afsIngeplandDezeWeek.length;
  const belDelta = pctDelta(teamBelActual, teamBelPace);

  if (belDelta != null && belDelta < -15) {
    belInsights.push({
      id: "bel-achter",
      unit: "bellen",
      severity: belDelta < -35 ? "kritiek" : "aandacht",
      title: `Ingeplande afspraken ${fmtPct(belDelta)} achter op bel-doel`,
      detail: `${teamBelActual} huisbezoeken ingepland deze week vs tempo ~${Math.round(teamBelPace)} (weekdoel ${teamBelDoel}).`,
      diagnose:
        leadDelta != null && leadDelta < -15
          ? "Waarschijnlijk deels door te weinig leads — eerst leadvolume herstellen."
          : "Leads zijn er redelijk; bel/plan-tempo moet omhoog (of L2A te laag).",
      metrics: [
        { label: "Ingepland", value: String(teamBelActual) },
        { label: "Tempo-doel", value: `~${Math.round(teamBelPace)}` },
      ],
    });
  } else if (belDelta != null && belDelta > 10) {
    belInsights.push({
      id: "bel-voor",
      unit: "bellen",
      severity: "ok",
      title: `Bellen ${fmtPct(belDelta)} voor op weekdoel`,
      detail: `${teamBelActual} afspraken ingepland vs tempo ~${Math.round(teamBelPace)}.`,
      diagnose: null,
    });
  }

  const belSorted = [...bellers]
    .map((b) => {
      const { effective } = resolvePersonTargets(store, "beller", b.id);
      const doel = effective.afsprakenGepland || defaultBel.afsprakenGepland;
      const pace = (doel * daysElapsed) / daysInWeek;
      const actual = ingeplandByBeller.get(b.id) || 0;
      return { b, actual, pace, doel, delta: pctDelta(actual, pace) };
    })
    .filter((r) => r.pace >= 1)
    .sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));

  for (const row of belSorted.slice(0, 4)) {
    if (row.delta == null || row.delta >= -20) continue;
    belInsights.push({
      id: `bel-persoon-${row.b.id}`,
      unit: "bellen",
      severity: row.delta < -40 ? "kritiek" : "aandacht",
      title: `${row.b.naam}: ${fmtPct(row.delta)} achter op afspraak-doel`,
      detail: `${row.actual} ingepland vs tempo ~${Math.round(row.pace)} (weekdoel ${row.doel}).`,
      diagnose: "Persoonlijk bel-tempo te laag — check claims, belbaar queue of werktijden.",
      metrics: [
        { label: "Ingepland", value: String(row.actual) },
        { label: "Doel (week)", value: String(row.doel) },
      ],
    });
  }

  if (belInsights.length === 0) {
    belInsights.push({
      id: "bel-ok",
      unit: "bellen",
      severity: "info",
      title: "Bel-planning op schema",
      detail: `${teamBelActual} afspraken ingepland deze week.`,
      diagnose: null,
    });
  }

  // —— Sales: agenda vullen + regio vs planning diagnose ——
  const salesInsights: ManagerInsight[] = [];

  const afsDezeWeekAgenda = afspraken.filter((a) => {
    if (!isNieuw(a.soort)) return false;
    const ymd = formatInTimeZone(
      new Date(a.start_at),
      AMSTERDAM_TZ,
      "yyyy-MM-dd"
    );
    return ymd >= weekStartYmd && ymd <= weekEndYmd;
  });

  const geplandByAdv = new Map<string, number>();
  for (const a of afsDezeWeekAgenda) {
    if (!a.adviseur_id) continue;
    geplandByAdv.set(
      a.adviseur_id,
      (geplandByAdv.get(a.adviseur_id) || 0) + 1
    );
  }

  // Lookback 21d: afspraken per adviseur + leads per provincie
  const afsLookback = afspraken.filter((a) => {
    if (!isNieuw(a.soort)) return false;
    const ymd = formatInTimeZone(
      new Date(a.start_at),
      AMSTERDAM_TZ,
      "yyyy-MM-dd"
    );
    return ymd >= lookbackStartYmd && ymd <= todayYmd;
  });
  const geplandLookbackByAdv = new Map<string, number>();
  for (const a of afsLookback) {
    if (!a.adviseur_id) continue;
    geplandLookbackByAdv.set(
      a.adviseur_id,
      (geplandLookbackByAdv.get(a.adviseur_id) || 0) + 1
    );
  }

  const leadsByProv = new Map<string, number>();
  for (const l of leads) {
    const ymd = formatInTimeZone(
      new Date(l.created_at),
      AMSTERDAM_TZ,
      "yyyy-MM-dd"
    );
    if (ymd < lookbackStartYmd || ymd > todayYmd) continue;
    const prov = provincieVanPostcode(l.postcode) || "(onbekend)";
    leadsByProv.set(prov, (leadsByProv.get(prov) || 0) + 1);
  }

  const avgLookback =
    salesAdviseurs.length > 0
      ? salesAdviseurs.reduce(
          (s, a) => s + (geplandLookbackByAdv.get(a.id) || 0),
          0
        ) / salesAdviseurs.length
      : 0;

  type AdvDiag = {
    adv: AdvRow;
    weekGepland: number;
    weekDoel: number;
    weekGap: number;
    lookbackGepland: number;
    regioLeads: number;
    provincie: string | null;
    diagnose: "regio" | "planning" | "vol" | "ok";
    severity: InsightSeverity;
  };

  const diags: AdvDiag[] = salesAdviseurs.map((adv) => {
    const { effective } = resolvePersonTargets(store, "adviseur", adv.id);
    const weekDoel =
      effective.afsprakenGepland || defaultAdv.afsprakenGepland || 20;
    const weekGepland = geplandByAdv.get(adv.id) || 0;
    const weekGap = weekDoel - weekGepland;
    const lookbackGepland = geplandLookbackByAdv.get(adv.id) || 0;
    const pc = postcodeFromAdres(adv.start_adres || "");
    const provincie = pc ? provincieVanPostcode(pc) : null;
    const regioLeads = provincie ? leadsByProv.get(provincie) || 0 : 0;

    // Relatieve regio-supply: t.o.v. mediaan van adviseurs met bekende provincie
    let diagnose: AdvDiag["diagnose"] = "ok";
    let severity: InsightSeverity = "info";

    if (weekGap >= 8 || (lookbackGepland < avgLookback * 0.55 && avgLookback >= 3)) {
      // Weinig afspraken — regio of planning?
      const regioScores = salesAdviseurs
        .map((a) => {
          const p = postcodeFromAdres(a.start_adres || "");
          const pr = p ? provincieVanPostcode(p) : null;
          return pr ? leadsByProv.get(pr) || 0 : null;
        })
        .filter((n): n is number => n != null)
        .sort((a, b) => a - b);
      const medianRegio =
        regioScores.length > 0
          ? regioScores[Math.floor(regioScores.length / 2)]
          : 0;

      if (provincie && regioLeads < medianRegio * 0.6 && medianRegio >= 5) {
        diagnose = "regio";
        severity = "aandacht";
      } else if (weekGepland < weekDoel * 0.5) {
        diagnose = "planning";
        severity = weekGap >= 12 ? "kritiek" : "aandacht";
      } else if (weekGepland >= weekDoel * 0.85) {
        diagnose = "vol";
        severity = "ok";
      } else {
        diagnose = "planning";
        severity = "aandacht";
      }
    } else if (weekGap <= 0) {
      diagnose = "vol";
      severity = "ok";
    }

    return {
      adv,
      weekGepland,
      weekDoel,
      weekGap,
      lookbackGepland,
      regioLeads,
      provincie,
      diagnose,
      severity,
    };
  });

  const teVullen = [...diags]
    .filter((d) => d.weekGap >= 5)
    .sort((a, b) => b.weekGap - a.weekGap);

  if (teVullen.length > 0) {
    salesInsights.push({
      id: "sales-agenda-leeg",
      unit: "sales",
      severity: teVullen[0].severity === "kritiek" ? "kritiek" : "aandacht",
      title: `${teVullen.length} agenda${teVullen.length === 1 ? "" : "’s"} onder weekdoel`,
      detail: teVullen
        .slice(0, 5)
        .map(
          (d) =>
            `${d.adv.naam}: ${d.weekGepland}/${d.weekDoel} (${d.weekGap} tekort)`
        )
        .join(" · "),
      diagnose: "Prioriteer inplannen op adviseurs met het grootste gat t.o.v. weekdoel.",
      metrics: teVullen.slice(0, 3).map((d) => ({
        label: d.adv.naam,
        value: `${d.weekGepland}/${d.weekDoel}`,
      })),
    });
  }

  for (const d of diags
    .filter((x) => x.diagnose === "regio" || x.diagnose === "planning")
    .sort((a, b) => b.weekGap - a.weekGap)
    .slice(0, 6)) {
    if (d.diagnose === "regio") {
      salesInsights.push({
        id: `sales-regio-${d.adv.id}`,
        unit: "sales",
        severity: d.severity,
        title: `${d.adv.naam}: te weinig leads in regio`,
        detail: `${d.weekGepland}/${d.weekDoel} afspraken deze week. In ${d.provincie || "zijn regio"} kwamen de afgelopen 3 weken ${d.regioLeads} leads binnen — dat is laag t.o.v. andere regio’s.`,
        diagnose:
          "Oorzaak lijkt lead-supply in de regio, niet (alleen) planning. Overweeg meer spend / routing naar deze provincie, of herverdeel leads geografisch.",
        metrics: [
          { label: "Agenda week", value: `${d.weekGepland}/${d.weekDoel}` },
          {
            label: `Leads ${d.provincie || "regio"} (3w)`,
            value: String(d.regioLeads),
          },
          { label: "Gepland (3w)", value: String(d.lookbackGepland) },
        ],
      });
    } else {
      salesInsights.push({
        id: `sales-plan-${d.adv.id}`,
        unit: "sales",
        severity: d.severity,
        title: `${d.adv.naam}: te weinig afspraken gepland`,
        detail: `${d.weekGepland}/${d.weekDoel} op de agenda deze week. Regio ${d.provincie || "onbekend"} had ${d.regioLeads} leads (3w) — supply lijkt niet het knelpunt.`,
        diagnose:
          "Leads in de regio zijn er wél; er wordt te weinig bij deze adviseur ingepland. Check best-slots/route, beschikbaarheid, of bellers die hem overslaan.",
        metrics: [
          { label: "Agenda week", value: `${d.weekGepland}/${d.weekDoel}` },
          {
            label: `Leads ${d.provincie || "regio"} (3w)`,
            value: String(d.regioLeads),
          },
          { label: "Gepland (3w)", value: String(d.lookbackGepland) },
        ],
      });
    }
  }

  const volle = diags.filter((d) => d.diagnose === "vol" && d.weekGepland > 0);
  if (volle.length > 0 && teVullen.length > 0) {
    salesInsights.push({
      id: "sales-herverdeel",
      unit: "sales",
      severity: "info",
      title: "Herverdeel van volle naar lege agenda’s",
      detail: `Vol/bijna vol: ${volle
        .slice(0, 4)
        .map((d) => d.adv.naam)
        .join(", ")}. Nog ruimte: ${teVullen
        .slice(0, 4)
        .map((d) => d.adv.naam)
        .join(", ")}.`,
      diagnose: "Stuur nieuwe huisbezoeken naar adviseurs met het grootste weekgat.",
    });
  }

  if (salesInsights.length === 0) {
    salesInsights.push({
      id: "sales-ok",
      unit: "sales",
      severity: "ok",
      title: "Sales-agenda’s rond doel",
      detail: "Geen grote gaten t.o.v. weekdoelen gevonden.",
      diagnose: null,
    });
  }

  const periodLabel = `Week ${weekStartYmd.slice(5)} – ${weekEndYmd} · stand ${todayYmd}`;

  return {
    generatedAt: now.toISOString(),
    periodLabel,
    units: [
      {
        id: "leads",
        label: "Leads",
        summary:
          leadDelta != null
            ? `${leadsDezeWeek.length} leads · ${fmtPct(leadDelta)} vs tempo`
            : `${leadsDezeWeek.length} leads deze week`,
        insights: leadsInsights,
      },
      {
        id: "bellen",
        label: "Bellen",
        summary: `${teamBelActual} ingepland · doel-tempo ~${Math.round(teamBelPace)}`,
        insights: belInsights,
      },
      {
        id: "sales",
        label: "Sales",
        summary:
          teVullen.length > 0
            ? `${teVullen.length} agenda’s onder doel`
            : "Agenda’s rond doel",
        insights: salesInsights,
      },
    ],
  };
}

function noonFromYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return fromZonedTime(new Date(y, m - 1, d, 12, 0, 0), AMSTERDAM_TZ);
}
