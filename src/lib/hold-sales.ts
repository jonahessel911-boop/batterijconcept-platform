import { addDays, differenceInCalendarDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { ProjectStatus } from "@/types/database";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeProjectStatus } from "@/lib/labels";
import { isSchouwdagDefinitief } from "@/lib/schouw-week";

/** Standaard sales-termijn na zetten HOLD. */
export const HOLD_SALES_DEADLINE_DAGEN = 4;
/** Extra termijn bij BO-verlenging. */
export const HOLD_SALES_VERLENG_DAGEN = 5;

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

/** Zoek vorige status uit lead-activiteit (meta.van bij HOLD). */
export function resumeStatusFromHoldEvents(
  events: Array<{ meta?: unknown } | null> | null | undefined,
  projectId: string
): ProjectStatus | null {
  for (const ev of events || []) {
    const meta = (ev?.meta || {}) as {
      project_id?: string;
      naar?: string;
      van?: string;
    };
    if (meta.project_id && meta.project_id !== projectId) continue;
    if (meta.naar === "hold_sales_actie" && isUsableResumeStatus(meta.van)) {
      return meta.van;
    }
  }
  return null;
}

/** Einde van kalenderdag + N dagen in Europe/Amsterdam. */
export function holdSalesDeadlineAt(
  from: Date = new Date(),
  days: number = HOLD_SALES_DEADLINE_DAGEN
): string {
  const local = toZonedTime(from, AMSTERDAM_TZ);
  const target = addDays(local, days);
  target.setHours(23, 59, 59, 999);
  return fromZonedTime(target, AMSTERDAM_TZ).toISOString();
}

/**
 * Verleng vanaf max(nu, huidige deadline) met N kalenderdagen (EOD Amsterdam).
 */
export function extendHoldSalesDeadlineAt(
  currentDeadline: string | null | undefined,
  days: number = HOLD_SALES_VERLENG_DAGEN,
  now: Date = new Date()
): string {
  const current = currentDeadline ? new Date(currentDeadline) : null;
  const base =
    current && !Number.isNaN(current.getTime()) && current.getTime() > now.getTime()
      ? current
      : now;
  return holdSalesDeadlineAt(base, days);
}

export function isHoldSalesDeadlineVerlopen(
  deadlineAt: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!deadlineAt) return false;
  const d = new Date(deadlineAt);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= now.getTime();
}

/** Korte countdown-tekst voor Offertes-banner (altijd een label). */
export function holdSalesDeadlineLabel(
  deadlineAt: string | null | undefined,
  now: Date = new Date()
): string {
  if (!deadlineAt) return "Geen deadline gezet";
  const d = new Date(deadlineAt);
  if (Number.isNaN(d.getTime())) return "Geen deadline gezet";
  const days = differenceInCalendarDays(
    toZonedTime(d, AMSTERDAM_TZ),
    toZonedTime(now, AMSTERDAM_TZ)
  );
  if (days < 0 || d.getTime() <= now.getTime()) {
    return "Verlopen — backoffice volgt ook op";
  }
  if (days === 0) return "Deadline vandaag";
  if (days === 1) return "Nog 1 dag";
  return `Nog ${days} dagen`;
}

/**
 * Cron/rapportage: lijst HOLD's waarvan sales-deadline verlopen is.
 * Geen auto-statuswijziging — BO kiest via Acties (verlengen / bedenktijd / annulering).
 */
export async function verwerkVerlopenHoldSales(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sb: { from: (table: string) => any }
): Promise<{
  verwerkt: Array<{ id: string; project_nummer?: string | null }>;
}> {
  const { data, error } = await sb
    .from("projecten")
    .select("id, project_nummer, hold_sales_deadline_at")
    .eq("status", "hold_sales_actie");
  if (error) throw new Error(error.message || "HOLD-query mislukt");
  const now = new Date();
  const rows = (data || []) as Array<{
    id: string;
    project_nummer?: string | null;
    hold_sales_deadline_at?: string | null;
  }>;
  const verwerkt = rows
    .filter((p) => isHoldSalesDeadlineVerlopen(p.hold_sales_deadline_at, now))
    .map((p) => ({ id: p.id, project_nummer: p.project_nummer }));
  return { verwerkt };
}
