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
  heeftGeenAanbetalingNodig,
  isAanbetalingFactuurOmschrijving,
} from "@/lib/aanbetaling";
import { isWarmtefondsProject } from "@/lib/backoffice-acties";
import { resolveFinancieringStatus } from "@/lib/financiering-status";
import {
  toOperationalStatus,
  type ProjectStatusKey,
} from "@/lib/project-status-config";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
} from "@/lib/schouw-week";

/**
 * Statussen ná opstarten (installatie-keten). Schouwweek-placeholder hoort
 * hier níet bij — die is juist één kickoff-stap.
 */
const PAST_KICKOFF_STATUS: ReadonlySet<ProjectStatusKey> = new Set([
  "schouw_voltooid",
  "restfactuur_verstuurd",
  "restfactuur_betaald",
  "materiaal_besteld",
  "installatie_ingepland",
  "installatie_voltooid",
  "review_gevraagd",
  "afgerond",
  "service",
]);

/**
 * Opstarten is achterhaald: expliciet afgerond, of verder in de keten.
 * Let op: alleen een schouwweek (maandag-placeholder) of status
 * opstarten_voltooid_afwachten_wf telt níet als “alles klaar” —
 * aanbetaling / Edwin kunnen nog openstaan.
 */
export function isProjectPastKickoff(project: Project): boolean {
  if (project.status === "annulering") return true;
  if (project.status === "hold_sales_actie") return true;
  if (project.bel_schouw_aanbetaling_at) return true;
  if (project.installatie_at || project.installatie_voltooid_at) return true;
  // Exacte schouwdag = voorbij opstarten; week-placeholder niet
  if (isSchouwdagDefinitief(project)) return true;
  const op = toOperationalStatus(project.status);
  if (op === "schouwdag_ingepland") return true;
  return PAST_KICKOFF_STATUS.has(op);
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

/** Minimale factuurvelden voor aanbetalingschecks (API-selects zijn vaak partiëel). */
export type AanbetalingFactuurLike = {
  status?: string | null;
  omschrijving?: string | null;
  credit_van_factuur_id?: string | null;
};

function aanbetalingFacturen(
  facturen: AanbetalingFactuurLike[]
): AanbetalingFactuurLike[] {
  return facturen.filter(
    (f) =>
      !f.credit_van_factuur_id &&
      isAanbetalingFactuurOmschrijving(f.omschrijving)
  );
}

export function isAanbetalingKickoffDone(
  facturen: AanbetalingFactuurLike[]
): boolean {
  return aanbetalingFacturen(facturen).some(
    (f) =>
      f.status === "verzonden" ||
      f.status === "deels_betaald" ||
      f.status === "betaald"
  );
}

export function isAanbetalingBetaald(
  facturen: AanbetalingFactuurLike[]
): boolean {
  return aanbetalingFacturen(facturen).some((f) => f.status === "betaald");
}

/** Project/offerte: handmatig €0 → geen factuur, geen aanbetaling-opstart. */
export function projectHeeftGeenAanbetalingNodig(project: Project): boolean {
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
  return heeftGeenAanbetalingNodig({
    aanbetalingTeInnenInc:
      project.aanbetaling_te_innen_inc ?? off?.aanbetaling_te_innen_inc,
    aanbetalingModus: off?.aanbetaling_modus,
    aanbetalingBedragInc: off?.aanbetaling_bedrag_inc,
    subtotaalExBtw: off?.subtotaal_ex_btw,
    btwBedrag: off?.btw_bedrag,
    totaalIncBtw: off?.totaal_inc_btw,
    financieringVoorbehoud:
      off?.financiering_voorbehoud ?? isWarmtefondsProject(project),
  });
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
  if (projectHeeftGeenAanbetalingNodig(project)) return true;
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
  const geenAanbetaling = projectHeeftGeenAanbetalingNodig(project);
  const aanbetalingDone =
    geenAanbetaling || isAanbetalingKickoffDone(facturen);
  const aanbetalingBetaald =
    geenAanbetaling || isAanbetalingBetaald(facturen);
  const schouwDone = isSchouwweekKickoffDone(project);
  const wfDone = isWfAfspraakKickoffDone(project);
  const schouwBlocked = !wf && !schouwDone && !aanbetalingBetaald;

  const items: KickoffItem[] = [];

  // Handmatig €0 → geen factuur-stap in opstarten
  if (!geenAanbetaling) {
    items.push({
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
    });
  }

  if (wf) {
    items.push({
      id: "wf_afspraak",
      label: "Gegevens doorsturen naar Edwin",
      done: wfDone,
      detail: wfDone
        ? "Doorgestuurd naar Edwin"
        : "WhatsApp met klantgegevens + afspraak laten inplannen",
    });
  }

  items.push({
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
  });

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
  // Expliciet afgerond (alle stappen gedaan of handmatig dicht)
  if (project.bel_schouw_aanbetaling_at) return true;
  // Verder in de keten (definitieve schouwdag / installatie) → klaar
  if (isProjectPastKickoff(project)) return true;
  // Anders: alleen de open checklist telt — schouwweek alleen ≠ klaar
  return projectKickoffItems(project, facturen).every((i) => i.done);
}

/**
 * Patch wanneer kickoff klaar is (alle stappen) óf al afgevinkt.
 * WF → status `opstarten_voltooid_afwachten_wf` (niet blijven hangen op Opstarten).
 * EM → alleen bel_schouw_aanbetaling_at (blijft Opstarten tot schouwdag).
 *
 * Repareert ook stuck state: bel_schouw gezet / kickoff compleet maar status
 * nog Opstarten bij WF.
 */
export function kickoffCompletionPatch(
  project: Project,
  facturen: Factuur[] = [],
  now = new Date()
): {
  bel_schouw_aanbetaling_at?: string;
  status?: "opstarten_voltooid_afwachten_wf";
} | null {
  if (isSchouwdagDefinitief(project)) return null;
  if (project.status === "annulering" || project.status === "hold_sales_actie") {
    return null;
  }

  const itemsDone = projectKickoffItems(project, facturen).every((i) => i.done);
  const belSet = Boolean(project.bel_schouw_aanbetaling_at);
  const kickoffDone = itemsDone || belSet || isKickoffComplete(project, facturen);
  if (!kickoffDone) return null;

  const wf = isWarmtefondsProject(project);
  const op = toOperationalStatus(project.status);
  const needBel = !belSet && itemsDone;
  // WF + nog op Opstarten → altijd door naar afwachten WF (ook bij repair)
  const needWfStatus = wf && op === "schouwweek_inplannen";

  if (!needBel && !needWfStatus) return null;

  return {
    ...(needBel ? { bel_schouw_aanbetaling_at: now.toISOString() } : {}),
    ...(needWfStatus ? { status: "opstarten_voltooid_afwachten_wf" as const } : {}),
  };
}

/**
 * Toon opstarten zolang er nog open stappen zijn (aanbetaling / Edwin /
 * schouwweek). Alleen schouwweek zetten mag de rest niet wegpoetsen.
 */
export function showProjectKickoff(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (project.status === "annulering") return false;
  if (project.status === "hold_sales_actie") return false;
  if (project.bel_schouw_aanbetaling_at) return false;
  if (project.installatie_at || project.installatie_voltooid_at) return false;
  if (isSchouwdagDefinitief(project)) return false;
  const op = toOperationalStatus(project.status);
  if (op === "schouwdag_ingepland" || PAST_KICKOFF_STATUS.has(op)) {
    return false;
  }
  return !projectKickoffItems(project, facturen).every((i) => i.done);
}
