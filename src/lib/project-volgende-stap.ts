/**
 * “Volgende stap” op de projectpagina: wat, waarom, en uiterlijk wanneer.
 *
 * Warmtefonds: schouwweek is alleen een klant-indicatie (± wanneer).
 * Exacte schouwdag + declaratie volgen ná WF-goedkeuring — niet op de week.
 */
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ, formatDateTimeNl } from "@/lib/format";
import {
  bestelDeadlineVoorInstallatie,
  INKOOP_DAGEN_VOOR_INSTALLATIE,
  materiaalNogTeBestellen,
  uitvoerDeadlineVolgendeWerkdag,
} from "@/lib/inkoop-sla";
import { batterijPurchasingStatus } from "@/lib/project-inkoop-checklist";
import {
  formatSchouwWeekLabel,
  isSchouwGeweest,
  isSchouwdagDefinitief,
  schouwWeekFromDate,
} from "@/lib/schouw-week";
import {
  FINANCIERING_PIPELINE,
  FINANCIERING_STATUS_LABEL_KORT,
  heeftWarmtefondsAfspraak,
  isWfVoorInBehandeling,
  normalizeFinancieringStatus,
  resolveFinancieringStatus,
  type FinancieringStatus,
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
 * WF: exacte schouwdag plannen zodra Warmtefonds is goedgekeurd.
 * Schouwweek-indicatie en ≥95% betaling sturen dit niet; 95% geldt voor installatie.
 */
export function kanWfSchouwdagInplannen(
  project: Project,
  _facturen: Factuur[] = []
): boolean {
  if (isSchouwdagDefinitief(project)) return false;
  return isWarmtefondsGoedgekeurdVoorSchouw(project);
}

/**
 * WF-installatie in Acties: schouw is geweest + ≥95% van offerte betaald.
 * Deadline = eerstvolgende werkdag daarna (zie uitvoerDeadlineVolgendeWerkdag).
 */
export function kanWfInstallatieInplannen(
  project: Project,
  facturen: Factuur[] = [],
  now: Date = new Date()
): boolean {
  if (project.installatie_at) return false;
  if (!isSchouwGeweest(project, now)) return false;
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
  | { kind: "status"; label: string; status: ProjectStatusKey }
  | {
      kind: "financiering";
      label: string;
      financiering_status: FinancieringStatus;
    };

/** WF-afspraak staat: volgende actie = voltooien → in behandeling. */
function wfAfspraakVoltooienStap(
  project: Project
): ProjectVolgendeStapInfo | null {
  if (!heeftWarmtefondsAfspraak(project)) return null;
  const n = normalizeFinancieringStatus(resolveFinancieringStatus(project));
  if (!isWfVoorInBehandeling(n)) return null;

  const wanneer = project.warmtefonds_afspraak_at
    ? formatDateTimeNl(project.warmtefonds_afspraak_at)
    : null;

  return {
    eyebrow: "Volgende stap",
    titel: "Voltooi WF-afspraak",
    reden: wanneer
      ? `WF-afspraak staat op ${wanneer}. Na de afspraak: markeer als voltooid — dan gaat de fase naar in behandeling.`
      : "WF-afspraak staat gepland. Na de afspraak: markeer als voltooid — dan gaat de fase naar in behandeling.",
    uiterlijkLabel: wanneer || "Op/na de WF-afspraak",
    uiterlijkAt: project.warmtefonds_afspraak_at || null,
    urgent: true,
    overdue: false,
    actie: {
      kind: "financiering",
      label: "Zet in behandeling",
      financiering_status: "in_behandeling",
    },
    wachtOp: null,
    volgendeDaarna: "WF in behandeling (wacht op beoordeling)",
    voorwaarden: [
      {
        label: "WF-afspraak gepland",
        ok: true,
      },
    ],
  };
}

export type ProjectVolgendeStapVoorwaarde = {
  label: string;
  ok: boolean;
};

export type ProjectVolgendeStapInfo = {
  eyebrow: string;
  titel: string;
  reden: string;
  uiterlijkLabel: string;
  uiterlijkAt: string | null;
  urgent: boolean;
  overdue: boolean;
  actie: VolgendeStapActie | null;
  /**
   * Wacht-modus: wat er nog moet gebeuren vóór de volgende orderstap.
   * Leeg/undefined = actieve BO-stap (niet wachten).
   */
  wachtOp?: string | null;
  /** Wat de volgende orderstap wordt zodra de wachtconditie klaar is. */
  volgendeDaarna?: string | null;
  /** Parallel spoor (bijv. WF-declaratie naast schouwdag). */
  parallel?: ProjectVolgendeStapVoorwaarde[];
  /** Voorwaarden om deze actie te mogen doen / door te gaan. */
  voorwaarden?: ProjectVolgendeStapVoorwaarde[];
};

function wachtStap(opts: {
  titel: string;
  wachtOp: string;
  volgendeDaarna: string;
  reden: string;
  uiterlijkLabel?: string;
  uiterlijkAt?: string | null;
  actie?: VolgendeStapActie | null;
}): ProjectVolgendeStapInfo {
  return {
    eyebrow: "Wachten",
    titel: opts.titel,
    reden: opts.reden,
    uiterlijkLabel: opts.uiterlijkLabel ?? "Zodra voorwaarde klaar is",
    uiterlijkAt: opts.uiterlijkAt ?? null,
    urgent: false,
    overdue: false,
    actie: opts.actie ?? null,
    wachtOp: opts.wachtOp,
    volgendeDaarna: opts.volgendeDaarna,
  };
}

function wfFinancieringWachtLabel(project: Project): string | null {
  const raw = resolveFinancieringStatus(project);
  const n = normalizeFinancieringStatus(raw);
  if (!n || n === "uitbetaald" || n === "afgewezen") return null;
  switch (n) {
    case "doorgestuurd_naar_edwin":
    case "documenten_aanleveren":
      return "Warmtefonds-documenten compleet";
    case "contact_verstuurd":
      return "Reactie klant / doorzetten naar in behandeling";
    case "in_behandeling":
      return "Goedkeuring Warmtefonds";
    case "aanbod_ondertekenen":
      return "Ondertekening Warmtefonds-aanbod";
    case "declaratie_indienen":
      return "Declaratie Warmtefonds indienen";
    case "wacht_op_betaling":
      return "Uitbetaling Warmtefonds";
    default:
      return FINANCIERING_STATUS_LABEL_KORT[n] || null;
  }
}

/**
 * Schouw (gepland of geweest) vóór WF-goedkeuring — komt voor bij vroege planning.
 * Order staat al verder; toon wat BO nog met WF moet doen (geen dubbele “status”).
 */
function wfSchouwEerderDanGoedkeuring(
  project: Project,
  now: Date
): ProjectVolgendeStapInfo | null {
  if (isWarmtefondsGoedgekeurdVoorSchouw(project)) return null;
  const gepland = isSchouwdagDefinitief(project);
  const geweest = isSchouwGeweest(project, now);
  if (!gepland && !geweest) return null;

  const raw = resolveFinancieringStatus(project);
  const n = normalizeFinancieringStatus(raw);
  const fsKort =
    (n && FINANCIERING_STATUS_LABEL_KORT[n]) ||
    wfFinancieringWachtLabel(project) ||
    "Warmtefonds";
  const schouwLabel = project.schouw_at
    ? formatUiterlijkAt(project.schouw_at)
    : null;

  // Afspraak gepland → eerst voltooien, daarna in behandeling
  const afspraakVoltooien = wfAfspraakVoltooienStap(project);
  if (afspraakVoltooien) return afspraakVoltooien;

  // BO moet nog documenten / doorzetten — echte actie, geen “afwachten”
  if (
    n === "doorgestuurd_naar_edwin" ||
    n === "documenten_aanleveren" ||
    !n
  ) {
    return {
      eyebrow: "Volgende stap",
      titel: "Rond WF af: documenten / doorzetten",
      reden: geweest
        ? `Schouw is al geweest; WF staat nog op “${fsKort}”. Rond documenten af (open taak) en zet door naar in behandeling.`
        : `Schouwdag staat al${schouwLabel ? ` (${schouwLabel})` : ""}; WF is nog “${fsKort}”. Jouw actie: documenten afronden en doorzetten. Daarna wacht je op beoordeling Warmtefonds.`,
      uiterlijkLabel: "Nu",
      uiterlijkAt: null,
      urgent: true,
      overdue: false,
      actie: null,
    };
  }

  // In behandeling e.d.: echt wachten op Warmtefonds
  const fsWacht =
    wfFinancieringWachtLabel(project) || "Goedkeuring Warmtefonds";

  if (geweest) {
    return wachtStap({
      titel: "Schouw geweest — wacht op WF-goedkeuring",
      wachtOp: fsWacht,
      volgendeDaarna: "Declaratie / installatie na goedkeuring",
      reden: `Schouw is uitgevoerd; WF staat op “${fsKort}”. Geen interne actie tot Warmtefonds beslist — opvolgen via open WF-taken indien nodig.`,
      uiterlijkLabel: "Zodra Warmtefonds beslist",
    });
  }

  return wachtStap({
    titel: "Schouw staat — wacht op WF-goedkeuring",
    wachtOp: fsWacht,
    volgendeDaarna: "Na goedkeuring: declaratie + verdere stappen",
    reden: schouwLabel
      ? `Schouwdag staat op ${schouwLabel}; WF is “${fsKort}”. Order blijft hier tot goedkeuring — jij hoeft nu niets te plannen.`
      : `Schouwdag staat; WF is “${fsKort}”. Wacht op goedkeuring Warmtefonds.`,
    uiterlijkLabel: schouwLabel || "Op de geplande schouwdag",
    uiterlijkAt: project.schouw_at || null,
  });
}

/**
 * WF na schouw / richting installatie: toon altijd wat we afwachten + wat daarna komt.
 */
function wfWachtTotInstallatie(
  project: Project,
  facturen: Factuur[],
  now: Date
): ProjectVolgendeStapInfo {
  const vroeg = wfSchouwEerderDanGoedkeuring(project, now);
  if (vroeg) return vroeg;

  const schouwOk = isSchouwGeweest(project, now);
  const pct = orderBetalingPctTegenOfferte(project, facturen);
  const betaaldOk = pct >= WF_INSTALLATIE_MIN_BETAALD_PCT;
  const fsWacht = wfFinancieringWachtLabel(project);

  // Schouwdag nog niet gezet: na WF-goedkeuring is dat een actie, geen wacht.
  if (!schouwOk && !isSchouwdagDefinitief(project)) {
    if (isWarmtefondsGoedgekeurdVoorSchouw(project)) {
      const due = dueEndOfDayInDays(2, now);
      const n = normalizeFinancieringStatus(resolveFinancieringStatus(project));
      const declaratieOk =
        !!n &&
        (n === "declaratie_indienen" ||
          n === "wacht_op_betaling" ||
          n === "uitbetaald" ||
          FINANCIERING_PIPELINE.indexOf(n) >=
            FINANCIERING_PIPELINE.indexOf("declaratie_indienen"));
      return {
        eyebrow: "Volgende stap",
        titel: "Schouwdag inplannen + WF-declaratie",
        reden:
          "Warmtefonds is goedgekeurd. Stuur de declaratie door en plan de exacte schouwdag met de klant. De schouwweek was alleen een indicatie.",
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
        wachtOp: null,
        volgendeDaarna: "Installatiedatum inplannen (na schouw + ≥95%)",
        parallel: [
          { label: "WF declaratie", ok: declaratieOk },
          {
            label: "Schouwdag inplannen",
            ok: isSchouwdagDefinitief(project),
          },
        ],
        voorwaarden: [
          {
            label: "Warmtefonds goedgekeurd",
            ok: true,
          },
        ],
      };
    }
    return wachtStap({
      titel: `Wachten: ${fsWacht || "Goedkeuring Warmtefonds"}`,
      wachtOp: fsWacht || "Goedkeuring Warmtefonds",
      volgendeDaarna: "WF-declaratie + schouwdag inplannen",
      reden:
        "Na goedkeuring: declaratie doorsturen en exacte schouwdag plannen. Schouwweek-indicatie stuurt dit niet.",
    });
  }

  const nodig: string[] = [];
  if (!schouwOk) {
    nodig.push("Schouwdag laten plaatsvinden");
  } else {
    // Schouw geweest: formulier is de operationele gate vóór doorpakken
    nodig.push("Schouwformulier binnen");
  }
  if (!betaaldOk) {
    nodig.push(
      fsWacht
        ? `${fsWacht} (≥${WF_INSTALLATIE_MIN_BETAALD_PCT}% betaald)`
        : `≥${WF_INSTALLATIE_MIN_BETAALD_PCT}% van offerte betaald (nu ${Math.round(pct)}%)`
    );
  }

  const titel =
    !schouwOk
      ? "Wachten tot schouw geweest is"
      : fsWacht && !betaaldOk
        ? `Wachten: ${fsWacht}`
        : !betaaldOk
          ? "Wachten op uitbetaling Warmtefonds"
          : "Wachten tot schouwformulier er is";

  return {
    ...wachtStap({
      titel,
      wachtOp: nodig.join(" · "),
      volgendeDaarna: "Installatiedatum inplannen",
      reden: `Order staat klaar voor installatie zodra dit binnen is. Nu nodig: ${nodig.join("; ")}.`,
      uiterlijkLabel: "Geen BO-deadline — parallel opvolgen via open taken / WF",
      actie: null,
    }),
    voorwaarden: [
      {
        label: "Schouw geweest",
        ok: schouwOk,
      },
      {
        label: "Warmtefonds uitbetaald",
        ok: betaaldOk,
      },
    ],
  };
}

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
        ? "Warmtefonds: declaratie betaald én schouw geweest — plan de installatie op de eerstvolgende werkdag. Zodra die datum staat, komt de order bij Purchasing te bestellen (5 werkdagen vóór de installatie)."
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

    // Schouwweek is geen BO-actie — alleen indicatie in kickoff/track & trace.
    return wachtStap({
      titel: "Wachten: opstarten / Warmtefonds",
      wachtOp: "Kickoff afronden (indicatie-schouwweek optioneel) · WF-traject",
      volgendeDaarna: "Na WF-goedkeuring: declaratie + schouwdag inplannen",
      reden:
        "De schouwweek is alleen een inschatting voor de klant, geen planning-actie. Exacte schouwdag volgt ná WF-goedkeuring, samen met de declaratie.",
      actie: {
        kind: "anchor",
        label: "Naar opstarten",
        href: "#project-kickoff",
      },
    });
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

  // Warmtefonds: schouwdag pas ná goedkeuring (niet op schouwweek-indicatie)
  if (wf && !isWarmtefondsGoedgekeurdVoorSchouw(project)) {
    const fsWacht =
      wfFinancieringWachtLabel(project) || "Goedkeuring Warmtefonds";
    const indicatie = week
      ? ` Indicatie voor de klant: ${formatSchouwWeekLabel(week.jaar, week.week) || `week ${week.week}`}.`
      : "";
    return wachtStap({
      titel: `Wachten: ${fsWacht}`,
      wachtOp: fsWacht,
      volgendeDaarna: "WF-declaratie doorsturen + schouwdag inplannen",
      reden: `Exacte schouwdag en declaratie volgen ná WF-goedkeuring.${indicatie}`,
    });
  }

  if (wf) {
    const due = dueEndOfDayInDays(2, now);
    const n = normalizeFinancieringStatus(resolveFinancieringStatus(project));
    const declaratieOk =
      !!n &&
      (n === "declaratie_indienen" ||
        n === "wacht_op_betaling" ||
        n === "uitbetaald" ||
        FINANCIERING_PIPELINE.indexOf(n) >=
          FINANCIERING_PIPELINE.indexOf("declaratie_indienen"));
    return {
      eyebrow: "Volgende stap",
      titel: "Schouwdag inplannen + WF-declaratie",
      reden:
        "Warmtefonds is goedgekeurd — stuur de declaratie door en plan de exacte schouwdag met de klant.",
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
      parallel: [
        { label: "WF declaratie", ok: declaratieOk },
        {
          label: "Schouwdag inplannen",
          ok: isSchouwdagDefinitief(project),
        },
      ],
      voorwaarden: [
        { label: "Warmtefonds goedgekeurd", ok: true },
      ],
    };
  }

  // Eigen middelen: schouwdag zodra betaling rond is — niet gekoppeld aan schouwweek
  const dueEm = dueEndOfDayInDays(1, now);
  return {
    eyebrow: "Volgende stap",
    titel: "Schouwdag inplannen met de klant",
    reden: "Plan de exacte schouwdag (de eventuele schouwweek was alleen een inschatting).",
    uiterlijkLabel: formatUiterlijkAt(dueEm),
    uiterlijkAt: dueEm,
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
      // Ná betaling én schouw: eerstvolgende werkdag. Is die al voorbij,
      // dan schuift de actie door naar de eerstvolgende werkdag vanaf nu.
      const updatedRaw = project.updated_at || project.created_at;
      const updated = updatedRaw ? new Date(updatedRaw) : now;
      const schouw = project.schouw_at ? new Date(project.schouw_at) : null;
      let anchor = Number.isNaN(updated.getTime()) ? now : updated;
      if (
        schouw &&
        !Number.isNaN(schouw.getTime()) &&
        schouw.getTime() > anchor.getTime()
      ) {
        anchor = schouw;
      }
      uiterlijkAt = uitvoerDeadlineVolgendeWerkdag(anchor, now).toISOString();
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

  // Warmtefonds: installatie pas na schouw + ≥95%. Anders: toon wacht + volgende.
  if (betaalwijze === "warmtefonds") {
    // Afspraak gepland → voltooien = naar in behandeling (vóór wacht/goedkeuring)
    const afspraakVoltooien = wfAfspraakVoltooienStap(project);
    if (afspraakVoltooien) return afspraakVoltooien;

    // Vroege schouw t.o.v. WF-goedkeuring (planning) — altijd expliciet maken
    const vroegSchouw = wfSchouwEerderDanGoedkeuring(project, now);
    if (vroegSchouw) return vroegSchouw;

    const isInstallatieKandidaat =
      status === "schouwdag_ingepland" ||
      status === "schouw_voltooid" ||
      status === "restfactuur_verstuurd" ||
      status === "restfactuur_betaald" ||
      status === "materiaal_besteld";
    if (isInstallatieKandidaat) {
      if (!kanWfInstallatieInplannen(project, facturen, now)) {
        // Schouw gepland maar nog niet geweest (WF al wel goedgekeurd)
        if (
          status === "schouwdag_ingepland" &&
          isSchouwdagDefinitief(project) &&
          !isSchouwGeweest(project, now)
        ) {
          return wachtStap({
            titel: "Wachten tot schouw geweest is",
            wachtOp: "Schouwdag laten plaatsvinden",
            volgendeDaarna: "Schouwformulier uploaden → daarna installatie plannen",
            reden: project.schouw_at
              ? `Schouw staat op ${formatUiterlijkAt(project.schouw_at)}. Daarna: formulier + WF-betaling → installatie.`
              : "Schouwdag staat gepland. Na de schouw volgt formulier en (na betaling) installatie.",
            uiterlijkLabel: project.schouw_at
              ? formatUiterlijkAt(project.schouw_at)
              : "Op de geplande schouwdag",
            uiterlijkAt: project.schouw_at || null,
          });
        }
        return wfWachtTotInstallatie(project, facturen, now);
      }
      return volgendeStapVanTaak(
        "restfactuur_betaald",
        betaalwijze,
        project,
        now
      );
    }

    // Afwachten WF (nog geen dag) — schouwweek-indicatie stuurt geen actie
    if (status === "opstarten_voltooid_afwachten_wf") {
      const week = schouwWeekOf(project);
      const fsWacht =
        wfFinancieringWachtLabel(project) || "Goedkeuring Warmtefonds";
      const indicatie = week
        ? ` Klant-indicatie: ${formatSchouwWeekLabel(week.jaar, week.week) || `week ${week.week}`}.`
        : "";
      return wachtStap({
        titel: `Wachten: ${fsWacht}`,
        wachtOp: fsWacht,
        volgendeDaarna: "WF-declaratie + schouwdag inplannen",
        reden: `Opstarten klaar — na goedkeuring declaratie doorsturen en exacte schouwdag plannen.${indicatie}`,
      });
    }
  }

  // Eigen middelen: installatie pas ná schouw + betaling.
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
        return wachtStap({
          titel: "Wachten op betaling",
          wachtOp: "Eerste / restfactuur betaald",
          volgendeDaarna: "Installatiedatum inplannen",
          reden: "Zonder betaling gaan we niet door naar installatie/inkoop.",
        });
      }
      return volgendeStapVanTaak(
        "restfactuur_betaald",
        betaalwijze,
        project,
        now
      );
    }

    if (
      status === "schouwdag_ingepland" &&
      isSchouwdagDefinitief(project) &&
      !isSchouwGeweest(project, now)
    ) {
      return wachtStap({
        titel: "Wachten tot schouw geweest is",
        wachtOp: "Schouwdag laten plaatsvinden",
        volgendeDaarna: "Schouwformulier uploaden",
        reden: project.schouw_at
          ? `Schouw staat op ${formatUiterlijkAt(project.schouw_at)}.`
          : "Schouwdag staat gepland.",
        uiterlijkLabel: project.schouw_at
          ? formatUiterlijkAt(project.schouw_at)
          : "Op de geplande schouwdag",
        uiterlijkAt: project.schouw_at || null,
      });
    }
  }

  const vanTaak = volgendeStapVanTaak(status, betaalwijze, project, now);
  if (vanTaak) return vanTaak;

  // Fallback: nooit stilzwijgend leeg als er nog pipeline is
  if (status === "schouwdag_ingepland") {
    return wachtStap({
      titel: "Wachten tot schouw geweest is",
      wachtOp: "Schouwdag",
      volgendeDaarna: "Schouwformulier / volgende orderstap",
      reden: redenVoorStatus(status, betaalwijze === "warmtefonds"),
      uiterlijkAt: project.schouw_at || null,
      uiterlijkLabel: project.schouw_at
        ? formatUiterlijkAt(project.schouw_at)
        : "Op de geplande schouwdag",
    });
  }

  if (status === "installatie_ingepland" || status === "materiaal_besteld") {
    const batterij = batterijPurchasingStatus(project.materiaal_checks);
    if (materiaalNogTeBestellen(project) || !batterij.besteld) {
      const due = project.installatie_at
        ? bestelDeadlineVoorInstallatie(project.installatie_at).toISOString()
        : null;
      const overdue = due ? isPast(due, now) : false;
      return {
        eyebrow: overdue ? "Volgende stap — te laat" : "Volgende stap",
        titel: "Batterij / materiaal bestellen",
        reden: project.installatie_at
          ? `Installatie staat gepland — bestel uiterlijk ${INKOOP_DAGEN_VOOR_INSTALLATIE} werkdagen van tevoren (Purchasing).`
          : "Materiaal nog open — afhandelen in Purchasing.",
        uiterlijkLabel: due
          ? formatUiterlijkAt(due)
          : "Zo snel mogelijk",
        uiterlijkAt: due,
        urgent: true,
        overdue,
        actie: {
          kind: "anchor",
          label: "Open Purchasing",
          href: "/?tab=purchasing",
        },
        wachtOp: null,
        volgendeDaarna: "Installatie laten uitvoeren",
      };
    }
    return wachtStap({
      titel: "Wachten tot installatie geweest is",
      wachtOp: "Installatiedag",
      volgendeDaarna: "Opleverformulier / after sale",
      reden: project.installatie_at
        ? `Installatie staat op ${formatUiterlijkAt(project.installatie_at)}. Materiaal is besteld.`
        : "Installatie is ingepland.",
      uiterlijkLabel: project.installatie_at
        ? formatUiterlijkAt(project.installatie_at)
        : "Op de geplande installatiedag",
      uiterlijkAt: project.installatie_at || null,
    });
  }

  return null;
}
