import { addDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";
import type { Afspraak, Factuur, Lead, Project } from "@/types/database";
import { isOrderVolledigBetaald } from "@/lib/aanbetaling";
import { AMSTERDAM_TZ, formatDateNl } from "@/lib/format";
import {
  factuurEffectieveDeadline,
  factuurIsOverdue,
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
import { isKickoffComplete } from "@/lib/project-kickoff";
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
  | "herplan_afspraak"
  | "volgende_stap"
  | "bestel_materiaal"
  | "aangetekende_brief"
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
  // Lead-sale-status wint op stale project.betaalwijze (bijv. na omzetting EM↔WF)
  const leadStatus = project.leads?.status ?? null;
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
    if (f.credit_van_factuur_id) continue;
    if (
      !factuurIsOverdue({
        status: f.status,
        vervaldatum: f.vervaldatum,
        afgesproken_betaaldatum: f.afgesproken_betaaldatum,
        betaald_op: f.betaald_op,
        credit_van_factuur_id: f.credit_van_factuur_id,
        now,
      })
    ) {
      continue;
    }
    const lead = leadFromFactuur(f);
    const offerteNummer =
      f.offertes?.offerte_nummer ||
      (f.omschrijving?.match(/OFF-[\w-]+/i)?.[0] ?? null);
    const deadline =
      factuurEffectieveDeadline({
        vervaldatum: f.vervaldatum,
        afgesproken_betaaldatum: f.afgesproken_betaaldatum,
      }) || f.vervaldatum;
    items.push({
      id: `nabellen-factuur-${f.id}`,
      soort: "nabellen_factuur",
      titel: "Nabellen factuur",
      detail: `Factuur ${f.factuur_nummer} is verlopen en nog niet betaald.`,
      deadlineAt: deadline
        ? vervaldatumEndOfDay(deadline).toISOString()
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
 * Huisbezoek opnieuw inplannen:
 * - Klant: status `afspraak_afgezegd_klant` (zonder nieuwe actieve afspraak)
 * - Deur niet open: status `deur_niet_open` (afgeboekt bezoek, opnieuw plannen)
 * - Adviseur/CRM: `Annulering (CRM)` zonder vervangende afspraak, en lead
 *   nog niet afgeboekt/sale (anders hoort herplannen niet meer)
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

/** Nog wachten op Warmtefonds (vóór goedkeuring) — hoort in “Wacht op extern”. */
export function isWarmtefondsWachtOpExtern(project: Project): boolean {
  if (!isWarmtefondsProject(project)) return false;
  if (project.status === "annulering") return false;
  if (isWarmtefondsGoedgekeurd(project)) return false;
  const raw = resolveFinancieringStatus(project);
  const n = normalizeFinancieringStatus(raw);
  if (!n || n === "afgewezen") return false;
  const idx = FINANCIERING_PIPELINE.indexOf(n);
  const from = FINANCIERING_PIPELINE.indexOf("aanbod_ondertekenen");
  return idx >= 0 && from >= 0 && idx < from;
}

function warmtefondsWachtTitel(status: FinancieringStatus): string {
  const n = normalizeFinancieringStatus(status) || status;
  if (n === "in_behandeling" || status === "aanvraag_gedaan") {
    return "Wachten goedkeuring Warmtefonds";
  }
  return (
    FINANCIERING_STATUS_TAAK[status]?.titel ||
    FINANCIERING_STATUS_TAAK[n]?.titel ||
    FINANCIERING_STATUS_LABEL[n] ||
    "Warmtefonds opvolgen"
  );
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
    const titel = warmtefondsWachtTitel(raw);
    const statusLabel =
      FINANCIERING_STATUS_LABEL[n] || FINANCIERING_STATUS_LABEL[raw] || n;

    items.push({
      id: `wacht-wf-${project.id}`,
      soort: "wacht_warmtefonds",
      titel,
      detail: `Status: ${statusLabel} — zodra goedgekeurd → schouw inplannen`,
      reden:
        n === "in_behandeling" || raw === "aanvraag_gedaan"
          ? "Warmtefonds beoordeelt de aanvraag. Check portaal/Edwin; bij goedkeuring plan je de schouw."
          : `Warmtefonds-fase “${statusLabel}” afronden vóór schouw.`,
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
    if (project.status === "annulering") continue;
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
 * Schouwdag inplannen: 1 week vóór schouwweek (window/overdue), of Warmtefonds
 * goedgekeurd zonder definitieve schouwdag.
 */
export function openSchouwInplannenActies(
  projecten: Project[],
  now = new Date()
): BackofficeActie[] {
  const items: BackofficeActie[] = [];
  const nowMs = now.getTime();

  for (const project of projecten) {
    if (project.status === "annulering") continue;
    if (isSchouwdagDefinitief(project)) continue;

    const jaar = project.schouw_jaar ?? null;
    const week = project.schouw_week ?? null;
    const wfGoedgekeurd = isWarmtefondsGoedgekeurd(project);

    let deadlineAt: Date | null = null;
    let detail = "";
    let reden: string | null = null;

    if (jaar && week) {
      const dueIso = dueAtVoorSchouwdagInplan(jaar, week);
      const due = new Date(dueIso);
      const overdue = due.getTime() < nowMs;
      const inWindow = isInSchouwdagPlannenWindow(jaar, week, now);
      if (inWindow || overdue) {
        deadlineAt = due;
        const weekLabel = formatSchouwWeekLabel(jaar, week);
        detail = `Schouwweek ${weekLabel} — plan de exacte schouwdag`;
        reden = overdue
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
      titel: "Schouw inplannen",
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
  // bel-schouw + nabellen-factuur: gedekt door status-gekoppelde auto-taken
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

  return [
    ...openHerplanAfspraakActies(
      opts?.leads || [],
      opts?.afspraken || [],
      now,
      opts?.adviseurs || []
    ),
    ...schouw,
    ...openWarmtefondsWachtActies(projecten, now),
    ...openAangetekendeBriefActies(projecten, now),
    ...openSchakelFinancieringActies(projecten, now),
    ...openBestelMateriaalActies(projecten, facturen, now),
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
  "herplan_afspraak",
  "bestel_materiaal",
  "schouw_inplannen",
  "volgende_stap",
  "aangetekende_brief",
  "schakel_financiering",
  "wacht_warmtefonds",
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
  if (soort === "herplan_afspraak") return "afspraken";
  if (soort === "bestel_materiaal") return "purchasing";
  if (
    soort === "aangetekende_brief" ||
    soort === "schakel_financiering" ||
    soort === "wacht_warmtefonds"
  ) {
    return "nazorg";
  }
  if (soort === "volgende_stap") {
    const t = titel || "";
    if (/materiaal|inkoop|bestel/i.test(t)) return "purchasing";
    if (/overstap|btw|review|nazorg/i.test(t)) return "nazorg";
    return "projecten";
  }
  if (soort === "schouw_inplannen" || soort === "bel_schouw_aanbetaling") {
    return "projecten";
  }
  if (soort === "nabellen_factuur") return "afspraken";
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
  const relatedFacturen = facturen.filter((f) => f.lead_id === project.lead_id);
  return openBackofficeActies([project], relatedFacturen, now).filter(
    (a) => a.projectId === project.id || a.leadId === project.lead_id
  );
}
