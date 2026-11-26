/**
 * Kickoff na getekende order.
 *
 * Warmtefonds (thuisbatterij): BTW-factuur + WF-afspraak + schouwweek parallel
 * Eigen middelen (thuisbatterij): sequentieel — eerste factuur leidend; schouwdag pas ná
 * markering betaald. Installatie volgt ná schouw.
 * Warmtepomp: alleen factuur + doorsturen naar TC Swiss (geen schouwweek).
 *
 * Track & trace is géén aparte taak — zit in de schouw-klantmail.
 */
import type { Factuur, Project } from "@/types/database";
import {
  aanbetalingVanOrder,
  heeftGeenAanbetalingNodig,
  isAanbetalingFactuurOmschrijving,
  isEersteFactuurBetaald,
  isEersteFactuurVerstuurd,
} from "@/lib/aanbetaling";
import { isWarmtefondsGoedgekeurd, isWarmtefondsProject } from "@/lib/backoffice-acties";
import { resolveFinancieringStatus } from "@/lib/financiering-status";
import {
  toOperationalStatus,
  type ProjectStatusKey,
} from "@/lib/project-status-config";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
} from "@/lib/schouw-week";
import { parseTcSwissIntakeStored } from "@/lib/tcswiss-intake";
import {
  isWarmtepompOrder,
  warmtepompProductNaamVanProject,
} from "@/lib/project-product";
import {
  aanbetalingAfspraakLabel,
  parseAanbetalingAfspraak,
} from "@/lib/aanbetaling-afspraak";

/**
 * Statussen ná opstarten (installatie-keten). Schouwweek-placeholder hoort
 * hier níet bij — die is juist één kickoff-stap.
 */
const PAST_KICKOFF_STATUS: ReadonlySet<ProjectStatusKey> = new Set([
  "schouw_inplannen",
  "schouw_voltooid",
  "restfactuur_verstuurd",
  "restfactuur_betaald",
  "materiaal_besteld",
  "installatie_ingepland",
  "installatie_voltooid",
  "after_sale",
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

export type KickoffItemId =
  | "aanbetaling"
  | "wf_afspraak"
  | "schouwweek"
  | "tcswiss";

/** Extra opstart-stap: warmtepomp-order naar TC Swiss. */
export type KickoffExtra = {
  warmtepomp?: boolean;
  tcswissSent?: boolean;
};

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
  // EM: exacte schouwdag; WF: week-placeholder volstaat voor kickoff
  if (!isWarmtefondsProject(project)) {
    return isSchouwdagDefinitief(project);
  }
  return Boolean(project.schouw_jaar && project.schouw_week);
}

/**
 * Schouw mag als open actie: nog niet gepland, én (Warmtefonds óf EM
 * eerste factuur betaald).
 */
export function isSchouwweekKickoffActionable(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (isWarmtepompOrder(project)) return false;
  if (isSchouwweekKickoffDone(project)) return false;
  if (isWarmtefondsProject(project)) return true;
  if (projectHeeftGeenAanbetalingNodig(project)) return true;
  return isEersteFactuurBetaald(facturen);
}

/** Intake klaar zodra Edwin is aangeschreven (financiering gestart). */
export function isWfAfspraakKickoffDone(project: Project): boolean {
  return resolveFinancieringStatus(project) != null;
}

export function projectKickoffItems(
  project: Project,
  facturen: Factuur[] = [],
  extra?: KickoffExtra
): KickoffItem[] {
  const wf = isWarmtefondsProject(project);
  const geenAanbetaling = projectHeeftGeenAanbetalingNodig(project);
  const betaalAfspraak = parseAanbetalingAfspraak(project.materiaal_checks);
  const aanbetalingVerstuurd = isEersteFactuurVerstuurd(facturen);
  const aanbetalingDone =
    geenAanbetaling || aanbetalingVerstuurd || Boolean(betaalAfspraak);
  const aanbetalingBetaald =
    geenAanbetaling || isEersteFactuurBetaald(facturen);
  const schouwDone = isSchouwweekKickoffDone(project);
  const wfDone = isWfAfspraakKickoffDone(project);
  const schouwBlocked = !wf && !schouwDone && !aanbetalingBetaald;
  const tcswissStored = parseTcSwissIntakeStored(project.materiaal_checks);
  const wp =
    Boolean(extra?.warmtepomp) ||
    Boolean(tcswissStored) ||
    isWarmtepompOrder(project);
  const tcswissSent = extra?.tcswissSent ?? Boolean(tcswissStored);
  const wpNaam = warmtepompProductNaamVanProject(project);

  const items: KickoffItem[] = [];

  // Handmatig €0 → geen factuur-stap in opstarten
  // Warmtepomp: factuur (obv offerte) + TC Swiss. Geen WF-portaal/schouw/Purchasing.
  if (!geenAanbetaling) {
    items.push({
      id: "aanbetaling",
      label: wp
        ? "Factuur versturen"
        : wf
          ? "BTW-factuur"
          : "50% aanbetaling",
      done: aanbetalingDone,
      detail: aanbetalingDone
        ? betaalAfspraak
          ? aanbetalingAfspraakLabel(betaalAfspraak)
          : "Taak afgevinkt"
        : wp
          ? wf
            ? "Verstuur de factuur zoals op de offerte (BTW / aanbetaling)"
            : "Verstuur de factuur zoals op de offerte (50% / aanbetaling)"
          : wf
            ? "Verstuur de factuur"
            : "Verstuur de 50%-factuur",
    });
  }

  // Warmtepomp: geen WF-portaal/schouwweek/Purchasing.
  if (wf && !wp) {
    items.push({
      id: "wf_afspraak",
      label: "WF-portaal",
      done: wfDone,
      detail: wfDone
        ? "Taak afgevinkt"
        : "Zet de klant in het Warmtefonds-portaal, daarna check",
    });
  }

  if (!wp) {
    items.push({
      id: "schouwweek",
      label: wf ? "Schouwweek" : "Schouwdag",
      done: schouwDone,
      blocked: schouwBlocked || undefined,
      blockedReason: schouwBlocked
        ? "Eerst eerste factuur als betaald markeren"
        : undefined,
      detail: schouwDone
        ? formatProjectSchouwWeek(project) || "Taak afgevinkt"
        : schouwBlocked
          ? "Eerst eerste factuur als betaald markeren"
          : "Check als dit is gezet",
    });
  }

  if (wp) {
    items.push({
      id: "tcswiss",
      label: "Stuur naar TC Swiss",
      done: tcswissSent,
      detail: tcswissSent
        ? `Doorgestuurd naar TC Swiss - ${wpNaam}`
        : `Stuur naar TC Swiss - ${wpNaam}`,
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
      warmtepomp: isWarmtepompOrder(project),
    });
    return {
      aanbetalingInc:
        factuurAanb?.bedrag_inc_btw ??
        project.aanbetaling_te_innen_inc ??
        off.aanbetaling_te_innen_inc ??
        a.bedragIncBtw,
      /** Warmtefonds-aanvraag: batterij max € 8.500, warmtepomp heel restant */
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
  facturen: Factuur[] = [],
  extra?: KickoffExtra
): boolean {
  // Expliciet afgerond (alle stappen gedaan of handmatig dicht)
  if (project.bel_schouw_aanbetaling_at) return true;
  // Verder in de keten (definitieve schouwdag / installatie) → klaar
  if (isProjectPastKickoff(project)) return true;
  // Anders: alleen de open checklist telt — schouwweek alleen ≠ klaar
  return projectKickoffItems(project, facturen, extra).every((i) => i.done);
}

/**
 * Patch wanneer kickoff klaar is (alle stappen) óf al afgevinkt.
 * WF → `opstarten_voltooid_afwachten_wf`, of `schouw_inplannen` als WF al goedgekeurd is.
 * EM → alleen bel_schouw_aanbetaling_at (blijft Opstarten tot schouwdag).
 *
 * Repareert ook stuck state: bel_schouw gezet / kickoff compleet maar status
 * nog Opstarten bij WF.
 */
export function kickoffCompletionPatch(
  project: Project,
  facturen: Factuur[] = [],
  now = new Date(),
  extra?: KickoffExtra
): {
  bel_schouw_aanbetaling_at?: string;
  status?: "opstarten_voltooid_afwachten_wf" | "schouw_inplannen";
} | null {
  if (isSchouwdagDefinitief(project)) return null;
  if (project.status === "annulering" || project.status === "hold_sales_actie") {
    return null;
  }

  const itemsDone = projectKickoffItems(project, facturen, extra).every(
    (i) => i.done
  );
  const belSet = Boolean(project.bel_schouw_aanbetaling_at);
  const kickoffDone =
    itemsDone || belSet || isKickoffComplete(project, facturen, extra);
  if (!kickoffDone) return null;

  const wf = isWarmtefondsProject(project);
  const op = toOperationalStatus(project.status);
  const needBel = !belSet && itemsDone;
  // WF + nog op Opstarten → altijd door naar afwachten WF (ook bij repair)
  const needWfStatus = wf && op === "schouwweek_inplannen";

  if (!needBel && !needWfStatus) return null;

  return {
    ...(needBel ? { bel_schouw_aanbetaling_at: now.toISOString() } : {}),
    ...(needWfStatus
      ? {
          status: (isWarmtefondsGoedgekeurd(project)
            ? "schouw_inplannen"
            : "opstarten_voltooid_afwachten_wf") as
            | "schouw_inplannen"
            | "opstarten_voltooid_afwachten_wf",
        }
      : {}),
  };
}

/**
 * Toon opstarten zolang er nog open stappen zijn (aanbetaling / Edwin /
 * schouwweek). Alleen schouwweek zetten mag de rest niet wegpoetsen.
 */
export function showProjectKickoff(
  project: Project,
  facturen: Factuur[] = [],
  extra?: KickoffExtra
): boolean {
  if (project.status === "annulering") return false;
  if (project.status === "hold_sales_actie") return false;
  if (project.installatie_at || project.installatie_voltooid_at) return false;
  if (isSchouwdagDefinitief(project)) return false;
  const op = toOperationalStatus(project.status);
  if (op === "schouwdag_ingepland" || PAST_KICKOFF_STATUS.has(op)) {
    return false;
  }
  const items = projectKickoffItems(project, facturen, extra);
  const tcswissOpen = items.some((i) => i.id === "tcswiss" && !i.done);
  if (project.bel_schouw_aanbetaling_at && !tcswissOpen) return false;
  return !items.every((i) => i.done);
}
