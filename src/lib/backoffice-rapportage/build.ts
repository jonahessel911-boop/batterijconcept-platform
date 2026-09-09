import type {
  Adviseur,
  Afspraak,
  BackofficeActieEvent,
  Factuur,
  Lead,
  Project,
  ProjectTaak,
} from "@/types/database";
import {
  averageOf,
  businessMinutesBetween,
  medianOf,
  percentileOf,
} from "@/lib/business-hours";
import {
  belSchouwDeadline,
  backofficeInstroomMoment,
  isWarmtefondsProject,
  openBackofficeActies,
  recommendedSchouwWeekForProject,
  saleMomentVanProject,
} from "@/lib/backoffice-acties";
import { schouwWeekFromDate } from "@/lib/schouw-week";
import {
  resolveMgmtPeriod,
  type MgmtPeriodPreset,
} from "@/lib/management-dashboard/periods";
import type {
  BackofficeRapportageData,
  BackofficeRapportagePeriod,
  ActieDeadlineSla,
  MedewerkerActieStats,
  MedewerkerTakenStats,
  TeamSlaStats,
  TtfcStats,
} from "./types";

function inRange(iso: string | null | undefined, start: Date, end: Date) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function weekKey(jaar: number, week: number) {
  return jaar * 100 + week;
}

function pct(onTime: number, eligible: number): number | null {
  if (eligible <= 0) return null;
  return Math.round((onTime / eligible) * 1000) / 10;
}

function buildTtfc(
  minutes: number[]
): TtfcStats {
  const sorted = [...minutes].sort((a, b) => a - b);
  return {
    count: sorted.length,
    medianMinutes: medianOf(sorted),
    p90Minutes: percentileOf(sorted, 90),
    avgMinutes: averageOf(sorted),
  };
}

function naamMap(adviseurs: Pick<Adviseur, "id" | "naam">[]) {
  const m = new Map<string, string>();
  for (const a of adviseurs) m.set(a.id, a.naam);
  return m;
}

export type BackofficeRapportageRaw = {
  leads: Pick<
    Lead,
    | "id"
    | "created_at"
    | "eerste_gebeld_at"
    | "beller_id"
    | "belpogingen"
    | "naam"
    | "telefoon"
    | "plaats"
    | "status"
  >[];
  taken: Pick<
    ProjectTaak,
    | "id"
    | "status"
    | "verantwoordelijke_id"
    | "due_at"
    | "updated_at"
    | "created_at"
  >[];
  actieEvents: Pick<
    BackofficeActieEvent,
    | "id"
    | "soort"
    | "adviseur_id"
    | "deadline_at"
    | "completed_at"
    | "on_time"
    | "project_id"
    | "factuur_id"
  >[];
  projecten: Project[];
  facturen: Factuur[];
  adviseurs: Pick<Adviseur, "id" | "naam" | "rol" | "actief">[];
  afspraken?: Pick<
    Afspraak,
    "id" | "lead_id" | "start_at" | "status" | "soort" | "notities"
  >[];
};

function teamSchouwSla(
  projecten: Project[],
  start: Date,
  end: Date
): TeamSlaStats {
  let eligible = 0;
  let onTime = 0;
  for (const p of projecten) {
    if (!p.bel_schouw_aanbetaling_at) continue;
    if (!inRange(p.bel_schouw_aanbetaling_at, start, end)) continue;
    const hasSchouw = Boolean(p.schouw_jaar && p.schouw_week) || Boolean(p.schouw_at);
    if (!hasSchouw) continue;
    eligible += 1;
    const saleAt = saleMomentVanProject(p);
    const recommended = recommendedSchouwWeekForProject(p, saleAt);
    let actualJaar = p.schouw_jaar;
    let actualWeek = p.schouw_week;
    if ((!actualJaar || !actualWeek) && p.schouw_at) {
      const w = schouwWeekFromDate(p.schouw_at);
      actualJaar = w.jaar;
      actualWeek = w.week;
    }
    if (actualJaar && actualWeek) {
      if (weekKey(actualJaar, actualWeek) <= weekKey(recommended.jaar, recommended.week)) {
        onTime += 1;
      }
    }
  }
  return { eligible, onTime, pct: pct(onTime, eligible) };
}

function teamAanbetalingSla(
  projecten: Project[],
  facturen: Factuur[],
  start: Date,
  end: Date
): TeamSlaStats {
  let eligible = 0;
  let onTime = 0;
  const paidByProject = new Map<string, string>();
  for (const f of facturen) {
    if (f.status !== "betaald" || !f.betaald_op || !f.project_id) continue;
    const prev = paidByProject.get(f.project_id);
    if (!prev || f.betaald_op < prev) paidByProject.set(f.project_id, f.betaald_op);
  }

  for (const p of projecten) {
    const teInnen = Number(
      p.aanbetaling_te_innen_inc ??
        p.offertes?.aanbetaling_te_innen_inc ??
        0
    );
    if (!(teInnen > 0) && !isWarmtefondsProject(p)) continue;
    if (!p.bel_schouw_aanbetaling_at) continue;
    if (!inRange(p.bel_schouw_aanbetaling_at, start, end)) continue;
    eligible += 1;
    const deadline = belSchouwDeadline(backofficeInstroomMoment(p));
    const paid = paidByProject.get(p.id);
    const doneAt = paid
      ? new Date(`${paid}T23:59:59`)
      : new Date(p.bel_schouw_aanbetaling_at);
    if (doneAt.getTime() <= deadline.getTime()) onTime += 1;
  }
  return { eligible, onTime, pct: pct(onTime, eligible) };
}

/**
 * Voltooide acties met deadline in de periode.
 * Combineert gelogde events + domein-timestamps (stap 1 / financiering),
 * zonder dubbeltelling.
 */
function buildActieDeadlineSla(
  projecten: Project[],
  actieEvents: BackofficeRapportageRaw["actieEvents"],
  openActies: { overdue: boolean }[],
  start: Date,
  end: Date
): ActieDeadlineSla {
  const byKey = new Map<string, { onTime: boolean }>();

  for (const p of projecten) {
    if (p.bel_schouw_aanbetaling_at && inRange(p.bel_schouw_aanbetaling_at, start, end)) {
      const deadline = belSchouwDeadline(backofficeInstroomMoment(p));
      const done = new Date(p.bel_schouw_aanbetaling_at).getTime();
      byKey.set(`bel_schouw_aanbetaling:p:${p.id}`, {
        onTime: done <= deadline.getTime(),
      });
    }
    if (
      p.financiering_geschakeld_at &&
      inRange(p.financiering_geschakeld_at, start, end)
    ) {
      const deadline = belSchouwDeadline(backofficeInstroomMoment(p));
      const done = new Date(p.financiering_geschakeld_at).getTime();
      byKey.set(`schakel_financiering:p:${p.id}`, {
        onTime: done <= deadline.getTime(),
      });
    }
  }

  for (const e of actieEvents) {
    if (!inRange(e.completed_at, start, end)) continue;
    if (!e.deadline_at) continue;
    const onTime =
      e.on_time != null
        ? e.on_time
        : new Date(e.completed_at).getTime() <=
          new Date(e.deadline_at).getTime();

    let key: string;
    if (e.project_id) {
      key = `${e.soort}:p:${e.project_id}`;
    } else if (e.factuur_id) {
      key = `${e.soort}:f:${e.factuur_id}`;
    } else {
      key = `${e.soort}:event:${e.id}`;
    }
    // Event overschrijft domein (nauwkeuriger completed_at / on_time)
    byKey.set(key, { onTime });
  }

  let voorDeadline = 0;
  let naDeadline = 0;
  for (const row of byKey.values()) {
    if (row.onTime) voorDeadline += 1;
    else naDeadline += 1;
  }
  const voltooid = voorDeadline + naDeadline;

  const open = openActies.length;
  const openOverdue = openActies.filter((a) => a.overdue).length;
  const openOpTijd = open - openOverdue;

  return {
    voltooid,
    voorDeadline,
    naDeadline,
    voorPct: pct(voorDeadline, voltooid),
    naPct: pct(naDeadline, voltooid),
    open,
    openOpTijd,
    openOverdue,
    openOpTijdPct: pct(openOpTijd, open),
    openOverduePct: pct(openOverdue, open),
  };
}

export function buildBackofficeRapportage(
  raw: BackofficeRapportageRaw,
  period: BackofficeRapportagePeriod,
  now = new Date()
): BackofficeRapportageData {
  const resolved = resolveMgmtPeriod(
    { period: period as MgmtPeriodPreset },
    now
  );
  const { start, end, label } = resolved;
  const names = naamMap(raw.adviseurs);

  // TTFC: eerste contact in periode
  const ttfcMinutes: number[] = [];
  const perBeller = new Map<string, number[]>();
  for (const lead of raw.leads) {
    if (!lead.eerste_gebeld_at) continue;
    if (!inRange(lead.eerste_gebeld_at, start, end)) continue;
    const mins = businessMinutesBetween(lead.created_at, lead.eerste_gebeld_at);
    ttfcMinutes.push(mins);
    const bid = lead.beller_id;
    if (bid) {
      const arr = perBeller.get(bid) || [];
      arr.push(mins);
      perBeller.set(bid, arr);
    }
  }

  const ttfcPerBeller = [...perBeller.entries()]
    .map(([adviseurId, mins]) => ({
      adviseurId,
      naam: names.get(adviseurId) || "Onbekend",
      ...buildTtfc(mins),
    }))
    .sort((a, b) => (a.medianMinutes ?? 1e9) - (b.medianMinutes ?? 1e9));

  // Taken voltooid in periode
  const takenByAdv = new Map<
    string,
    { voltooid: number; metDeadline: number; voorDeadline: number }
  >();
  for (const t of raw.taken) {
    if (t.status !== "done") continue;
    if (!inRange(t.updated_at, start, end)) continue;
    const id = t.verantwoordelijke_id || "__none__";
    const row = takenByAdv.get(id) || {
      voltooid: 0,
      metDeadline: 0,
      voorDeadline: 0,
    };
    row.voltooid += 1;
    if (t.due_at) {
      row.metDeadline += 1;
      if (new Date(t.updated_at).getTime() <= new Date(t.due_at).getTime()) {
        row.voorDeadline += 1;
      }
    }
    takenByAdv.set(id, row);
  }

  const takenPerMedewerker: MedewerkerTakenStats[] = [...takenByAdv.entries()]
    .filter(([id]) => id !== "__none__")
    .map(([adviseurId, row]) => ({
      adviseurId,
      naam: names.get(adviseurId) || "Onbekend",
      voltooid: row.voltooid,
      metDeadline: row.metDeadline,
      voorDeadline: row.voorDeadline,
      onTimePct: pct(row.voorDeadline, row.metDeadline),
    }))
    .sort((a, b) => b.voltooid - a.voltooid);

  // Actie-events
  const actieByAdv = new Map<
    string,
    { voltooid: number; metDeadline: number; voorDeadline: number }
  >();
  for (const e of raw.actieEvents) {
    if (!inRange(e.completed_at, start, end)) continue;
    const id = e.adviseur_id || "__none__";
    const row = actieByAdv.get(id) || {
      voltooid: 0,
      metDeadline: 0,
      voorDeadline: 0,
    };
    row.voltooid += 1;
    if (e.deadline_at) {
      row.metDeadline += 1;
      const onTime =
        e.on_time != null
          ? e.on_time
          : new Date(e.completed_at).getTime() <=
            new Date(e.deadline_at).getTime();
      if (onTime) row.voorDeadline += 1;
    }
    actieByAdv.set(id, row);
  }

  const actiesPerMedewerker: MedewerkerActieStats[] = [...actieByAdv.entries()]
    .filter(([id]) => id !== "__none__")
    .map(([adviseurId, row]) => ({
      adviseurId,
      naam: names.get(adviseurId) || "Onbekend",
      voltooid: row.voltooid,
      metDeadline: row.metDeadline,
      voorDeadline: row.voorDeadline,
      onTimePct: pct(row.voorDeadline, row.metDeadline),
    }))
    .sort((a, b) => b.voltooid - a.voltooid);

  const openActies = openBackofficeActies(raw.projecten, raw.facturen, now, {
    leads: raw.leads,
    afspraken: raw.afspraken || [],
  });

  const actieDeadline = buildActieDeadlineSla(
    raw.projecten,
    raw.actieEvents,
    openActies,
    start,
    end
  );

  const openTaken = raw.taken.filter((t) => t.status !== "done");
  const overdueTaken = openTaken.filter(
    (t) => t.due_at && new Date(t.due_at).getTime() < now.getTime()
  );

  return {
    period: {
      preset: period,
      label,
      start: start.toISOString(),
      end: end.toISOString(),
    },
    ttfc: buildTtfc(ttfcMinutes),
    ttfcPerBeller,
    takenPerMedewerker,
    actiesPerMedewerker,
    actieDeadline,
    teamSla: {
      schouw: teamSchouwSla(raw.projecten, start, end),
      aanbetaling: teamAanbetalingSla(raw.projecten, raw.facturen, start, end),
    },
    workload: {
      openActies: openActies.length,
      overdueActies: openActies.filter((a) => a.overdue).length,
      openTaken: openTaken.length,
      overdueTaken: overdueTaken.length,
    },
  };
}
