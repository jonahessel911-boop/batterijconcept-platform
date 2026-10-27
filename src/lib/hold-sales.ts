import type { ProjectStatus } from "@/types/database";
import { normalizeProjectStatus } from "@/lib/labels";
import { isSchouwdagDefinitief } from "@/lib/schouw-week";

type ResumeProject = {
  status: string;
  schouw_at?: string | null;
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  warmtefonds_aangevraagd_at?: string | null;
  warmtefonds_afspraak_at?: string | null;
  installatie_at?: string | null;
  installatie_voltooid_at?: string | null;
  financiering_status?: string | null;
  offertes?:
    | {
        financiering_voorbehoud?: boolean | null;
      }
    | {
        financiering_voorbehoud?: boolean | null;
      }[]
    | null;
};

function isWarmtefondsResume(project: ResumeProject): boolean {
  const off = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;
  if (off?.financiering_voorbehoud) return true;
  if (project.warmtefonds_aangevraagd_at || project.warmtefonds_afspraak_at) {
    return true;
  }
  if (project.financiering_status) return true;
  return false;
}

/**
 * Status om HOLD te hervatten als we geen eerdere status uit de activiteit hebben.
 * Gebaseerd op wat er al feitelijk is gedaan op het project.
 */
export function inferResumeStatusAfterHold(
  project: ResumeProject
): ProjectStatus {
  if (project.installatie_voltooid_at) return "installatie_voltooid";
  if (project.installatie_at) return "installatie_ingepland";

  if (
    isSchouwdagDefinitief({
      schouw_at: project.schouw_at,
      schouw_jaar: project.schouw_jaar,
      schouw_week: project.schouw_week,
    })
  ) {
    return "schouwdag_ingepland";
  }

  const wf = isWarmtefondsResume(project);
  if (wf) {
    const fs = project.financiering_status;
    if (fs === "uitbetaald" || fs === "aanvraag_goedgekeurd") {
      return "warmtefonds_goedgekeurd";
    }
    if (fs === "in_behandeling") return "warmtefonds_in_behandeling";
    if (project.warmtefonds_aangevraagd_at || fs === "aanvraag_gedaan") {
      return "warmtefonds_aangevraagd";
    }
    if (project.warmtefonds_afspraak_at || fs === "afspraak_ingepland") {
      return "warmtefonds_afspraak_ingepland";
    }
  }

  if (project.schouw_jaar && project.schouw_week) {
    return wf ? "opstarten_voltooid_afwachten_wf" : "schouwweek_inplannen";
  }

  return "schouwweek_inplannen";
}

export function isUsableResumeStatus(
  status: string | null | undefined
): status is ProjectStatus {
  if (!status) return false;
  const n = normalizeProjectStatus(status);
  return n !== "hold_sales_actie" && n !== "annulering";
}
