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
import {
  REFERRAL_TAK_AUTO_KEY,
  REFERRAL_TAK_TITEL,
} from "@/lib/sales-referral-taak";
import { nextWeekdayAmsterdamAfter } from "@/lib/inkoop-sla";
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

/** Nazorg na oplevering: overstap / BTW / review. */
export const OPLEVERING_REVIEW_TAK_AUTO_KEY =
  "installatie_voltooid:review_vragen";

type DueContext = {
  schouwAt?: string | null;
  installatieAt?: string | null;
  /** Moment status installatie voltooid (fallback als geen installatie_at). */
  installatieVoltooidAt?: string | null;
  now?: Date;
};

type KickoffDueContext = DueContext & {
  /** Eigen middelen: schouwweek-taak pas ná 50% betaling. */
  aanbetalingBetaald?: boolean;
  /** Handmatig €0 → geen aanbetalingsfactuur/taak. */
  geenAanbetalingNodig?: boolean;
};

/** Auto-taken bij status Opstarten. WF parallel; EM gestaffeld. */
function kickoffAutoTaken(
  warmtefonds: boolean,
  opts: {
    aanbetalingBetaald?: boolean;
    geenAanbetalingNodig?: boolean;
  } = {}
): AutoTaakDef[] {
  const taken: AutoTaakDef[] = [];
  if (!opts.geenAanbetalingNodig) {
    taken.push({
      autoKey: "kickoff:aanbetaling",
      titel: warmtefonds
        ? "BTW-factuur versturen"
        : "50% aanbetaling versturen",
      afdeling: "Facturatie",
      dueInDays: 1,
    });
  }
  if (warmtefonds) {
    taken.push({
      autoKey: "kickoff:wf_afspraak",
      titel: "Warmtefonds-aanvraagafspraak inplannen",
      afdeling: "Backoffice",
      dueInDays: 1,
    });
  }
  // WF: schouwweek parallel. EM: pas ná 50% betaling (of geen aanbetaling).
  if (warmtefonds || opts.aanbetalingBetaald || opts.geenAanbetalingNodig) {
    taken.push({
      autoKey: "kickoff:schouwweek",
      titel: warmtefonds
        ? "Schouwweek inplannen + track & trace (±5 weken)"
        : "Schouwweek inplannen + track & trace",
      afdeling: "Planning",
      dueInDays: 1,
    });
  }
  return taken;
}

/** Taken die open moeten staan bij deze projectstatus (+ betaalwijze). */
export function autoTakenVoorStatus(
  status: string,
  betaalwijze: Betaalwijze = "warmtefonds",
  ctx: KickoffDueContext = {}
): AutoTaakDef[] {
  const key = toOperationalStatus(status) as ProjectStatusKey;

  // Opstarten: WF parallel; EM eerst factuur, schouwweek na betaling
  if (key === "schouwweek_inplannen") {
    return kickoffAutoTaken(betaalwijze === "warmtefonds", {
      aanbetalingBetaald: ctx.aanbetalingBetaald,
      geenAanbetalingNodig: ctx.geenAanbetalingNodig,
    });
  }

  // Na oplevering: overstap + BTW + review — deadline = eerstvolgende werkdag na installatie
  if (key === "installatie_voltooid") {
    const anchor =
      ctx.installatieAt || ctx.installatieVoltooidAt || null;
    const dueAt = anchor
      ? nextWeekdayAmsterdamAfter(anchor).toISOString()
      : undefined;
    const dueInDays = dueAt ? null : 1;
    return [
      {
        autoKey: "installatie_voltooid:overstap_leverancier",
        titel: "Overstappen dynamische leverancier",
        afdeling: "Backoffice",
        dueInDays,
        dueAt,
      },
      {
        autoKey: "installatie_voltooid:btw_terugvragen",
        titel: "BTW terugvrage starten",
        afdeling: "Backoffice",
        dueInDays,
        dueAt,
      },
      {
        autoKey: OPLEVERING_REVIEW_TAK_AUTO_KEY,
        titel: "Review vragen",
        afdeling: "Backoffice",
        dueInDays,
        dueAt,
      },
    ];
  }

  // Review afgevinkt → sales vraagt referrals
  if (key === "review_gevraagd" || key === "afgerond") {
    return [
      {
        autoKey: REFERRAL_TAK_AUTO_KEY,
        titel: REFERRAL_TAK_TITEL,
        afdeling: "Verkoop",
        dueInDays: 1,
      },
    ];
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
