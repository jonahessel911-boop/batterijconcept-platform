import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { Afspraak, Factuur, Lead, Project } from "@/types/database";
import { AMSTERDAM_TZ } from "@/lib/format";
import { factuurIsOverdue, vervaldatumEndOfDay } from "@/lib/factuur-betaling";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import { annuleringsNotitieFromAfspraak } from "@/lib/bel-queue";
import {
  defaultSchouwWeekAfterSale,
  formatSchouwWeekLabel,
  isSchouwdagDefinitief,
  schouwWeekOffsetVoorSale,
  type SchouwWeek,
} from "@/lib/schouw-week";
import { isKickoffComplete } from "@/lib/project-kickoff";
import { resolveProjectVolgendeStap } from "@/lib/project-volgende-stap";
import { toOperationalStatus } from "@/lib/project-status-config";
import {
  bestelDeadlineVoorInstallatie,
  INKOOP_DAGEN_VOOR_INSTALLATIE,
  materiaalNogTeBestellen,
} from "@/lib/inkoop-sla";
import { resolveFinancieringStatus } from "@/lib/financiering-status";

export type BackofficeActieSoort =
  | "bel_schouw_aanbetaling"
  | "schakel_financiering"
  | "nabellen_factuur"
  | "herplan_afspraak"
  | "volgende_stap"
  | "bestel_materiaal"
  | "aangetekende_brief";

/** Edwin van Veenendaal — plant Warmtefonds-afspraken / aanvragen. */
export const FINANCIERINGSMAN_NAAM = "Edwin van Veenendaal";
export const FINANCIERINGSMAN_TEL = "+31 6 58824298";
export const FINANCIERINGSMAN_TEL_HREF = "tel:+31658824298";
export const FINANCIERINGSMAN_WHATSAPP =
  "https://wa.me/31658824298";

export type BackofficeActie = {
  id: string;
  soort: BackofficeActieSoort;
  titel: string;
  detail: string;
  deadlineAt: string;
  saleAt?: string;
  overdue: boolean;
  leadId: string;
  leadNaam: string;
  telefoon?: string | null;
  plaats?: string | null;
  offerteId?: string | null;
  offerteNummer?: string | null;
  projectId?: string;
  projectNummer?: string | null;
  factuurId?: string;
  factuurNummer?: string | null;
  href: string;
  /** Voorgestelde schouwweek (sale + 5) bij bel-schouw-actie */
  schouwJaar?: number;
  schouwWeek?: number;
  schouwWeekLabel?: string;
  /** Alleen bij bel-schouw / schakel-financiering */
  project?: Project;
  /** Annuleringsreden (herplan_afspraak), uit afspraak-notities */
  annuleringsReden?: string | null;
  /** Volgende-stap: waarom dit nu moet */
  reden?: string | null;
  /** Volgende-stap: toon planner voor exacte schouwdag */
  planSchouwdag?: boolean;
  /** Volgende-stap: toon planner voor schouwweek */
  planSchouwweek?: boolean;
  /** Volgende-stap nog niet urgent (belweek ligt in de toekomst) */
  later?: boolean;
};

type ProjectOfferteJoin = {
  offertes?: {
    id?: string;
    offerte_nummer?: string | null;
    financiering_voorbehoud?: boolean | null;
    aanbetaling_te_innen_inc?: number | null;
    ondertekend_op?: string | null;
  } | null;
};

function projectOfferte(project: Project) {
  return (project as Project & ProjectOfferteJoin).offertes ?? null;
}

/**
 * Warmtefonds vs eigen middelen.
 * Lead-sale-status wint (sale_eigen_middelen / sale_financiering);
 * anders offerte.financiering_voorbehoud.
 */
export function isWarmtefondsSale(opts: {
  leadStatus?: string | null;
  financieringVoorbehoud?: boolean | null;
}): boolean {
  if (opts.leadStatus === "sale_eigen_middelen") return false;
  if (opts.leadStatus === "sale_financiering") return true;
  return Boolean(opts.financieringVoorbehoud);
}

export function isWarmtefondsProject(project: Project): boolean {
  if (project.betaalwijze === "eigen_middelen") return false;
  if (project.betaalwijze === "warmtefonds") return true;
  const leadStatus = project.leads?.status ?? null;
  return isWarmtefondsSale({
    leadStatus,
    financieringVoorbehoud: projectOfferte(project)?.financiering_voorbehoud,
  });
}

/** Aanbevolen schouwweek: +5 bij Warmtefonds, +1 bij eigen middelen. */
export function recommendedSchouwWeekForProject(
  project: Project,
  saleAt?: Date | string
): SchouwWeek {
  const from = saleAt
    ? typeof saleAt === "string"
      ? new Date(saleAt)
      : saleAt
    : saleMomentVanProject(project);
  return defaultSchouwWeekAfterSale(
    from,
    schouwWeekOffsetVoorSale(isWarmtefondsProject(project))
  );
}

/**
 * Verkoopmoment = tekenen van de offerte (voor schouwweek e.d.).
 * Fallback: project-aanmaak.
 */
export function saleMomentVanProject(project: Project): Date {
  const ondertekend = projectOfferte(project)?.ondertekend_op;
  if (ondertekend) return new Date(ondertekend);
  if (project.backoffice_afgerond_at) {
    return new Date(project.backoffice_afgerond_at);
  }
  return new Date(project.created_at);
}

/**
 * Moment waarop de order in de backoffice-actielijst komt
 * (actie afgerond → project aangemaakt). Niet het tekenmoment.
 */
export function backofficeInstroomMoment(project: Project): Date {
  if (project.backoffice_afgerond_at) {
    return new Date(project.backoffice_afgerond_at);
  }
  return new Date(project.created_at);
}

/**
 * Deadline stap 1: volgende kalenderdag na instroom backoffice, 17:00 Europe/Amsterdam.
 */
export function belSchouwDeadline(instroomAt: Date | string): Date {
  const at = typeof instroomAt === "string" ? new Date(instroomAt) : instroomAt;
  const local = toZonedTime(at, AMSTERDAM_TZ);
  const nextDay = addDays(local, 1);
  nextDay.setHours(17, 0, 0, 0);
  return fromZonedTime(nextDay, AMSTERDAM_TZ);
}

export function isBelSchouwActieOpen(project: Project): boolean {
  // Pas dicht na volledige stap 1 (factuur + schouwweek)
  if (project.bel_schouw_aanbetaling_at) return false;
  const s = project.status as string;
  return (
    s === "schouw_aanbetaling" ||
    s === "aanbetaling_betaald" ||
    s === "schouw_in_afwachting" ||
    // legacy
    s === "schouw_inplannen" ||
    s === "schouw_gepland"
  );
}

export function isSchakelFinancieringActieOpen(project: Project): boolean {
  // Alleen bij Warmtefonds-afwijzing — tot betaalwijze is omgezet of actie is afgerond
  const afgewezen =
    project.financiering_status === "afgewezen" ||
    project.status === "warmtefonds_afgewezen";
  if (!afgewezen) return false;
  if (project.financiering_geschakeld_at) return false;
  return true;
}

/** Dagen zonder WF-voortgang → aangetekende brief. */
export const AANGETEKENDE_BRIEF_NA_DAGEN = 14;

/**
 * Warmtefonds-klant die niet meewerkt / HOLD, nog niet officieel geannuleerd.
 * Actie: aangetekende brief (meewerken of 50% annuleringskosten).
 */
export function isAangetekendeBriefActieOpen(
  project: Project,
  now = new Date()
): boolean {
  if (project.status === "annulering") return false;
  if (project.aangetekende_brief_verstuurd_at) return false;
  if (!isWarmtefondsProject(project)) return false;

  const fs = resolveFinancieringStatus(project);
  if (fs === "aanvraag_goedgekeurd" || fs === "uitbetaald") return false;

  // HOLD sales: altijd open zolang niet afgehandeld
  if (project.status === "hold_sales_actie") return true;

  // Financiering gestart maar nog niet goedgekeurd — na X dagen
  const stuckStatuses = new Set([
    "doorgestuurd_naar_edwin",
    "afspraak_ingepland",
    "aanvraag_gedaan",
  ]);
  if (!fs || !stuckStatuses.has(fs)) return false;

  const anchor =
    project.financiering_geschakeld_at ||
    project.warmtefonds_afspraak_at ||
    project.warmtefonds_aangevraagd_at ||
    project.backoffice_afgerond_at ||
    projectOfferte(project)?.ondertekend_op ||
    project.created_at;
  if (!anchor) return false;
  const since = new Date(anchor).getTime();
  if (Number.isNaN(since)) return false;
  const days =
    (now.getTime() - since) / (1000 * 60 * 60 * 24);
  return days >= AANGETEKENDE_BRIEF_NA_DAGEN;
}

export function belSchouwActieTitel(project: Project): string {
  return isWarmtefondsProject(project)
    ? "Lead bellen voor schouw + aanbetaling"
    : "Lead bellen voor schouw";
}

/** Tekst om naar financieringsman te sturen (WhatsApp/SMS). */
export function financieringSchakelBericht(actie: {
  leadNaam: string;
  telefoon?: string | null;
  plaats?: string | null;
  offerteNummer?: string | null;
}): string {
  return [
    `Hoi Edwin,`,
    ``,
    `Warmtefonds-klant voor financiering:`,
    `Naam: ${actie.leadNaam}`,
    `Tel: ${actie.telefoon?.trim() || "—"}`,
    `Plaats: ${actie.plaats?.trim() || "—"}`,
    `Offerte: ${actie.offerteNummer || "—"} (getekende PDF bijgevoegd)`,
  ].join("\n");
}

/** WhatsApp-bericht naar Edwin: klant + bedragen + PDF-bijlage handmatig. */
export function edwinWarmtefondsWhatsappBericht(opts: {
  leadNaam: string;
  telefoon?: string | null;
  straat?: string | null;
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  plaats?: string | null;
  offerteNummer?: string | null;
  projectNummer?: string | null;
  aanbetalingInc?: number | null;
  warmtefondsInc?: number | null;
}): string {
  const adres = [
    [opts.straat, opts.huisnummer, opts.toevoeging]
      .filter(Boolean)
      .join(" "),
    [opts.postcode, opts.plaats].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");

  const fmt = (n: number | null | undefined) =>
    n != null && Number.isFinite(n)
      ? new Intl.NumberFormat("nl-NL", {
          style: "currency",
          currency: "EUR",
        }).format(n)
      : "—";

  return [
    `Hoi Edwin,`,
    ``,
    `Hierbij een Warmtefonds-klant. Kun jij de aanvraagafspraak inplannen?`,
    ``,
    `Klant: ${opts.leadNaam}`,
    `Tel: ${opts.telefoon?.trim() || "—"}`,
    `Adres: ${adres || "—"}`,
    opts.projectNummer ? `Project: ${opts.projectNummer}` : null,
    `Offerte: ${opts.offerteNummer || "—"}`,
    `Aanbetaling: ${fmt(opts.aanbetalingInc)}`,
    `Warmtefonds-deel: ${fmt(opts.warmtefondsInc)}`,
    ``,
    `Getekende offerte stuur ik als PDF-bijlage mee.`,
  ]
    .filter((line) => line != null)
    .join("\n");
}

export function edwinWhatsappUrl(bericht: string): string {
  return `${FINANCIERINGSMAN_WHATSAPP}?text=${encodeURIComponent(bericht)}`;
}

function leadFromProject(project: Project) {
  return Array.isArray(project.leads) ? project.leads[0] : project.leads;
}

function leadFromFactuur(factuur: Factuur) {
  return Array.isArray(factuur.leads) ? factuur.leads[0] : factuur.leads;
}

export function openBelSchouwActies(
  projecten: Project[],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  for (const project of projecten) {
    if (!isBelSchouwActieOpen(project)) continue;
    const saleAt = saleMomentVanProject(project);
    const instroomAt = backofficeInstroomMoment(project);
    const deadlineAt = belSchouwDeadline(instroomAt);
    const warmtefonds = isWarmtefondsProject(project);
    const lead = leadFromProject(project);
    const schouw = recommendedSchouwWeekForProject(project, saleAt);
    const schouwWeekLabel = formatSchouwWeekLabel(schouw.jaar, schouw.week);
    const offerte = projectOfferte(project);
    items.push({
      id: `bel-schouw-${project.id}`,
      soort: "bel_schouw_aanbetaling",
      titel: belSchouwActieTitel(project),
      detail: warmtefonds
        ? `Bel de klant: schouw ±5 wkn vooruit (${schouwWeekLabel}) én aanbetaling regelen.`
        : `Bel de klant: schouw z.s.m. inplannen (${schouwWeekLabel}).`,
      deadlineAt: deadlineAt.toISOString(),
      saleAt: saleAt.toISOString(),
      overdue: deadlineAt.getTime() < now.getTime(),
      leadId: project.lead_id,
      leadNaam: lead?.naam || project.titel || "—",
      telefoon: lead?.telefoon || null,
      plaats: lead?.plaats || null,
      offerteId: offerte?.id || project.offerte_id,
      offerteNummer: offerte?.offerte_nummer || null,
      projectId: project.id,
      projectNummer: project.project_nummer,
      href: `/projecten/${project.id}`,
      schouwJaar: schouw.jaar,
      schouwWeek: schouw.week,
      schouwWeekLabel,
      project,
    });
  }
  return items;
}

export function openSchakelFinancieringActies(
  projecten: Project[],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  for (const project of projecten) {
    if (!isSchakelFinancieringActieOpen(project)) continue;
    const saleAt = saleMomentVanProject(project);
    const instroomAt = backofficeInstroomMoment(project);
    const deadlineAt = belSchouwDeadline(instroomAt);
    const lead = leadFromProject(project);
    const offerte = projectOfferte(project);
    items.push({
      id: `schakel-financiering-${project.id}`,
      soort: "schakel_financiering",
      titel: "Schakel financiering (Warmtefonds afgewezen)",
      detail:
        "Zet om naar eigen middelen of stop project — overleg met klant. Bel financieringsman indien nodig.",
      deadlineAt: deadlineAt.toISOString(),
      saleAt: saleAt.toISOString(),
      overdue: deadlineAt.getTime() < now.getTime(),
      leadId: project.lead_id,
      leadNaam: lead?.naam || project.titel || "—",
      telefoon: lead?.telefoon || null,
      plaats: lead?.plaats || null,
      offerteId: offerte?.id || project.offerte_id,
      offerteNummer: offerte?.offerte_nummer || null,
      projectId: project.id,
      projectNummer: project.project_nummer,
      href: `/projecten/${project.id}`,
      project,
    });
  }
  return items;
}

export function openAangetekendeBriefActies(
  projecten: Project[],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  for (const project of projecten) {
    if (!isAangetekendeBriefActieOpen(project, now)) continue;
    const saleAt = saleMomentVanProject(project);
    const deadlineAt = addDays(now, 3);
    deadlineAt.setHours(17, 0, 0, 0);
    const lead = leadFromProject(project);
    const offerte = projectOfferte(project);
    items.push({
      id: `aangetekende-brief-${project.id}`,
      soort: "aangetekende_brief",
      titel:
        "Aangetekende brief: annuleringskosten of installatie doorzetten",
      detail:
        "Download de aangetekende brief (PDF), verstuur per post, en markeer afgerond. Klant kiest: Warmtefonds meewerken of 50% annuleringskosten.",
      reden:
        "Klant werkt (nog) niet mee aan Warmtefonds — formeel aanzeggen vóór officiële annulering.",
      deadlineAt: deadlineAt.toISOString(),
      saleAt: saleAt.toISOString(),
      overdue: false,
      leadId: project.lead_id,
      leadNaam: lead?.naam || project.titel || "—",
      telefoon: lead?.telefoon || null,
      plaats: lead?.plaats || null,
      offerteId: offerte?.id || project.offerte_id,
      offerteNummer: offerte?.offerte_nummer || null,
      projectId: project.id,
      projectNummer: project.project_nummer,
      href: `/projecten/${project.id}`,
      project,
    });
  }
  return items;
}

export function openNabellenFactuurActies(
  facturen: Factuur[],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  for (const f of facturen) {
    if (
      !factuurIsOverdue({
        status: f.status,
        vervaldatum: f.vervaldatum,
        betaald_op: f.betaald_op,
        now,
      })
    ) {
      continue;
    }
    const lead = leadFromFactuur(f);
    const offerteNummer =
      f.offertes?.offerte_nummer ||
      (f.omschrijving?.match(/OFF-[\w-]+/i)?.[0] ?? null);
    items.push({
      id: `nabellen-factuur-${f.id}`,
      soort: "nabellen_factuur",
      titel: "Nabellen factuur",
      detail: `Factuur ${f.factuur_nummer} is verlopen en nog niet betaald.`,
      deadlineAt: f.vervaldatum
        ? vervaldatumEndOfDay(f.vervaldatum).toISOString()
        : now.toISOString(),
      overdue: true,
      leadId: f.lead_id,
      leadNaam: lead?.naam || "—",
      telefoon: (lead as { telefoon?: string | null } | null)?.telefoon || null,
      offerteNummer,
      factuurId: f.id,
      factuurNummer: f.factuur_nummer,
      href: `/facturen/${f.id}`,
    });
  }
  return items;
}

/**
 * Klant heeft huisbezoek geannuleerd → opnieuw inplannen.
 * Bron: leadstatus `afspraak_afgezegd_klant` (zonder nieuwe actieve afspraak).
 * Voltooien → status `nieuw`; definitief annuleren → `geen_interesse`.
 */
export function openHerplanAfspraakActies(
  leads: Pick<Lead, "id" | "naam" | "telefoon" | "plaats" | "status">[],
  afspraken: Pick<
    Afspraak,
    "id" | "lead_id" | "start_at" | "status" | "soort" | "notities"
  >[] = [],
  now = new Date()
): BackofficeActie[] {
  const nowMs = now.getTime();
  const hasFutureActive = new Set<string>();
  for (const a of afspraken) {
    if (!afspraakBlokkeertAgenda(a.soort)) continue;
    if (a.status === "geannuleerd" || a.status === "voltooid") continue;
    if (new Date(a.start_at).getTime() <= nowMs) continue;
    hasFutureActive.add(a.lead_id);
  }

  const cancelledByKlant = new Map<string, (typeof afspraken)[0]>();
  const latestCancelled = new Map<string, (typeof afspraken)[0]>();
  for (const a of afspraken) {
    if (!afspraakBlokkeertAgenda(a.soort)) continue;
    if (a.status !== "geannuleerd") continue;
    const prevLatest = latestCancelled.get(a.lead_id);
    if (
      !prevLatest ||
      new Date(a.start_at).getTime() > new Date(prevLatest.start_at).getTime()
    ) {
      latestCancelled.set(a.lead_id, a);
    }
    const note = (a.notities || "").toLowerCase();
    if (!note.includes("annulering (klant)")) continue;
    const prev = cancelledByKlant.get(a.lead_id);
    if (
      !prev ||
      new Date(a.start_at).getTime() > new Date(prev.start_at).getTime()
    ) {
      cancelledByKlant.set(a.lead_id, a);
    }
  }

  const items: BackofficeActie[] = [];
  for (const lead of leads) {
    // Alleen status afspraak_afgezegd_klant → taak open.
    // Voltooien zet status op nieuw; definitief annuleren op geen_interesse.
    if (lead.status !== "afspraak_afgezegd_klant") continue;
    if (hasFutureActive.has(lead.id)) continue;

    const cancelled =
      cancelledByKlant.get(lead.id) || latestCancelled.get(lead.id);
    const startAt = cancelled?.start_at || now.toISOString();
    const deadlineAt = belSchouwDeadline(startAt);
    const reden = annuleringsNotitieFromAfspraak(cancelled);
    items.push({
      id: `herplan-afspraak-${lead.id}`,
      soort: "herplan_afspraak",
      titel: "Afspraak opnieuw inplannen",
      detail: cancelled
        ? `Klant heeft afspraak geannuleerd (${new Date(cancelled.start_at).toLocaleString("nl-NL", { timeZone: AMSTERDAM_TZ })}). Plan een nieuw moment.`
        : "Klant heeft de afspraak afgezegd. Plan een nieuw huisbezoek.",
      deadlineAt: deadlineAt.toISOString(),
      overdue: deadlineAt.getTime() < nowMs,
      leadId: lead.id,
      leadNaam: lead.naam || "—",
      telefoon: lead.telefoon || null,
      plaats: lead.plaats || null,
      href: `/?tab=leads&lead=${lead.id}`,
      annuleringsReden: reden,
    });
  }
  return items;
}

/**
 * Operationele “Volgende stap” per project → backoffice-actie
 * (zelfde logica als op de projectpagina: wat / waarom / uiterlijk).
 */
export function openVolgendeStapActies(
  projecten: Project[],
  facturen: Factuur[] = [],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  for (const project of projecten) {
    if (project.status === "annulering") continue;

    const related = facturen.filter(
      (f) =>
        f.project_id === project.id ||
        (!f.project_id && f.lead_id === project.lead_id)
    );
    const op = toOperationalStatus(project.status);
    if (
      op === "schouwweek_inplannen" &&
      !isKickoffComplete(project, related)
    ) {
      continue;
    }

    const stap = resolveProjectVolgendeStap(project, now);
    if (!stap) continue;

    // Feiten winnen: geen “inplannen”-actie als de datum al staat.
    if (
      project.installatie_at &&
      /installatiedatum inplannen|installatie inplannen/i.test(stap.titel)
    ) {
      continue;
    }
    if (
      isSchouwdagDefinitief(project) &&
      /schouwdag inplannen/i.test(stap.titel)
    ) {
      continue;
    }
    if (
      project.installatie_at &&
      materiaalNogTeBestellen(project) &&
      /materiaal|inkoop|bestel/i.test(stap.titel)
    ) {
      continue;
    }

    const lead = leadFromProject(project);
    const offerte = projectOfferte(project);
    const deadlineAt = stap.uiterlijkAt || now.toISOString();
    const planSchouwdag =
      (stap.actie?.kind === "anchor" &&
        stap.actie.openSoort === "schouwdag") ||
      /schouwdag/i.test(stap.titel);
    const planSchouwweek =
      !planSchouwdag &&
      stap.actie?.kind === "anchor" &&
      /schouwweek/i.test(stap.titel);

    const schouwLabel =
      project.schouw_jaar && project.schouw_week
        ? formatSchouwWeekLabel(project.schouw_jaar, project.schouw_week)
        : undefined;

    items.push({
      id: `volgende-stap-${project.id}`,
      soort: "volgende_stap",
      titel: stap.titel,
      detail: stap.reden,
      reden: stap.reden,
      deadlineAt,
      saleAt: saleMomentVanProject(project).toISOString(),
      overdue: stap.overdue,
      leadId: project.lead_id,
      leadNaam: lead?.naam || project.titel || "—",
      telefoon: lead?.telefoon || null,
      plaats: lead?.plaats || null,
      offerteId: offerte?.id || project.offerte_id,
      offerteNummer: offerte?.offerte_nummer || null,
      projectId: project.id,
      projectNummer: project.project_nummer,
      href: `/projecten/${project.id}`,
      schouwJaar: project.schouw_jaar ?? undefined,
      schouwWeek: project.schouw_week ?? undefined,
      schouwWeekLabel: schouwLabel,
      project,
      planSchouwdag,
      planSchouwweek,
      later: !stap.urgent && !stap.overdue,
    });
  }
  return items;
}

/**
 * Batterij/materiaal moet uiterlijk 3 werkdagen (ma–vr) vóór installatie
 * besteld zijn — Apex levert niet in het weekend.
 */
export function openBestelMateriaalActies(
  projecten: Project[],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  const nowMs = now.getTime();
  for (const project of projecten) {
    if (!project.installatie_at) continue;
    if (!materiaalNogTeBestellen(project)) continue;

    const deadlineAt = bestelDeadlineVoorInstallatie(project.installatie_at);
    const lead = leadFromProject(project);
    const offerte = projectOfferte(project);
    const overdue = deadlineAt.getTime() < nowMs;
    items.push({
      id: `bestel-materiaal-${project.id}`,
      soort: "bestel_materiaal",
      titel: "Batterij bestellen (3 werkdagen vóór installatie)",
      detail: overdue
        ? `Installatie staat gepland — materiaal had uiterlijk ${INKOOP_DAGEN_VOOR_INSTALLATIE} werkdagen van tevoren besteld moeten zijn (levering alleen ma–vr).`
        : `Bestel bij Apex uiterlijk ${INKOOP_DAGEN_VOOR_INSTALLATIE} werkdagen vóór de installatie. Levering alleen ma–vr, niet in het weekend.`,
      reden: overdue
        ? `Installatie staat gepland — materiaal had uiterlijk ${INKOOP_DAGEN_VOOR_INSTALLATIE} werkdagen van tevoren besteld moeten zijn (levering alleen ma–vr).`
        : `Bestel bij Apex uiterlijk ${INKOOP_DAGEN_VOOR_INSTALLATIE} werkdagen vóór de installatie. Levering alleen ma–vr, niet in het weekend.`,
      deadlineAt: deadlineAt.toISOString(),
      saleAt: saleMomentVanProject(project).toISOString(),
      overdue,
      leadId: project.lead_id,
      leadNaam: lead?.naam || project.titel || "—",
      telefoon: lead?.telefoon || null,
      plaats: lead?.plaats || null,
      offerteId: offerte?.id || project.offerte_id,
      offerteNummer: offerte?.offerte_nummer || null,
      projectId: project.id,
      projectNummer: project.project_nummer,
      href: "/?tab=purchasing",
      project,
    });
  }
  return items;
}

export function openBackofficeActies(
  projecten: Project[],
  facturen: Factuur[] = [],
  now = new Date(),
  opts?: {
    leads?: Pick<Lead, "id" | "naam" | "telefoon" | "plaats" | "status">[];
    afspraken?: Pick<
      Afspraak,
      "id" | "lead_id" | "start_at" | "status" | "soort" | "notities"
    >[];
  }
): BackofficeActie[] {
  // bel-schouw + nabellen-factuur: gedekt door status-gekoppelde auto-taken
  return [
    ...openHerplanAfspraakActies(
      opts?.leads || [],
      opts?.afspraken || [],
      now
    ),
    ...openAangetekendeBriefActies(projecten, now),
    ...openSchakelFinancieringActies(projecten, now),
    ...openBestelMateriaalActies(projecten, now),
    ...openVolgendeStapActies(projecten, facturen, now),
  ].sort(
    (a, b) =>
      new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime()
  );
}

/** Openstaande acties voor één project (incl. factuur-nabellen op dezelfde lead). */
export function openActiesVoorProject(
  project: Project,
  facturen: Factuur[] = [],
  now = new Date()
): BackofficeActie[] {
  const relatedFacturen = facturen.filter((f) => f.lead_id === project.lead_id);
  return openBackofficeActies([project], relatedFacturen, now).filter(
    (a) => a.projectId === project.id || a.leadId === project.lead_id
  );
}
