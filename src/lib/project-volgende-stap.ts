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
  resolveBetaalwijze,
  resolveStatusTaak,
  toOperationalStatus,
  type Betaalwijze,
  type ProjectStatusKey,
} from "@/lib/project-status-config";
import type { Project } from "@/types/database";

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
    case "schouwdag_ingepland":
      return "De schouwdag staat; zorg dat klant en installateur scherp staan.";
    case "schouw_voltooid":
      return "Schouwformulier binnen. Check Financieel: is alles betaald? Zo ja → materiaal inkopen; zo nee → restfactuur.";
    case "restfactuur_verstuurd":
      return "Zonder betaling kunnen we materiaal niet veilig inkopen.";
    case "restfactuur_betaald":
      return "Alles betaald — volgende stap is materiaal inkopen/bestellen.";
    case "materiaal_besteld":
      return "Zodra levering rond is, kan de installatie worden ingepland.";
    case "installatie_ingepland":
      return "Bevestig tijdig zodat klant en monteur niet voor verrassingen staan.";
    case "installatie_voltooid":
      return wf
        ? "Afronden: Frank Energie + BTW-teruggave direct oppakken."
        : "Afronden: BTW-teruggave / nazorg oppakken.";
    case "review_gevraagd":
      return "Reviews helpen nieuwe klanten over de streep.";
    default:
      return wf
        ? "Warmtefonds loopt parallel; houd de orderstatus bij."
        : "Houd de orderstatus bij zodat planning en facturatie kloppen.";
  }
}

function volgendeStapNaOpstarten(
  project: Project,
  now: Date
): ProjectVolgendeStapInfo {
  const week = schouwWeekOf(project);
  const wf = isWarmtefonds(project);

  if (!week) {
    const due = dueEndOfDayInDays(1, now);
    return {
      eyebrow: "Volgende stap",
      titel: "Schouwweek inplannen",
      reden: wf
        ? "Warmtefonds duurt ±5 weken — daarom plannen we de schouwweek ongeveer 5 weken vooruit."
        : "Eigen middelen: schouw zo snel mogelijk inplannen.",
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
      titel: "Zet orderstatus op Schouwdag ingepland",
      reden: "Exacte schouwdag staat — trek de orderstatus gelijk.",
      uiterlijkLabel: "Nu",
      uiterlijkAt: null,
      urgent: true,
      overdue: false,
      actie: {
        kind: "status",
        label: "Zet op Schouwdag ingepland",
        status: "schouwdag_ingepland",
      },
    };
  }

  const belweek = schouwWeekEerder(week.jaar, week.week);
  const dueAt = dueAtVoorSchouwdagInplan(week.jaar, week.week);
  const inWindow = isInSchouwdagPlannenWindow(week.jaar, week.week, now);
  const overdue = isPast(dueAt, now);
  const schouwLabel =
    formatSchouwWeekLabel(week.jaar, week.week) || `Week ${week.week}`;

  if (!inWindow && !overdue) {
    return {
      eyebrow: "Volgende stap (later)",
      titel: `Schouwdag inplannen vanaf ${formatMaandagWeek(belweek.jaar, belweek.week)}`,
      reden: wf
        ? `Warmtefonds duurt ±5 weken. Schouwweek staat op ${schouwLabel}. Eén week van tevoren bel je de klant voor de exacte schouwdag.`
        : `Schouwweek staat op ${schouwLabel}. Eén week van tevoren bel je voor de exacte schouwdag.`,
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

/**
 * Bepaal de volgende operationele stap (niet financiering — die loopt parallel).
 */
export function resolveProjectVolgendeStap(
  project: Project,
  now: Date = new Date()
): ProjectVolgendeStapInfo | null {
  if (project.status === "annulering") return null;

  const status = toOperationalStatus(project.status);
  const betaalwijze = betaalwijzeVanProject(project);

  if (status === "schouwweek_inplannen") {
    return volgendeStapNaOpstarten(project, now);
  }

  return volgendeStapVanTaak(status, betaalwijze, project, now);
}
