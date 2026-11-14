import { BEL_CLAIM_TTL_MS } from "@/lib/bel-claim";
import { isBellerRol } from "@/lib/rollen";
import type {
  DayAdvisorRow,
  DayOverview,
  WeekLeaderboardRow,
  WeekOverview,
} from "@/lib/sales-cockpit/cockpit-metrics";
import type { RawAppt } from "@/lib/sales-cockpit/classify";
import { isoToYmd } from "@/lib/sales-cockpit/range";

/**
 * Ruimer dan queue-TTL (15 min): Bel-tab op achtergrond throttled heartbeats,
 * waardoor claims anders te vroeg van de wall verdwijnen.
 */
export const WALL_CLAIM_DISPLAY_TTL_MS = Math.max(
  BEL_CLAIM_TTL_MS,
  45 * 60 * 1000
);

export function isWallCallerVisible(
  claimedAt: string | null | undefined,
  now = new Date(),
  onCall = false
): boolean {
  if (onCall) return true;
  if (!claimedAt) return false;
  const t = new Date(claimedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < WALL_CLAIM_DISPLAY_TTL_MS;
}

/** Week-KPI’s op de live wall (huidige schouwweek). */
export type WallWeekKpis = {
  label: string;
  /**
   * Belconversie L→A % —zelfde als rapportage Bel-conversie
   * (“Lead to appointment” = nonNieuwIngepland / nonNieuwGebeld).
   */
  belConversiePct: number | null;
  /** Niet-nieuwe leads in de week-funnel (noemer L→A). */
  gebeld: number;
  /** Huisbezoeken onder die niet-nieuwe leads (teller L→A). */
  belIngepland: number;
  /** Unieke nieuwe huisbezoeken met start in de week. */
  nieuwIngepland: number;
  /** Conversie gelopen nieuw → deal. */
  salesConversiePct: number | null;
  gelopenNieuw: number;
  salesFromGelopen: number;
  deals: number;
  aanbetalingenInc: number;
  orderwaardeEx: number;
};

export type WallCaller = {
  id: string;
  naam: string;
  leadId: string;
  leadNumber: string;
  leadNaam: string;
  claimedAt: string;
};

export type WallScheduledAppt = {
  id: string;
  leadId: string;
  leadNumber: string;
  leadNaam: string;
  soort: string;
  startAt: string;
  createdAt: string;
  plannerId: string | null;
  plannerNaam: string | null;
  adviseurId: string | null;
  adviseurNaam: string | null;
};

export type WallPlannerStat = {
  id: string;
  naam: string;
  n: number;
};

export type WallTopAdvisor = {
  id: string;
  naam: string;
  rank: number;
  deals: number;
  orderwaardeEx: number;
  conversionNieuwGelopenSalePct: number | null;
  /** Gelopen afspraken deze week (nieuw + vervolg). */
  gelopen: number;
};

export type WallActivityKind =
  | "lead"
  | "afspraak"
  | "status"
  | "afboek"
  | "offerte"
  | "bel"
  | "backoffice"
  | "factuur"
  | "betaling"
  | "inkoop"
  | "schouw"
  | "installatie"
  | "service"
  | "overig";

export type WallActivityEvent = {
  id: string;
  at: string;
  kind: WallActivityKind;
  titel: string;
  detail: string | null;
  leadId?: string | null;
  leadNaam: string | null;
  actorNaam: string | null;
};

export type WallboardOverview = {
  ymd: string;
  isToday: boolean;
  deals: number;
  orderwaardeEx: number;
  /** Leads aangemaakt op deze dag (Amsterdam). */
  leadsToday: number;
  apptTotal: number;
  nieuw: number;
  vervolgFysiek: number;
  vervolgTel: number;
  callersActive: number;
  /** Afspraken die vandaag zijn ingepland (created_at), excl. geannuleerd/verzet/bel-slots. */
  scheduledToday: number;
  advisorsInAppt: number;
  advisors: DayAdvisorRow[];
  callers: WallCaller[];
  recentScheduled: WallScheduledAppt[];
  plannersToday: WallPlannerStat[];
  topAdvisors: WallTopAdvisor[];
  /** Chronologische live-log (nieuwste eerst). */
  activity: WallActivityEvent[];
  week: WallWeekKpis;
};

export type WallClaimRow = {
  leadId: string;
  leadNumber: string;
  leadNaam: string;
  claimedBy: string;
  claimedAt: string;
  /** Actief Fonio-gesprek (ringing/active). */
  onCall?: boolean;
};

export function buildWallWeekKpis(input: {
  week: WeekOverview;
  belConversiePct: number | null;
  gebeld: number;
  belIngepland: number;
}): WallWeekKpis {
  const week = input.week;
  return {
    label: week.label,
    belConversiePct: input.belConversiePct,
    gebeld: input.gebeld,
    belIngepland: input.belIngepland,
    nieuwIngepland: week.ingepland,
    salesConversiePct: week.conversionNieuwGelopenSalePct,
    gelopenNieuw: week.gelopen,
    salesFromGelopen: week.salesFromGelopen,
    deals: week.deals,
    aanbetalingenInc: week.aanbetalingenInc,
    orderwaardeEx: week.orderwaardeEx,
  };
}

function isKlantAfspraakSoort(soort: string): boolean {
  return (
    soort !== "bel" &&
    soort !== "warme_bel" &&
    soort !== "warmtefonds_aanvraag"
  );
}

export function buildWallboard(input: {
  day: DayOverview;
  appointments: RawAppt[];
  claims: WallClaimRow[];
  advisorsById: Map<string, { naam: string; rol?: string | null }>;
  leadMetaById: Map<string, { leadNumber: string; naam: string }>;
  week: WeekOverview;
  weekLeaderboard?: WeekLeaderboardRow[];
  belConversiePct?: number | null;
  gebeld?: number;
  belIngepland?: number;
  /** Leads aangemaakt op day.ymd. */
  leadsToday?: number;
  activity?: WallActivityEvent[];
  nowIso?: string;
}): WallboardOverview {
  const now = input.nowIso ? new Date(input.nowIso) : new Date();
  const day = input.day;

  const callers: WallCaller[] = [];
  const seenCallerLead = new Set<string>();
  for (const claim of input.claims) {
    if (!isWallCallerVisible(claim.claimedAt, now, claim.onCall === true)) {
      continue;
    }
    const key = `${claim.claimedBy}:${claim.leadId}`;
    if (seenCallerLead.has(key)) continue;
    seenCallerLead.add(key);
    const adv = input.advisorsById.get(claim.claimedBy);
    callers.push({
      id: claim.claimedBy,
      naam: adv?.naam || "Beller",
      leadId: claim.leadId,
      leadNumber: claim.leadNumber,
      leadNaam: claim.leadNaam,
      claimedAt: claim.claimedAt,
    });
  }
  callers.sort((a, b) => b.claimedAt.localeCompare(a.claimedAt));

  let scheduledToday = 0;
  const scheduled: WallScheduledAppt[] = [];
  const plannerCount = new Map<string, number>();
  for (const appt of input.appointments) {
    if (appt.status === "geannuleerd" || appt.status === "verzet") continue;
    const created = appt.createdAt || appt.startAt;
    const createdYmd = isoToYmd(created);
    if (createdYmd !== day.ymd) continue;
    const soort = (appt.soort || "").trim();
    // Alleen echte klantafspraken (geen koude bel-slots).
    if (!isKlantAfspraakSoort(soort)) continue;

    scheduledToday += 1;

    // Rail “zojuist ingepland”: alleen door bellers.
    if (!appt.plannerId) continue;
    const planner = input.advisorsById.get(appt.plannerId);
    if (!isBellerRol(planner?.rol)) continue;

    const meta = input.leadMetaById.get(appt.leadId);
    const adviseur = appt.adviseurId
      ? input.advisorsById.get(appt.adviseurId)
      : null;
    scheduled.push({
      id: appt.id,
      leadId: appt.leadId,
      leadNumber: meta?.leadNumber || appt.leadId,
      leadNaam: meta?.naam || "Lead",
      soort: soort || "nieuw",
      startAt: appt.startAt,
      createdAt: created,
      plannerId: appt.plannerId,
      plannerNaam: planner?.naam ?? null,
      adviseurId: appt.adviseurId,
      adviseurNaam: adviseur?.naam ?? null,
    });
    plannerCount.set(
      appt.plannerId,
      (plannerCount.get(appt.plannerId) || 0) + 1
    );
  }
  scheduled.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const plannersToday: WallPlannerStat[] = [...plannerCount.entries()]
    .map(([id, n]) => ({
      id,
      naam: input.advisorsById.get(id)?.naam || "Onbekend",
      n,
    }))
    .sort((a, b) => b.n - a.n || a.naam.localeCompare(b.naam, "nl"));

  const topAdvisors: WallTopAdvisor[] = (input.weekLeaderboard || []).map(
    (row, i) => ({
      id: row.id,
      naam: row.naam,
      rank: i + 1,
      deals: row.deals,
      orderwaardeEx: row.orderwaardeEx,
      conversionNieuwGelopenSalePct: row.conversionNieuwGelopenSalePct,
      gelopen: row.nieuwGelopen + row.vervolgGelopen,
    })
  );

  return {
    ymd: day.ymd,
    isToday: day.isToday,
    deals: day.deals,
    orderwaardeEx: day.orderwaardeEx,
    leadsToday: input.leadsToday ?? 0,
    apptTotal: day.apptTotal,
    nieuw: day.nieuw,
    vervolgFysiek: day.vervolgFysiek,
    vervolgTel: day.vervolgTel,
    callersActive: callers.length,
    scheduledToday,
    advisorsInAppt: day.advisors.filter((a) => a.liveStatus === "in_afspraak")
      .length,
    advisors: day.advisors,
    callers,
    recentScheduled: scheduled.slice(0, 24),
    plannersToday,
    topAdvisors,
    activity: input.activity ?? [],
    week: buildWallWeekKpis({
      week: input.week,
      belConversiePct: input.belConversiePct ?? null,
      gebeld: input.gebeld ?? 0,
      belIngepland: input.belIngepland ?? 0,
    }),
  };
}
