/**
 * “Volgende stap” op de projectpagina: wat, waarom, en uiterlijk wanneer.
 *
 * Warmtefonds: schouwweek ±5 weken vooruit; één week eerder (maandag
 * belweek) bel je voor de definitieve schouwdag.
 */
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";
import { nextWeekdayAmsterdamAfter } from "@/lib/inkoop-sla";
import {
  dueAtVoorSchouwdagInplan,
  formatSchouwWeekLabel,
  isInSchouwdagPlannenWindow,
  isSchouwdagDefinitief,
  schouwWeekEerder,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import {
  FINANCIERING_PIPELINE,
  normalizeFinancieringStatus,
  resolveFinancieringStatus,
} from "@/lib/financiering-status";
import {
  heeftGeenAanbetalingNodig,
  isEersteFactuurBetaald,
  isEersteFactuurVerstuurd,
  orderBetalingProgress,
} from "@/lib/aanbetaling";
import {
  resolveBetaalwijze,
  resolveStatusTaak,
  toOperationalStatus,
  type Betaalwijze,
  type ProjectStatusKey,
} from "@/lib/project-status-config";
import type { Factuur, Project } from "@/types/database";

/** Warmtefonds: installatie-actie pas vanaf dit % betaald (gemarkeerd). */
export const WF_INSTALLATIE_MIN_BETAALD_PCT = 95;

function facturenVoorProject(project: Project, facturen: Factuur[]): Factuur[] {
  return facturen.filter(
    (f) =>
      f.project_id === project.id ||
      (!f.project_id && f.lead_id === project.lead_id) ||
      (project.offerte_id != null && f.offerte_id === project.offerte_id)
  );
}

function projectOfferteVoorEm(project: Project) {
  return Array.isArray(project.offertes) ? project.offertes[0] : project.offertes;
}

function emGeenAanbetalingNodig(project: Project): boolean {
  const off = projectOfferteVoorEm(project) as
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
    financieringVoorbehoud: off?.financiering_voorbehoud ?? false,
  });
}

/**
 * Betaald t.o.v. volledig offertebedrag (niet t.o.v. alleen verstuurde facturen).
 */
export function orderBetalingPctTegenOfferte(
  project: Project,
  facturen: Factuur[] = []
): number {
  const off = projectOfferteVoorEm(project);
  return orderBetalingProgress({
    facturen: facturenVoorProject(project, facturen),
    orderIncBtw: off?.totaal_inc_btw,
  }).pct;
}

/**
 * WF: exacte schouwdag in Acties pas bij ≥95% van het offertebedrag betaald.
 * (Alleen “aanbetaling betaald” / verstuurde facturen is niet genoeg.)
 */
export function kanWfSchouwdagInplannen(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (isSchouwdagDefinitief(project)) return false;
  return (
    orderBetalingPctTegenOfferte(project, facturen) >=
    WF_INSTALLATIE_MIN_BETAALD_PCT
  );
}

/**
 * WF-installatie in Acties: schouwdag definitief gepland + ≥95% van offerte betaald.
 */
export function kanWfInstallatieInplannen(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (project.installatie_at) return false;
  if (!isSchouwdagDefinitief(project)) return false;
  return (
    orderBetalingPctTegenOfferte(project, facturen) >=
    WF_INSTALLATIE_MIN_BETAALD_PCT
  );
}

/**
 * EM-installatie: schouwdag gepland + ≥95% van het offertebedrag betaald.
 * (Eerste factuur ontgrendelt alleen de schouw-actie; installatie vraagt het totaal.)
 */
export function kanEmInstallatieInplannen(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (project.installatie_at) return false;
  if (!isSchouwdagDefinitief(project)) return false;
  if (emGeenAanbetalingNodig(project)) return true;
  return (
    orderBetalingPctTegenOfferte(project, facturen) >=
    WF_INSTALLATIE_MIN_BETAALD_PCT
  );
}

function betaalwijzeVanProject(project: Project): Betaalwijze {
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

function isWarmtefonds(project: Project): boolean {
  return betaalwijzeVanProject(project) === "warmtefonds";
}

/** Warmtefonds goedgekeurd (pipeline vanaf aanbod_ondertekenen / legacy). */
function isWarmtefondsGoedgekeurdVoorSchouw(project: Project): boolean {
  if (project.status === "warmtefonds_goedgekeurd") return true;
  const raw = resolveFinancieringStatus(project);
  const n = normalizeFinancieringStatus(raw);
  if (!n || n === "afgewezen") return false;
  if (raw === "aanvraag_goedgekeurd") return true;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  const from = FINANCIERING_PIPELINE.indexOf("aanbod_ondertekenen");
  return idx >= 0 && from >= 0 && idx >= from;
}

export type VolgendeStapActie =
  | { kind: "anchor"; label: string; href: string; openSoort?: "schouwdag" }
  | { kind: "status"; label: string; status: ProjectStatusKey };

export type ProjectVolgendeStapInfo = {
  eyebrow: string;
  titel: string;
  reden: string;
  uiterlijkLabel: string;
  uiterlijkAt: string | null;
  urgent: boolean;
  overdue: boolean;
  actie: VolgendeStapActie | null;
};

function schouwWeekOf(project: Project): { jaar: number; week: number } | null {
  if (project.schouw_jaar && project.schouw_week) {
    return { jaar: project.schouw_jaar, week: project.schouw_week };
  }
  if (project.schouw_at) return schouwWeekFromDate(project.schouw_at);
  return null;
}

function formatUiterlijkAt(iso: string): string {
  return formatInTimeZone(
    new Date(iso),
    AMSTERDAM_TZ,
    "EEEE d MMMM yyyy · HH:mm",
    { locale: nl }
  );
}

function formatMaandagWeek(jaar: number, week: number): string {
  const mondayIso = schouwWeekToMondayIso(jaar, week);
  const dag = formatInTimeZone(
    new Date(mondayIso),
    AMSTERDAM_TZ,
    "d MMMM yyyy",
    { locale: nl }
  );
  return `Maandag week ${week} · ${dag}`;
}

function isPast(iso: string, now: Date): boolean {
  return now.getTime() > new Date(iso).getTime();
}

function dueEndOfDayInDays(days: number, now: Date): string {
  const z = toZonedTime(now, AMSTERDAM_TZ);
  const target = addDays(z, days);
  return fromZonedTime(
    new Date(
      target.getFullYear(),
      target.getMonth(),
      target.getDate(),
      17,
      0,
      0
    ),
    AMSTERDAM_TZ
  ).toISOString();
}

function redenVoorStatus(status: ProjectStatusKey, wf: boolean): string {
  switch (status) {
    case "opstarten_voltooid_afwachten_wf":
      return "Opstarten klaar — wacht op Warmtefonds. Schouwdag pas plannen na goedkeuring (of in het schouwvenster).";
    case "schouwdag_ingepland":
      return "Schouwdag staat gepland. Na de schouw volgt de volgende stap automatisch.";
    case "schouw_voltooid":
      return wf
        ? "Schouw is geweest. Zodra Warmtefonds heeft betaald (én schouwformulier binnen is) volgt automatisch: installatie inplannen."
        : "Schouwformulier binnen. Check Financieel: is alles betaald? Zo ja → installatie plannen; zo nee → restfactuur.";
    case "restfactuur_verstuurd":
      return wf
        ? "Factuur WF verstuurd (declaratie). Wacht op Warmtefonds-uitbetaling vóór installatie/inkoop."
        : "Zonder betaling kunnen we niet veilig door naar installatie/inkoop.";
    case "restfactuur_betaald":
      return wf
        ? "Warmtefonds: ≥95% betaald én schouwdag gepland — plan de installatiedatum. Daarna komt Purchasing automatisch (5 werkdagen vóór installatie)."
        : "Eerste factuur betaald én schouwdag gepland — plan de installatiedatum. Daarna komt Purchasing automatisch (batterij inkopen, 5 werkdagen vóór installatie).";
    case "materiaal_besteld":
      return "Materiaal besteld. Staat de installatie nog niet? Plan die nu in (uiterlijk volgende werkdag).";
    case "installatie_voltooid":
      return "Afronden: BTW terugvragen, overstap dynamische leverancier, daarna review.";
    case "review_gevraagd":
    case "afgerond":
      return "Project afgerond — referrals en nazorg bij sales.";
    default:
      return wf
        ? "Warmtefonds loopt parallel; houd de orderstatus bij."
        : "Houd de orderstatus bij zodat planning en facturatie kloppen.";
  }
}

function volgendeStapNaOpstarten(
  project: Project,
  now: Date,
  facturen: Factuur[] = []
): ProjectVolgendeStapInfo | null {
  const week = schouwWeekOf(project);
  const wf = isWarmtefonds(project);

  if (!week) {
    const due = dueEndOfDayInDays(1, now);

    // Eigen middelen: eerste factuur leidend → betaald → schouwdag
    if (!wf) {
      if (emGeenAanbetalingNodig(project)) {
        return {
          eyebrow: "Volgende stap",
          titel: "Schouwdag inplannen",
          reden: "Geen aanbetaling nodig — plan nu de schouwdag (incl. track & trace).",
          uiterlijkLabel: formatUiterlijkAt(due),
          uiterlijkAt: due,
          urgent: true,
          overdue: false,
          actie: {
            kind: "anchor",
            label: "Plan schouwdag",
            href: "#project-afspraken",
            openSoort: "schouwdag",
          },
        };
      }

      const betaald = isEersteFactuurBetaald(facturen);
      const factuurVerstuurd = isEersteFactuurVerstuurd(facturen);

      if (!factuurVerstuurd) {
        return {
          eyebrow: "Volgende stap",
          titel: "Eerste factuur versturen",
          reden:
            "Eigen middelen: de eerste factuur is leidend; schouwdag volgt na markering betaald.",
          uiterlijkLabel: formatUiterlijkAt(due),
          uiterlijkAt: due,
          urgent: true,
          overdue: false,
          actie: {
            kind: "anchor",
            label: "Naar opstarten",
            href: "#project-kickoff",
          },
        };
      }

      if (!betaald) {
        return {
          eyebrow: "Volgende stap",
          titel: "Wacht op betaling eerste factuur",
          reden:
            "Eerste factuur is verstuurd. Markeer als betaald → daarna schouwdag inplannen.",
          uiterlijkLabel: "Na betaling",
          uiterlijkAt: null,
          urgent: false,
          overdue: false,
          actie: null,
        };
      }

      return {
        eyebrow: "Volgende stap",
        titel: "Schouwdag inplannen",
        reden:
          "Eerste factuur is betaald — plan nu de schouwdag (incl. track & trace).",
        uiterlijkLabel: formatUiterlijkAt(due),
        uiterlijkAt: due,
        urgent: true,
        overdue: false,
        actie: {
          kind: "anchor",
          label: "Plan schouwdag",
          href: "#project-afspraken",
          openSoort: "schouwdag",
        },
      };
    }

    return {
      eyebrow: "Volgende stap",
      titel: "Schouwweek inplannen",
      reden:
        "Warmtefonds duurt ±5 weken — daarom plannen we de schouwweek ongeveer 5 weken vooruit.",
      uiterlijkLabel: formatUiterlijkAt(due),
      uiterlijkAt: due,
      urgent: true,
      overdue: false,
      actie: {
        kind: "anchor",
        label: "Plan schouwweek",
        href: "#project-afspraken",
      },
    };
  }

  if (isSchouwdagDefinitief(project)) {
    return {
      eyebrow: "Volgende stap",
      titel: "Zet orderstatus op Schouw gepland",
      reden: "Exacte schouwdag staat — trek de orderstatus gelijk.",
      uiterlijkLabel: "Nu",
      uiterlijkAt: null,
      urgent: true,
      overdue: false,
      actie: {
        kind: "status",
        label: "Zet op Schouw gepland",
        status: "schouwdag_ingepland",
      },
    };
  }

  // Warmtefonds: schouwdag pas ná goedkeuring (wacht-actie dekt de tussentijd)
  if (wf && !isWarmtefondsGoedgekeurdVoorSchouw(project)) {
    return null;
  }

  // WF: exacte schouwdag pas bij ≥95% van het offertebedrag (niet alleen verstuurde facturen)
  if (wf && !kanWfSchouwdagInplannen(project, facturen)) {
    return null;
  }

  const belweek = schouwWeekEerder(week.jaar, week.week);
  const dueAt = dueAtVoorSchouwdagInplan(week.jaar, week.week);
  const inWindow = isInSchouwdagPlannenWindow(week.jaar, week.week, now);
  const overdue = isPast(dueAt, now);
  const schouwLabel =
    formatSchouwWeekLabel(week.jaar, week.week) || `Week ${week.week}`;

  if (wf) {
    return {
      eyebrow: overdue ? "Volgende stap — te laat" : "Volgende stap",
      titel: "Schouwdag inplannen met de klant",
      reden: `≥95% van de offerte betaald · schouwweek ${schouwLabel} — plan nu de exacte schouwdag.`,
      uiterlijkLabel: formatUiterlijkAt(dueAt),
      uiterlijkAt: dueAt,
      urgent: true,
      overdue,
      actie: {
        kind: "anchor",
        label: "Actie afronden — plan schouwdag",
        href: "#project-afspraken",
        openSoort: "schouwdag",
      },
    };
  }

  if (!inWindow && !overdue) {
    return {
      eyebrow: "Volgende stap (later)",
      titel: `Schouwdag inplannen vanaf ${formatMaandagWeek(belweek.jaar, belweek.week)}`,
      reden: `Schouwweek staat op ${schouwLabel}. Eén week van tevoren bel je voor de exacte schouwdag.`,
      uiterlijkLabel: `${formatMaandagWeek(belweek.jaar, belweek.week)} (uiterlijk 17:00)`,
      uiterlijkAt: dueAt,
      urgent: false,
      overdue: false,
      actie: {
        kind: "anchor",
        label: "Actie afronden — plan schouwdag",
        href: "#project-afspraken",
        openSoort: "schouwdag",
      },
    };
  }

  return {
    eyebrow: overdue ? "Volgende stap — te laat" : "Volgende stap",
    titel: "Schouwdag inplannen met de klant",
    reden: "Want de week erop is de schouwweek gepland.",
    uiterlijkLabel: `${formatUiterlijkAt(dueAt)} · belweek ${belweek.week}`,
    uiterlijkAt: dueAt,
    urgent: true,
    overdue,
    actie: {
      kind: "anchor",
      label: "Actie afronden — plan schouwdag",
      href: "#project-afspraken",
      openSoort: "schouwdag",
    },
  };
}

function volgendeStapVanTaak(
  status: ProjectStatusKey,
  betaalwijze: Betaalwijze,
  project: Project,
  now: Date
): ProjectVolgendeStapInfo | null {
  const taak = resolveStatusTaak(status, betaalwijze);
  if (!taak) return null;

  let uiterlijkAt: string | null = null;
  switch (taak.due.kind) {
    case "days":
      uiterlijkAt = dueEndOfDayInDays(taak.due.days, now);
      break;
    case "schouw_minus_days":
      if (project.schouw_at) {
        uiterlijkAt = addDays(
          new Date(project.schouw_at),
          -taak.due.days
        ).toISOString();
      }
      break;
    case "installatie_minus_days":
      if (project.installatie_at) {
        uiterlijkAt = addDays(
          new Date(project.installatie_at),
          -taak.due.days
        ).toISOString();
      }
      break;
    case "next_weekday": {
      // Klaar-moment ≈ laatste statusupdate (betaling/schouwformulier → restfactuur_betaald)
      const anchorRaw = project.updated_at || project.created_at;
      const anchor = anchorRaw ? new Date(anchorRaw) : now;
      const base = Number.isNaN(anchor.getTime()) ? now : anchor;
      uiterlijkAt = nextWeekdayAmsterdamAfter(base).toISOString();
      break;
    }
    case "none":
      uiterlijkAt = null;
      break;
  }

  const overdue = uiterlijkAt ? isPast(uiterlijkAt, now) : false;
  const wf = betaalwijze === "warmtefonds";

  return {
    eyebrow: overdue ? "Volgende stap — te laat" : "Volgende stap",
    titel: taak.titel,
    reden: redenVoorStatus(status, wf),
    uiterlijkLabel: uiterlijkAt
      ? formatUiterlijkAt(uiterlijkAt)
      : "Geen vaste deadline — zo snel mogelijk",
    uiterlijkAt,
    urgent:
      overdue ||
      taak.due.kind === "days" ||
      taak.due.kind === "next_weekday",
    overdue,
    actie:
      /installatiedatum inplannen/i.test(taak.titel)
        ? {
            kind: "anchor",
            label: "Plan installatie",
            href: "#project-afspraken",
          }
        : null,
  };
}

/** Pipeline-rang zodat feiten (installatie_at) achtergebleven status inhalen. */
const OP_RANK: ProjectStatusKey[] = [
  "schouwweek_inplannen",
  "opstarten_voltooid_afwachten_wf",
  "schouwdag_ingepland",
  "schouw_voltooid",
  "restfactuur_verstuurd",
  "restfactuur_betaald",
  "materiaal_besteld",
  "installatie_ingepland",
  "installatie_voltooid",
  "review_gevraagd",
];

function opRank(status: ProjectStatusKey): number {
  const i = OP_RANK.indexOf(status);
  return i >= 0 ? i : -1;
}

type EffectiveStatusProject = {
  status: string;
  installatie_at?: string | null;
  installatie_voltooid_at?: string | null;
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  schouw_at?: string | null;
};

/**
 * Effectieve status voor “volgende stap”: datumvelden winnen van vastgelopen status.
 * Voorbeeld: installatie_at gezet maar status nog materiaal_besteld → behandel als ingepland.
 */
export function effectiveOperationalStatus(
  project: EffectiveStatusProject
): ProjectStatusKey {
  let status = toOperationalStatus(project.status);
  if (
    status === "annulering" ||
    status === "service" ||
    status === "hold_sales_actie"
  ) {
    return status;
  }

  if (project.installatie_voltooid_at) {
    const min: ProjectStatusKey = "installatie_voltooid";
    if (opRank(status) < opRank(min)) status = min;
  } else if (project.installatie_at) {
    const min: ProjectStatusKey = "installatie_ingepland";
    if (opRank(status) < opRank(min)) status = min;
  } else if (
    project.schouw_at &&
    !Number.isNaN(new Date(project.schouw_at).getTime()) &&
    new Date(project.schouw_at).getTime() <= Date.now()
  ) {
    // Schouw is geweest → geen herinner-actie meer; door naar na-schouw stap
    const min: ProjectStatusKey = "schouw_voltooid";
    if (opRank(status) < opRank(min)) status = min;
  } else if (isSchouwdagDefinitief(project)) {
    const min: ProjectStatusKey = "schouwdag_ingepland";
    if (
      opRank(status) < opRank(min) &&
      (status === "schouwweek_inplannen" ||
        status === "opstarten_voltooid_afwachten_wf")
    ) {
      // Alleen bump binnen opstart — verdere pipeline blijft via expliciete status
      status = min;
    }
  }

  return status;
}

/**
 * Bepaal de volgende operationele stap (niet financiering — die loopt parallel).
 */
export function resolveProjectVolgendeStap(
  project: Project,
  now: Date = new Date(),
  facturen: Factuur[] = []
): ProjectVolgendeStapInfo | null {
  const st = (project.status || "").toLowerCase();
  if (
    st === "annulering" ||
    st === "geannuleerd" ||
    st === "hold_sales_actie" ||
    st === "hold_sales"
  ) {
    return null;
  }

  const status = effectiveOperationalStatus(project);
  // Referrals vragen = sales-actie (Verkoop-taak + SalesReferralActies), geen BO-stap.
  if (status === "review_gevraagd" || status === "afgerond") return null;

  const betaalwijze = betaalwijzeVanProject(project);

  if (status === "schouwweek_inplannen") {
    return volgendeStapNaOpstarten(project, now, facturen);
  }

  // Warmtefonds: installatie-actie pas bij ≥95% betaald + schouwdag gepland.
  // Geen “betaling controleren”-actie tussendoor.
  if (betaalwijze === "warmtefonds") {
    const isInstallatieKandidaat =
      status === "schouwdag_ingepland" ||
      status === "schouw_voltooid" ||
      status === "restfactuur_verstuurd" ||
      status === "restfactuur_betaald" ||
      status === "materiaal_besteld";
    if (isInstallatieKandidaat) {
      if (!kanWfInstallatieInplannen(project, facturen)) {
        return null;
      }
      // Toon installatie-stap (niet restfactuur-opvolgen / lege schouw-status)
      return volgendeStapVanTaak(
        "restfactuur_betaald",
        betaalwijze,
        project,
        now
      );
    }
  }

  // Eigen middelen: installatie pas ná schouw + eerste factuur betaald.
  // Eerste factuur betaald zonder schouw → schouw-actie (via opstarten-pad).
  if (betaalwijze === "eigen_middelen") {
    const isInstallatieKandidaat =
      status === "schouw_voltooid" ||
      status === "restfactuur_verstuurd" ||
      status === "restfactuur_betaald" ||
      status === "materiaal_besteld";
    if (isInstallatieKandidaat) {
      if (!kanEmInstallatieInplannen(project, facturen)) {
        if (
          isEersteFactuurBetaald(facturenVoorProject(project, facturen)) ||
          emGeenAanbetalingNodig(project)
        ) {
          return volgendeStapNaOpstarten(project, now, facturen);
        }
        return null;
      }
      return volgendeStapVanTaak(
        "restfactuur_betaald",
        betaalwijze,
        project,
        now
      );
    }
  }

  return volgendeStapVanTaak(status, betaalwijze, project, now);
}
