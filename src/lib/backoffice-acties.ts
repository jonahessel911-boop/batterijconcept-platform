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
  schouwWeekOffsetVoorSale,
  type SchouwWeek,
} from "@/lib/schouw-week";

export type BackofficeActieSoort =
  | "bel_schouw_aanbetaling"
  | "schakel_financiering"
  | "nabellen_factuur"
  | "herplan_afspraak";

/** Financieringsman Warmtefonds — bel/WhatsApp bij Warmtefonds-sale. */
export const FINANCIERINGSMAN_TEL = "+31 6 58824298";
export const FINANCIERINGSMAN_TEL_HREF = "tel:+31658824298";

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
  if (!isWarmtefondsProject(project)) return false;
  if (project.financiering_geschakeld_at) return false;
  return true;
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
    `Hallo, Warmtefonds-klant voor financiering:`,
    `Naam: ${actie.leadNaam}`,
    `Tel: ${actie.telefoon?.trim() || "—"}`,
    `Plaats: ${actie.plaats?.trim() || "—"}`,
    `Offerte: ${actie.offerteNummer || "—"} (getekende PDF bijgevoegd)`,
  ].join("\n");
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
      titel: "Schakelen met financieringsman",
      detail: `Stuur naam, tel, plaats + getekende offerte. Bel ${FINANCIERINGSMAN_TEL}.`,
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

const HERPLAN_SKIP_STATUS = new Set([
  "deal",
  "sale_financiering",
  "sale_eigen_middelen",
  "geen_interesse",
  "offerte_afgewezen",
  "niet_gekwalificeerd",
]);

/**
 * Klant heeft huisbezoek geannuleerd → opnieuw inplannen.
 * Bron: leadstatus `afspraak_afgezegd_klant`, of geannuleerde fysieke
 * afspraak met “Annulering (klant)” zonder nieuwe actieve afspraak.
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
    if (HERPLAN_SKIP_STATUS.has(lead.status)) continue;
    if (hasFutureActive.has(lead.id)) continue;

    const fromStatus = lead.status === "afspraak_afgezegd_klant";
    const cancelled =
      cancelledByKlant.get(lead.id) ||
      (fromStatus ? latestCancelled.get(lead.id) : undefined);
    if (!fromStatus && !cancelledByKlant.has(lead.id)) continue;

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
  return [
    ...openHerplanAfspraakActies(
      opts?.leads || [],
      opts?.afspraken || [],
      now
    ),
    ...openSchakelFinancieringActies(projecten, now),
    ...openBelSchouwActies(projecten, now),
    ...openNabellenFactuurActies(facturen, now),
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
