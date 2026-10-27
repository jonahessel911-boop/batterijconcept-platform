/**
 * Kickoff na getekende order.
 *
 * Warmtefonds: BTW-factuur + WF-afspraak + schouwweek parallel (incl. track & trace-mail)
 * Eigen middelen: sequentieel — eerst 50%-factuur, schouwweek pas ná betaling
 *
 * Track & trace is géén aparte taak — zit in de schouwweek-klantmail.
 */
import type { Factuur, Project } from "@/types/database";
import {
  aanbetalingVanOrder,
  isAanbetalingFactuurOmschrijving,
} from "@/lib/aanbetaling";
import { isWarmtefondsProject } from "@/lib/backoffice-acties";
import { resolveFinancieringStatus } from "@/lib/financiering-status";
import {
  toOperationalStatus,
  type ProjectStatusKey,
} from "@/lib/project-status-config";
import { formatProjectSchouwWeek } from "@/lib/schouw-week";

/** Vanaf deze orderstatus is opstarten voorbij — geen kickoff-acties meer. */
const PAST_KICKOFF_STATUS: ReadonlySet<ProjectStatusKey> = new Set([
  "opstarten_voltooid_afwachten_wf",
  "schouwdag_ingepland",
  "schouw_voltooid",
  "restfactuur_verstuurd",
  "restfactuur_betaald",
  "materiaal_besteld",
  "installatie_ingepland",
  "installatie_voltooid",
  "review_gevraagd",
  "service",
]);

/** Feiten die bewijzen dat opstarten achterhaald is (ook bij stale status). */
export function isProjectPastKickoff(project: Project): boolean {
  if (project.status === "annulering") return true;
  if (project.status === "hold_sales_actie") return true;
  if (project.bel_schouw_aanbetaling_at) return true;
  if (project.installatie_at || project.installatie_voltooid_at) return true;
  if (project.schouw_at) return true;
  return PAST_KICKOFF_STATUS.has(toOperationalStatus(project.status));
}

export type KickoffItemId = "aanbetaling" | "wf_afspraak" | "schouwweek";

export type KickoffItem = {
  id: KickoffItemId;
  label: string;
  done: boolean;
  detail: string;
  /** Niet actionable (bv. EM schouwweek vóór 50% betaling). */
  blocked?: boolean;
  blockedReason?: string;
};

function aanbetalingFacturen(facturen: Factuur[]): Factuur[] {
  return facturen.filter(
    (f) =>
      !f.credit_van_factuur_id &&
      isAanbetalingFactuurOmschrijving(f.omschrijving)
  );
}

export function isAanbetalingKickoffDone(facturen: Factuur[]): boolean {
  return aanbetalingFacturen(facturen).some(
    (f) =>
      f.status === "verzonden" ||
      f.status === "deels_betaald" ||
      f.status === "betaald"
  );
}

export function isAanbetalingBetaald(facturen: Factuur[]): boolean {
  return aanbetalingFacturen(facturen).some((f) => f.status === "betaald");
}

export function isSchouwweekKickoffDone(project: Project): boolean {
  return Boolean(project.schouw_jaar && project.schouw_week);
}

/**
 * Schouwweek mag als open actie: nog geen week, én (Warmtefonds óf EM 50% betaald).
 */
export function isSchouwweekKickoffActionable(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (isSchouwweekKickoffDone(project)) return false;
  if (isWarmtefondsProject(project)) return true;
  return isAanbetalingBetaald(facturen);
}

/** Intake klaar zodra Edwin is aangeschreven (financiering gestart). */
export function isWfAfspraakKickoffDone(project: Project): boolean {
  return resolveFinancieringStatus(project) != null;
}

export function projectKickoffItems(
  project: Project,
  facturen: Factuur[] = []
): KickoffItem[] {
  const wf = isWarmtefondsProject(project);
  const aanbetalingDone = isAanbetalingKickoffDone(facturen);
  const aanbetalingBetaald = isAanbetalingBetaald(facturen);
  const schouwDone = isSchouwweekKickoffDone(project);
  const wfDone = isWfAfspraakKickoffDone(project);
  const schouwBlocked = !wf && !schouwDone && !aanbetalingBetaald;

  const items: KickoffItem[] = [
    {
      id: "aanbetaling",
      label: wf ? "BTW-factuur versturen" : "50% aanbetaling versturen",
      done: aanbetalingDone,
      detail: aanbetalingBetaald
        ? "Verstuurd én betaald"
        : aanbetalingDone
          ? "Verstuurd — wacht op betaling"
          : wf
            ? "Nog te versturen"
            : "50% vooraf · 50% na installatie",
    },
    {
      id: "schouwweek",
      label: "Schouwweek inplannen",
      done: schouwDone,
      blocked: schouwBlocked || undefined,
      blockedReason: schouwBlocked
        ? "Eerst 50% betaling afwachten"
        : undefined,
      detail: schouwDone
        ? formatProjectSchouwWeek(project) || "Ingepland"
        : schouwBlocked
          ? "Eerst 50% betaling afwachten"
          : wf
            ? "Incl. track & trace-mail · meestal ±5 weken vooruit"
            : "Incl. track & trace-mail naar de klant",
    },
  ];

  if (wf) {
    items.splice(1, 0, {
      id: "wf_afspraak",
      label: "Gegevens doorsturen naar Edwin",
      done: wfDone,
      detail: wfDone
        ? "Doorgestuurd naar Edwin"
        : "WhatsApp met klantgegevens + afspraak laten inplannen",
    });
  }

  return items;
}

function projectOfferte(project: Project) {
  const raw = project.offertes;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Aanbetaling (+ Warmtefonds-deel bij WF) voor kickoff / Edwin-bericht. */
export function kickoffWarmtefondsBedragen(
  project: Project,
  facturen: Factuur[] = []
): { aanbetalingInc: number | null; warmtefondsInc: number | null } {
  const off = projectOfferte(project) as
    | {
        subtotaal_ex_btw?: number | null;
        btw_bedrag?: number | null;
        totaal_inc_btw?: number | null;
        aanbetaling_modus?: string | null;
        aanbetaling_bedrag_inc?: number | null;
        aanbetaling_te_innen_inc?: number | null;
        financiering_voorbehoud?: boolean | null;
      }
    | null
    | undefined;

  const factuurAanb = facturen.find(
    (f) =>
      !f.credit_van_factuur_id &&
      isAanbetalingFactuurOmschrijving(f.omschrijving) &&
      (f.status === "verzonden" ||
        f.status === "deels_betaald" ||
        f.status === "betaald" ||
        f.status === "concept")
  );

  const warmtefonds = isWarmtefondsProject(project);

  if (
    off &&
    (off.subtotaal_ex_btw != null || off.totaal_inc_btw != null)
  ) {
    const a = aanbetalingVanOrder({
      subtotaalExBtw: Number(off.subtotaal_ex_btw) || 0,
      btwBedrag: off.btw_bedrag ?? undefined,
      totaalIncBtw: off.totaal_inc_btw ?? undefined,
      modus: off.aanbetaling_modus,
      handmatigIncBtw: off.aanbetaling_bedrag_inc,
      financieringVoorbehoud: warmtefonds,
    });
    return {
      aanbetalingInc:
        factuurAanb?.bedrag_inc_btw ??
        project.aanbetaling_te_innen_inc ??
        off.aanbetaling_te_innen_inc ??
        a.bedragIncBtw,
      /** Warmtefonds-aanvraag: max € 8.500 */
      warmtefondsInc: warmtefonds ? a.warmtefondsIncBtw : null,
    };
  }

  const aanbetalingInc =
    factuurAanb?.bedrag_inc_btw ??
    project.aanbetaling_te_innen_inc ??
    off?.aanbetaling_te_innen_inc ??
    null;

  return { aanbetalingInc, warmtefondsInc: null };
}

export function isKickoffComplete(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (isProjectPastKickoff(project)) return true;
  return projectKickoffItems(project, facturen).every((i) => i.done);
}

/**
 * Alleen tonen zolang het project nog in opstarten zit én er open stappen zijn.
 * Geïnstalleerd / schouw gedaan / verder in de keten → nooit meer kickoff-acties.
 */
export function showProjectKickoff(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (isProjectPastKickoff(project)) return false;
  return !isKickoffComplete(project, facturen);
}
