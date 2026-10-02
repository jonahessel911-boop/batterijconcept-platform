import { addDays, subDays } from "date-fns";
import type { ProjectAfdeling } from "@/lib/project-afdeling";
import type { Betaalwijze } from "@/lib/project-status-config";
import {
  remapLegacyProjectStatus,
  resolveStatusTaak,
  type ProjectStatusKey,
} from "@/lib/project-status-config";

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

/** Taken die open moeten staan bij deze projectstatus (+ betaalwijze). */
export function autoTakenVoorStatus(
  status: string,
  betaalwijze: Betaalwijze = "warmtefonds",
  ctx: DueContext = {}
): AutoTaakDef[] {
  const key = remapLegacyProjectStatus(status) as ProjectStatusKey;
  const taak = resolveStatusTaak(key, betaalwijze);
  if (!taak) return [];

  const now = ctx.now || new Date();
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

export function dueAtFromDays(
  days: number | null | undefined,
  from = new Date()
): string | null {
  if (days == null) return null;
  return addDays(from, days).toISOString();
}
