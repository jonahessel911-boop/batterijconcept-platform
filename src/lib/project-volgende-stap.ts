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
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import {
  resolveBetaalwijze,
  resolveStatusTaak,
  toOperationalStatus,
  type Betaalwijze,
  type ProjectStatusKey,
} from "@/lib/project-status-config";
import type { Factuur, Project } from "@/types/database";

function aanbetalingFacturenVan(facturen: Factuur[]): Factuur[] {
  return facturen.filter(
    (f) =>
      !f.credit_van_factuur_id &&
      isAanbetalingFactuurOmschrijving(f.omschrijving)
  );
}

function isAanbetalingVerstuurd(facturen: Factuur[]): boolean {
  return aanbetalingFacturenVan(facturen).some(
    (f) =>
      f.status === "verzonden" ||
      f.status === "deels_betaald" ||
      f.status === "betaald"
  );
}

function isAanbetalingBetaald(facturen: Factuur[]): boolean {
  return aanbetalingFacturenVan(facturen).some((f) => f.status === "betaald");
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
        ? "Schouw is geweest. Controleer of Warmtefonds heeft betaald; zo ja → installatie inplannen."
        : "Schouwformulier binnen. Check Financieel: is alles betaald? Zo ja → installatie plannen; zo nee → restfactuur.";
    case "restfactuur_verstuurd":
      return wf
        ? "Factuur WF verstuurd (declaratie). Wacht op Warmtefonds-uitbetaling vóór installatie/inkoop."
        : "Zonder betaling kunnen we niet veilig door naar installatie/inkoop.";
    case "restfactuur_betaald":
      return "Alles betaald — plan eerst de installatiedatum. Purchasing verschijnt daarna automatisch (5 werkdagen vóór installatie).";
    case "materiaal_besteld":
      return "Materiaal besteld. Staat de installatie nog niet? Plan die nu in.";
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

    // Eigen middelen: sequentieel — factuur → betaling → schouwweek
    if (!wf) {
      const betaald = isAanbetalingBetaald(facturen);
      const factuurVerstuurd = isAanbetalingVerstuurd(facturen);

      if (!factuurVerstuurd) {
        return {
          eyebrow: "Volgende stap",
          titel: "50% aanbetaling versturen",
          reden: "Eigen middelen: eerst de 50%-factuur; schouwweek volgt na betaling.",
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
          titel: "Wacht op 50% betaling",
          reden:
            "Factuur is verstuurd. Schouwweek plant je in zodra de 50% binnen is.",
          uiterlijkLabel: "Na betaling",
          uiterlijkAt: null,
          urgent: false,
          overdue: false,
          actie: null,
        };
      }

      return {
        eyebrow: "Volgende stap",
        titel: "Schouwweek inplannen",
        reden: "50% is betaald — plan nu de schouwweek (incl. track & trace).",
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
      reden: `Warmtefonds goedgekeurd · schouwweek ${schouwLabel} — plan nu de exacte schouwdag.`,
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
    urgent: overdue || taak.due.kind === "days",
    overdue,
    actie: null,
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

  return volgendeStapVanTaak(status, betaalwijze, project, now);
}
