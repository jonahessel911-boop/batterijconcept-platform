/**
 * Klantgerichte track & trace — begrijpelijke stappen i.p.v. interne CRM-statussen.
 */
import {
  formatSchouwWeekLabel,
  isSchouwdagDefinitief,
  schouwWeekEerder,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import {
  toOperationalStatus,
  type ProjectStatusKey,
} from "@/lib/project-status-config";
import { planningVensterNl } from "@/lib/planning-window";

export type KlantStapId =
  | "order_bevestigd"
  | "btw_factuur"
  | "warmtefonds_afspraak"
  | "schouwweek"
  | "schouwdag"
  | "klaar_voor_installatie"
  | "installatie"
  | "geinstalleerd"
  | "dynamische_energie"
  | "btw_terugvragen";

export type KlantStapState = "done" | "current" | "upcoming";

export type KlantStap = {
  id: KlantStapId;
  title: string;
  detail: string | null;
  state: KlantStapState;
};

export type KlantNazorgItem = {
  id: "btw" | "energie";
  title: string;
  status: "wacht" | "bezig" | "klaar";
  detail: string;
};

export type KlantTrackFactuur = {
  id: string;
  factuur_nummer: string;
  label: string;
  status: string;
  bedrag_inc_btw: number;
  factuurdatum: string;
  betaald_op: string | null;
};

export type KlantAgendaItem = {
  id:
    | "schouwweek"
    | "schouwdag"
    | "installatie"
    | "service"
    | "warmtefonds_afspraak";
  titel: string;
  status: "gepland" | "wacht" | "voltooid";
  /** ISO voor sortering */
  sortAt: string | null;
  /** Lange regel, bv. "Week 43 · 19 okt – 25 okt 2026" */
  when: string | null;
  /** Agenda-layout: dagnummer */
  day: string | null;
  /** Agenda-layout: korte maand */
  month: string | null;
  /** Agenda-layout: weekdag */
  weekday: string | null;
  /** Tijdvenster of "hele week" */
  timeLabel: string | null;
  detail: string;
};

export type KlantTrackPayload = {
  track_token: string;
  klant_naam: string;
  project_nummer: string | null;
  offerte_nummer: string;
  adres: string | null;
  geannuleerd: boolean;
  huidige_samenvatting: string;
  stappen: KlantStap[];
  agenda: KlantAgendaItem[];
  nazorg: KlantNazorgItem[];
  documenten: {
    offerte: {
      beschikbaar: boolean;
      nummer: string;
      ondertekend_op: string | null;
    };
    facturen: KlantTrackFactuur[];
  };
};

type ProjectLite = {
  project_nummer: string;
  status: string;
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  schouw_at?: string | null;
  installatie_at?: string | null;
  installatie_voltooid_at?: string | null;
  service_at?: string | null;
  /** Interne Warmtefonds-aanvraagafspraak */
  warmtefonds_afspraak_at?: string | null;
  financiering_status?: string | null;
  betaalwijze?: string | null;
  financiering_voorbehoud?: boolean | null;
  /** Schouw pas afgerond als formulier geüpload is */
  schouw_formulier_geupload?: boolean;
  btw_terugvragen_aangevraagd_at?: string | null;
  overstap_dynamische_leverancier_at?: string | null;
};

function warmtefondsAfspraakState(
  project: ProjectLite,
  geinstalleerd: boolean
): KlantStapState {
  const at = project.warmtefonds_afspraak_at;
  if (!at) return "upcoming";
  const fs = project.financiering_status;
  if (
    geinstalleerd ||
    fs === "aanvraag_gedaan" ||
    fs === "aanvraag_goedgekeurd" ||
    fs === "uitbetaald"
  ) {
    return "done";
  }
  if (new Date(at).getTime() <= Date.now()) return "done";
  return "current";
}

function resolveCurrentIndex(
  project: ProjectLite | null,
  btwStand: BtwFactuurStand
): number {
  const btwKlaar =
    btwStand === "betaald" || btwStand === "niet_van_toepassing";
  if (!project) return btwKlaar ? 2 : 1;
  if (project.status === "annulering") return -1;

  const status = toOperationalStatus(project.status);
  const geinstalleerd = isGeinstalleerd(status, project);

  // Indices: 0 order · 1 BTW-factuur · 2 schouwweek · … · 6 geïnstalleerd · 7 energie · 8 btw-terug
  if (project.btw_terugvragen_aangevraagd_at) return 9;
  if (project.overstap_dynamische_leverancier_at) return 8;
  if (geinstalleerd) return 7;

  if (project.installatie_at || status === "installatie_ingepland") return 5;

  if (project.schouw_formulier_geupload) return 4;

  if (isSchouwdagDefinitief(project)) return 3;

  // BTW-factuur eerst afronden (betaling) vóór schouwweek als current
  if (!btwKlaar) return 1;

  if (project.schouw_jaar && project.schouw_week) return 2;

  if (status === "schouwdag_ingepland") {
    return project.schouw_jaar && project.schouw_week ? 2 : 1;
  }

  return 2; // klaar voor schouwweek-inplannen
}

function schouwweekContactTekst(jaar: number, week: number): string {
  const prev = schouwWeekEerder(jaar, week);
  return `Ongeveer een week van tevoren (week ${prev.week}) nemen we contact op om de exacte schouwdag in te plannen.`;
}

const INSTALLATIE_WACHT_DETAIL =
  "Na een geslaagde schouw en de Warmtefonds-declaratie kopen we je batterij in. Eén dag na de schouw plannen we je installatiedatum in.";

/**
 * Geïnstalleerd alleen op harde DB-signalen (niet alleen status "service").
 */
function isGeinstalleerd(
  status: ProjectStatusKey,
  p: ProjectLite
): boolean {
  if (p.installatie_voltooid_at) return true;
  if (status === "installatie_voltooid" || status === "review_gevraagd") {
    return true;
  }
  return false;
}

export function friendlyFactuurLabel(
  omschrijving: string | null | undefined
): string {
  const o = (omschrijving || "").toLowerCase();
  if (o.includes("aanbetaling") || o.includes("btw")) return "BTW-factuur";
  if (o.includes("restant") || o.includes("restfactuur")) return "Eindafrekening";
  if (o.includes("credit")) return "Creditfactuur";
  return "Factuur";
}

function isAanbetalingOmschrijving(omschrijving: string | null | undefined) {
  return /aanbetaling|btw-factuur/i.test(omschrijving || "");
}

type BtwFactuurStand = "niet_van_toepassing" | "wacht" | "open" | "betaald";

function resolveBtwFactuurStand(
  project: ProjectLite | null,
  facturen: Array<{ omschrijving: string | null; status: string }>
): BtwFactuurStand {
  const aanb = facturen.filter((f) => isAanbetalingOmschrijving(f.omschrijving));
  if (aanb.some((f) => f.status === "betaald")) return "betaald";
  if (
    aanb.some(
      (f) => f.status === "verzonden" || f.status === "deels_betaald"
    )
  ) {
    return "open";
  }
  const needs =
    project?.betaalwijze === "warmtefonds" ||
    project?.financiering_voorbehoud === true ||
    aanb.length > 0;
  if (!needs) return "niet_van_toepassing";
  return "wacht";
}

function dateParts(iso: string): {
  day: string;
  month: string;
  weekday: string;
} {
  const d = new Date(iso);
  return {
    day: new Intl.DateTimeFormat("nl-NL", {
      day: "numeric",
      timeZone: "Europe/Amsterdam",
    }).format(d),
    month: new Intl.DateTimeFormat("nl-NL", {
      month: "short",
      timeZone: "Europe/Amsterdam",
    }).format(d),
    weekday: new Intl.DateTimeFormat("nl-NL", {
      weekday: "long",
      timeZone: "Europe/Amsterdam",
    }).format(d),
  };
}

function weekSortAt(jaar: number, week: number): string | null {
  try {
    return schouwWeekToMondayIso(jaar, week);
  } catch {
    return null;
  }
}

function buildAgenda(project: ProjectLite | null): KlantAgendaItem[] {
  const items: KlantAgendaItem[] = [];
  if (!project) {
    return [
      {
        id: "schouwweek",
        titel: "Schouwweek",
        status: "wacht",
        sortAt: null,
        when: null,
        day: null,
        month: null,
        weekday: null,
        timeLabel: null,
        detail:
          "Nog niet ingepland. We sturen je een mail zodra de schouwweek bekend is.",
      },
      {
        id: "schouwdag",
        titel: "Schouwdag",
        status: "wacht",
        sortAt: null,
        when: null,
        day: null,
        month: null,
        weekday: null,
        timeLabel: null,
        detail: "Eerst plannen we een schouwweek; daarna volgt de exacte dag.",
      },
      {
        id: "installatie",
        titel: "Installatie",
        status: "wacht",
        sortAt: null,
        when: null,
        day: null,
        month: null,
        weekday: null,
        timeLabel: null,
        detail: INSTALLATIE_WACHT_DETAIL,
      },
    ];
  }

  const status = toOperationalStatus(project.status);
  const geinstalleerd = isGeinstalleerd(status, project);
  const weekLabel =
    project.schouw_jaar && project.schouw_week
      ? formatSchouwWeekLabel(project.schouw_jaar, project.schouw_week)
      : null;
  const schouwDef = isSchouwdagDefinitief(project);
  const schouwFormulier = Boolean(project.schouw_formulier_geupload);

  // --- Warmtefonds-afspraak (alleen als gezet in DB) ---
  if (project.warmtefonds_afspraak_at) {
    const at = project.warmtefonds_afspraak_at;
    const parts = dateParts(at);
    const past = new Date(at).getTime() <= Date.now();
    const fs = project.financiering_status;
    const afgerond =
      geinstalleerd ||
      past ||
      fs === "aanvraag_gedaan" ||
      fs === "aanvraag_goedgekeurd" ||
      fs === "uitbetaald";
    items.push({
      id: "warmtefonds_afspraak",
      titel: "Warmtefonds-afspraak",
      status: afgerond ? "voltooid" : "gepland",
      sortAt: at,
      when: formatNlDateTime(at),
      day: parts.day,
      month: parts.month,
      weekday: parts.weekday,
      timeLabel: new Intl.DateTimeFormat("nl-NL", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Amsterdam",
      }).format(new Date(at)),
      detail: afgerond
        ? "Afspraak voor je Warmtefonds-aanvraag."
        : "Afspraak om je Warmtefonds-aanvraag te regelen. Noteer deze datum.",
    });
  }

  // --- Schouwweek (altijd tonen; week ≠ dag, staat boven schouwdag) ---
  if (weekLabel && project.schouw_jaar && project.schouw_week) {
    const mondayIso = weekSortAt(project.schouw_jaar, project.schouw_week);
    const parts = mondayIso ? dateParts(mondayIso) : null;
    const contact = schouwweekContactTekst(
      project.schouw_jaar,
      project.schouw_week
    );
    items.push({
      id: "schouwweek",
      titel: "Schouwweek",
      // Week-fase klaar zodra de exacte dag gepland is (of schouwformulier er is)
      status: schouwDef || schouwFormulier ? "voltooid" : "gepland",
      sortAt: mondayIso,
      when: weekLabel,
      day: parts?.day ?? "W",
      month: parts?.month ?? String(project.schouw_week),
      weekday: "Week",
      timeLabel: `Week ${project.schouw_week}`,
      detail: `Je schouw valt in ${weekLabel}. ${contact}`,
    });
  } else {
    items.push({
      id: "schouwweek",
      titel: "Schouwweek",
      status: "wacht",
      sortAt: null,
      when: null,
      day: null,
      month: null,
      weekday: null,
      timeLabel: null,
      detail:
        "Nog niet ingepland. We sturen je een mail zodra de schouwweek bekend is.",
    });
  }

  // --- Schouwdag (pas afgerond bij schouwformulier) ---
  if (schouwDef && project.schouw_at) {
    const parts = dateParts(project.schouw_at);
    const venster = planningVensterNl(project.schouw_at);
    items.push({
      id: "schouwdag",
      titel: "Schouwdag",
      status: schouwFormulier || geinstalleerd ? "voltooid" : "gepland",
      sortAt: project.schouw_at,
      when: formatNlDateTime(project.schouw_at),
      day: parts.day,
      month: parts.month,
      weekday: parts.weekday,
      timeLabel: venster.label,
      detail: schouwFormulier
        ? "Schouw is uitgevoerd — het schouwformulier is ontvangen."
        : "Installatiepartner komt langs voor de schouw (opname ter plaatse).",
    });
  } else {
    items.push({
      id: "schouwdag",
      titel: "Schouwdag",
      status: "wacht",
      sortAt: null,
      when: null,
      day: null,
      month: null,
      weekday: null,
      timeLabel: null,
      detail:
        weekLabel && project.schouw_jaar && project.schouw_week
          ? schouwweekContactTekst(project.schouw_jaar, project.schouw_week)
          : "Eerst plannen we een schouwweek; daarna volgt de exacte dag.",
    });
  }

  // --- Installatie ---
  const installAt = project.installatie_at || null;
  const voltooidAt = project.installatie_voltooid_at || null;
  if (installAt || voltooidAt || geinstalleerd) {
    const anchor = installAt || voltooidAt!;
    const parts = dateParts(anchor);
    const venster = installAt ? planningVensterNl(installAt) : null;
    items.push({
      id: "installatie",
      titel: "Installatie",
      status: geinstalleerd || Boolean(voltooidAt) ? "voltooid" : "gepland",
      sortAt: anchor,
      when: installAt
        ? formatNlDateTime(installAt)
        : voltooidAt
          ? `Afgerond op ${formatNlDate(voltooidAt)}`
          : null,
      day: parts.day,
      month: parts.month,
      weekday: parts.weekday,
      timeLabel: venster?.label || (voltooidAt ? "Afgerond" : null),
      detail:
        geinstalleerd || voltooidAt
          ? "Je thuisbatterij is geïnstalleerd."
          : "Zorg dat er iemand aanwezig is en dat de meterkast bereikbaar is.",
    });
  } else {
    items.push({
      id: "installatie",
      titel: "Installatie",
      status: "wacht",
      sortAt: null,
      when: null,
      day: null,
      month: null,
      weekday: null,
      timeLabel: null,
      detail: INSTALLATIE_WACHT_DETAIL,
    });
  }

  // --- Optionele service-afspraak ---
  if (project.service_at) {
    const parts = dateParts(project.service_at);
    const venster = planningVensterNl(project.service_at);
    const past = new Date(project.service_at).getTime() < Date.now();
    items.push({
      id: "service",
      titel: "Service",
      status: past ? "voltooid" : "gepland",
      sortAt: project.service_at,
      when: formatNlDateTime(project.service_at),
      day: parts.day,
      month: parts.month,
      weekday: parts.weekday,
      timeLabel: venster.label,
      detail: "Service-afspraak bij jou thuis.",
    });
  }

  return items;
}

export function buildKlantTrack(opts: {
  trackToken: string;
  klantNaam: string;
  adres: string | null;
  offerte: {
    offerte_nummer: string;
    ondertekend_op: string | null;
    signed_pdf_path: string | null;
  };
  project: ProjectLite | null;
  facturen: Array<{
    id: string;
    factuur_nummer: string;
    omschrijving: string | null;
    status: string;
    bedrag_inc_btw: number;
    factuurdatum: string;
    betaald_op: string | null;
  }>;
}): KlantTrackPayload {
  const geannuleerd = opts.project?.status === "annulering";
  const status = opts.project
    ? toOperationalStatus(opts.project.status)
    : null;
  const geinstalleerd = opts.project
    ? isGeinstalleerd(status || "schouwweek_inplannen", opts.project)
    : false;

  const weekLabel =
    opts.project?.schouw_jaar && opts.project?.schouw_week
      ? formatSchouwWeekLabel(opts.project.schouw_jaar, opts.project.schouw_week)
      : null;
  const schouwDef = opts.project
    ? isSchouwdagDefinitief(opts.project)
    : false;

  const btwStand = resolveBtwFactuurStand(opts.project, opts.facturen);
  const btwFactuur = opts.facturen.find((f) =>
    isAanbetalingOmschrijving(f.omschrijving)
  );

  const defs: Array<{ id: KlantStapId; title: string; detail: string | null }> =
    [
      {
        id: "order_bevestigd",
        title: "Order bevestigd",
        detail: opts.offerte.ondertekend_op
          ? `Offerte ${opts.offerte.offerte_nummer} is ondertekend`
          : `Offerte ${opts.offerte.offerte_nummer}`,
      },
      {
        id: "btw_factuur",
        title: "BTW-factuur",
        detail:
          btwStand === "betaald"
            ? btwFactuur?.betaald_op
              ? `Betaald op ${formatNlDate(btwFactuur.betaald_op)}`
              : "Betaald — bedankt."
            : btwStand === "open"
              ? "Je hebt de BTW-factuur per e-mail ontvangen. Betaal deze om verder te gaan met je order."
              : btwStand === "niet_van_toepassing"
                ? "Niet van toepassing op deze order."
                : "Je ontvangt de BTW-factuur (aanbetaling) per e-mail. Betaal deze om verder te gaan.",
      },
      {
        id: "schouwweek",
        title: "Schouwweek",
        detail:
          weekLabel && opts.project?.schouw_jaar && opts.project?.schouw_week
            ? `Gepland in ${weekLabel}. ${schouwweekContactTekst(opts.project.schouw_jaar, opts.project.schouw_week)}`
            : "We plannen eerst een week in waarin de schouw plaatsvindt. Via de mail krijg je ook toegang tot track & trace.",
      },
      {
        id: "schouwdag",
        title: "Schouwdag",
        detail:
          schouwDef && opts.project?.schouw_at
            ? opts.project.schouw_formulier_geupload
              ? `Uitgevoerd op ${formatNlDateTime(opts.project.schouw_at)} — schouwformulier ontvangen.`
              : `Afspraak op ${formatNlDateTime(opts.project.schouw_at)}`
            : weekLabel && opts.project?.schouw_jaar && opts.project?.schouw_week
              ? schouwweekContactTekst(
                  opts.project.schouw_jaar,
                  opts.project.schouw_week
                )
              : "Nog niet gepland.",
      },
      {
        id: "klaar_voor_installatie",
        title: "Klaarzetten voor installatie",
        detail:
          "Na een geslaagde schouw en de Warmtefonds-declaratie kopen we je batterij in. Updates volgen per e-mail.",
      },
      {
        id: "installatie",
        title: "Installatie",
        detail: opts.project?.installatie_at
          ? `Gepland op ${formatNlDateTime(opts.project.installatie_at)}`
          : opts.project?.installatie_voltooid_at
            ? `Afgerond op ${formatNlDate(opts.project.installatie_voltooid_at)}`
            : INSTALLATIE_WACHT_DETAIL,
      },
      {
        id: "geinstalleerd",
        title: "Geïnstalleerd",
        detail: geinstalleerd
          ? "Je thuisbatterij is geïnstalleerd."
          : "Nog niet uitgevoerd.",
      },
      {
        id: "dynamische_energie",
        title: "Overstap dynamische energie",
        detail: opts.project?.overstap_dynamische_leverancier_at
          ? `Geregeld op ${formatNlDate(opts.project.overstap_dynamische_leverancier_at)}. Je overstap naar een dynamisch energiecontract is in gang gezet.`
          : "Eén dag na de installatie bellen we je om de overstap naar een dynamische energieleverancier in te plannen.",
      },
      {
        id: "btw_terugvragen",
        title: "BTW terugvragen",
        detail: opts.project?.btw_terugvragen_aangevraagd_at
          ? `Aangevraagd op ${formatNlDate(opts.project.btw_terugvragen_aangevraagd_at)}. Het bedrag wordt meestal na 3 tot 4 maanden op je rekening gestort.`
          : "Na de installatie starten we de BTW-teruggave. Het bedrag wordt meestal na 3 tot 4 maanden op je rekening gestort.",
      },
    ];

  const currentIdx = resolveCurrentIndex(opts.project, btwStand);
  const stappen: KlantStap[] = defs.map((d, i) => {
    let state: KlantStapState;
    if (geannuleerd) {
      state = i < Math.max(currentIdx, 0) ? "done" : "upcoming";
    } else if (currentIdx < 0) {
      state = "upcoming";
    } else if (d.id === "btw_factuur" && btwStand === "niet_van_toepassing") {
      state = "done";
    } else if (d.id === "btw_factuur" && btwStand === "betaald") {
      state = "done";
    } else if (i < currentIdx) {
      state = "done";
    } else if (i === currentIdx) {
      state = "current";
    } else {
      state = "upcoming";
    }
    return { ...d, state };
  });

  // Warmtefonds-afspraak in traject zodra die in de DB staat
  if (opts.project?.warmtefonds_afspraak_at) {
    const at = opts.project.warmtefonds_afspraak_at;
    const wfState = geannuleerd
      ? "upcoming"
      : warmtefondsAfspraakState(opts.project, geinstalleerd);
    const btwStap = stappen.find((s) => s.id === "btw_factuur");
    if (btwStap && btwStap.state === "current" && wfState === "current") {
      /* parallel ok */
    }
    const insertAt = Math.max(
      stappen.findIndex((s) => s.id === "btw_factuur") + 1,
      2
    );
    stappen.splice(insertAt, 0, {
      id: "warmtefonds_afspraak",
      title: "Warmtefonds-afspraak",
      detail: `Afspraak op ${formatNlDateTime(at)}`,
      state: wfState,
    });
  }

  // Nazorg zit nu in het traject; aparte kaarten niet meer nodig
  const nazorg: KlantNazorgItem[] = [];

  const agenda = buildAgenda(opts.project);

  let huidige_samenvatting = "Je order is bevestigd.";
  if (geannuleerd) {
    huidige_samenvatting = "Deze order is geannuleerd.";
  } else {
    const current = stappen.find((s) => s.state === "current");
    if (current) {
      huidige_samenvatting = current.detail
        ? `${current.title} — ${current.detail}`
        : current.title;
    } else if (geinstalleerd) {
      huidige_samenvatting =
        "Je installatie is afgerond. We regelen nog de overstap en BTW-teruggave.";
    }
  }

  return {
    track_token: opts.trackToken,
    klant_naam: opts.klantNaam,
    project_nummer: opts.project?.project_nummer || null,
    offerte_nummer: opts.offerte.offerte_nummer,
    adres: opts.adres,
    geannuleerd,
    huidige_samenvatting,
    stappen,
    agenda,
    nazorg,
    documenten: {
      offerte: {
        beschikbaar: Boolean(opts.offerte.signed_pdf_path),
        nummer: opts.offerte.offerte_nummer,
        ondertekend_op: opts.offerte.ondertekend_op,
      },
      facturen: opts.facturen.map((f) => ({
        id: f.id,
        factuur_nummer: f.factuur_nummer,
        label: friendlyFactuurLabel(f.omschrijving),
        status: f.status,
        bedrag_inc_btw: Number(f.bedrag_inc_btw) || 0,
        factuurdatum: f.factuurdatum,
        betaald_op: f.betaald_op,
      })),
    },
  };
}

function formatNlDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Amsterdam",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

function formatNlDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Amsterdam",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
