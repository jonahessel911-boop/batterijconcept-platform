/**
 * Kickoff na getekende order: 2–3 dingen tegelijk, geen lineaire statussen.
 *
 * Warmtefonds: BTW-factuur + WF-afspraak + schouwweek (incl. track & trace-mail)
 * Eigen middelen: BTW-factuur + schouwweek (incl. track & trace-mail)
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
import { formatProjectSchouwWeek } from "@/lib/schouw-week";

export type KickoffItemId = "aanbetaling" | "wf_afspraak" | "schouwweek";

export type KickoffItem = {
  id: KickoffItemId;
  label: string;
  done: boolean;
  detail: string;
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

  const items: KickoffItem[] = [
    {
      id: "aanbetaling",
      label: "BTW-factuur versturen",
      done: aanbetalingDone,
      detail: aanbetalingBetaald
        ? "Verstuurd én betaald"
        : aanbetalingDone
          ? "Verstuurd — wacht op betaling"
          : "Nog te versturen",
    },
    {
      id: "schouwweek",
      label: "Schouwweek inplannen",
      done: schouwDone,
      detail: schouwDone
        ? formatProjectSchouwWeek(project) || "Ingepland"
        : wf
          ? "Incl. track & trace-mail · meestal ±5 weken vooruit"
          : "Incl. track & trace-mail naar de klant",
    },
  ];

  if (wf) {
    items.splice(1, 0, {
      id: "wf_afspraak",
      label: "Edwin inschakelen (Warmtefonds)",
      done: wfDone,
      detail: wfDone
        ? "Doorgestuurd naar Edwin"
        : "Eerst WhatsApp sturen, daarna afvinken",
    });
  }

  return items;
}

function projectOfferte(project: Project) {
  const raw = project.offertes;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Aanbetaling + Warmtefonds-deel voor Edwin-bericht. */
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
      financieringVoorbehoud: true,
    });
    return {
      aanbetalingInc:
        factuurAanb?.bedrag_inc_btw ??
        project.aanbetaling_te_innen_inc ??
        off.aanbetaling_te_innen_inc ??
        a.bedragIncBtw,
      /** Warmtefonds-aanvraag: max € 8.500 */
      warmtefondsInc: a.warmtefondsIncBtw,
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
  if (project.status === "annulering") return true;
  return projectKickoffItems(project, facturen).every((i) => i.done);
}

/** Alleen tonen zolang er nog kickoff-werk open staat. */
export function showProjectKickoff(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (project.status === "annulering") return false;
  return !isKickoffComplete(project, facturen);
}
