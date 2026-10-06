import { addDays, subDays } from "date-fns";
import type { ProjectAfdeling } from "@/lib/project-afdeling";
import type { Betaalwijze } from "@/lib/project-status-config";
import {
  resolveStatusTaak,
  toOperationalStatus,
  type ProjectStatusKey,
} from "@/lib/project-status-config";
import {
  FINANCIERING_STATUS_TAAK,
  isFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";
export type TaakStatus = "todo" | "doing" | "done";

export type AutoTaakDef = {
  autoKey: string;
  titel: string;
  afdeling: ProjectAfdeling;
  /** Dagen tot due vanaf nu; null = geen vaste due */
  dueInDays: number | null;
  /** Absolute due (wint van dueInDays) */
  dueAt?: string | null;
};

type DueContext = {
  schouwAt?: string | null;
  installatieAt?: string | null;
  now?: Date;
};

/** Parallelle auto-taken bij status Opstarten. */
function kickoffAutoTaken(warmtefonds: boolean): AutoTaakDef[] {
  const taken: AutoTaakDef[] = [
    {
      autoKey: "kickoff:aanbetaling",
      titel: "Aanbetalingsfactuur versturen",
      afdeling: "Facturatie",
      dueInDays: 1,
    },
    {
      autoKey: "kickoff:schouwweek",
      titel: warmtefonds
        ? "Schouwweek inplannen (±5 weken vooruit)"
        : "Schouwweek inplannen",
      afdeling: "Planning",
      dueInDays: 1,
    },
  ];
  if (warmtefonds) {
    taken.splice(1, 0, {
      autoKey: "kickoff:wf_afspraak",
      titel: "Warmtefonds-aanvraagafspraak inplannen",
      afdeling: "Backoffice",
      dueInDays: 1,
    });
  }
  return taken;
}

/** Taken die open moeten staan bij deze projectstatus (+ betaalwijze). */
export function autoTakenVoorStatus(
  status: string,
  betaalwijze: Betaalwijze = "warmtefonds",
  ctx: DueContext = {}
): AutoTaakDef[] {
  const key = toOperationalStatus(status) as ProjectStatusKey;

  // Opstarten: 2–3 parallelle kickoff-taken (geen lineaire aanbetaling-status)
  if (key === "schouwweek_inplannen") {
    return kickoffAutoTaken(betaalwijze === "warmtefonds");
  }

  const taak = resolveStatusTaak(key, betaalwijze);
  if (!taak) return [];

  let dueInDays: number | null = null;
  let dueAt: string | null | undefined;

  switch (taak.due.kind) {
    case "days":
      dueInDays = taak.due.days;
      break;
    case "none":
      dueInDays = null;
      dueAt = null;
      break;
    case "schouw_minus_days":
      if (ctx.schouwAt) {
        dueAt = subDays(new Date(ctx.schouwAt), taak.due.days).toISOString();
      } else {
        dueInDays = taak.due.days;
      }
      break;
    case "installatie_minus_days":
      if (ctx.installatieAt) {
        dueAt = subDays(
          new Date(ctx.installatieAt),
          taak.due.days
        ).toISOString();
      } else {
        dueInDays = taak.due.days;
      }
      break;
  }

  return [
    {
      autoKey: `${key}:${taak.autoKeySuffix}`,
      titel: taak.titel,
      afdeling: taak.afdeling,
      dueInDays,
      dueAt,
    },
  ];
}

/** Taken voor de parallelle Warmtefonds-financieringsfase. */
export function autoTakenVoorFinanciering(
  status: FinancieringStatus | null | undefined
): AutoTaakDef[] {
  if (!status || !isFinancieringStatus(status)) return [];
  const taak = FINANCIERING_STATUS_TAAK[status];
  if (!taak) return [];
  return [
    {
      autoKey: `financiering:${status}:${taak.autoKeySuffix}`,
      titel: taak.titel,
      afdeling: taak.afdeling,
      dueInDays: taak.dueDays,
    },
  ];
}

export function dueAtFromDays(
  days: number | null | undefined,
  from = new Date()
): string | null {
  if (days == null) return null;
  return addDays(from, days).toISOString();
}
