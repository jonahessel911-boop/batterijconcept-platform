/**
 * Context bij open taken / volgende actie:
 * parallelle sporen + voorwaarden (wel/niet bereikt).
 */
import { isWarmtefondsGoedgekeurd } from "@/lib/backoffice-acties";
import {
  FINANCIERING_PIPELINE,
  normalizeFinancieringStatus,
  resolveFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";
import {
  orderBetalingPctTegenOfferte,
  WF_INSTALLATIE_MIN_BETAALD_PCT,
} from "@/lib/project-volgende-stap";
import { resolveBetaalwijze } from "@/lib/project-status-config";
import { isSchouwGeweest, isSchouwdagDefinitief } from "@/lib/schouw-week";
import type { Factuur, Project, ProjectTaak } from "@/types/database";

export type TaakVoorwaarde = {
  label: string;
  ok: boolean;
};

export type TaakContext = {
  /** Parallel spoor (niet de taak zelf), bijv. WF-declaratie naast schouwdag. */
  parallel: TaakVoorwaarde[];
  /** Wat er klaar moet zijn om deze actie te mogen / af te ronden. */
  voorwaarden: TaakVoorwaarde[];
};

function betaalwijze(project: Project) {
  const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  const off = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;
  return resolveBetaalwijze({
    betaalwijze: project.betaalwijze,
    leadStatus: lead?.status,
    financieringVoorbehoud: off?.financiering_voorbehoud,
  });
}

function fsNorm(project: Project): FinancieringStatus | null {
  return normalizeFinancieringStatus(resolveFinancieringStatus(project));
}

function fsAtLeast(
  project: Project,
  min: FinancieringStatus
): boolean {
  const n = fsNorm(project);
  if (!n || n === "afgewezen") return false;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  const from = FINANCIERING_PIPELINE.indexOf(min);
  return idx >= 0 && from >= 0 && idx >= from;
}

function isWfDeclaratieKlaar(project: Project): boolean {
  return (
    fsAtLeast(project, "declaratie_indienen") ||
    fsAtLeast(project, "wacht_op_betaling") ||
    fsNorm(project) === "uitbetaald"
  );
}

function isWfUitbetaald(
  project: Project,
  facturen: Factuur[]
): boolean {
  if (fsNorm(project) === "uitbetaald") return true;
  return (
    orderBetalingPctTegenOfferte(project, facturen) >=
    WF_INSTALLATIE_MIN_BETAALD_PCT
  );
}

/**
 * Context voor een open taak — zodat BO ziet wat parallel loopt
 * en of voorwaarden al bereikt zijn.
 */
export function contextVoorOpenTaak(
  taak: Pick<ProjectTaak, "titel" | "auto_key">,
  project: Project,
  facturen: Factuur[] = [],
  now: Date = new Date()
): TaakContext {
  const wf = betaalwijze(project) === "warmtefonds";
  const key = (taak.auto_key || "").toLowerCase();
  const titel = (taak.titel || "").toLowerCase();
  const parallel: TaakVoorwaarde[] = [];
  const voorwaarden: TaakVoorwaarde[] = [];

  const isSchouwdag =
    key.includes("schouwdag") || titel.includes("schouwdag inplannen");
  const isDeclaratie =
    key.includes("declaratie") ||
    titel.includes("declaratie") ||
    titel.includes("restfactuur");
  const isInstallatie =
    key.includes("installatie") ||
    titel.includes("installatiedatum") ||
    titel.includes("installatie inplannen");
  const isDocumenten =
    key.includes("documenten") ||
    key.includes("wacht_documenten") ||
    titel.includes("documenten");
  const isOpvolgenWf =
    key.includes("opvolgen") ||
    titel.includes("opvolgen bij warmtefonds") ||
    titel.includes("in behandeling");

  if (wf && isSchouwdag) {
    parallel.push({
      label: "WF declaratie",
      ok: isWfDeclaratieKlaar(project),
    });
    voorwaarden.push({
      label: "Warmtefonds goedgekeurd",
      ok: isWarmtefondsGoedgekeurd(project),
    });
  }

  if (wf && isDeclaratie) {
    parallel.push({
      label: "Schouwdag inplannen",
      ok: isSchouwdagDefinitief(project),
    });
    voorwaarden.push({
      label: "Warmtefonds goedgekeurd",
      ok: isWarmtefondsGoedgekeurd(project),
    });
  }

  if (isInstallatie) {
    voorwaarden.push({
      label: "Schouw geweest",
      ok: isSchouwGeweest(project, now),
    });
    if (wf) {
      voorwaarden.push({
        label: "Warmtefonds uitbetaald",
        ok: isWfUitbetaald(project, facturen),
      });
    } else {
      voorwaarden.push({
        label: "Restfactuur / order betaald",
        ok: isWfUitbetaald(project, facturen),
      });
    }
  }

  if (wf && isDocumenten) {
    voorwaarden.push({
      label: "Doorgestuurd naar Warmtefonds",
      ok: !!fsNorm(project),
    });
  }

  if (wf && isOpvolgenWf) {
    voorwaarden.push({
      label: "Documenten compleet / in behandeling",
      ok: fsAtLeast(project, "in_behandeling"),
    });
  }

  return { parallel, voorwaarden };
}
