import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { Afspraak, Factuur, Lead, Project } from "@/types/database";
import {
  isAanbetalingFactuurOmschrijving,
  isOrderVolledigBetaald,
  isRestantFactuurOmschrijving,
} from "@/lib/aanbetaling";
import {
  ANNULERING_ACTIE_DAG,
  ANNULERING_KEUZE_CONTROLE_DAG,
  ANNULERING_KEUZE_REACTIE_DAGEN,
  annuleringKeuzeControleVanaf,
  annuleringsActieVanaf,
  bedenktijdVanOndertekening,
} from "@/lib/bedenktijd";
import {
  AV_ANNULERING_PCT,
  annuleringskostenIncBtw,
} from "@/lib/av-annulering";
import { AMSTERDAM_TZ, formatDateNl } from "@/lib/format";
import {
  factuurEffectieveDeadline,
  factuurOpvolgActie,
  vervaldatumEndOfDay,
} from "@/lib/factuur-betaling";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import {
  annuleringsDoorFromAfspraak,
  annuleringsNotitieFromAfspraak,
} from "@/lib/bel-queue";
import {
  defaultSchouwWeekAfterSale,
  dueAtVoorSchouwdagInplan,
  formatSchouwWeekLabel,
  isInSchouwdagPlannenWindow,
  isSchouwdagDefinitief,
  isSchouwweekGepland,
  schouwWeekOffsetVoorSale,
  type SchouwWeek,
} from "@/lib/schouw-week";
import {
  isKickoffComplete,
  isSchouwweekKickoffActionable,
  projectHeeftGeenAanbetalingNodig,
  showProjectKickoff,
} from "@/lib/project-kickoff";
import { resolveProjectVolgendeStap } from "@/lib/project-volgende-stap";
import { toOperationalStatus } from "@/lib/project-status-config";
import {
  bestelDeadlineVoorInstallatie,
  INKOOP_DAGEN_VOOR_INSTALLATIE,
  materiaalNogTeBestellen,
} from "@/lib/inkoop-sla";
import {
  FINANCIERING_PIPELINE,
  FINANCIERING_STATUS_LABEL,
  FINANCIERING_STATUS_TAAK,
  normalizeFinancieringStatus,
  resolveFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";

export type BackofficeActieSoort =
  | "bel_schouw_aanbetaling"
  | "schakel_financiering"
  | "nabellen_factuur"
  | "wf_aanbetaling_herinnering"
  | "herplan_afspraak"
  | "volgende_stap"
  | "bestel_materiaal"
  | "aangetekende_brief"
  | "annulering_keuze_controle"
  | "schouw_inplannen"
  | "wacht_warmtefonds";

export type HerplanBron = "klant" | "adviseur" | "deur_niet_open";

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
  /** PRIO: deadline vandaag/morgen of overdue */
  prio?: boolean;
  /**
   * Vastgelopen: overdue langer dan 2 dagen, of niet-urgente “later”-stap
   * die al de deadline voorbij is. UI toont VAST-badge.
   */
  vastgelopen?: boolean;
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
  /** Wie de (CRM-)annulering deed / gekoppelde adviseur */
  geannuleerdDoorNaam?: string | null;
  /** Originele afspraak start (herplan) */
  afspraakStartAt?: string | null;
  /** Klant-annulering vs adviseur/CRM-herplan */
  herplanBron?: HerplanBron;
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
    totaal_inc_btw?: number | null;
  } | null;
};

function projectOfferte(project: Project) {
  const raw = (project as Project & ProjectOfferteJoin).offertes ?? null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

function projectLeadStatus(project: Project): string | null {
  const raw = project.leads as
    | { status?: string | null }
    | { status?: string | null }[]
    | null
    | undefined;
  if (Array.isArray(raw)) return raw[0]?.status ?? null;
  return raw?.status ?? null;
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
  // Lead-sale-status wint op stale project.betaalwijze (bijv. na omzetting EM↔WF)
  // Supabase-join kan lead/offerte als object óf array teruggeven.
  const leadStatus = projectLeadStatus(project);
  if (leadStatus === "sale_eigen_middelen") return false;
  if (leadStatus === "sale_financiering") return true;
  if (project.betaalwijze === "eigen_middelen") return false;
  if (project.betaalwijze === "warmtefonds") return true;
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

/** Project staat op annulering — geen workflow-acties meer in Acties. */
export function isProjectGeannuleerd(
  project: Pick<Project, "status"> | { status?: string | null }
): boolean {
  const s = (project.status || "").toLowerCase();
  return s === "annulering" || s === "geannuleerd";
}

/** HOLD SALES: geen Acties tot sales HOLD opheft. */
export function isProjectHoldSales(
  project: Pick<Project, "status"> | { status?: string | null }
): boolean {
  const s = (project.status || "").toLowerCase();
  return s === "hold_sales_actie" || s === "hold_sales";
}

/** Geen Acties-tab rijen (annulering of HOLD). */
export function isProjectBuitenActies(
  project: Pick<Project, "status"> | { status?: string | null }
): boolean {
  return isProjectGeannuleerd(project) || isProjectHoldSales(project);
}

/** Opstart open: aanbetalingsfactuur / Edwin / schouwweek nog niet af. */
export function isBelSchouwActieOpen(
  project: Project,
  facturen: Factuur[] = []
): boolean {
  if (isProjectBuitenActies(project)) return false;
  // Handmatig afgerond (legacy)
  if (project.bel_schouw_aanbetaling_at) return false;
  return showProjectKickoff(project, facturen);
}

export function isSchakelFinancieringActieOpen(project: Project): boolean {
  if (isProjectBuitenActies(project)) return false;
  // Alleen bij Warmtefonds-afwijzing — tot betaalwijze is omgezet of actie is afgerond
  const afgewezen =
    project.financiering_status === "afgewezen" ||
    project.status === "warmtefonds_afgewezen";
  if (!afgewezen) return false;
  if (project.financiering_geschakeld_at) return false;
  return true;
}

function factuurHoortBijProject(project: Project, f: Factuur): boolean {
  return (
    f.project_id === project.id ||
    (!f.project_id && f.lead_id === project.lead_id) ||
    (project.offerte_id != null && f.offerte_id === project.offerte_id)
  );
}

/** Ids van facturen waarvoor al een creditfactuur bestaat. */
function gecrediteerdeFactuurIds(facturen: Factuur[]): Set<string> {
  const ids = new Set<string>();
  for (const f of facturen) {
    if (f.credit_van_factuur_id) ids.add(f.credit_van_factuur_id);
  }
  return ids;
}

/**
 * Aanbetalingsfactuur is gecrediteerd → uit betalings-/aanzeg-flow.
 */
export function heeftGecrediteerdeAanbetaling(
  project: Project,
  facturen: Factuur[]
): boolean {
  const credited = gecrediteerdeFactuurIds(facturen);
  if (credited.size === 0) return false;
  return facturen.some(
    (f) =>
      !f.credit_van_factuur_id &&
      factuurHoortBijProject(project, f) &&
      isAanbetalingFactuurOmschrijving(f.omschrijving) &&
      credited.has(f.id)
  );
}

/**
 * Aanbetalingsfactuur verstuurd maar nog niet (volledig) betaald.
 * Gecrediteerde aanbetalingen tellen niet mee.
 */
export function heeftVerzondenOnbetaaldeAanbetaling(
  project: Project,
  facturen: Factuur[]
): boolean {
  if (heeftGecrediteerdeAanbetaling(project, facturen)) return false;
  const credited = gecrediteerdeFactuurIds(facturen);
  return facturen.some(
    (f) =>
      !f.credit_van_factuur_id &&
      !credited.has(f.id) &&
      factuurHoortBijProject(project, f) &&
      isAanbetalingFactuurOmschrijving(f.omschrijving) &&
      (f.status === "verzonden" || f.status === "deels_betaald")
  );
}

/** Minimaal één (deel)betaalde factuur bij dit project (geen credits / gecrediteerd). */
export function heeftMinimaalEenBetaaldeFactuur(
  project: Project,
  facturen: Factuur[]
): boolean {
  const credited = gecrediteerdeFactuurIds(facturen);
  return facturen.some(
    (f) =>
      !f.credit_van_factuur_id &&
      !credited.has(f.id) &&
      factuurHoortBijProject(project, f) &&
      (f.status === "betaald" || f.status === "deels_betaald")
  );
}

/**
 * Vanaf dag 15 na ondertekenen (na 14 dagen bedenktijd):
 * opvolging annuleringskosten / installatie doorzetten.
 * Open als:
 * 1. kalenderdag ≥ dag 15 (Amsterdam, 00:00),
 * 2. nog geen factuur (deels)betaald,
 * 3. aanbetaling niet gecrediteerd,
 * 4. status niet annulering / HOLD,
 * 5. aangetekende brief nog niet afgerond.
 */
export function isAangetekendeBriefActieOpen(
  project: Project,
  facturen: Factuur[] = [],
  now = new Date()
): boolean {
  if (isProjectBuitenActies(project)) return false;
  if (project.aangetekende_brief_verstuurd_at) return false;

  const vanaf = annuleringsActieVanaf(projectOfferte(project)?.ondertekend_op);
  if (!vanaf || now.getTime() < vanaf.getTime()) return false;

  if (heeftGecrediteerdeAanbetaling(project, facturen)) return false;
  if (heeftMinimaalEenBetaaldeFactuur(project, facturen)) return false;

  return true;
}

/** Factuur met annuleringskosten (20% AV) herkennen. */
export function isAnnuleringskostenFactuur(f: {
  omschrijving?: string | null;
}): boolean {
  return /annuleringskosten/i.test(f.omschrijving || "");
}

export function heeftAnnuleringskostenFactuur(
  project: Project,
  facturen: Factuur[]
): boolean {
  return facturen.some(
    (f) =>
      !f.credit_van_factuur_id &&
      f.status !== "vervallen" &&
      factuurHoortBijProject(project, f) &&
      isAnnuleringskostenFactuur(f)
  );
}

/**
 * Dag 6 na mail «Keuze: annulering of installatie»:
 * controleer reactie; zonder antwoord → annuleringsfactuur.
 */
export function isAnnuleringKeuzeControleOpen(
  project: Project,
  facturen: Factuur[] = [],
  now = new Date()
): boolean {
  if (project.annulering_keuze_gecontroleerd_at) return false;
  const st = String(project.status || "").trim().toLowerCase();
  if (st === "hold_sales_actie") return false;
  const verstuurd = project.aangetekende_brief_verstuurd_at;
  if (!verstuurd) return false;

  const vanaf = annuleringKeuzeControleVanaf(verstuurd);
  if (!vanaf || now.getTime() < vanaf.getTime()) return false;

  if (heeftAnnuleringskostenFactuur(project, facturen)) return false;
  // Betaalde aanbetaling = traject loopt → geen annuleringsfactuur-actie
  if (heeftMinimaalEenBetaaldeFactuur(project, facturen)) return false;

  return true;
}

export function belSchouwActieTitel(project: Project): string {
  if (projectHeeftGeenAanbetalingNodig(project)) {
    return "Lead bellen voor schouw";
  }
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
  facturen: Factuur[] = [],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  for (const project of projecten) {
    const projectFacturen = facturen.filter(
      (f) =>
        f.project_id === project.id ||
        (!f.project_id && f.lead_id === project.lead_id) ||
        (project.offerte_id != null && f.offerte_id === project.offerte_id)
    );
    if (!isBelSchouwActieOpen(project, projectFacturen)) continue;
    const saleAt = saleMomentVanProject(project);
    const instroomAt = backofficeInstroomMoment(project);
    const deadlineAt = belSchouwDeadline(instroomAt);
    const warmtefonds = isWarmtefondsProject(project);
    const lead = leadFromProject(project);
    const schouw = recommendedSchouwWeekForProject(project, saleAt);
    const schouwWeekLabel = formatSchouwWeekLabel(schouw.jaar, schouw.week);
    const offerte = projectOfferte(project);
    const schouwActionable = isSchouwweekKickoffActionable(
      project,
      projectFacturen
    );
    const geenAanbetaling = projectHeeftGeenAanbetalingNodig(project);
    items.push({
      id: `bel-schouw-${project.id}`,
      soort: "bel_schouw_aanbetaling",
      titel: belSchouwActieTitel(project),
      detail: warmtefonds
        ? geenAanbetaling
          ? `Opstarten: geen aanbetaling, gegevens naar Edwin, schouwweek (${schouwWeekLabel}).`
          : `Opstarten: aanbetalingsfactuur, gegevens naar Edwin, schouwweek (${schouwWeekLabel}).`
        : geenAanbetaling
          ? `Opstarten: geen aanbetaling — schouwweek inplannen (${schouwWeekLabel}).`
          : schouwActionable
            ? `Opstarten: 50% betaald — schouwweek inplannen (${schouwWeekLabel}).`
            : `Opstarten: eerst 50%-factuur; schouwweek (${schouwWeekLabel}) volgt na betaling.`,
      deadlineAt: deadlineAt.toISOString(),
      saleAt: saleAt.toISOString(),
      overdue: deadlineAt.getTime() < now.getTime(),
      prio: isPrioDeadline(deadlineAt, now),
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
      planSchouwweek: schouwActionable,
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
  facturen: Factuur[] = [],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  for (const project of projecten) {
    if (!isAangetekendeBriefActieOpen(project, facturen, now)) continue;
    const saleAt = saleMomentVanProject(project);
    // Zelfde dag zichtbaar onder Vandaag — bedenktijd is al voorbij.
    const deadlineAt = new Date(now);
    deadlineAt.setHours(17, 0, 0, 0);
    const lead = leadFromProject(project);
    const offerte = projectOfferte(project);
    const bedenktijd = bedenktijdVanOndertekening(
      offerte?.ondertekend_op,
      now
    );
    const bedenktijdDetail = bedenktijd
      ? `Bedenktijd 14 dagen verlopen (dag ${ANNULERING_ACTIE_DAG} sinds ${bedenktijd.startLabel}; verlopen sinds ${bedenktijd.eindLabel}).`
      : `Bedenktijd voorbij — actie vanaf dag ${ANNULERING_ACTIE_DAG}.`;
    items.push({
      id: `aangetekende-brief-${project.id}`,
      soort: "aangetekende_brief",
      titel:
        "Annuleringskosten of installatie doorzetten",
      detail: `${bedenktijdDetail} Aanbetaling niet betaald. Stuur de mail «Annulering of installatie» (template Contact). Na verzending start de ${ANNULERING_KEUZE_REACTIE_DAGEN}-dagen reactietermijn; op dag ${ANNULERING_KEUZE_CONTROLE_DAG} volgt de controle-actie.`,
      reden: bedenktijd
        ? `Dag ${ANNULERING_ACTIE_DAG}+ na ondertekenen (${bedenktijd.startLabel}): geen betaalde factuur — formeel opvolgen met mailtemplate.`
        : `Dag ${ANNULERING_ACTIE_DAG}+ na ondertekenen: geen betaalde factuur en niet geannuleerd — formeel opvolgen met mailtemplate.`,
      deadlineAt: deadlineAt.toISOString(),
      saleAt: saleAt.toISOString(),
      overdue: now.getTime() > deadlineAt.getTime(),
      prio: true,
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

export function openAnnuleringKeuzeControleActies(
  projecten: Project[],
  facturen: Factuur[] = [],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  const pct = Math.round(AV_ANNULERING_PCT * 100);
  for (const project of projecten) {
    if (!isAnnuleringKeuzeControleOpen(project, facturen, now)) continue;
    const verstuurd = project.aangetekende_brief_verstuurd_at!;
    const vanaf = annuleringKeuzeControleVanaf(verstuurd)!;
    const deadlineAt = new Date(vanaf);
    deadlineAt.setHours(17, 0, 0, 0);
    const saleAt = saleMomentVanProject(project);
    const lead = leadFromProject(project);
    const offerteRaw = projectOfferte(project);
    const offerte = Array.isArray(offerteRaw) ? offerteRaw[0] : offerteRaw;
    const orderInc = Number(offerte?.totaal_inc_btw);
    const kosten =
      Number.isFinite(orderInc) && orderInc > 0
        ? annuleringskostenIncBtw(orderInc)
        : null;
    const kostenLabel =
      kosten != null
        ? new Intl.NumberFormat("nl-NL", {
            style: "currency",
            currency: "EUR",
          }).format(kosten)
        : `${pct}%`;
    items.push({
      id: `annulering-keuze-controle-${project.id}`,
      soort: "annulering_keuze_controle",
      titel: "Controleer keuze — annuleringsfactuur indien geen reactie",
      detail: `Keuze-mail is verstuurd. Reactietermijn (${ANNULERING_KEUZE_REACTIE_DAGEN} dagen) voorbij. Check of de klant installatie doorzet of annuleert. Geen antwoord → stuur annuleringsfactuur (${kostenLabel}).`,
      reden: `Dag ${ANNULERING_KEUZE_CONTROLE_DAG} na keuze-mail — controle + eventueel ${pct}% annuleringskosten.`,
      deadlineAt: deadlineAt.toISOString(),
      saleAt: saleAt.toISOString(),
      overdue: now.getTime() > deadlineAt.getTime(),
      prio: true,
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
  now = new Date(),
  projecten: Project[] = []
): BackofficeActie[] {
  const projectById = new Map(projecten.map((p) => [p.id, p]));
  const projectByLead = new Map<string, Project>();
  const projectByOfferte = new Map<string, Project>();
  for (const p of projecten) {
    if (p.lead_id && !projectByLead.has(p.lead_id)) {
      projectByLead.set(p.lead_id, p);
    }
    if (p.offerte_id) projectByOfferte.set(p.offerte_id, p);
  }

  const metCredit = new Set(
    facturen
      .map((f) => f.credit_van_factuur_id)
      .filter((id): id is string => Boolean(id))
  );
  const items: BackofficeActie[] = [];
  for (const f of facturen) {
    if (f.credit_van_factuur_id) continue;
    if (metCredit.has(f.id)) continue;

    // HOLD sales / annulering → bij adviseur, niet in BO-acties
    const linkedProject =
      (f.project_id ? projectById.get(f.project_id) : undefined) ||
      (f.offerte_id ? projectByOfferte.get(f.offerte_id) : undefined) ||
      (f.lead_id ? projectByLead.get(f.lead_id) : undefined);
    if (linkedProject && isProjectBuitenActies(linkedProject)) continue;

    // Warmtefonds-restfactuur: betaalroute via fonds, geen BO-opvolging
    if (
      linkedProject &&
      isWarmtefondsProject(linkedProject) &&
      isRestantFactuurOmschrijving(f.omschrijving)
    ) {
      continue;
    }

    const fase = factuurOpvolgActie({
      status: f.status,
      vervaldatum: f.vervaldatum,
      afgesproken_betaaldatum: f.afgesproken_betaaldatum,
      betaald_op: f.betaald_op,
      credit_van_factuur_id: f.credit_van_factuur_id,
      now,
    });
    if (!fase) continue;

    const lead = leadFromFactuur(f);
    const offerteNummer =
      f.offertes?.offerte_nummer ||
      (f.omschrijving?.match(/OFF-[\w-]+/i)?.[0] ?? null);
    const afspraak = f.afgesproken_betaaldatum?.slice(0, 10) || null;
    const deadline =
      factuurEffectieveDeadline({
        vervaldatum: f.vervaldatum,
        afgesproken_betaaldatum: f.afgesproken_betaaldatum,
      }) || f.vervaldatum;

    const titel =
      fase === "controleren" ? "Betaling controleren" : "Factuur opvolgen";
    const detail =
      fase === "controleren"
        ? `Klant gaf aan te betalen op ${
            afspraak ? formatDateNl(`${afspraak}T12:00:00`) : "—"
          }. Controleer of factuur ${f.factuur_nummer} binnen is.`
        : `Factuur ${f.factuur_nummer} is langer dan 1 dag te laat en nog niet betaald.`;

    items.push({
      id: `nabellen-factuur-${f.id}`,
      soort: "nabellen_factuur",
      titel,
      detail,
      reden: detail,
      deadlineAt: deadline
        ? vervaldatumEndOfDay(deadline).toISOString()
        : now.toISOString(),
      overdue: true,
      prio: true,
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
 * Warmtefonds: openstaande aanbetaling → vriendelijke herinneringsmail,
 * zodat we pas na betaling Warmtefonds kunnen aanvragen.
 */
export function openWarmtefondsAanbetalingHerinneringActies(
  facturen: Factuur[],
  now = new Date(),
  projecten: Project[] = []
): BackofficeActie[] {
  const projectById = new Map(projecten.map((p) => [p.id, p]));
  const projectByLead = new Map<string, Project>();
  const projectByOfferte = new Map<string, Project>();
  for (const p of projecten) {
    if (p.lead_id && !projectByLead.has(p.lead_id)) {
      projectByLead.set(p.lead_id, p);
    }
    if (p.offerte_id) projectByOfferte.set(p.offerte_id, p);
  }

  const metCredit = new Set(
    facturen
      .map((f) => f.credit_van_factuur_id)
      .filter((id): id is string => Boolean(id))
  );
  const items: BackofficeActie[] = [];

  for (const f of facturen) {
    if (f.credit_van_factuur_id) continue;
    if (metCredit.has(f.id)) continue;
    if (!f.lead_id) continue;
    if (!isAanbetalingFactuurOmschrijving(f.omschrijving)) continue;
    if (f.status !== "verzonden" && f.status !== "deels_betaald") continue;

    const project =
      (f.project_id ? projectById.get(f.project_id) : undefined) ||
      (f.offerte_id ? projectByOfferte.get(f.offerte_id) : undefined) ||
      (f.lead_id ? projectByLead.get(f.lead_id) : undefined);
    if (!project) continue;
    if (isProjectBuitenActies(project)) continue;
    if (!isWarmtefondsProject(project)) continue;
    // Na WF-aanvraag is deze herinnering niet meer de juiste actie
    if (project.warmtefonds_aangevraagd_at) continue;

    const lead = leadFromFactuur(f);
    const deadline =
      factuurEffectieveDeadline({
        vervaldatum: f.vervaldatum,
        afgesproken_betaaldatum: f.afgesproken_betaaldatum,
      }) || f.vervaldatum;
    const deadlineAt = deadline
      ? vervaldatumEndOfDay(deadline)
      : now;
    const overdue = now.getTime() > deadlineAt.getTime();
    const msTot = deadlineAt.getTime() - now.getTime();
    const prio = overdue || msTot <= 2 * 24 * 60 * 60 * 1000;

    items.push({
      id: `wf-aanbetaling-herinnering-${f.id}`,
      soort: "wf_aanbetaling_herinnering",
      titel: "Herinneringsmail aanbetaling (Warmtefonds)",
      detail: `Aanbetaling ${f.factuur_nummer} openstaand — nodig vóór Warmtefonds-aanvraag. Stuur vriendelijke herinnering met factuur-PDF.`,
      reden: `Warmtefonds: aanbetaling ${f.factuur_nummer} nog niet (volledig) betaald.`,
      deadlineAt: deadlineAt.toISOString(),
      overdue,
      prio,
      leadId: f.lead_id,
      leadNaam: lead?.naam || "—",
      telefoon: (lead as { telefoon?: string | null } | null)?.telefoon || null,
      offerteNummer:
        f.offertes?.offerte_nummer ||
        (f.omschrijving?.match(/OFF-[\w-]+/i)?.[0] ?? null),
      projectId: project.id,
      projectNummer: project.project_nummer,
      factuurId: f.id,
      factuurNummer: f.factuur_nummer,
      href: `/facturen/${f.id}`,
      project,
    });
  }
  return items;
}

/**
 * Huisbezoek opnieuw inplannen:
 * - Klant: status `afspraak_afgezegd_klant` → Bel-wachtrij
 * - Deur niet open: status `deur_niet_open` → Bel-wachtrij
 * - Adviseur/CRM: `Annulering (CRM)` zonder vervangende afspraak → BO-Acties
 *   (lead nog niet afgeboekt/sale)
 */
type HerplanAfspraak = Pick<
  Afspraak,
  "id" | "lead_id" | "start_at" | "status" | "soort" | "notities"
> & {
  adviseur_id?: string | null;
  created_at?: string | null;
  adviseurs?: { naam?: string | null } | null;
};

/** Lead is al afgehandeld — geen herplan-actie meer. */
const HERPLAN_UITGESLOTEN_STATUS = new Set([
  "deal",
  "sale_financiering",
  "sale_eigen_middelen",
  "geen_interesse",
  "geen_interesse_al_batterij",
  "geen_interesse_plugin",
  "geen_interesse_alleen_info",
  "offerte_afgewezen",
  "niet_gekwalificeerd",
  "huurwoning",
  "foutief_nummer",
  "gegevens_niet_overeen",
  "afspraak",
  "na_afspraak",
  "vervolg_fysiek",
  "vervolg_tel",
]);

function leadHeeftVervangendeAfspraak(
  leadId: string,
  cancelled: HerplanAfspraak,
  afspraken: HerplanAfspraak[]
): boolean {
  const cancelStart = new Date(cancelled.start_at).getTime();
  const cancelCreated = cancelled.created_at
    ? new Date(cancelled.created_at).getTime()
    : cancelStart;
  const cancelAnchor = Math.min(cancelStart, cancelCreated);

  for (const a of afspraken) {
    if (a.lead_id !== leadId) continue;
    if (a.id === cancelled.id) continue;
    if (!afspraakBlokkeertAgenda(a.soort)) continue;
    if (a.status === "geannuleerd") continue;
    const startMs = new Date(a.start_at).getTime();
    const createdMs = a.created_at ? new Date(a.created_at).getTime() : startMs;
    // Nieuwere of latere huisbezoek-afspraak = al heringepland / afgerond
    if (startMs > cancelAnchor || createdMs > cancelAnchor) return true;
  }
  return false;
}

function resolveGeannuleerdDoorNaam(
  cancelled: HerplanAfspraak | undefined,
  adviseurById: Map<string, string>
): string | null {
  if (!cancelled) return null;
  const fromNote = annuleringsDoorFromAfspraak(cancelled);
  if (fromNote) return fromNote;
  const rawJoin = cancelled.adviseurs as
    | { naam?: string | null }
    | { naam?: string | null }[]
    | null
    | undefined;
  const joined = Array.isArray(rawJoin)
    ? rawJoin[0]?.naam?.trim()
    : rawJoin?.naam?.trim();
  if (joined) return joined;
  const id = cancelled.adviseur_id?.trim();
  if (id && adviseurById.has(id)) return adviseurById.get(id) || null;
  return null;
}

export function openHerplanAfspraakActies(
  leads: Pick<Lead, "id" | "naam" | "telefoon" | "plaats" | "status">[],
  afspraken: HerplanAfspraak[] = [],
  now = new Date(),
  adviseurs: Pick<{ id: string; naam: string }, "id" | "naam">[] = []
): BackofficeActie[] {
  const nowMs = now.getTime();
  const adviseurById = new Map(
    adviseurs
      .filter((a) => a.id && a.naam?.trim())
      .map((a) => [a.id, a.naam.trim()] as const)
  );
  const hasFutureActive = new Set<string>();
  for (const a of afspraken) {
    if (!afspraakBlokkeertAgenda(a.soort)) continue;
    if (a.status === "geannuleerd" || a.status === "voltooid") continue;
    if (new Date(a.start_at).getTime() <= nowMs) continue;
    hasFutureActive.add(a.lead_id);
  }

  const cancelledByKlant = new Map<string, HerplanAfspraak>();
  const cancelledByCrm = new Map<string, HerplanAfspraak>();
  const latestCancelled = new Map<string, HerplanAfspraak>();
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
    if (note.includes("annulering (klant)")) {
      const prev = cancelledByKlant.get(a.lead_id);
      if (
        !prev ||
        new Date(a.start_at).getTime() > new Date(prev.start_at).getTime()
      ) {
        cancelledByKlant.set(a.lead_id, a);
      }
    }
    if (note.includes("annulering (crm)")) {
      const prev = cancelledByCrm.get(a.lead_id);
      if (
        !prev ||
        new Date(a.start_at).getTime() > new Date(prev.start_at).getTime()
      ) {
        cancelledByCrm.set(a.lead_id, a);
      }
    }
  }

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const items: BackofficeActie[] = [];
  const seen = new Set<string>();

  for (const lead of leads) {
    if (lead.status !== "afspraak_afgezegd_klant") continue;
    if (hasFutureActive.has(lead.id)) continue;

    const cancelled =
      cancelledByKlant.get(lead.id) || latestCancelled.get(lead.id);
    const startAt = cancelled?.start_at || now.toISOString();
    const deadlineAt = belSchouwDeadline(startAt);
    const overdue = deadlineAt.getTime() < nowMs;
    const reden = annuleringsNotitieFromAfspraak(cancelled);
    const doorNaam = resolveGeannuleerdDoorNaam(cancelled, adviseurById);
    items.push({
      id: `herplan-afspraak-${lead.id}`,
      soort: "herplan_afspraak",
      titel: "Herplannen — klant geannuleerd",
      detail: cancelled
        ? `Klant heeft afspraak geannuleerd (${new Date(cancelled.start_at).toLocaleString("nl-NL", { timeZone: AMSTERDAM_TZ })}). Plan een nieuw moment.`
        : "Klant heeft de afspraak afgezegd. Plan een nieuw huisbezoek.",
      deadlineAt: deadlineAt.toISOString(),
      overdue,
      prio: isPrioDeadline(deadlineAt, now),
      leadId: lead.id,
      leadNaam: lead.naam || "—",
      telefoon: lead.telefoon || null,
      plaats: lead.plaats || null,
      href: `/?tab=leads&lead=${lead.id}`,
      annuleringsReden: reden,
      geannuleerdDoorNaam: doorNaam,
      afspraakStartAt: cancelled?.start_at ?? null,
      herplanBron: "klant",
    });
    seen.add(lead.id);
  }

  for (const lead of leads) {
    if (lead.status !== "deur_niet_open") continue;
    if (seen.has(lead.id)) continue;
    if (hasFutureActive.has(lead.id)) continue;

    let latestVisit: HerplanAfspraak | undefined;
    for (const a of afspraken) {
      if (a.lead_id !== lead.id) continue;
      if (!afspraakBlokkeertAgenda(a.soort)) continue;
      if (
        !latestVisit ||
        new Date(a.start_at).getTime() > new Date(latestVisit.start_at).getTime()
      ) {
        latestVisit = a;
      }
    }
    const startAt = latestVisit?.start_at || now.toISOString();
    const deadlineAt = belSchouwDeadline(startAt);
    const overdue = deadlineAt.getTime() < nowMs;
    const doorNaam = resolveGeannuleerdDoorNaam(latestVisit, adviseurById);
    items.push({
      id: `herplan-afspraak-${lead.id}`,
      soort: "herplan_afspraak",
      titel: "Herplannen — deur niet open",
      detail: latestVisit
        ? `Deur niet open / klant niet bereikbaar bij bezoek op ${new Date(latestVisit.start_at).toLocaleString("nl-NL", { timeZone: AMSTERDAM_TZ })}. Plan een nieuw huisbezoek.`
        : "Deur niet open / klant niet bereikbaar. Plan een nieuw huisbezoek.",
      deadlineAt: deadlineAt.toISOString(),
      overdue,
      prio: isPrioDeadline(deadlineAt, now),
      leadId: lead.id,
      leadNaam: lead.naam || "—",
      telefoon: lead.telefoon || null,
      plaats: lead.plaats || null,
      href: `/?tab=leads&lead=${lead.id}`,
      annuleringsReden: "Deur niet open / klant niet bereikbaar",
      geannuleerdDoorNaam: doorNaam,
      afspraakStartAt: latestVisit?.start_at ?? null,
      herplanBron: "deur_niet_open",
    });
    seen.add(lead.id);
  }

  for (const [leadId, cancelled] of cancelledByCrm) {
    if (seen.has(leadId)) continue;
    if (hasFutureActive.has(leadId)) continue;
    const lead = leadById.get(leadId);
    if (!lead) continue;
    if (HERPLAN_UITGESLOTEN_STATUS.has(lead.status || "")) continue;
    if (leadHeeftVervangendeAfspraak(leadId, cancelled, afspraken)) continue;

    const deadlineAt = belSchouwDeadline(cancelled.start_at);
    const overdue = deadlineAt.getTime() < nowMs;
    const reden = annuleringsNotitieFromAfspraak(cancelled);
    const doorNaam = resolveGeannuleerdDoorNaam(cancelled, adviseurById);
    items.push({
      id: `herplan-afspraak-${leadId}`,
      soort: "herplan_afspraak",
      titel: "Herplannen — adviseur",
      detail: reden
        ? `Adviseur/CRM heeft afspraak geannuleerd. ${reden}`
        : `Adviseur/CRM heeft afspraak geannuleerd (${new Date(cancelled.start_at).toLocaleString("nl-NL", { timeZone: AMSTERDAM_TZ })}). Plan een nieuw moment.`,
      deadlineAt: deadlineAt.toISOString(),
      overdue,
      prio: isPrioDeadline(deadlineAt, now),
      leadId,
      leadNaam: lead.naam || "—",
      telefoon: lead.telefoon || null,
      plaats: lead.plaats || null,
      href: `/?tab=leads&lead=${leadId}`,
      annuleringsReden: reden,
      geannuleerdDoorNaam: doorNaam,
      afspraakStartAt: cancelled.start_at,
      herplanBron: "adviseur",
    });
    seen.add(leadId);
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
    if (isProjectBuitenActies(project)) continue;

    const related = facturen.filter(
      (f) =>
        f.project_id === project.id ||
        (!f.project_id && f.lead_id === project.lead_id)
    );
    const op = toOperationalStatus(project.status);
    // Review/referrals = sales-actie (SalesReferralActies), niet backoffice.
    if (op === "review_gevraagd" || op === "afgerond") continue;
    if (
      op === "schouwweek_inplannen" &&
      !isKickoffComplete(project, related)
    ) {
      continue;
    }

    const stap = resolveProjectVolgendeStap(project, now, related);
    if (!stap) continue;
    if (/vraag referrals|project is afgerond/i.test(stap.titel)) continue;

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
    // Schouw al geweest (of formulier): geen herinner-actie meer
    if (
      /schouwdag bevestigen|schouwdag herinneren|herinneren richting datum/i.test(
        stap.titel
      )
    ) {
      const schouwAt = project.schouw_at
        ? new Date(project.schouw_at).getTime()
        : NaN;
      if (Number.isFinite(schouwAt) && schouwAt <= now.getTime()) {
        continue;
      }
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

    const later = !stap.urgent && !stap.overdue;
    items.push({
      id: `volgende-stap-${project.id}`,
      soort: "volgende_stap",
      titel: stap.titel,
      detail: stap.reden,
      reden: stap.reden,
      deadlineAt,
      saleAt: saleMomentVanProject(project).toISOString(),
      overdue: stap.overdue,
      prio: stap.overdue || isPrioDeadline(new Date(deadlineAt), now),
      vastgelopen: isVastgelopen(deadlineAt, stap.overdue, now),
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
      later,
    });
  }
  return items;
}

/** Overdue ≥ 2 kalenderdagen → vastgelopen. */
export function isVastgelopen(
  deadlineAt: string | Date,
  overdue: boolean,
  now = new Date()
): boolean {
  if (!overdue) return false;
  const due =
    typeof deadlineAt === "string" ? new Date(deadlineAt) : deadlineAt;
  if (Number.isNaN(due.getTime())) return overdue;
  const days =
    (now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24);
  return days >= 2;
}

/** PRIO als deadline vandaag of morgen (≤ 1 kalenderdag) of overdue. */
export function isPrioDeadline(deadlineAt: Date, now: Date = new Date()): boolean {
  const nowMs = now.getTime();
  if (deadlineAt.getTime() < nowMs) return true;
  const z = toZonedTime(now, AMSTERDAM_TZ);
  const tomorrowEnd = addDays(z, 1);
  tomorrowEnd.setHours(23, 59, 59, 999);
  const tomorrowEndUtc = fromZonedTime(tomorrowEnd, AMSTERDAM_TZ);
  return deadlineAt.getTime() <= tomorrowEndUtc.getTime();
}

function softDueOverWerkdagen(from: Date, workdays: number): Date {
  const z = toZonedTime(from, AMSTERDAM_TZ);
  let left = workdays;
  const cursor = new Date(z);
  while (left > 0) {
    cursor.setDate(cursor.getDate() + 1);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  cursor.setHours(17, 0, 0, 0);
  return fromZonedTime(cursor, AMSTERDAM_TZ);
}

/**
 * Warmtefonds goedgekeurd (of verder): dan mag schouw worden gepland.
 * Herkent legacy `aanvraag_goedgekeurd`, pipeline `aanbod_ondertekenen`+,
 * én project.status `warmtefonds_goedgekeurd`.
 */
export function isWarmtefondsGoedgekeurd(project: Project): boolean {
  if (project.status === "warmtefonds_goedgekeurd") return true;
  const raw = resolveFinancieringStatus(project);
  const n = normalizeFinancieringStatus(raw);
  if (!n || n === "afgewezen") return false;
  // Legacy key blijft expliciet
  if (raw === "aanvraag_goedgekeurd") return true;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  const from = FINANCIERING_PIPELINE.indexOf("aanbod_ondertekenen");
  return idx >= 0 && from >= 0 && idx >= from;
}

/**
 * Acties-tab bucket “Wacht op extern”: wachten/opvolgen zonder harde interne deadline.
 * (Nabellen/schakelen horen hier historisch ook — te laat → Te laat-bucket.)
 */
export function isBackofficeActieWachtExtern(actie: BackofficeActie): boolean {
  // Actieve BO-taak: herinneringsmail sturen (niet “wacht op extern”)
  if (actie.soort === "wf_aanbetaling_herinnering") return false;
  if (actie.soort === "wacht_warmtefonds") return true;
  if (actie.soort === "schakel_financiering") return true;
  if (actie.soort === "nabellen_factuur") return true;
  if (actie.later) return true;
  const t = (actie.titel || "").toLowerCase();
  return (
    t.includes("wacht") ||
    t.includes("edwin") ||
    t.includes("financiering") ||
    t.includes("warmtefonds")
  );
}

/**
 * Projecten-filter “Wachten Extern”: alleen echt wachten (geen BO-werk vandaag).
 * Documenten/Edwin/nabellen/schakelen = Actie.
 */
export function isProjectFilterWachtExtern(actie: BackofficeActie): boolean {
  if (actie.later) return true;
  if (actie.overdue || actie.vastgelopen) return false;

  if (actie.soort === "wacht_warmtefonds") {
    const t = (actie.titel || "").toLowerCase();
    // Documenten / afspraak / aanvraag indienen → BO moet iets doen = Actie
    if (
      t.includes("document") ||
      t.includes("afspraak") ||
      t.includes("aanvraag indienen") ||
      t.includes("opvragen")
    ) {
      return false;
    }
    // Wachten op beoordeling / opvolgen bij WF
    return true;
  }

  if (actie.soort === "volgende_stap") {
    const t = (actie.titel || "").toLowerCase();
    return /\bwacht op\b/.test(t);
  }

  return false;
}

/** Nog wachten op Warmtefonds (vóór goedkeuring) — hoort in “Wacht op extern”. */
export function isWarmtefondsWachtOpExtern(project: Project): boolean {
  if (!isWarmtefondsProject(project)) return false;
  if (isProjectBuitenActies(project)) return false;
  if (isWarmtefondsGoedgekeurd(project)) return false;
  const raw = resolveFinancieringStatus(project);
  const n = normalizeFinancieringStatus(raw);
  if (!n || n === "afgewezen") return false;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  const from = FINANCIERING_PIPELINE.indexOf("aanbod_ondertekenen");
  return idx >= 0 && from >= 0 && idx < from;
}

/**
 * Onderscheid binnen Wacht op extern (Warmtefonds):
 * - afspraak_inplannen: doorgestuurd / documenten / afspraak
 * - goedkeuring: aanvraag bij WF in behandeling
 */
export type WarmtefondsWachtFase = "afspraak_inplannen" | "goedkeuring";

export function warmtefondsWachtFaseVanStatus(
  status: FinancieringStatus | string | null | undefined
): WarmtefondsWachtFase {
  const n = normalizeFinancieringStatus(status) || status;
  if (n === "in_behandeling" || status === "aanvraag_gedaan") {
    return "goedkeuring";
  }
  return "afspraak_inplannen";
}

export function warmtefondsWachtFaseVanProject(
  project: Project
): WarmtefondsWachtFase | null {
  if (!isWarmtefondsWachtOpExtern(project)) return null;
  return warmtefondsWachtFaseVanStatus(resolveFinancieringStatus(project));
}

export function warmtefondsWachtFaseVanActie(
  actie: Pick<BackofficeActie, "soort" | "titel" | "project">
): WarmtefondsWachtFase | null {
  if (actie.soort !== "wacht_warmtefonds") return null;
  if (actie.project) {
    const fromProject = warmtefondsWachtFaseVanProject(actie.project);
    if (fromProject) return fromProject;
  }
  const t = (actie.titel || "").toLowerCase();
  if (
    t.includes("goedkeuring") ||
    t.includes("in behandeling") ||
    t.includes("opvolgen")
  ) {
    return "goedkeuring";
  }
  return "afspraak_inplannen";
}

function warmtefondsWachtTitel(status: FinancieringStatus): string {
  return warmtefondsWachtFaseVanStatus(status) === "goedkeuring"
    ? "Wachten op goedkeuring WF"
    : "Wachten Afspraak Inplannen WF";
}

/**
 * Warmtefonds vóór goedkeuring: zichtbaar onder “Wacht op extern”.
 * Na goedkeuring verdwijnt deze actie en verschijnt “Schouw inplannen”.
 */
export function openWarmtefondsWachtActies(
  projecten: Project[],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  for (const project of projecten) {
    if (!isWarmtefondsWachtOpExtern(project)) continue;
    const raw = resolveFinancieringStatus(project);
    if (!raw) continue;
    const n = normalizeFinancieringStatus(raw) || raw;
    const taak = FINANCIERING_STATUS_TAAK[raw] || FINANCIERING_STATUS_TAAK[n];
    const dueDays = taak?.dueDays ?? 5;
    const sale = saleMomentVanProject(project);
    const deadlineAt = softDueOverWerkdagen(sale, dueDays);
    // Soft: niet “te laat” forceren terwijl we echt op extern wachten —
    // gebruik max(sale+due, now+2wd) zodat nieuwe dossiers niet meteen rood zijn
    const softFromNow = softDueOverWerkdagen(now, Math.min(dueDays, 5));
    const due =
      deadlineAt.getTime() < now.getTime() ? softFromNow : deadlineAt;

    const lead = leadFromProject(project);
    const offerte = projectOfferte(project);
    const fase = warmtefondsWachtFaseVanStatus(raw);
    const titel = warmtefondsWachtTitel(raw);
    const statusLabel =
      FINANCIERING_STATUS_LABEL[n] || FINANCIERING_STATUS_LABEL[raw] || n;

    items.push({
      id: `wacht-wf-${project.id}`,
      soort: "wacht_warmtefonds",
      titel,
      detail:
        fase === "goedkeuring"
          ? `Status: ${statusLabel} — zodra goedgekeurd → schouw inplannen`
          : `Status: ${statusLabel} — documenten/afspraak afronden, daarna wachten op goedkeuring`,
      reden:
        fase === "goedkeuring"
          ? "Warmtefonds beoordeelt de aanvraag. Check portaal/Edwin; bij goedkeuring plan je de schouw."
          : `Warmtefonds-fase “${statusLabel}”: documenten opvragen of afspraak inplannen.`,
      deadlineAt: due.toISOString(),
      saleAt: sale.toISOString(),
      overdue: false,
      prio: false,
      vastgelopen: false,
      later: true,
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

/**
 * Batterij bestellen: schouw gepland + order volledig betaald + installatie gezet
 * + checklist nog open. Deadline = 5 werkdagen vóór installatie (17:00).
 * PRIO als deadline ≤ morgen of overdue.
 */
export function openBestelMateriaalActies(
  projecten: Project[],
  facturen: Factuur[] = [],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  const nowMs = now.getTime();
  const facturenByProject = new Map<string, Factuur[]>();
  for (const f of facturen) {
    if (!f.project_id) continue;
    const list = facturenByProject.get(f.project_id) ?? [];
    list.push(f);
    facturenByProject.set(f.project_id, list);
  }

  for (const project of projecten) {
    if (isProjectBuitenActies(project)) continue;
    if (!project.installatie_at) continue;
    if (!materiaalNogTeBestellen(project)) continue;
    if (!isSchouwweekGepland(project)) continue;

    const offerte = projectOfferte(project);
    const orderIncBtw = Number(offerte?.totaal_inc_btw ?? 0) || 0;
    if (
      !isOrderVolledigBetaald({
        facturen: facturenByProject.get(project.id) ?? [],
        orderIncBtw,
      })
    ) {
      continue;
    }

    const deadlineAt = bestelDeadlineVoorInstallatie(project.installatie_at);
    const lead = leadFromProject(project);
    const overdue = deadlineAt.getTime() < nowMs;
    const prio = isPrioDeadline(deadlineAt, now);
    const bestelLabel = formatDateNl(deadlineAt);
    const installLabel = formatDateNl(project.installatie_at);
    const pn = project.project_nummer?.trim();

    items.push({
      id: `bestel-materiaal-${project.id}`,
      soort: "bestel_materiaal",
      titel: "Batterij bestellen",
      detail: `Besteldatum ${bestelLabel} · installatie ${installLabel}${pn ? ` · ${pn}` : ""}`,
      reden: `Bestellen vóór ${bestelLabel} (${INKOOP_DAGEN_VOOR_INSTALLATIE} werkdagen vóór installatie)`,
      deadlineAt: deadlineAt.toISOString(),
      saleAt: saleMomentVanProject(project).toISOString(),
      overdue,
      prio,
      vastgelopen: isVastgelopen(deadlineAt, overdue, now),
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
  return items.sort(
    (a, b) =>
      Number(b.prio) - Number(a.prio) ||
      Number(b.overdue) - Number(a.overdue) ||
      a.deadlineAt.localeCompare(b.deadlineAt)
  );
}

/**
 * Schouwdag inplannen:
 * - Warmtefonds: pas ná goedkeuring (niet eerder op schouwweek-window).
 * - Eigen middelen: 1 week vóór schouwweek (window/overdue).
 */
export function openSchouwInplannenActies(
  projecten: Project[],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  const nowMs = now.getTime();

  for (const project of projecten) {
    if (isProjectBuitenActies(project)) continue;
    if (isSchouwdagDefinitief(project)) continue;

    const jaar = project.schouw_jaar ?? null;
    const week = project.schouw_week ?? null;
    const warmtefonds = isWarmtefondsProject(project);
    const wfGoedgekeurd = isWarmtefondsGoedgekeurd(project);

    // WF: geen schouwdag-actie tot financiering goedgekeurd is
    if (warmtefonds && !wfGoedgekeurd) continue;

    let deadlineAt: Date | null = null;
    let detail = "";
    let reden: string | null = null;

    if (jaar && week) {
      const dueIso = dueAtVoorSchouwdagInplan(jaar, week);
      const due = new Date(dueIso);
      const overdue = due.getTime() < nowMs;
      const inWindow = isInSchouwdagPlannenWindow(jaar, week, now);
      if (warmtefonds || inWindow || overdue) {
        deadlineAt = due;
        const weekLabel = formatSchouwWeekLabel(jaar, week);
        detail = warmtefonds
          ? `Warmtefonds goedgekeurd · schouwweek ${weekLabel} — plan de exacte schouwdag`
          : `Schouwweek ${weekLabel} — plan de exacte schouwdag`;
        reden = warmtefonds
          ? "Warmtefonds is goedgekeurd; plan nu de schouwdag."
          : overdue
            ? `Schouwdag had uiterlijk 1 week vóór schouwweek ${weekLabel} gepland moeten zijn.`
            : `Plan de schouwdag in (window: 1 week vóór schouwweek ${weekLabel}).`;
      }
    }

    if (!deadlineAt && wfGoedgekeurd) {
      deadlineAt = softDueOverWerkdagen(now, 2);
      detail = "Warmtefonds goedgekeurd — schouwdag inplannen";
      reden =
        "Warmtefonds is goedgekeurd; plan zo snel mogelijk de schouwdag.";
    }

    if (!deadlineAt) continue;

    const lead = leadFromProject(project);
    const offerte = projectOfferte(project);
    const overdue = deadlineAt.getTime() < nowMs;
    const schouwLabel =
      jaar && week ? formatSchouwWeekLabel(jaar, week) : undefined;

    items.push({
      id: `schouw-inplannen-${project.id}`,
      soort: "schouw_inplannen",
      titel: "Schouwdag inplannen",
      detail,
      reden,
      deadlineAt: deadlineAt.toISOString(),
      saleAt: saleMomentVanProject(project).toISOString(),
      overdue,
      prio: isPrioDeadline(deadlineAt, now),
      vastgelopen: isVastgelopen(deadlineAt, overdue, now),
      leadId: project.lead_id,
      leadNaam: lead?.naam || project.titel || "—",
      telefoon: lead?.telefoon || null,
      plaats: lead?.plaats || null,
      offerteId: offerte?.id || project.offerte_id,
      offerteNummer: offerte?.offerte_nummer || null,
      projectId: project.id,
      projectNummer: project.project_nummer,
      href: `/projecten/${project.id}`,
      schouwJaar: jaar ?? undefined,
      schouwWeek: week ?? undefined,
      schouwWeekLabel: schouwLabel,
      project,
      planSchouwdag: true,
    });
  }

  return items.sort(
    (a, b) =>
      Number(b.prio) - Number(a.prio) ||
      Number(b.overdue) - Number(a.overdue) ||
      a.deadlineAt.localeCompare(b.deadlineAt)
  );
}

export function openBackofficeActies(
  projecten: Project[],
  facturen: Factuur[] = [],
  now = new Date(),
  opts?: {
    leads?: Pick<Lead, "id" | "naam" | "telefoon" | "plaats" | "status">[];
    afspraken?: HerplanAfspraak[];
    adviseurs?: Pick<{ id: string; naam: string }, "id" | "naam">[];
  }
): BackofficeActie[] {
  const opstart = openBelSchouwActies(projecten, facturen, now);
  const schouw = openSchouwInplannenActies(projecten, now);
  const schouwProjectIds = new Set(
    schouw.map((a) => a.projectId).filter(Boolean) as string[]
  );
  const volgende = openVolgendeStapActies(projecten, facturen, now).filter(
    (a) => {
      // Geen “later” (nog niet belweek) in de actieve lijst
      if (a.later) return false;
      // Geen dubbele schouwdag-actie naast schouw_inplannen
      if (
        a.projectId &&
        schouwProjectIds.has(a.projectId) &&
        /schouwdag/i.test(a.titel)
      ) {
        return false;
      }
      return true;
    }
  );

  // Klant-afzegging / deur-niet-open → Bel-wachtrij.
  // Adviseur/CRM-annulering → wel als BO-actie (herplannen).
  const herplanAdviseur = openHerplanAfspraakActies(
    opts?.leads || [],
    opts?.afspraken || [],
    now,
    opts?.adviseurs || []
  ).filter((a) => a.herplanBron === "adviseur");

  return [
    ...opstart,
    ...schouw,
    ...herplanAdviseur,
    ...openWarmtefondsWachtActies(projecten, now),
    ...openAangetekendeBriefActies(projecten, facturen, now),
    ...openAnnuleringKeuzeControleActies(projecten, facturen, now),
    ...openSchakelFinancieringActies(projecten, now),
    ...openBestelMateriaalActies(projecten, facturen, now),
    ...openNabellenFactuurActies(facturen, now, projecten),
    ...openWarmtefondsAanbetalingHerinneringActies(facturen, now, projecten),
    ...volgende,
  ].sort(
    (a, b) =>
      Number(b.vastgelopen) - Number(a.vastgelopen) ||
      Number(b.overdue) - Number(a.overdue) ||
      Number(b.prio) - Number(a.prio) ||
      new Date(a.deadlineAt).getTime() - new Date(b.deadlineAt).getTime()
  );
}

/**
 * Acties-tab / sidebar-badge: afspraken, purchasing, project-planning, nazorg.
 * Badge en lijst moeten dezelfde set gebruiken.
 */
export const ACTIES_TAB_SOORTEN: ReadonlySet<BackofficeActieSoort> = new Set([
  "bel_schouw_aanbetaling",
  "bestel_materiaal",
  "schouw_inplannen",
  "volgende_stap",
  "aangetekende_brief",
  "annulering_keuze_controle",
  "schakel_financiering",
  "wacht_warmtefonds",
  "nabellen_factuur",
  "wf_aanbetaling_herinnering",
  "herplan_afspraak",
]);

export type ActiesTabId =
  | "afspraken"
  | "purchasing"
  | "projecten"
  | "nazorg";

/** Tab-indeling voor de Acties-UI. */
export function actieTabVoorSoort(
  soort: BackofficeActieSoort,
  titel?: string
): ActiesTabId {
  if (soort === "bestel_materiaal") return "purchasing";
  if (
    soort === "aangetekende_brief" ||
    soort === "annulering_keuze_controle" ||
    soort === "schakel_financiering" ||
    soort === "wacht_warmtefonds"
  ) {
    return "nazorg";
  }
  if (soort === "volgende_stap") {
    const t = titel || "";
    if (/materiaal|inkoop|bestel/i.test(t)) return "purchasing";
    // review/referrals horen niet in BO-acties (sales); overstap/btw wel nazorg
    if (/overstap|btw|nazorg/i.test(t)) return "nazorg";
    return "projecten";
  }
  if (soort === "schouw_inplannen" || soort === "bel_schouw_aanbetaling") {
    return "projecten";
  }
  if (
    soort === "nabellen_factuur" ||
    soort === "wf_aanbetaling_herinnering" ||
    soort === "herplan_afspraak"
  ) {
    return "afspraken";
  }
  return "projecten";
}

export function actiesVoorActiesTab(
  acties: BackofficeActie[]
): BackofficeActie[] {
  return acties.filter((a) => ACTIES_TAB_SOORTEN.has(a.soort));
}

/** Openstaande acties voor één project (incl. factuur-nabellen op dezelfde lead). */
export function openActiesVoorProject(
  project: Project,
  facturen: Factuur[] = [],
  now = new Date()
): BackofficeActie[] {
  if (isProjectBuitenActies(project)) return [];
  const relatedFacturen = facturen.filter((f) => f.lead_id === project.lead_id);
  return openBackofficeActies([project], relatedFacturen, now).filter(
    (a) => a.projectId === project.id || a.leadId === project.lead_id
  );
}
