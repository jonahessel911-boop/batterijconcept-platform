"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Adviseur,
  Afspraak,
  Factuur,
  InstallatiePartner,
  Lead,
  Project,
  ProjectTaak,
} from "@/types/database";
import {
  FINANCIERINGSMAN_NAAM,
  FINANCIERINGSMAN_TEL,
  FINANCIERINGSMAN_TEL_HREF,
  edwinWarmtefondsWhatsappBericht,
  edwinWhatsappUrl,
  financieringSchakelBericht,
  isWarmtefondsProject,
  isBackofficeActieWachtExtern,
  actiesVoorActiesTab,
  openBackofficeActies,
  recommendedSchouwWeekForProject,
  saleMomentVanProject,
  warmtefondsWachtFaseVanActie,
  type BackofficeActie,
} from "@/lib/backoffice-acties";
import { logBackofficeActieEvent } from "@/lib/backoffice-actie-events";
import { formatDateShort, formatEuro } from "@/lib/format";
import { appendLeadNotitie } from "@/lib/lead-notitie";
import { leadStatusLabel } from "@/lib/labels";
import { PROJECT_AFDELINGEN } from "@/lib/project-afdeling";
import {
  findDefaultBackofficeMedewerkerId,
  isAdminAdviseur,
} from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseBrowser } from "@/lib/supabase";
import {
  formatSchouwWeekLabel,
  schouwWeekFromDate,
  schouwWeekValue,
  upcomingSchouwWeekOptions,
} from "@/lib/schouw-week";
import {
  kickoffWarmtefondsBedragen,
  projectKickoffItems,
} from "@/lib/project-kickoff";
import {
  resolveFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";
import {
  isAanbetalingFactuurOmschrijving,
  isRestantFactuurOmschrijving,
} from "@/lib/aanbetaling";
import { LeadAfspraakPlannen } from "./LeadAfspraakPlannen";
import { PartnerSlotPicker } from "./PartnerSlotPicker";
import { ProjectFinancieringPath } from "./ProjectFinancieringPath";
import { VerstuurDatumOptieModal } from "./VerstuurDatumOptieModal";
import { KlantContactMailModal } from "./KlantContactMailModal";
import { ActiesEmailInbox } from "./ActiesEmailInbox";
import { INKOOP_PRODUCT_IMAGES } from "@/lib/inkoop-product-images";
import { apexProductUrl } from "@/lib/apex-product-url";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";

function isOverstapNazorgTaak(taak: ProjectTaak): boolean {
  const key = (taak.auto_key || "").toLowerCase();
  const titel = (taak.titel || "").toLowerCase();
  return (
    key.includes("overstap") ||
    titel.includes("overstap") ||
    titel.includes("dynamische")
  );
}

type SectionId =
  | "herplan"
  | "schouw"
  | "volgende"
  | "inkoop"
  | "warmtefonds"
  | "wf_afspraak"
  | "wf_goedkeuring"
  | "stap1"
  | "factuur"
  | "aangetekend"
  | "handmatig";

type TaskRow = {
  key: string;
  section: SectionId;
  actie: BackofficeActie;
  kind:
    | "herplan"
    | "schouw_inplannen"
    | "volgende_stap"
    | "bestel_materiaal"
    | "financiering"
    | "wacht_warmtefonds"
    | "factuur_versturen"
    | "schouw_week"
    | "edwin_doorsturen"
    | "nabellen"
    | "wf_aanbetaling_herinnering"
    | "aangetekende_brief"
    | "annulering_keuze_controle"
    | "terugbel";
  titel: string;
  klant: string;
  meta?: string;
  dueAt: string;
  overdue: boolean;
  prio?: boolean;
  done: boolean;
};

const SECTION_META: Record<
  SectionId,
  { label: string; accent: string }
> = {
  herplan: {
    label: "Herplan",
    accent: "bg-[#FFF0E6] text-[#C45A12]",
  },
  schouw: {
    label: "Schouw",
    accent: "bg-[#E8F0F6] text-[#1A4A6E]",
  },
  volgende: {
    label: "Installatie",
    accent: "bg-[#E8F5E9] text-[#2E7D32]",
  },
  inkoop: {
    label: "Inkoop",
    accent: "bg-[#FFF8E7] text-[#8A6D00]",
  },
  warmtefonds: {
    label: "Warmtefonds",
    accent: "bg-[#E8F0F6] text-[#1A4A6E]",
  },
  wf_afspraak: {
    label: "Wachten Afspraak Inplannen WF",
    accent: "bg-[#E8F0F6] text-[#1A4A6E]",
  },
  wf_goedkeuring: {
    label: "Wachten op goedkeuring WF",
    accent: "bg-[#EEF2FF] text-[#3730A3]",
  },
  stap1: {
    label: "Opstarten",
    accent: "bg-green-soft text-green-dark",
  },
  factuur: {
    label: "Factuur",
    accent: "bg-[#FFF0E6] text-[#C45A12]",
  },
  aangetekend: {
    label: "Aangetekend",
    accent: "bg-[#FFF0E6] text-[#9A3B1A]",
  },
  handmatig: {
    label: "Taken",
    accent: "bg-[#F3F0FF] text-[#5B21B6]",
  },
};

const TYPE_PILL: Record<TaskRow["kind"], { label: string; className: string }> =
  {
    herplan: {
      label: "Herplan",
      className: "bg-[#FFF0E6] text-[#C45A12]",
    },
    schouw_inplannen: {
      label: "Schouw",
      className: "bg-[#E8F0F6] text-[#1A4A6E]",
    },
    volgende_stap: {
      label: "Installatie",
      className: "bg-[#E8F5E9] text-[#2E7D32]",
    },
    bestel_materiaal: {
      label: "Inkoop",
      className: "bg-[#FFF8E7] text-[#8A6D00]",
    },
    financiering: {
      label: "Warmtefonds",
      className: "bg-[#E8F0F6] text-[#1A4A6E]",
    },
    wacht_warmtefonds: {
      label: "Warmtefonds",
      className: "bg-[#E8F0F6] text-[#1A4A6E]",
    },
    factuur_versturen: {
      label: "Factuur",
      className: "bg-[#FFF0E6] text-[#C45A12]",
    },
    schouw_week: {
      label: "Opstarten",
      className: "bg-green-soft text-green-dark",
    },
    edwin_doorsturen: {
      label: "Warmtefonds",
      className: "bg-[#E8F0F6] text-[#1A4A6E]",
    },
    nabellen: {
      label: "Factuur",
      className: "bg-[#FFF0E6] text-[#C45A12]",
    },
    wf_aanbetaling_herinnering: {
      label: "Warmtefonds",
      className: "bg-[#E8F0F6] text-[#1A4A6E]",
    },
    aangetekende_brief: {
      label: "Bedenktijd",
      className: "bg-[#FFF0E6] text-[#9A3B1A]",
    },
    annulering_keuze_controle: {
      label: "Bedenktijd",
      className: "bg-[#FFF0E6] text-[#9A3B1A]",
    },
    terugbel: {
      label: "Terugbel",
      className: "bg-[#FFF0E6] text-[#C45A12]",
    },
  };

/** Filtertabs zoals in de Acties-werkvoorraad. */
type ActieBucket = "vandaag" | "te_laat" | "gepland" | "wacht_extern";

const ACTIE_BUCKETS: {
  id: ActieBucket;
  label: string;
  icon: "sun" | "alert" | "calendar" | "wait";
}[] = [
  { id: "vandaag", label: "Vandaag", icon: "sun" },
  { id: "te_laat", label: "Te laat", icon: "alert" },
  { id: "gepland", label: "Gepland", icon: "calendar" },
  { id: "wacht_extern", label: "Wacht op extern", icon: "wait" },
];

/** Soort-filter (categorie-pill). */
type SoortFilter = "alle" | SectionId | "nazorg";

const ACTIES_FILTERS_KEY = "bc_bo_acties_filters_v1";

type ActiesFiltersStored = {
  medewerkerId?: string;
  bucket?: ActieBucket;
  soortFilter?: SoortFilter;
  zoek?: string;
  /** yyyy-MM-dd — welke dag de focus-werklijst toont */
  focusDayKey?: string;
};

function readActiesFilters(): ActiesFiltersStored {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ACTIES_FILTERS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as ActiesFiltersStored;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeActiesFilters(filters: ActiesFiltersStored) {
  try {
    localStorage.setItem(ACTIES_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    /* ignore */
  }
}

const SOORT_FILTER_ORDER: SoortFilter[] = [
  "alle",
  "stap1",
  "schouw",
  "factuur",
  "inkoop",
  "volgende",
  "wf_afspraak",
  "wf_goedkeuring",
  "warmtefonds",
  "herplan",
  "aangetekend",
  "handmatig",
  "nazorg",
];

function soortFilterLabel(id: SoortFilter): string {
  if (id === "alle") return "Alles";
  if (id === "nazorg") return "Nazorg";
  if (id === "wf_afspraak") return "Wachten Afspraak Inplannen WF";
  if (id === "wf_goedkeuring") return "Wachten op goedkeuring WF";
  return SECTION_META[id].label;
}

function compareActieRows(a: TaskRow, b: TaskRow): number {
  // Geblokkeerd / prio eerst, daarna te laat, dan deadline oplopend
  const aBlok = a.actie.vastgelopen ? 1 : 0;
  const bBlok = b.actie.vastgelopen ? 1 : 0;
  if (aBlok !== bBlok) return bBlok - aBlok;
  const aPrio = a.prio || a.overdue ? 1 : 0;
  const bPrio = b.prio || b.overdue ? 1 : 0;
  if (aPrio !== bPrio) return bPrio - aPrio;
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function calendarDaysUntil(dueAt: string, now = new Date()): number {
  const dueYmd = ymdAmsterdam(new Date(dueAt));
  const nowYmd = ymdAmsterdam(now);
  const due = new Date(`${dueYmd}T12:00:00`);
  const today = new Date(`${nowYmd}T12:00:00`);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Actie hoort bij focus-dag: deadline die dag, of (op vandaag) ook achterstallig. */
function actieMatchesFocusDay(
  actie: Pick<
    BackofficeActie,
    "deadlineAt" | "overdue" | "vastgelopen" | "soort"
  > & { vastgelopen?: boolean },
  dayKey: string,
  now = new Date()
): boolean {
  const dueYmd = ymdAmsterdam(new Date(actie.deadlineAt));
  if (dueYmd === dayKey) return true;
  const todayKey = ymdAmsterdam(now);
  if (dayKey !== todayKey) return false;
  // Op vandaag: te late / vastgelopen acties meenemen (niet wacht-extern)
  if (
    isBackofficeActieWachtExtern(actie as BackofficeActie) &&
    !actie.overdue &&
    !actie.vastgelopen
  ) {
    return false;
  }
  const days = calendarDaysUntil(actie.deadlineAt, now);
  return days < 0 || Boolean(actie.overdue) || Boolean(actie.vastgelopen);
}

function shiftDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const base = new Date(y!, m! - 1, d!, 12, 0, 0);
  return ymdAmsterdam(addDays(base, delta));
}

function formatFocusDayLabel(dayKey: string): string {
  const today = ymdAmsterdam(new Date());
  if (dayKey === today) return "Vandaag";
  if (dayKey === shiftDayKey(today, 1)) return "Morgen";
  if (dayKey === shiftDayKey(today, -1)) return "Gisteren";
  try {
    return formatInTimeZone(
      new Date(`${dayKey}T12:00:00`),
      AMSTERDAM_TZ,
      "EEEE d MMMM",
      { locale: nl }
    );
  } catch {
    return dayKey;
  }
}

type OpvolgMode = "algemeen" | "specifiek";

/** Standaard: +1 dag, zelfde lokale tijd als nu. */
function defaultOpvolgDateTime(now = new Date()): {
  date: string;
  time: string;
} {
  const morgen = addDays(now, 1);
  return {
    date: formatInTimeZone(morgen, AMSTERDAM_TZ, "yyyy-MM-dd"),
    time: formatInTimeZone(now, AMSTERDAM_TZ, "HH:mm"),
  };
}

/**
 * Algemeen: dag zonder vast tijdstip (12:00) — rangschikt met andere dagtaken.
 * Specifiek: exacte datum + tijd.
 */
function dueAtFromOpvolg(
  date: string,
  mode: OpvolgMode,
  time: string
): Date {
  const hhmm =
    mode === "specifiek" && /^\d{2}:\d{2}$/.test(time) ? time : "12:00";
  return fromZonedTime(`${date}T${hhmm}:00`, AMSTERDAM_TZ);
}

function dueAtFromDayKey(dayKey: string): Date {
  return fromZonedTime(`${dayKey}T17:00:00`, AMSTERDAM_TZ);
}

function digitsOnly(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

function normalizePostcode(s: string | null | undefined): string {
  return (s || "").replace(/\s+/g, "").toUpperCase();
}

/** Zoek open acties op tel / postcode / naam / project (terugbel). */
/** Handmatige terugbel-taken gezet via Acties (niet bereikt / wacht op klant). */
function isActiesOpvolgTaak(t: ProjectTaak): boolean {
  if (t.status === "done") return false;
  if (t.auto_key) return false;
  const n = (t.notities || "").toLowerCase();
  const titel = (t.titel || "").toLowerCase();
  return (
    n.includes("via acties:") ||
    titel.startsWith("wacht op klant:") ||
    titel.startsWith("nabellen (niet bereikt):")
  );
}

function opvolgTaakToRow(
  t: ProjectTaak,
  projecten: Project[]
): TaskRow {
  const due = t.due_at || new Date().toISOString();
  const overdue =
    Boolean(t.due_at) && new Date(t.due_at!).getTime() < Date.now();
  const leadRaw = t.projecten?.leads;
  const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
  const leadId = t.projecten?.lead_id || "";
  const leadNaam = lead?.naam || "—";
  const project =
    (t.project_id
      ? projecten.find((p) => p.id === t.project_id)
      : undefined) || undefined;
  return {
    key: `opvolg-${t.id}`,
    section: "handmatig",
    kind: "terugbel",
    titel: t.titel || "Terugbellen",
    klant: leadNaam,
    meta: t.projecten?.project_nummer || undefined,
    dueAt: due,
    overdue,
    prio: overdue || calendarDaysUntil(due) <= 1,
    done: false,
    actie: {
      id: t.id,
      soort: "volgende_stap",
      titel: t.titel || "Terugbellen",
      detail: t.notities || "Gepland terugbelmoment via Acties",
      reden: t.notities || "Gepland terugbelmoment via Acties",
      deadlineAt: due,
      overdue,
      prio: overdue || calendarDaysUntil(due) <= 1,
      leadId,
      leadNaam,
      telefoon: lead?.telefoon || null,
      plaats: lead?.plaats || null,
      projectId: t.project_id || undefined,
      projectNummer: t.projecten?.project_nummer || null,
      href: t.project_id ? `/projecten/${t.project_id}` : "#",
      project,
    },
  };
}

function actieMatchesJumpQuery(
  row: TaskRow,
  query: string,
  leads: Lead[]
): boolean {
  const q = query.trim();
  if (q.length < 2) return false;
  const lead = leads.find((l) => l.id === row.actie.leadId);
  const qDigits = digitsOnly(q);
  const qPc = normalizePostcode(q);

  if (qDigits.length >= 3) {
    const tel = digitsOnly(row.actie.telefoon || lead?.telefoon);
    if (tel && tel.includes(qDigits)) return true;
  }
  if (qPc.length >= 4) {
    const pc = normalizePostcode(lead?.postcode);
    if (pc && pc.startsWith(qPc)) return true;
  }
  const hay = [
    row.klant,
    row.titel,
    row.actie.projectNummer,
    row.actie.offerteNummer,
    row.actie.plaats,
    lead?.plaats,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

function bucketVoorActie(
  actie: BackofficeActie,
  now = new Date()
): ActieBucket {
  if (
    isBackofficeActieWachtExtern(actie) &&
    !actie.overdue &&
    !actie.vastgelopen
  ) {
    return "wacht_extern";
  }
  const days = calendarDaysUntil(actie.deadlineAt, now);
  if (days < 0 || actie.overdue || actie.vastgelopen) return "te_laat";
  if (days === 0) return "vandaag";
  return "gepland";
}

function formatDeadlineWhen(dueAt: string): string {
  return formatInTimeZone(new Date(dueAt), AMSTERDAM_TZ, "d MMM yyyy - HH:mm", {
    locale: nl,
  });
}

/** Deadline zoals in de werkvoorraad: datum+tijd bovenaan, status eronder. */
function deadlinePill(opts: {
  dueAt: string;
  overdue: boolean;
  vastgelopen?: boolean;
}): { when: string; label: string; className: string } {
  const when = formatDeadlineWhen(opts.dueAt);
  if (opts.vastgelopen) {
    return {
      when,
      label: "Geblokkeerd",
      className: "text-[#5A635C]",
    };
  }
  const days = calendarDaysUntil(opts.dueAt);
  if (days < 0 || opts.overdue) {
    return {
      when,
      label: "Te laat",
      className: "text-[#C62828]",
    };
  }
  if (days === 0) {
    return {
      when,
      label: "Vandaag",
      className: "text-[#C45A12]",
    };
  }
  if (days === 1) {
    return {
      when,
      label: "Morgen",
      className: "text-[#1A4A6E]",
    };
  }
  return {
    when,
    label: `Over ${days} d`,
    className: "text-muted",
  };
}

function initialsVanNaam(naam: string): string {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function eigenaarVoorActie(
  actie: BackofficeActie,
  projecten: Project[],
  adviseurs: Adviseur[],
  /** Zonder project-eigenaar: standaard Tarik (backoffice). */
  defaultEigenaarId?: string | null
): { id: string | null; naam: string; initials: string; impliciet?: boolean } {
  const project =
    actie.project ||
    (actie.projectId
      ? projecten.find((p) => p.id === actie.projectId)
      : undefined);
  const raw = project?.verantwoordelijke;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v?.naam) {
    return {
      id: v.id || project?.verantwoordelijke_id || null,
      naam: v.naam,
      initials: initialsVanNaam(v.naam),
    };
  }
  if (project?.verantwoordelijke_id) {
    const a = adviseurs.find((x) => x.id === project.verantwoordelijke_id);
    if (a?.naam) {
      return {
        id: a.id,
        naam: a.naam,
        initials: initialsVanNaam(a.naam),
      };
    }
  }
  if (defaultEigenaarId) {
    const a = adviseurs.find((x) => x.id === defaultEigenaarId);
    const naam = a?.naam || "Tarik";
    return {
      id: defaultEigenaarId,
      naam,
      initials: initialsVanNaam(naam),
      impliciet: true,
    };
  }
  return { id: null, naam: "Niet toegewezen", initials: "?" };
}

function BucketIcon({
  icon,
  className,
}: {
  icon: (typeof ACTIE_BUCKETS)[number]["icon"];
  className?: string;
}) {
  const cn = className || "h-4 w-4";
  if (icon === "alert") {
    return (
      <svg className={cn} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l6.518 11.594c.75 1.335-.213 2.982-1.742 2.982H3.48c-1.53 0-2.492-1.647-1.743-2.982L8.257 3.1zM10 13a1 1 0 100 2 1 1 0 000-2zm-.75-6.75a.75.75 0 011.5 0v4a.75.75 0 01-1.5 0v-4z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (icon === "sun") {
    return (
      <svg className={cn} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path d="M10 3.5a.75.75 0 01.75.75V6a.75.75 0 01-1.5 0V4.25A.75.75 0 0110 3.5zM10 14a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5A.75.75 0 0110 14zM4.25 10a.75.75 0 01.75-.75H6.5a.75.75 0 010 1.5H5a.75.75 0 01-.75-.75zM13.5 10a.75.75 0 01.75-.75H15a.75.75 0 010 1.5h-1.5a.75.75 0 01-.75-.75zM5.94 5.94a.75.75 0 011.06 0l1.06 1.06a.75.75 0 11-1.06 1.06L5.94 7a.75.75 0 010-1.06zM12.94 12.94a.75.75 0 011.06 0l1.06 1.06a.75.75 0 11-1.06 1.06l-1.06-1.06a.75.75 0 010-1.06zM14.06 5.94a.75.75 0 010 1.06L13 8.06a.75.75 0 11-1.06-1.06l1.06-1.06a.75.75 0 011.06 0zM7 12.94a.75.75 0 010 1.06l-1.06 1.06a.75.75 0 11-1.06-1.06L5.94 13a.75.75 0 011.06 0zM10 7a3 3 0 100 6 3 3 0 000-6z" />
      </svg>
    );
  }
  if (icon === "calendar") {
    return (
      <svg className={cn} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm-2 7a1 1 0 011-1h10a1 1 0 110 2H5a1 1 0 01-1-1z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (icon === "wait") {
    return (
      <svg className={cn} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .192.168.1.5.75h4a.75.75 0 000-1.5h-3.25V5z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg className={cn} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M5 8V6a5 5 0 0110 0v2h1a1 1 0 011 1v8a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1h1zm2-2a3 3 0 016 0v2H7V6z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CheckDot({ done }: { done: boolean }) {
  return (
    <span
      className={[
        "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
        done
          ? "border-green bg-green text-white"
          : "border-[#c5cdc8] bg-white text-transparent",
      ].join(" ")}
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="h-2.5 w-2.5" fill="none">
        <path
          d="M3.5 8.5 6.5 11.5 12.5 4.5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function draftFacturenVoorActie(actie: BackofficeActie, facturen: Factuur[]) {
  return facturen.filter((f) => {
    if (f.lead_id !== actie.leadId) return false;
    if (f.status !== "concept") return false;
    if (actie.offerteId && f.offerte_id && f.offerte_id !== actie.offerteId) {
      return false;
    }
    return true;
  });
}

function aanbetalingDraftsVoorActie(
  actie: BackofficeActie,
  facturen: Factuur[]
): Factuur[] {
  const drafts = draftFacturenVoorActie(actie, facturen);
  const aanb = drafts.filter((f) =>
    isAanbetalingFactuurOmschrijving(f.omschrijving)
  );
  return aanb.length > 0 ? aanb : drafts;
}

function verzondenFacturenVoorActie(
  actie: BackofficeActie,
  facturen: Factuur[]
) {
  return facturen.filter((f) => {
    if (f.lead_id !== actie.leadId) return false;
    if (f.status === "concept") return false;
    if (actie.offerteId && f.offerte_id && f.offerte_id !== actie.offerteId) {
      return false;
    }
    return true;
  });
}

/** Zijpaneel: opstart-/backoffice-notitie naast de actie-werkruimte. */
function SaleNotitiesAside({
  actie,
  projecten,
  forceShow = false,
}: {
  actie: BackofficeActie;
  projecten: Project[];
  /** Toon paneel ook zonder notitie (lege staat) */
  forceShow?: boolean;
}) {
  const project =
    actie.project ||
    (actie.projectId
      ? projecten.find((p) => p.id === actie.projectId)
      : projecten.find((p) => p.lead_id === actie.leadId));
  if (!project) return null;

  const backoffice = project.backoffice_notitie?.trim() || "";
  const installateur = project.installateur_notitie?.trim() || "";
  const hasEnergie =
    project.elektra_verbruik_kwh != null ||
    project.teruglevering_kwh != null ||
    project.energie_contract_type != null;
  if (!backoffice && !installateur && !hasEnergie && !forceShow) return null;

  return (
    <aside className="w-full shrink-0 space-y-3 lg:sticky lg:top-0 lg:w-[16.5rem] xl:w-[18rem]">
      {hasEnergie || forceShow ? (
        <div className="overflow-hidden rounded-2xl border border-[#0a4727]/20 bg-[#F7F9F7] shadow-[0_1px_0_rgba(10,71,39,0.04)]">
          <div className="border-b border-line bg-white px-3.5 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#0a4727]">
              Frank overstap
            </p>
            <p className="mt-0.5 font-display text-sm font-semibold text-ink">
              Energieverbruik
            </p>
          </div>
          <div className="space-y-2 px-3.5 py-3 text-[12px]">
            <p>
              <span className="text-muted">Elektra · </span>
              <span className="font-semibold tabular-nums text-ink">
                {project.elektra_verbruik_kwh != null
                  ? `${Number(project.elektra_verbruik_kwh).toLocaleString("nl-NL")} kWh`
                  : "—"}
              </span>
            </p>
            <p>
              <span className="text-muted">Gas · </span>
              <span className="font-semibold tabular-nums text-ink">
                {project.gas_verbruik_m3 != null
                  ? `${Number(project.gas_verbruik_m3).toLocaleString("nl-NL")} m³`
                  : "geen / —"}
              </span>
            </p>
            <p>
              <span className="text-muted">Teruglever · </span>
              <span className="font-semibold tabular-nums text-ink">
                {project.teruglevering_kwh != null
                  ? `${Number(project.teruglevering_kwh).toLocaleString("nl-NL")} kWh`
                  : "—"}
              </span>
            </p>
            <p>
              <span className="text-muted">Contract · </span>
              <span className="font-semibold text-ink">
                {project.energie_contract_type || "—"}
                {project.energie_contract_type === "vast" &&
                project.energie_contract_einddatum
                  ? ` · eind ${project.energie_contract_einddatum}`
                  : ""}
              </span>
            </p>
          </div>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-2xl border border-line bg-[#F7F9F7] shadow-[0_1px_0_rgba(10,71,39,0.04)]">
        <div className="border-b border-line bg-white px-3.5 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            Opstart
          </p>
          <p className="mt-0.5 font-display text-sm font-semibold text-ink">
            Backoffice notitie
          </p>
        </div>
        <div className="border-l-[3px] border-l-[#0a4727] px-3.5 py-3.5">
          {backoffice ? (
            <div>
              {project.backoffice_notitie_door?.trim() ? (
                <p className="mb-1.5 text-[10px] font-medium text-muted">
                  {project.backoffice_notitie_door.trim()}
                </p>
              ) : null}
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">
                {backoffice}
              </p>
            </div>
          ) : (
            <p className="text-[12px] italic leading-relaxed text-muted">
              Geen notitie van sales — check het project bij twijfel.
            </p>
          )}
          {installateur ? (
            <div className="mt-3 border-t border-line/70 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Installateur
                {project.installateur_notitie_door?.trim()
                  ? ` · ${project.installateur_notitie_door.trim()}`
                  : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-[12px] leading-relaxed text-ink/90">
                {installateur}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function buildTaskRows(
  acties: BackofficeActie[],
  facturen: Factuur[]
): TaskRow[] {
  const rows: TaskRow[] = [];
  for (const actie of acties) {
    if (actie.soort === "herplan_afspraak") {
      const metaParts: string[] = [];
      if (actie.annuleringsReden?.trim()) {
        metaParts.push(actie.annuleringsReden.trim());
      }
      if (actie.geannuleerdDoorNaam?.trim()) {
        metaParts.push(
          actie.herplanBron === "adviseur"
            ? `door ${actie.geannuleerdDoorNaam.trim()}`
            : `adviseur ${actie.geannuleerdDoorNaam.trim()}`
        );
      }
      rows.push({
        key: `${actie.id}-herplan`,
        section: "herplan",
        actie,
        kind: "herplan",
        titel: actie.titel,
        klant: actie.leadNaam,
        meta: metaParts.length > 0 ? metaParts.join(" · ") : undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        prio: actie.vastgelopen || actie.prio || actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "schouw_inplannen") {
      rows.push({
        key: `${actie.id}-schouw`,
        section: "schouw",
        actie,
        kind: "schouw_inplannen",
        titel: actie.titel,
        klant: actie.leadNaam,
        meta: actie.projectNummer || actie.schouwWeekLabel || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        prio: actie.vastgelopen || actie.prio || actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "volgende_stap") {
      rows.push({
        key: `${actie.id}-volgende`,
        section: "volgende",
        actie,
        kind: "volgende_stap",
        titel: actie.titel,
        klant: actie.leadNaam,
        meta: actie.projectNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        prio: actie.vastgelopen || actie.prio || actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "bestel_materiaal") {
      rows.push({
        key: `${actie.id}-inkoop`,
        section: "inkoop",
        actie,
        kind: "bestel_materiaal",
        titel: actie.titel,
        klant: actie.leadNaam,
        meta: actie.projectNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        prio: actie.vastgelopen || actie.prio || actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "aangetekende_brief") {
      rows.push({
        key: `${actie.id}-brief`,
        section: "aangetekend",
        actie,
        kind: "aangetekende_brief",
        titel: "Annuleringskosten of installatie doorzetten",
        klant: actie.leadNaam,
        meta: actie.offerteNummer || actie.projectNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "annulering_keuze_controle") {
      rows.push({
        key: `${actie.id}-keuze`,
        section: "aangetekend",
        actie,
        kind: "annulering_keuze_controle",
        titel: actie.titel,
        klant: actie.leadNaam,
        meta: actie.offerteNummer || actie.projectNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        prio: actie.prio || actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "schakel_financiering") {
      rows.push({
        key: `${actie.id}-fin`,
        section: "warmtefonds",
        actie,
        kind: "financiering",
        titel: "Schakelen met financieringsman",
        klant: actie.leadNaam,
        meta: actie.offerteNummer || actie.projectNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "wacht_warmtefonds") {
      const fase = warmtefondsWachtFaseVanActie(actie);
      rows.push({
        key: `${actie.id}-wf-wacht`,
        section:
          fase === "goedkeuring" ? "wf_goedkeuring" : "wf_afspraak",
        actie,
        kind: "wacht_warmtefonds",
        titel: actie.titel,
        klant: actie.leadNaam,
        meta: actie.projectNummer || actie.offerteNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "nabellen_factuur") {
      rows.push({
        key: `${actie.id}-nabellen`,
        section: "factuur",
        actie,
        kind: "nabellen",
        titel: actie.titel || `Factuur opvolgen ${actie.factuurNummer || ""}`,
        klant: actie.leadNaam,
        meta: actie.factuurNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "wf_aanbetaling_herinnering") {
      rows.push({
        key: `${actie.id}-wf-herinnering`,
        section: "factuur",
        actie,
        kind: "wf_aanbetaling_herinnering",
        titel:
          actie.titel ||
          `Herinneringsmail aanbetaling ${actie.factuurNummer || ""}`,
        klant: actie.leadNaam,
        meta: actie.factuurNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        prio: actie.prio,
        done: false,
      });
      continue;
    }
    if (actie.soort === "bel_schouw_aanbetaling") {
      const project = actie.project;
      if (!project) continue;
      const related = facturen.filter(
        (f) =>
          f.project_id === project.id ||
          (!f.project_id && f.lead_id === actie.leadId) ||
          (actie.offerteId != null && f.offerte_id === actie.offerteId)
      );
      const items = projectKickoffItems(project, related);
      for (const item of items) {
        if (item.done) continue;
        if (item.id === "aanbetaling") {
          rows.push({
            key: `${actie.id}-factuur`,
            section: "stap1",
            actie,
            kind: "factuur_versturen",
            titel: "Aanbetalingsfactuur versturen",
            klant: actie.leadNaam,
            meta: actie.projectNummer || undefined,
            dueAt: actie.deadlineAt,
            overdue: actie.overdue,
            prio: actie.prio || actie.overdue,
            done: false,
          });
        } else if (item.id === "wf_afspraak") {
          rows.push({
            key: `${actie.id}-edwin`,
            section: "stap1",
            actie,
            kind: "edwin_doorsturen",
            titel: "Gegevens doorsturen naar Edwin",
            klant: actie.leadNaam,
            meta: actie.projectNummer || undefined,
            dueAt: actie.deadlineAt,
            overdue: actie.overdue,
            prio: actie.prio || actie.overdue,
            done: false,
          });
        } else if (item.id === "schouwweek") {
          // Eigen middelen: schouwdag pas ná 50% betaling; WF: schouwweek
          if (item.blocked) continue;
          const em =
            actie.project != null && !isWarmtefondsProject(actie.project);
          rows.push({
            key: `${actie.id}-schouwweek`,
            section: "stap1",
            actie: {
              ...actie,
              planSchouwweek: !em,
              planSchouwdag: em,
            },
            kind: em ? "schouw_inplannen" : "schouw_week",
            titel: em ? "Schouwdag inplannen" : "Schouwweek inplannen",
            klant: actie.leadNaam,
            meta: actie.projectNummer || undefined,
            dueAt: actie.deadlineAt,
            overdue: actie.overdue,
            prio: actie.prio || actie.overdue,
            done: false,
          });
        }
      }
    }
  }
  return rows;
}

export function BackofficeActiesList({
  projecten,
  facturen = [],
  leads = [],
  afspraken = [],
  adviseurs = [],
  adviseurId = null,
  onProjectUpdated,
  onFactuurUpdated,
  onLeadUpdated,
}: {
  projecten: Project[];
  facturen?: Factuur[];
  leads?: Lead[];
  afspraken?: Afspraak[];
  adviseurs?: Adviseur[];
  /** Ingelogde medewerker (voor actie-voltooiingslog). */
  adviseurId?: string | null;
  onProjectUpdated?: (project: Project) => void;
  onFactuurUpdated?: (factuur: Factuur) => void;
  onLeadUpdated?: (id: string, patch: Partial<Lead>) => void;
}) {
  const acties = useMemo(
    () =>
      actiesVoorActiesTab(
        openBackofficeActies(projecten, facturen, new Date(), {
          leads,
          afspraken,
          adviseurs,
        })
      ),
    [projecten, facturen, leads, afspraken, adviseurs]
  );
  const rows = useMemo(
    () => buildTaskRows(acties, facturen),
    [acties, facturen]
  );
  const weekOptions = useMemo(() => upcomingSchouwWeekOptions(40), []);
  const defaultEigenaarId = useMemo(
    () => findDefaultBackofficeMedewerkerId(adviseurs),
    [adviseurs]
  );
  const medewerkers = useMemo(() => {
    const bo = adviseurs.filter((a) => {
      if (a.actief === false || isAdminAdviseur(a)) return false;
      const rol = normalizeRol(a.rol);
      return (
        rol === "backoffice" ||
        rol === "admin" ||
        a.id === adviseurId ||
        a.id === defaultEigenaarId
      );
    });
    // Fallback: als niemand als backoffice gemarkeerd is, toon actieve medewerkers
    const list =
      bo.length > 0
        ? bo
        : adviseurs.filter((a) => a.actief !== false && !isAdminAdviseur(a));
    return [...list].sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  }, [adviseurs, adviseurId, defaultEigenaarId]);
  const projectOpties = useMemo(
    () =>
      [...projecten].sort((a, b) =>
        (a.project_nummer || "").localeCompare(b.project_nummer || "", "nl")
      ),
    [projecten]
  );

  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  /** Open project-taken (handmatig + auto) */
  const [projectTaken, setProjectTaken] = useState<ProjectTaak[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [factuurKeuze, setFactuurKeuze] = useState<Record<string, string>>({});
  /** Aangegeven betaaldatum per nabellen-actie (yyyy-MM-dd). */
  const [aangegevenBetaaldatum, setAangegevenBetaaldatum] = useState<
    Record<string, string>
  >({});
  const [weekKeuze, setWeekKeuze] = useState<Record<string, string>>({});
  const [installatieAtKeuze, setInstallatieAtKeuze] = useState<
    Record<string, string>
  >({});
  const [schouwAtKeuze, setSchouwAtKeuze] = useState<Record<string, string>>(
    {}
  );
  const [partnerKeuze, setPartnerKeuze] = useState<Record<string, string>>({});
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [bucket, setBucket] = useState<ActieBucket>("vandaag");
  const [soortFilter, setSoortFilter] = useState<SoortFilter>("alle");
  const [zoek, setZoek] = useState("");
  /**
   * Filter medewerker. Leeg = alle acties.
   * Admin start op “Alle”; pure backoffice op “Mijn acties”.
   * Opgeslagen keuze wint van de rol-default.
   */
  const [medewerkerId, setMedewerkerId] = useState("");
  const [filtersHydrated, setFiltersHydrated] = useState(false);
  const hadStoredMedewerkerFilter = useRef(false);
  /** Focusmodus: één taak tegelijk voor de gekozen dag. */
  const [actionView, setActionView] = useState(true);
  const [focusDayKey, setFocusDayKey] = useState(() =>
    ymdAmsterdam(new Date())
  );
  const [notesOpen, setNotesOpen] = useState(false);
  const [showWachtExtern, setShowWachtExtern] = useState(false);
  /** Vervolg: algemeen (dag) of specifiek (datum+tijd+notitie). */
  const [opvolgMode, setOpvolgMode] = useState<OpvolgMode>("algemeen");
  const [opvolgDate, setOpvolgDate] = useState(
    () => defaultOpvolgDateTime().date
  );
  const [opvolgTime, setOpvolgTime] = useState(
    () => defaultOpvolgDateTime().time
  );
  const [opvolgNote, setOpvolgNote] = useState("");
  /** Terugbel-zoek in focusmodus (tel / postcode). */
  const [focusJumpQ, setFocusJumpQ] = useState("");
  /** Actie geopend via zoeken — mag buiten de dag-filter. */
  const [jumpPinnedKey, setJumpPinnedKey] = useState<string | null>(null);
  /** Welke gekoppelde gesprek-stappen openstaan in de zijkant. */
  const [gesprekOpen, setGesprekOpen] = useState<Record<string, boolean>>({});
  const [edwinGestuurd, setEdwinGestuurd] = useState(false);
  /** Laatste bel-moment in deze sessie (Action view). */
  const [laatsteContactAt, setLaatsteContactAt] = useState<string | null>(null);
  const [herplanActie, setHerplanActie] = useState<BackofficeActie | null>(
    null
  );
  const [inkoopActie, setInkoopActie] = useState<BackofficeActie | null>(null);
  const [overstapMail, setOverstapMail] = useState<{
    projectId: string;
    taakId: string;
    klantNaam: string;
    projectNummer: string | null;
  } | null>(null);
  /** Mail «Annulering of installatie» vanuit bedenktijd-actie. */
  const [contactMailProject, setContactMailProject] = useState<Project | null>(
    null
  );

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTitel, setNewTitel] = useState("");
  const [newOmschrijving, setNewOmschrijving] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [newPersonId, setNewPersonId] = useState(
    () => adviseurId || defaultEigenaarId || ""
  );
  const [newDue, setNewDue] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return d.toISOString().slice(0, 10);
  });
  const [newAfdeling, setNewAfdeling] = useState<string>("Backoffice");

  // Filters uit localStorage (blijven staan bij terugkomen van project)
  useEffect(() => {
    const s = readActiesFilters();
    if (
      s.bucket &&
      ACTIE_BUCKETS.some((b) => b.id === s.bucket)
    ) {
      setBucket(s.bucket);
    }
    if (s.soortFilter && SOORT_FILTER_ORDER.includes(s.soortFilter)) {
      setSoortFilter(s.soortFilter);
    }
    if (typeof s.zoek === "string") setZoek(s.zoek);
    if (typeof s.medewerkerId === "string") {
      hadStoredMedewerkerFilter.current = true;
      setMedewerkerId(s.medewerkerId);
    }
    if (
      typeof s.focusDayKey === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(s.focusDayKey)
    ) {
      setFocusDayKey(s.focusDayKey);
    }
    setFiltersHydrated(true);
  }, []);

  // Session/adviseurs laden asynchroon → default filter één keer zetten
  // (overslaan als gebruiker al een opgeslagen medewerker-filter heeft)
  const filterDefaultGezet = useRef(false);
  useEffect(() => {
    if (!filtersHydrated) return;
    if (hadStoredMedewerkerFilter.current) {
      filterDefaultGezet.current = true;
      return;
    }
    if (filterDefaultGezet.current || !adviseurId) return;
    if (adviseurs.length === 0) return;
    const me = adviseurs.find((a) => a.id === adviseurId);
    const rol = me ? normalizeRol(me.rol) : null;
    // Backoffice start op eigen lijst; admin/overig ziet alles (anders lijkt Acties “leeg”)
    if (rol === "backoffice") {
      setMedewerkerId(adviseurId);
    } else {
      setMedewerkerId("");
    }
    filterDefaultGezet.current = true;
  }, [filtersHydrated, adviseurId, adviseurs]);

  useEffect(() => {
    if (!filtersHydrated) return;
    writeActiesFilters({
      medewerkerId,
      bucket,
      soortFilter,
      zoek,
      focusDayKey,
    });
  }, [filtersHydrated, medewerkerId, bucket, soortFilter, zoek, focusDayKey]);
  useEffect(() => {
    if (!newPersonId && (adviseurId || defaultEigenaarId)) {
      setNewPersonId(adviseurId || defaultEigenaarId || "");
    }
  }, [adviseurId, defaultEigenaarId, newPersonId]);

  async function loadProjectTaken() {
    try {
      // Eerst verouderde auto-taken automatisch afsluiten bij huidige status
      await fetch("/api/taken/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      }).catch(() => null);

      const res = await fetch("/api/taken?open=1");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProjectTaken([]);
        return;
      }
      setProjectTaken((data.taken as ProjectTaak[]) || []);
    } catch {
      setProjectTaken([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/installatie-partners");
        const data = await res.json().catch(() => ({}));
        if (!cancelled) setPartners(data.partners || []);
      } catch {
        if (!cancelled) setPartners([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void loadProjectTaken());
    return () => cancelAnimationFrame(frame);
  }, []);

  const defaultPartnerId = partners.length === 1 ? partners[0].id : "";

  const opvolgRows = useMemo(
    () =>
      projectTaken
        .filter(isActiesOpvolgTaak)
        .map((t) => opvolgTaakToRow(t, projecten)),
    [projectTaken, projecten]
  );

  const openRows = useMemo(
    () => [...rows.filter((r) => !r.done), ...opvolgRows],
    [rows, opvolgRows]
  );

  const nazorgTaken = useMemo(
    () =>
      projectTaken.filter((t) => {
        if (t.status === "done") return false;
        // Geannuleerde orders: geen workflow/nazorg-taken meer in Acties
        const projectStatus = (
          t.projecten?.status ||
          (t.project_id
            ? projecten.find((p) => p.id === t.project_id)?.status
            : null) ||
          ""
        ).toLowerCase();
        if (
          projectStatus === "annulering" ||
          projectStatus === "geannuleerd" ||
          projectStatus === "hold_sales_actie" ||
          projectStatus === "hold_sales"
        ) {
          return false;
        }
        const key = (t.auto_key || "").toLowerCase();
        const titel = (t.titel || "").toLowerCase();
        // Referrals = sales (Verkoop), niet in backoffice-Acties.
        if (key.includes("referral") || titel.includes("vraag referrals")) {
          return false;
        }
        return (
          key.includes("overstap") ||
          key.includes("btw_terug") ||
          key.includes("review_vragen") ||
          titel.includes("overstap") ||
          titel.includes("btw terug") ||
          titel.includes("dynamische") ||
          titel.includes("review vragen")
        );
      }),
    [projectTaken, projecten]
  );

  const bucketCounts = useMemo(() => {
    const counts: Record<ActieBucket, number> = {
      vandaag: 0,
      te_laat: 0,
      gepland: 0,
      wacht_extern: 0,
    };
    for (const r of openRows) {
      if (medewerkerId) {
        const eigenaar = eigenaarVoorActie(
          r.actie,
          projecten,
          adviseurs,
          defaultEigenaarId
        );
        if (eigenaar.id !== medewerkerId) continue;
      }
      counts[bucketVoorActie(r.actie)] += 1;
    }
    // Nazorg-taken: deadline → bucket
    for (const t of nazorgTaken) {
      if (medewerkerId) {
        const taakEigenaar = t.verantwoordelijke_id || null;
        const project = t.project_id
          ? projecten.find((p) => p.id === t.project_id)
          : undefined;
        const projectEigenaar = project?.verantwoordelijke_id || null;
        const eigenaarId =
          taakEigenaar || projectEigenaar || defaultEigenaarId || null;
        if (eigenaarId !== medewerkerId) continue;
      }
      const due = t.due_at || new Date().toISOString();
      const overdue =
        Boolean(t.due_at) && new Date(t.due_at!).getTime() < Date.now();
      const fake: BackofficeActie = {
        id: t.id,
        soort: "volgende_stap",
        titel: t.titel,
        detail: "",
        deadlineAt: due,
        overdue,
        vastgelopen: overdue && calendarDaysUntil(due) <= -2,
        leadId: t.projecten?.lead_id || "",
        leadNaam: t.projecten?.leads?.naam || "—",
        href: t.project_id ? `/projecten/${t.project_id}` : "#",
      };
      counts[bucketVoorActie(fake)] += 1;
    }
    return counts;
  }, [
    openRows,
    nazorgTaken,
    medewerkerId,
    projecten,
    adviseurs,
    defaultEigenaarId,
  ]);

  const visibleRows = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    const filtered = openRows.filter((r) => {
      if (actionView) {
        if (!actieMatchesFocusDay(r.actie, focusDayKey)) return false;
        if (
          !showWachtExtern &&
          isBackofficeActieWachtExtern(r.actie) &&
          !r.actie.overdue &&
          !r.actie.vastgelopen
        ) {
          return false;
        }
        // Focusmodus: alle soorten van die dag (geen soort-filter)
      } else if (bucketVoorActie(r.actie) !== bucket) {
        return false;
      }
      if (!actionView) {
        if (soortFilter === "nazorg") return false;
        if (soortFilter !== "alle" && r.section !== soortFilter) return false;
      }
      if (medewerkerId) {
        if (r.kind === "terugbel") {
          const taak = projectTaken.find((t) => t.id === r.actie.id);
          const owner =
            taak?.verantwoordelijke_id ||
            eigenaarVoorActie(
              r.actie,
              projecten,
              adviseurs,
              defaultEigenaarId
            ).id;
          if (owner !== medewerkerId) return false;
        } else {
          const eigenaar = eigenaarVoorActie(
            r.actie,
            projecten,
            adviseurs,
            defaultEigenaarId
          );
          if (eigenaar.id !== medewerkerId) return false;
        }
      }
      if (!q) return true;
      const hay = [
        r.titel,
        r.klant,
        r.meta,
        r.actie.detail,
        r.actie.projectNummer,
        r.actie.offerteNummer,
        r.actie.plaats,
        SECTION_META[r.section]?.label,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    return [...filtered].sort(compareActieRows);
  }, [
    openRows,
    actionView,
    focusDayKey,
    showWachtExtern,
    bucket,
    soortFilter,
    zoek,
    medewerkerId,
    projecten,
    adviseurs,
    defaultEigenaarId,
    projectTaken,
  ]);

  const visibleNazorgTaken = useMemo(() => {
    if (soortFilter !== "alle" && soortFilter !== "nazorg") return [];
    if (
      bucket !== "te_laat" &&
      bucket !== "vandaag" &&
      bucket !== "gepland"
    ) {
      return [];
    }
    const q = zoek.trim().toLowerCase();
    const filtered = nazorgTaken.filter((t) => {
      const due = t.due_at || new Date().toISOString();
      const overdue =
        Boolean(t.due_at) && new Date(t.due_at!).getTime() < Date.now();
      const fake: BackofficeActie = {
        id: t.id,
        soort: "volgende_stap",
        titel: t.titel,
        detail: "",
        deadlineAt: due,
        overdue,
        vastgelopen: overdue && calendarDaysUntil(due) <= -2,
        leadId: t.projecten?.lead_id || "",
        leadNaam: "",
        href: "#",
      };
      if (bucketVoorActie(fake) !== bucket) return false;
      if (medewerkerId) {
        const taakEigenaar = t.verantwoordelijke_id || null;
        const project = t.project_id
          ? projecten.find((p) => p.id === t.project_id)
          : undefined;
        const projectEigenaar = project?.verantwoordelijke_id || null;
        const eigenaarId =
          taakEigenaar || projectEigenaar || defaultEigenaarId || null;
        if (eigenaarId !== medewerkerId) return false;
      }
      if (!q) return true;
      const hay = [t.titel, t.projecten?.project_nummer, t.projecten?.leads?.naam]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    return [...filtered].sort((a, b) => {
      const da = a.due_at ? new Date(a.due_at).getTime() : 0;
      const db = b.due_at ? new Date(b.due_at).getTime() : 0;
      return da - db;
    });
  }, [
    nazorgTaken,
    bucket,
    soortFilter,
    zoek,
    medewerkerId,
    projecten,
    defaultEigenaarId,
  ]);

  /** Counts per soort binnen huidige bucket (+ medewerker), voor filterchips. */
  const soortCounts = useMemo(() => {
    const counts: Partial<Record<SoortFilter, number>> = { alle: 0 };
    for (const r of openRows) {
      if (bucketVoorActie(r.actie) !== bucket) continue;
      if (medewerkerId) {
        const eigenaar = eigenaarVoorActie(
          r.actie,
          projecten,
          adviseurs,
          defaultEigenaarId
        );
        if (eigenaar.id !== medewerkerId) continue;
      }
      counts.alle = (counts.alle || 0) + 1;
      counts[r.section] = (counts[r.section] || 0) + 1;
    }
    // Nazorg in dezelfde bucket
    if (bucket === "vandaag" || bucket === "te_laat" || bucket === "gepland") {
      let n = 0;
      for (const t of nazorgTaken) {
        const due = t.due_at || new Date().toISOString();
        const overdue =
          Boolean(t.due_at) && new Date(t.due_at!).getTime() < Date.now();
        const fake: BackofficeActie = {
          id: t.id,
          soort: "volgende_stap",
          titel: t.titel,
          detail: "",
          deadlineAt: due,
          overdue,
          vastgelopen: overdue && calendarDaysUntil(due) <= -2,
          leadId: "",
          leadNaam: "",
          href: "#",
        };
        if (bucketVoorActie(fake) !== bucket) continue;
        if (medewerkerId) {
          const taakEigenaar = t.verantwoordelijke_id || null;
          const project = t.project_id
            ? projecten.find((p) => p.id === t.project_id)
            : undefined;
          const eigenaarId =
            taakEigenaar ||
            project?.verantwoordelijke_id ||
            defaultEigenaarId ||
            null;
          if (eigenaarId !== medewerkerId) continue;
        }
        n += 1;
      }
      if (n > 0) {
        counts.nazorg = n;
        counts.alle = (counts.alle || 0) + n;
      }
    }
    return counts;
  }, [
    openRows,
    nazorgTaken,
    bucket,
    medewerkerId,
    projecten,
    adviseurs,
    defaultEigenaarId,
  ]);

  // Spring naar eerste niet-lege bucket als huidige leeg is
  useEffect(() => {
    if (bucketCounts[bucket] > 0) return;
    const first = ACTIE_BUCKETS.find((b) => bucketCounts[b.id] > 0);
    if (first) setBucket(first.id);
  }, [bucketCounts, bucket]);

  // Soort-filter resetten als die in deze bucket leeg is
  useEffect(() => {
    if (soortFilter === "alle") return;
    if ((soortCounts[soortFilter] || 0) > 0) return;
    setSoortFilter("alle");
  }, [soortCounts, soortFilter]);

  const focusJumpHits = useMemo(() => {
    const q = focusJumpQ.trim();
    if (!actionView || q.length < 2) return [] as TaskRow[];
    return openRows
      .filter((r) => actieMatchesJumpQuery(r, q, leads))
      .sort(compareActieRows)
      .slice(0, 12);
  }, [actionView, focusJumpQ, openRows, leads]);

  const selectedRow = useMemo(() => {
    if (jumpPinnedKey) {
      const pinned =
        openRows.find((r) => r.key === jumpPinnedKey) || null;
      if (pinned) return pinned;
    }
    return visibleRows.find((r) => r.key === selectedKey) || null;
  }, [visibleRows, selectedKey, jumpPinnedKey, openRows]);

  const selectedProjectFacturen = useMemo(() => {
    const pid = selectedRow?.actie.projectId;
    if (!pid) return [] as Factuur[];
    return facturen.filter(
      (f) =>
        f.project_id === pid || f.offerte_id === selectedRow?.actie.offerteId
    );
  }, [facturen, selectedRow]);

  // Focusmodus: altijd een geldige actie voor de gekozen dag selecteren
  useEffect(() => {
    if (!actionView) return;
    if (jumpPinnedKey) {
      if (!openRows.some((r) => r.key === jumpPinnedKey)) {
        setJumpPinnedKey(null);
      } else {
        setSelectedKey(jumpPinnedKey);
        setNotesOpen(false);
        return;
      }
    }
    setSelectedKey((prev) => {
      if (visibleRows.length === 0) return null;
      if (prev && visibleRows.some((r) => r.key === prev)) return prev;
      return visibleRows[0]!.key;
    });
    setNotesOpen(false);
  }, [actionView, focusDayKey, visibleRows, jumpPinnedKey, openRows]);

  // Bij selectie: focus op gekozen actiesoort
  useEffect(() => {
    const row =
      (jumpPinnedKey
        ? openRows.find((r) => r.key === jumpPinnedKey)
        : null) ||
      visibleRows.find((r) => r.key === selectedKey) ||
      null;
    if (!row) {
      setGesprekOpen({});
      setEdwinGestuurd(false);
      setLaatsteContactAt(null);
      resetOpvolgDefaults();
      return;
    }
    setGesprekOpen({ [row.kind]: true });
    setEdwinGestuurd(false);
    setLaatsteContactAt(null);
    resetOpvolgDefaults();
    // Alleen bij wissel van geselecteerde rij
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, jumpPinnedKey]);

  const geenEigenaarCount = useMemo(
    () =>
      openRows.filter((r) => {
        // Expliciet geen verantwoordelijke op project (vóór Tarik-fallback)
        const e = eigenaarVoorActie(r.actie, projecten, adviseurs);
        return !e.id;
      }).length,
    [openRows, projecten, adviseurs]
  );

  async function createHandmatigeActie() {
    if (!newTitel.trim()) {
      setError("Vul een omschrijving in.");
      return;
    }
    if (!newProjectId) {
      setError("Kies een project.");
      return;
    }
    if (!newPersonId) {
      setError("Kies een medewerker.");
      return;
    }
    if (!newDue) {
      setError("Vul een deadline in.");
      return;
    }
    setCreating(true);
    setError(null);
    setMsg(null);
    try {
      const due = new Date(`${newDue}T17:00:00`);
      const res = await fetch("/api/taken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: newProjectId,
          titel: newTitel.trim(),
          afdeling: newAfdeling || "Backoffice",
          verantwoordelijke_id: newPersonId,
          due_at: due.toISOString(),
          notities: newOmschrijving.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Actie aanmaken mislukt"
        );
      }
      const taak = data.taak as ProjectTaak;
      setProjectTaken((prev) => [taak, ...prev]);
      setShowCreate(false);
      setNewTitel("");
      setNewOmschrijving("");
      setNewProjectId("");
      setNewPersonId(adviseurId || "");
      setMsg("Actie aangemaakt.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Actie aanmaken mislukt");
    } finally {
      setCreating(false);
    }
  }

  async function voltooiHandmatigeTaak(taak: ProjectTaak) {
    setBusyId(taak.id);
    setError(null);
    try {
      // Review vragen afronden → zelfde als Review-checkbox (mail + status)
      const isReviewVragen = (taak.auto_key || "")
        .toLowerCase()
        .includes("review_vragen");
      if (isReviewVragen && taak.project_id) {
        const revRes = await fetch(`/api/projecten/${taak.project_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            review_gevraagd_at: new Date().toISOString(),
            status: "afgerond",
          }),
        });
        if (!revRes.ok) {
          const revData = await revRes.json().catch(() => ({}));
          throw new Error(
            (revData as { error?: string }).error ||
              "Review markeren mislukt"
          );
        }
      }
      const res = await fetch(`/api/taken/${taak.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Voltooien mislukt"
        );
      }
      setProjectTaken((prev) => prev.filter((t) => t.id !== taak.id));
      const mail = (data as { mail?: { ok?: boolean; skipped?: boolean } })
        .mail;
      if (taak.aangemaakt_door_id && mail?.ok) {
        setMsg("Taak afgerond · adviseur gemaild.");
      } else if (taak.aangemaakt_door_id && mail && !mail.ok && !mail.skipped) {
        setMsg("Taak afgerond · mail naar adviseur mislukt.");
      } else {
        setMsg(taak.auto_key ? "Auto-taak afgerond." : "Taak afgerond.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voltooien mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function verwijderProjectTaak(taak: ProjectTaak) {
    if (
      !confirm(
        taak.auto_key
          ? "Deze auto-taak verwijderen uit de lijst? (wordt afgerond)"
          : "Deze taak definitief verwijderen?"
      )
    ) {
      return;
    }
    setBusyId(`del-${taak.id}`);
    setError(null);
    try {
      if (taak.auto_key) {
        // Hard delete zou bij sync opnieuw aangemaakt worden
        const res = await fetch(`/api/taken/${taak.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Verwijderen mislukt"
          );
        }
      } else {
        const res = await fetch(`/api/taken/${taak.id}`, { method: "DELETE" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Verwijderen mislukt"
          );
        }
      }
      setProjectTaken((prev) => prev.filter((t) => t.id !== taak.id));
      setMsg("Taak verwijderd.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setBusyId(null);
    }
  }

  /** Actie uit de Acties-lijst halen (zonder het onderliggende werk te forceren). */
  async function verwijderActie(actie: BackofficeActie) {
    if (
      !confirm(
        "Deze actie uit de lijst verwijderen? Je kunt hem later opnieuw zien als de status dat weer vraagt."
      )
    ) {
      return;
    }
    const completedAt = new Date().toISOString();
    if (actie.soort === "aangetekende_brief") {
      const project = await patchProject(actie, {
        aangetekende_brief_verstuurd_at: completedAt,
      });
      if (project) {
        void logBackofficeActieEvent({
          soort: "aangetekende_brief",
          leadId: actie.leadId,
          projectId: actie.projectId,
          adviseurId,
          deadlineAt: actie.deadlineAt,
          completedAt,
        });
        setMsg("Actie verwijderd.");
      }
      return;
    }
    if (actie.soort === "annulering_keuze_controle") {
      const project = await patchProject(actie, {
        annulering_keuze_gecontroleerd_at: completedAt,
      });
      if (project) {
        void logBackofficeActieEvent({
          soort: "annulering_keuze_controle",
          leadId: actie.leadId,
          projectId: actie.projectId,
          adviseurId,
          deadlineAt: actie.deadlineAt,
          completedAt,
        });
        setMsg("Actie verwijderd.");
      }
      return;
    }
    if (actie.soort === "schakel_financiering") {
      const project = await patchProject(actie, {
        financiering_geschakeld_at: completedAt,
      });
      if (project) {
        void logBackofficeActieEvent({
          soort: "schakel_financiering",
          leadId: actie.leadId,
          projectId: actie.projectId,
          adviseurId,
          deadlineAt: actie.deadlineAt,
          completedAt,
        });
        setMsg("Actie verwijderd.");
      }
      return;
    }
    if (actie.soort === "bel_schouw_aanbetaling") {
      const proj = actie.project;
      const project = await patchProject(actie, {
        bel_schouw_aanbetaling_at: completedAt,
        ...(proj && isWarmtefondsProject(proj)
          ? { status: "opstarten_voltooid_afwachten_wf" as const }
          : {}),
      });
      if (project) {
        void logBackofficeActieEvent({
          soort: "bel_schouw_aanbetaling",
          leadId: actie.leadId,
          projectId: actie.projectId,
          adviseurId,
          deadlineAt: actie.deadlineAt,
          completedAt,
        });
        setMsg("Actie verwijderd.");
      }
      return;
    }
    if (actie.soort === "herplan_afspraak") {
      await voltooiHerplan(actie);
      setMsg("Actie verwijderd.");
      return;
    }
    if (
      actie.soort === "nabellen_factuur" ||
      actie.soort === "wf_aanbetaling_herinnering"
    ) {
      setError(
        "Factuur-acties verdwijnen als de aanbetaling betaald is, of als Warmtefonds is aangevraagd."
      );
      return;
    }
    setError(
      "Deze actie verdwijnt automatisch als de volgende stap op het project is gezet."
    );
  }

  async function voltooiHerplan(actie: BackofficeActie) {
    const lead = leads.find((l) => l.id === actie.leadId);
    const completedAt = new Date().toISOString();
    const notities = appendLeadNotitie(
      lead?.notities,
      "Herplan-actie voltooid."
    );
    const patch: Partial<Lead> = {
      status: "nieuw",
      notities,
    };
    setBusyId(actie.id);
    setError(null);
    try {
      const sb = getSupabaseBrowser();
      const { error: err } = await sb
        .from("leads")
        .update(patch)
        .eq("id", actie.leadId);
      if (err) throw err;
      onLeadUpdated?.(actie.leadId, patch);
      void logBackofficeActieEvent({
        soort: "herplan_afspraak",
        leadId: actie.leadId,
        adviseurId,
        deadlineAt: actie.deadlineAt,
        completedAt,
      });
      void fetch(`/api/leads/${actie.leadId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "status",
          titel: `Status → ${leadStatusLabel.nieuw}`,
          detail: "Herplan-actie voltooid vanuit backoffice-acties",
        }),
      }).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voltooien mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function definitiefAnnuleren(actie: BackofficeActie) {
    if (
      !window.confirm(
        `${actie.leadNaam}: afspraak definitief annuleren?\n\nDe lead wordt gemarkeerd als geen interesse (geen nieuwe afspraak).`
      )
    ) {
      return;
    }
    const lead = leads.find((l) => l.id === actie.leadId);
    const notities = appendLeadNotitie(
      lead?.notities,
      "Afspraak definitief geannuleerd: klant wil geen nieuwe afspraak."
    );
    const patch: Partial<Lead> = {
      status: "geen_interesse",
      notities,
    };
    setBusyId(actie.id);
    setError(null);
    try {
      const sb = getSupabaseBrowser();
      const { error: err } = await sb
        .from("leads")
        .update(patch)
        .eq("id", actie.leadId);
      if (err) throw err;
      onLeadUpdated?.(actie.leadId, patch);
      void fetch(`/api/leads/${actie.leadId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "status",
          titel: `Status → ${leadStatusLabel.geen_interesse}`,
          detail: "Afspraak definitief geannuleerd vanuit backoffice-acties",
        }),
      }).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Annuleren mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function patchProject(
    actie: BackofficeActie,
    body: Record<string, string | number | null>
  ) {
    if (!actie.projectId) return null;
    setBusyId(actie.id);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${actie.projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const project = data.project as Project;
      onProjectUpdated?.(project);
      void loadProjectTaken();
      return project;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function updateFinancieringStatusFromActie(
    actie: BackofficeActie,
    status: FinancieringStatus | null,
    extra?: { warmtefonds_afspraak_at?: string | null }
  ) {
    if (!actie.projectId) return;
    setBusyId(`${actie.id}-wf`);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/projecten/${actie.projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financiering_status: status,
          ...(extra?.warmtefonds_afspraak_at !== undefined
            ? { warmtefonds_afspraak_at: extra.warmtefonds_afspraak_at }
            : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Financieringsfase bijwerken mislukt"
        );
      }
      const project = (data as { project?: Project }).project;
      if (project) onProjectUpdated?.(project);
      void loadProjectTaken();
      if (
        status === "aanvraag_goedgekeurd" ||
        status === "aanbod_ondertekenen"
      ) {
        setMsg(
          "Warmtefonds goedgekeurd — actie verdwijnt; daarna schouw plannen."
        );
      } else {
        setMsg("Warmtefonds-status bijgewerkt.");
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Financieringsfase bijwerken mislukt"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function maybeCompleteStap1(
    actie: BackofficeActie,
    opts: {
      factuurDone?: boolean;
      schouwDone?: boolean;
      edwinDone?: boolean;
      project?: Project;
    }
  ) {
    const project = opts.project || actie.project;
    if (!project || !actie.projectId) return;
    const related = facturen.filter(
      (f) =>
        f.project_id === project.id ||
        (!f.project_id && f.lead_id === actie.leadId) ||
        (actie.offerteId != null && f.offerte_id === actie.offerteId)
    );
    // Override flags voor net afgeronde stap (project state kan nog stale zijn)
    const items = projectKickoffItems(project, related).map((item) => {
      if (item.id === "aanbetaling" && opts.factuurDone) {
        return { ...item, done: true };
      }
      if (item.id === "schouwweek" && opts.schouwDone) {
        return { ...item, done: true };
      }
      if (item.id === "wf_afspraak" && opts.edwinDone) {
        return { ...item, done: true };
      }
      return item;
    });
    if (!items.every((i) => i.done)) return;
    const completedAt = new Date().toISOString();
    await patchProject(actie, {
      bel_schouw_aanbetaling_at: completedAt,
      ...(isWarmtefondsProject(project)
        ? { status: "opstarten_voltooid_afwachten_wf" as const }
        : {}),
    });
    void logBackofficeActieEvent({
      soort: "bel_schouw_aanbetaling",
      leadId: actie.leadId,
      projectId: actie.projectId,
      adviseurId,
      deadlineAt: actie.deadlineAt,
      completedAt,
    });
  }

  async function markFinancieringGeschakeld(actie: BackofficeActie) {
    const completedAt = new Date().toISOString();
    const project = await patchProject(actie, {
      financiering_geschakeld_at: completedAt,
    });
    if (project) {
      void logBackofficeActieEvent({
        soort: "schakel_financiering",
        leadId: actie.leadId,
        projectId: actie.projectId,
        adviseurId,
        deadlineAt: actie.deadlineAt,
        completedAt,
      });
    }
  }

  async function markAangetekendeBriefAfgerond(actie: BackofficeActie) {
    if (
      !confirm(
        "Keuze-mail markeren als verstuurd? Op dag 6 verschijnt de controle-actie (annuleringsfactuur indien geen reactie)."
      )
    ) {
      return;
    }
    const completedAt = new Date().toISOString();
    const project = await patchProject(actie, {
      aangetekende_brief_verstuurd_at: completedAt,
    });
    if (project) {
      void logBackofficeActieEvent({
        soort: "aangetekende_brief",
        leadId: actie.leadId,
        projectId: actie.projectId,
        adviseurId,
        deadlineAt: actie.deadlineAt,
        completedAt,
      });
      setMsg(
        "Keuze-mail gemarkeerd. Over 5 dagen volgt de controle-actie."
      );
    }
  }

  async function markAnnuleringKeuzeInstallatie(actie: BackofficeActie) {
    if (
      !confirm(
        "Klant werkt mee / installatie doorzetten? De controle-actie verdwijnt."
      )
    ) {
      return;
    }
    const completedAt = new Date().toISOString();
    const project = await patchProject(actie, {
      annulering_keuze_gecontroleerd_at: completedAt,
    });
    if (project) {
      void logBackofficeActieEvent({
        soort: "annulering_keuze_controle",
        leadId: actie.leadId,
        projectId: actie.projectId,
        adviseurId,
        deadlineAt: actie.deadlineAt,
        completedAt,
        meta: { uitkomst: "installatie" },
      });
      setMsg("Installatie doorzetten — controle afgerond.");
    }
  }

  async function verstuurAnnuleringsfactuurVanActie(actie: BackofficeActie) {
    if (!actie.projectId) return;
    if (
      !confirm(
        "Geen reactie → annuleringsfactuur maken én mailen, en project op Annulering zetten?"
      )
    ) {
      return;
    }
    setBusyId(`${actie.id}-annul-factuur`);
    setError(null);
    try {
      const res = await fetch(
        `/api/projecten/${actie.projectId}/annuleringsfactuur?send=1`,
        { method: "POST" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        factuur?: { factuur_nummer?: string };
        sent?: boolean;
        sendError?: string | null;
      };
      if (!res.ok) throw new Error(data.error || "Annuleringsfactuur mislukt");
      void logBackofficeActieEvent({
        soort: "annulering_keuze_controle",
        leadId: actie.leadId,
        projectId: actie.projectId,
        adviseurId,
        deadlineAt: actie.deadlineAt,
        completedAt: new Date().toISOString(),
        meta: { uitkomst: "annuleringsfactuur", sent: data.sent },
      });
      if (data.sendError) {
        setError(
          `Factuur ${data.factuur?.factuur_nummer || ""} aangemaakt, maar mail mislukt: ${data.sendError}`
        );
        setMsg("Project op Annulering — factuur staat als concept klaar.");
      } else {
        setMsg(
          `Annuleringsfactuur ${data.factuur?.factuur_nummer || ""} verstuurd. Project op Annulering.`
        );
      }
      if (actie.project) {
        onProjectUpdated?.({
          ...actie.project,
          status: "annulering",
          annulering_keuze_gecontroleerd_at: new Date().toISOString(),
          schouw_at: null,
          schouw_jaar: null,
          schouw_week: null,
          installatie_at: null,
        });
      }
      void loadProjectTaken();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Annuleringsfactuur mislukt"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function markFactuurBetaald(
    actie: BackofficeActie,
    opts?: { skipConfirm?: boolean; goNext?: boolean }
  ) {
    if (!actie.factuurId) return false;
    if (
      !opts?.skipConfirm &&
      !confirm(`Factuur ${actie.factuurNummer || ""} markeren als betaald?`)
    ) {
      return false;
    }
    setBusyId(`${actie.id}-betaald`);
    setError(null);
    try {
      const completedAt = new Date().toISOString();
      const res = await fetch(`/api/facturen/${actie.factuurId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "betaald",
          betaald_op: completedAt.slice(0, 10),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Markeren als betaald mislukt");
      if (data.factuur) onFactuurUpdated?.(data.factuur as Factuur);
      void logBackofficeActieEvent({
        soort: "nabellen_factuur",
        leadId: actie.leadId,
        projectId: actie.projectId,
        factuurId: actie.factuurId,
        adviseurId,
        deadlineAt: actie.deadlineAt,
        completedAt,
      });
      setMsg(`Factuur ${actie.factuurNummer || ""} gemarkeerd als betaald.`);
      void loadProjectTaken();
      if (opts?.goNext !== false && actionView) {
        if (jumpPinnedKey) setJumpPinnedKey(null);
        else if (
          selectedIndex >= 0 &&
          selectedIndex < visibleRows.length - 1
        ) {
          goNextActie();
        }
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Markeren mislukt");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function stuurWfAanbetalingHerinnering(actie: BackofficeActie) {
    if (!actie.factuurId) return;
    if (
      !confirm(
        `Herinneringsmail voor aanbetaling ${actie.factuurNummer || ""} sturen?\n\nVriendelijke herinnering dat de aanbetaling nodig is om Warmtefonds aan te vragen. Factuur-PDF gaat mee als bijlage.`
      )
    ) {
      return;
    }
    setBusyId(`${actie.id}-wf-herinnering`);
    setError(null);
    try {
      const res = await fetch(`/api/facturen/${actie.factuurId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_reminder" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Herinnering versturen mislukt"
        );
      }
      setMsg(
        `Herinneringsmail aanbetaling ${actie.factuurNummer || ""} verstuurd.`
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Herinnering versturen mislukt"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function opnieuwVerstuurFactuur(actie: BackofficeActie) {
    if (!actie.factuurId) return;
    if (
      !confirm(
        `Factuur ${actie.factuurNummer || ""} opnieuw per e-mail versturen?`
      )
    ) {
      return;
    }
    setBusyId(`${actie.id}-herstuur`);
    setError(null);
    try {
      const res = await fetch(`/api/facturen/${actie.factuurId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opnieuw versturen mislukt");
      if (data.factuur) onFactuurUpdated?.(data.factuur as Factuur);
      setMsg(
        `Factuur ${actie.factuurNummer || ""} opnieuw verstuurd naar de klant.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opnieuw versturen mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function setAangegevenTeBetalen(
    actie: BackofficeActie,
    dayKey?: string
  ) {
    if (!actie.factuurId) return;
    const datum = (
      dayKey ||
      aangegevenBetaaldatum[actie.id] ||
      ""
    ).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      setError("Kies eerst wanneer de klant zegt te betalen.");
      return;
    }
    setBusyId(`${actie.id}-aangegeven`);
    setError(null);
    try {
      const res = await fetch(`/api/facturen/${actie.factuurId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afgesproken_betaaldatum: datum }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data.error || "Afgesproken betaaldatum opslaan mislukt"
        );
      }
      if (data.factuur) onFactuurUpdated?.(data.factuur as Factuur);
      setMsg(
        `Afgesproken: betaalt op ${formatFocusDayLabel(datum)}. Die dag komt “Betaling controleren” terug.`
      );
      setAangegevenBetaaldatum((prev) => {
        const next = { ...prev };
        delete next[actie.id];
        return next;
      });
      if (actionView) {
        if (jumpPinnedKey) setJumpPinnedKey(null);
        else if (
          selectedIndex >= 0 &&
          selectedIndex < visibleRows.length - 1
        ) {
          goNextActie();
        }
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Afgesproken betaaldatum mislukt"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function verstuurFactuur(
    actie: BackofficeActie,
    opts?: { factuurId?: string; skipConfirm?: boolean }
  ) {
    let drafts = draftFacturenVoorActie(actie, facturen);
    let chosen =
      opts?.factuurId ||
      factuurKeuze[actie.id] ||
      (drafts.length === 1 ? drafts[0].id : "");
    if (!chosen) {
      setError("Kies eerst een conceptfactuur");
      return;
    }
    const f =
      drafts.find((x) => x.id === chosen) ||
      facturen.find((x) => x.id === chosen);
    if (
      !opts?.skipConfirm &&
      !confirm(`Factuur ${f?.factuur_nummer || ""} versturen?`)
    ) {
      return;
    }
    setBusyId(`${actie.id}-factuur`);
    setError(null);
    try {
      const res = await fetch(`/api/facturen/${chosen}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Versturen mislukt");
      if (data.factuur) onFactuurUpdated?.(data.factuur as Factuur);
      setExpandedRow(null);
      setMsg(`Factuur ${f?.factuur_nummer || ""} verstuurd naar de klant.`);
      await maybeCompleteStap1(actie, { factuurDone: true });
      void loadProjectTaken();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Versturen mislukt");
    } finally {
      setBusyId(null);
    }
  }

  /** Kickoff: maak aanbetalingsconcept indien nodig, verstuur daarna. */
  async function verstuurAanbetalingsFactuur(actie: BackofficeActie) {
    const offerteId = actie.offerteId || actie.project?.offerte_id || null;
    const drafts = aanbetalingDraftsVoorActie(actie, facturen);
    let chosen =
      factuurKeuze[actie.id] || (drafts.length === 1 ? drafts[0].id : "");
    let label =
      drafts.find((d) => d.id === chosen)?.factuur_nummer ||
      facturen.find((d) => d.id === chosen)?.factuur_nummer ||
      "";

    if (!chosen) {
      if (!offerteId) {
        setError("Geen offerte — kan geen factuur aanmaken.");
        return;
      }
      setBusyId(`${actie.id}-factuur`);
      setError(null);
      try {
        const res = await fetch(`/api/offertes/${offerteId}/factuur`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ soort: "aanbetaling" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Conceptfactuur mislukt"
          );
        }
        const f = (data as { factuur?: Factuur }).factuur;
        if (!f?.id) {
          throw new Error("Geen factuur ontvangen");
        }
        onFactuurUpdated?.(f);
        setFactuurKeuze((p) => ({ ...p, [actie.id]: f.id }));
        chosen = f.id;
        label = f.factuur_nummer || label;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Conceptfactuur aanmaken mislukt"
        );
        setBusyId(null);
        return;
      } finally {
        setBusyId(null);
      }
    }

    if (!confirm(`Factuur ${label || ""} versturen naar de klant?`)) return;
    await verstuurFactuur(actie, { factuurId: chosen, skipConfirm: true });
  }

  async function logBelContact(actie: BackofficeActie, detail: string) {
    if (!actie.leadId) return;
    try {
      await fetch(`/api/leads/${actie.leadId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          soort: "telefoon",
          titel: "Klant gebeld (Acties)",
          detail,
        }),
      });
      setLaatsteContactAt(new Date().toISOString());
    } catch {
      /* best-effort */
    }
  }

  function resetOpvolgDefaults() {
    const d = defaultOpvolgDateTime();
    setOpvolgMode("algemeen");
    setOpvolgDate(d.date);
    setOpvolgTime(d.time);
    setOpvolgNote("");
  }

  /**
   * Niet bereikt → morgen algemeen.
   * Terugbel → gekozen datum (algemeen zonder tijd, of specifiek met tijd + notitie).
   */
  async function planOpvolging(
    actie: BackofficeActie,
    soort: "niet_bereikt" | "wacht_klant"
  ) {
    if (!actie.projectId) {
      setError("Geen project om opvolging op te zetten.");
      return;
    }
    const ownerId =
      medewerkerId || adviseurId || defaultEigenaarId || null;
    if (!ownerId) {
      setError("Geen medewerker om de terugbel-actie aan te koppelen.");
      return;
    }

    const mode: OpvolgMode =
      soort === "niet_bereikt" ? "algemeen" : opvolgMode;
    const date =
      soort === "niet_bereikt"
        ? defaultOpvolgDateTime().date
        : opvolgDate;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Kies een geldige datum.");
      return;
    }
    if (mode === "specifiek" && !/^\d{2}:\d{2}$/.test(opvolgTime)) {
      setError("Kies een geldige tijd.");
      return;
    }

    const due = dueAtFromOpvolg(date, mode, opvolgTime);
    const note = opvolgNote.trim();
    const titel =
      soort === "wacht_klant"
        ? `Wacht op klant: ${actie.titel}`
        : `Nabellen (niet bereikt): ${actie.titel}`;
    const notities =
      soort === "niet_bereikt"
        ? "Via Acties: klant niet bereikt"
        : mode === "specifiek"
          ? note
            ? `Via Acties: specifiek terugbel · ${note}`
            : "Via Acties: specifiek terugbel"
          : "Via Acties: algemeen terugbel (geen vast tijdstip)";

    setBusyId(`${actie.id}-opvolg`);
    setError(null);
    try {
      const res = await fetch("/api/taken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: actie.projectId,
          titel,
          afdeling: "Backoffice",
          verantwoordelijke_id: ownerId,
          due_at: due.toISOString(),
          notities,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opvolging mislukt"
        );
      }
      const whenLabel =
        mode === "specifiek"
          ? `${formatFocusDayLabel(date)} ${opvolgTime}`
          : formatFocusDayLabel(date);
      await logBelContact(
        actie,
        soort === "wacht_klant"
          ? `Terugbellen · ${mode} · ${whenLabel}`
          : "Niet bereikt · morgen opnieuw"
      );
      setMsg(
        soort === "wacht_klant"
          ? mode === "specifiek"
            ? `Specifiek terugbel gezet: ${whenLabel}.`
            : `Algemeen terugbel gezet op ${whenLabel} — zonder vast tijdstip.`
          : "Opvolging gezet: morgen opnieuw bellen."
      );
      resetOpvolgDefaults();
      void loadProjectTaken();
      if (actionView) {
        if (jumpPinnedKey) {
          setJumpPinnedKey(null);
        } else if (
          selectedIndex >= 0 &&
          selectedIndex < visibleRows.length - 1
        ) {
          goNextActie();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opvolging mislukt");
    } finally {
      setBusyId(null);
    }
  }

  function openJumpHit(row: TaskRow) {
    setJumpPinnedKey(row.key);
    setSelectedKey(row.key);
    setFocusJumpQ("");
    setNotesOpen(false);
    setMsg(null);
  }

  function exitJumpPin() {
    setJumpPinnedKey(null);
    if (visibleRows[0]) setSelectedKey(visibleRows[0].key);
    else setSelectedKey(null);
  }

  async function afrondenEnVolgende(row: TaskRow) {
    const actie = row.actie;
    setBusyId(`${actie.id}-afronden`);
    setError(null);
    try {
      if (row.kind === "factuur_versturen") {
        await verstuurAanbetalingsFactuur(actie);
        setMsg("Aanbetalingsfactuur verwerkt.");
      } else if (row.kind === "edwin_doorsturen") {
        if (!edwinGestuurd) {
          throw new Error("Stuur eerst de WhatsApp naar Edwin, daarna afronden.");
        }
        await updateFinancieringStatusFromActie(
          actie,
          "doorgestuurd_naar_edwin"
        );
        await maybeCompleteStap1(actie, {
          edwinDone: true,
          project: actie.project,
        });
        setMsg("Gegevens doorgestuurd naar Edwin.");
      } else if (row.kind === "schouw_week") {
        await planSchouwWeek(actie);
        setMsg("Schouwweek gezet.");
      } else if (row.kind === "herplan") {
        await voltooiHerplan(actie);
      } else if (
        row.kind === "nabellen" ||
        row.kind === "wf_aanbetaling_herinnering"
      ) {
        const ok = await markFactuurBetaald(actie, { goNext: false });
        if (!ok) return;
      } else if (row.kind === "financiering") {
        await markFinancieringGeschakeld(actie);
      } else if (row.kind === "aangetekende_brief") {
        await markAangetekendeBriefAfgerond(actie);
      } else if (row.kind === "annulering_keuze_controle") {
        await markAnnuleringKeuzeInstallatie(actie);
      } else if (row.kind === "terugbel") {
        const res = await fetch(`/api/taken/${actie.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Afronden mislukt"
          );
        }
        await logBelContact(actie, `Terugbel afgerond: ${actie.titel}`);
        setMsg("Terugbel-actie afgerond.");
        void loadProjectTaken();
      } else if (
        row.kind === "volgende_stap" ||
        row.kind === "schouw_inplannen" ||
        row.kind === "bestel_materiaal" ||
        row.kind === "wacht_warmtefonds"
      ) {
        // Afgeleide acties verdwijnen vanzelf bij statuswijziging; log alleen
        await logBelContact(actie, `Actie afgerond: ${actie.titel}`);
        setMsg("Actie afgerond — ga door naar de volgende.");
      }

      if (jumpPinnedKey) {
        setJumpPinnedKey(null);
      } else if (
        selectedIndex >= 0 &&
        selectedIndex < visibleRows.length - 1
      ) {
        goNextActie();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afronden mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function createRestantFactuur(actie: BackofficeActie) {
    const offerteId = actie.offerteId || actie.project?.offerte_id || null;
    if (!offerteId) {
      setError("Geen offerte gekoppeld — open het project.");
      return;
    }
    setBusyId(`${actie.id}-restant`);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/offertes/${offerteId}/factuur`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soort: "restant" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Restfactuur mislukt"
        );
      }
      if ((data as { skipped?: boolean }).skipped) {
        setMsg("Geen restant meer te factureren.");
      } else {
        const f = (data as { factuur?: Factuur }).factuur;
        if (f) {
          onFactuurUpdated?.(f);
          setFactuurKeuze((p) => ({ ...p, [actie.id]: f.id }));
        }
        setMsg(
          f?.factuur_nummer
            ? `Restfactuur ${f.factuur_nummer} als concept klaargezet — verstuur hieronder.`
            : "Restfactuur als concept klaargezet — verstuur hieronder."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restfactuur mislukt");
    } finally {
      setBusyId(null);
    }
  }

  function isRestfactuurActie(actie: BackofficeActie): boolean {
    const t = `${actie.titel || ""} ${actie.detail || ""}`.toLowerCase();
    return t.includes("restfactuur") || t.includes("restant");
  }

  function isInstallatieActie(actie: BackofficeActie): boolean {
    const t = `${actie.titel || ""} ${actie.detail || ""}`.toLowerCase();
    // Niet de oude “betaling controleren … installatie”-titel
    if (/betaling warmtefonds controleren/i.test(t)) return false;
    return (
      /installatiedatum inplannen|installatie inplannen/i.test(t) ||
      (t.includes("installatie") && !t.includes("controleren"))
    );
  }

  /** Werkpaneel: echte knoppen per actiesoort (lijst + action view). */
  function actieWerkPanel(
    row: TaskRow,
    opts?: { hideContact?: boolean; compact?: boolean }
  ) {
    const compact = Boolean(opts?.compact);
    const actie = row.actie;
    const drafts = draftFacturenVoorActie(actie, facturen);
    const selectedFactuur =
      factuurKeuze[actie.id] || (drafts.length === 1 ? drafts[0].id : "");
    const selectedPartner =
      partnerKeuze[actie.id] ||
      actie.project?.installatie_partner_id ||
      defaultPartnerId;
    const selectedSchouwAt = schouwAtKeuze[actie.id] || "";
    const saleAt = actie.saleAt
      ? new Date(actie.saleAt)
      : actie.project
        ? saleMomentVanProject(actie.project)
        : new Date();
    const recommended = actie.project
      ? recommendedSchouwWeekForProject(actie.project, saleAt)
      : { jaar: saleAt.getFullYear(), week: 1 };
    const recommendedValue = schouwWeekValue(recommended.jaar, recommended.week);
    const selectedWeek = weekKeuze[actie.id] || recommendedValue;
    const restfactuur = isRestfactuurActie(actie);
    const installatie = isInstallatieActie(actie);
    const tel =
      actie.telefoon ||
      leads.find((l) => l.id === actie.leadId)?.telefoon ||
      null;

    return (
      <div className="space-y-3">
        {(actie.reden || actie.detail) &&
        row.kind === "volgende_stap" &&
        !compact ? (
          <p className="text-[12px] leading-relaxed text-muted">
            <span className="font-semibold text-ink">Waarom: </span>
            {actie.reden || actie.detail}
          </p>
        ) : null}

        {/* Factuur opvolgen — één duidelijke keuze i.p.v. 3 knoppen */}
        {row.kind === "nabellen" ? (
          <div
            className={
              compact
                ? "space-y-2.5 border border-line bg-white px-3 py-3"
                : "space-y-3 border border-line bg-white px-4 py-4"
            }
          >
            <div>
              <p className="text-sm font-semibold text-ink">
                Wat zei de klant?
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                {actie.factuurNummer || "Factuur"} · langer dan 1 dag te laat
              </p>
            </div>

            <button
              type="button"
              disabled={busyId === `${actie.id}-betaald`}
              onClick={() => void markFactuurBetaald(actie)}
              className="flex h-11 w-full items-center justify-center bg-green text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
            >
              {busyId === `${actie.id}-betaald`
                ? "Bezig…"
                : "Is betaald → klaar"}
            </button>

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                Of: betaalt later op…
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="date"
                  value={
                    aangegevenBetaaldatum[actie.id] ||
                    defaultOpvolgDateTime().date
                  }
                  onChange={(e) =>
                    setAangegevenBetaaldatum((prev) => ({
                      ...prev,
                      [actie.id]: e.target.value,
                    }))
                  }
                  className="h-9 border border-line bg-white px-2 text-xs text-ink"
                />
                <button
                  type="button"
                  disabled={busyId === `${actie.id}-aangegeven`}
                  onClick={() =>
                    void setAangegevenTeBetalen(
                      actie,
                      aangegevenBetaaldatum[actie.id] ||
                        defaultOpvolgDateTime().date
                    )
                  }
                  className="h-9 border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:border-ink hover:bg-wash disabled:opacity-50"
                >
                  {busyId === `${actie.id}-aangegeven`
                    ? "…"
                    : "Zet betaaldatum"}
                </button>
              </div>
              <p className="text-[11px] text-muted">
                Die dag komt “Betaling controleren” terug.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[12px]">
              <button
                type="button"
                disabled={busyId === `${actie.id}-herstuur`}
                onClick={() => void opnieuwVerstuurFactuur(actie)}
                className="font-semibold text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
              >
                {busyId === `${actie.id}-herstuur`
                  ? "Bezig…"
                  : "Factuur opnieuw mailen"}
              </button>
              {actie.factuurId ? (
                <Link
                  href={`/facturen/${actie.factuurId}`}
                  className="font-semibold text-muted underline-offset-2 hover:text-ink hover:underline"
                >
                  Bekijk factuur
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {!opts?.hideContact && tel ? (
            <a
              href={`tel:${tel.replace(/\s/g, "")}`}
              className="inline-flex h-9 items-center gap-1.5 border border-line bg-white px-3 text-xs font-semibold text-green-deeper hover:bg-wash"
            >
              Bel klant
            </a>
          ) : null}

          {row.kind === "terugbel" ? (
            <p className="w-full text-[13px] text-muted">
              Bel de klant terug. Klaar? Druk op{" "}
              <span className="font-semibold text-ink">Afronden</span>.
            </p>
          ) : null}

          {row.kind === "herplan" ? (
            <button
              type="button"
              onClick={() => setHerplanActie(actie)}
              className="inline-flex h-9 items-center bg-orange px-3 text-xs font-semibold text-white hover:opacity-90"
            >
              Afspraak herplannen
            </button>
          ) : null}

          {row.kind === "bestel_materiaal" ? (
            <button
              type="button"
              onClick={() => setInkoopActie(actie)}
              className="inline-flex h-9 items-center bg-orange px-3 text-xs font-semibold text-white hover:opacity-90"
            >
              Bestelling vastleggen
            </button>
          ) : null}

          {row.kind === "financiering" ? (
            <>
              <a
                href={FINANCIERINGSMAN_TEL_HREF}
                className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark"
              >
                Bel {FINANCIERINGSMAN_TEL}
              </a>
              <button
                type="button"
                onClick={() => void copyBericht(actie)}
                className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold hover:bg-wash"
              >
                Kopieer bericht
              </button>
              <button
                type="button"
                onClick={() => void markFinancieringGeschakeld(actie)}
                className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold hover:bg-wash"
              >
                Afgerond
              </button>
            </>
          ) : null}

          {row.kind === "wf_aanbetaling_herinnering" ? (
            <>
              <button
                type="button"
                disabled={busyId === `${actie.id}-wf-herinnering`}
                onClick={() => void stuurWfAanbetalingHerinnering(actie)}
                className="inline-flex h-9 items-center bg-orange px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busyId === `${actie.id}-wf-herinnering`
                  ? "Bezig…"
                  : "Stuur herinneringsmail"}
              </button>
              <button
                type="button"
                onClick={() => void markFactuurBetaald(actie)}
                className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark"
              >
                Markeer betaald
              </button>
            </>
          ) : null}

          {row.kind === "aangetekende_brief" ? (
            <>
              <button
                type="button"
                disabled={!actie.project}
                onClick={() => {
                  if (actie.project) setContactMailProject(actie.project);
                }}
                className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
              >
                Mail klant
              </button>
              {actie.projectId ? (
                <a
                  href={`/api/projecten/${actie.projectId}/aangetekende-brief`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center border border-[#9A3B1A]/30 bg-[#FFF6F2] px-3 text-xs font-semibold text-[#9A3B1A] hover:bg-[#FFE8DF]"
                >
                  PDF
                </a>
              ) : null}
              <button
                type="button"
                disabled={busyId === `${actie.id}-aangetekend`}
                onClick={() => void markAangetekendeBriefAfgerond(actie)}
                className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold hover:bg-wash disabled:opacity-50"
              >
                Mail verstuurd
              </button>
            </>
          ) : null}

          {row.kind === "annulering_keuze_controle" ? (
            <>
              <button
                type="button"
                disabled={busyId === `${actie.id}-keuze-install`}
                onClick={() => void markAnnuleringKeuzeInstallatie(actie)}
                className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
              >
                Installatie doorzetten
              </button>
              <button
                type="button"
                disabled={busyId === `${actie.id}-annul-factuur`}
                onClick={() => void verstuurAnnuleringsfactuurVanActie(actie)}
                className="inline-flex h-9 items-center bg-[#9A3B1A] px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busyId === `${actie.id}-annul-factuur`
                  ? "Bezig…"
                  : "Annuleringsfactuur versturen"}
              </button>
            </>
          ) : null}

          {actie.projectId && !compact ? (
            <Link
              href={`/projecten/${actie.projectId}?from=acties`}
              className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold text-ink hover:bg-wash"
            >
              Open project
            </Link>
          ) : null}
          {actie.factuurId && row.kind === "wf_aanbetaling_herinnering" ? (
            <Link
              href={`/facturen/${actie.factuurId}`}
              className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold text-ink hover:bg-wash"
            >
              Open factuur
            </Link>
          ) : null}
        </div>

        {row.kind === "wacht_warmtefonds" && actie.project
          ? (() => {
              const projectFacturen = facturen.filter(
                (f) =>
                  f.project_id === actie.projectId ||
                  f.lead_id === actie.leadId
              );
              const bedragen = kickoffWarmtefondsBedragen(
                actie.project!,
                projectFacturen
              );
              return (
                <div className="rounded-sm border border-line bg-white px-3.5 py-3">
                  <ProjectFinancieringPath
                    status={resolveFinancieringStatus(actie.project)}
                    afspraakAt={actie.project.warmtefonds_afspraak_at}
                    disabled={busyId === `${actie.id}-wf`}
                    onChange={(s, extra) =>
                      void updateFinancieringStatusFromActie(actie, s, extra)
                    }
                    aanbetalingInc={bedragen.aanbetalingInc}
                    warmtefondsInc={bedragen.warmtefondsInc}
                    restantFactuurStatus={
                      projectFacturen.find(
                        (f) =>
                          !f.credit_van_factuur_id &&
                          isRestantFactuurOmschrijving(f.omschrijving)
                      )?.status ?? null
                    }
                  />
                </div>
              );
            })()
          : null}

        {/* Restfactuur */}
        {(row.kind === "volgende_stap" || row.kind === "factuur_versturen") &&
        restfactuur ? (
          <div className="rounded-sm border border-line bg-white px-3.5 py-3">
            <p className="text-sm font-semibold text-ink">
              Restfactuur opstellen &amp; versturen
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              Maak eerst een concept, verstuur daarna naar de klant.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={
                  busyId === `${actie.id}-restant` ||
                  !(actie.offerteId || actie.project?.offerte_id)
                }
                onClick={() => void createRestantFactuur(actie)}
                className="inline-flex h-9 items-center bg-orange px-3 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                {busyId === `${actie.id}-restant`
                  ? "Bezig…"
                  : "Restfactuur opstellen"}
              </button>
              {drafts.length > 0 ? (
                <>
                  <select
                    value={selectedFactuur}
                    onChange={(e) =>
                      setFactuurKeuze((p) => ({
                        ...p,
                        [actie.id]: e.target.value,
                      }))
                    }
                    className="h-9 border border-line bg-white px-2 text-xs outline-none focus:border-green"
                  >
                    <option value="">Concept…</option>
                    {drafts.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.factuur_nummer} ·{" "}
                        {formatEuro(Number(f.bedrag_inc_btw) || 0)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={
                      busyId === `${actie.id}-factuur` || !selectedFactuur
                    }
                    onClick={() => void verstuurFactuur(actie)}
                    className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                  >
                    Versturen
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Schouw plannen */}
        {(row.kind === "volgende_stap" ||
          row.kind === "schouw_inplannen" ||
          row.kind === "schouw_week") &&
        (actie.planSchouwdag ||
          actie.planSchouwweek ||
          row.kind === "schouw_inplannen" ||
          row.kind === "schouw_week") ? (
          <div
            className={
              compact
                ? "space-y-2 border border-line bg-white px-3 py-2.5"
                : "space-y-3 border border-line bg-white px-4 py-4"
            }
          >
            <div className={compact ? "min-w-0" : "flex items-start gap-3"}>
              {!compact ? (
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wash text-[11px] font-bold text-muted">
                  1
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <p
                  className={
                    compact
                      ? "text-xs font-semibold text-ink"
                      : "text-sm font-semibold text-ink"
                  }
                >
                  {actie.planSchouwdag || row.kind === "schouw_inplannen"
                    ? "Exacte schouwdag afspreken"
                    : "Schouwweek zetten"}
                  {compact && actie.schouwWeekLabel ? (
                    <span className="ml-1.5 font-normal text-muted">
                      · {actie.schouwWeekLabel}
                    </span>
                  ) : null}
                </p>
                {!compact && actie.schouwWeekLabel ? (
                  <p className="mt-0.5 text-[12px] text-muted">
                    Week:{" "}
                    <span className="font-medium text-ink">
                      {actie.schouwWeekLabel}
                    </span>
                  </p>
                ) : null}

                {actie.planSchouwweek && row.kind !== "schouw_inplannen" ? (
                  <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Schouwweek
                    <select
                      value={selectedWeek}
                      onChange={(e) =>
                        setWeekKeuze((p) => ({
                          ...p,
                          [actie.id]: e.target.value,
                        }))
                      }
                      className="mt-1 block w-full max-w-md border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                    >
                      {weekOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                          {o.value === recommendedValue ? " · aanbevolen" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="mt-3 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Installatiepartner
                  <select
                    value={selectedPartner}
                    onChange={(e) => {
                      setPartnerKeuze((p) => ({
                        ...p,
                        [actie.id]: e.target.value,
                      }));
                      setSchouwAtKeuze((p) => {
                        const next = { ...p };
                        delete next[actie.id];
                        return next;
                      });
                    }}
                    className="mt-1 block w-full max-w-md border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
                  >
                    <option value="">Kies partner…</option>
                    {partners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.naam}
                      </option>
                    ))}
                  </select>
                </label>

                {(actie.planSchouwdag || row.kind === "schouw_inplannen") &&
                selectedPartner ? (
                  <div className={compact ? "mt-2" : "mt-3"}>
                    {!compact ? (
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Beschikbaar slot
                      </p>
                    ) : null}
                    <div className={compact ? "" : "mt-1.5"}>
                      <PartnerSlotPicker
                        partnerId={selectedPartner}
                        soort="schouw"
                        leadId={actie.leadId}
                        projectId={actie.projectId || null}
                        excludeProjectId={actie.projectId || null}
                        compact={compact}
                        value={selectedSchouwAt || null}
                        onPartnerChange={(pid) =>
                          setPartnerKeuze((p) => ({ ...p, [actie.id]: pid }))
                        }
                        onChange={(iso) =>
                          setSchouwAtKeuze((p) => {
                            if (!iso) {
                              const next = { ...p };
                              delete next[actie.id];
                              return next;
                            }
                            return { ...p, [actie.id]: iso };
                          })
                        }
                      />
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={
                    busyId === `${actie.id}-schouw` ||
                    !selectedPartner ||
                    ((actie.planSchouwdag ||
                      row.kind === "schouw_inplannen") &&
                      !selectedSchouwAt)
                  }
                  onClick={() => void planSchouwWeek(actie)}
                  className={[
                    "inline-flex items-center bg-orange font-semibold text-white hover:opacity-90 disabled:opacity-40",
                    compact
                      ? "mt-2 h-9 px-3 text-xs"
                      : "mt-4 h-10 px-4 text-sm",
                  ].join(" ")}
                >
                  {busyId === `${actie.id}-schouw`
                    ? "Bezig…"
                    : actie.planSchouwdag || row.kind === "schouw_inplannen"
                      ? "Schouwdag vastleggen"
                      : "Schouwweek inplannen"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Kickoff aanbetaling — conceptfactuur zoals op factuurpagina */}
        {row.kind === "factuur_versturen" && !restfactuur
          ? (() => {
              const pool = aanbetalingDraftsVoorActie(actie, facturen);
              const chosenId =
                selectedFactuur || (pool.length === 1 ? pool[0].id : "");
              const fac =
                pool.find((f) => f.id === chosenId) || pool[0] || null;
              const lead =
                leads.find((l) => l.id === actie.leadId) || null;
              const bedragen = actie.project
                ? kickoffWarmtefondsBedragen(actie.project, facturen)
                : { aanbetalingInc: null, warmtefondsInc: null };
              const straat = [
                lead?.straat,
                lead?.huisnummer,
                lead?.toevoeging,
              ]
                .filter(Boolean)
                .join(" ")
                .trim();
              const plaats = [lead?.postcode, lead?.plaats]
                .filter(Boolean)
                .join(" ")
                .trim();
              const ex = fac ? Number(fac.bedrag_ex_btw) || 0 : null;
              const btw = fac ? Number(fac.btw_bedrag) || 0 : null;
              const inc = fac
                ? Number(fac.bedrag_inc_btw) || 0
                : bedragen.aanbetalingInc;

              return (
                <div className="space-y-3">
                  {pool.length > 1 ? (
                    <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Concept kiezen
                      <select
                        value={chosenId}
                        onChange={(e) =>
                          setFactuurKeuze((p) => ({
                            ...p,
                            [actie.id]: e.target.value,
                          }))
                        }
                        className="mt-1 block h-9 w-full max-w-md border border-line bg-white px-2 text-xs"
                      >
                        {pool.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.factuur_nummer} ·{" "}
                            {formatEuro(Number(f.bedrag_inc_btw) || 0)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <article className="border border-line bg-white shadow-[0_1px_0_rgba(0,0,0,0.03)]">
                    <div className="border-b border-line px-4 py-5 sm:px-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="font-display text-lg font-semibold tracking-tight text-green-deeper">
                            BatterijConcept
                          </p>
                          <p className="mt-1 text-[12px] leading-relaxed text-muted">
                            Daltonlaan 500
                            <br />
                            3584 BK Utrecht
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-xl font-semibold text-ink">
                            Factuur
                          </p>
                          <p className="mt-0.5 font-mono text-sm font-semibold text-green-dark">
                            {fac?.factuur_nummer || "Concept (nog aanmaken)"}
                          </p>
                          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                            Concept — nog niet verzonden
                          </p>
                        </div>
                      </div>

                      <div className="mt-6 grid gap-5 sm:grid-cols-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                            Factuur aan
                          </p>
                          <p className="mt-1.5 text-sm font-semibold text-ink">
                            {lead?.naam || actie.leadNaam}
                          </p>
                          {straat ? (
                            <p className="text-[13px] text-muted">{straat}</p>
                          ) : null}
                          {plaats ? (
                            <p className="text-[13px] text-muted">{plaats}</p>
                          ) : null}
                          {lead?.email || actie.telefoon ? (
                            <p className="mt-1 text-[13px] text-muted">
                              {[lead?.email, actie.telefoon || lead?.telefoon]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        <div className="sm:text-right">
                          <dl className="inline-grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-[13px]">
                            <dt className="text-muted">Factuurdatum</dt>
                            <dd className="font-medium text-ink">
                              {fac?.factuurdatum
                                ? formatDateShort(fac.factuurdatum)
                                : "—"}
                            </dd>
                            <dt className="text-muted">Vervaldatum</dt>
                            <dd className="font-medium text-ink">
                              {fac?.vervaldatum
                                ? formatDateShort(fac.vervaldatum)
                                : "—"}
                            </dd>
                            {actie.offerteNummer ? (
                              <>
                                <dt className="text-muted">Offerte</dt>
                                <dd className="font-medium text-ink">
                                  {actie.offerteNummer}
                                </dd>
                              </>
                            ) : null}
                          </dl>
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto px-4 py-2 sm:px-6">
                      <table className="w-full min-w-[22rem] text-left text-sm">
                        <thead>
                          <tr className="border-b border-line text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                            <th className="py-3 pr-3 font-semibold">
                              Omschrijving
                            </th>
                            <th className="py-3 pr-3 text-right font-semibold">
                              Excl. btw
                            </th>
                            <th className="py-3 pr-3 text-right font-semibold">
                              Btw
                            </th>
                            <th className="py-3 text-right font-semibold">
                              Incl. btw
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-b border-line">
                            <td className="py-3.5 pr-3 align-top">
                              <p className="font-medium text-ink">
                                {fac?.omschrijving ||
                                  "Aanbetalingsfactuur / BTW-factuur"}
                              </p>
                            </td>
                            <td className="py-3.5 pr-3 text-right tabular-nums text-muted">
                              {ex != null ? formatEuro(ex) : "—"}
                            </td>
                            <td className="py-3.5 pr-3 text-right tabular-nums text-muted">
                              {btw != null ? formatEuro(btw) : "—"}
                            </td>
                            <td className="py-3.5 text-right tabular-nums font-semibold text-ink">
                              {inc != null ? formatEuro(inc) : "—"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-wrap items-end justify-between gap-3 border-t border-line px-4 py-4 sm:px-6">
                      <div className="text-[12px] text-muted">
                        {lead?.email ? (
                          <>Wordt gemaild naar <span className="font-medium text-ink">{lead.email}</span></>
                        ) : (
                          <span className="text-[#C45A12]">
                            Let op: geen e-mail op de lead
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Totaal incl. btw
                        </p>
                        <p className="font-display text-2xl font-semibold tabular-nums text-ink">
                          {inc != null ? formatEuro(inc) : "—"}
                        </p>
                      </div>
                    </div>
                  </article>

                  <div className="flex flex-wrap items-center gap-2">
                    {fac ? (
                      <Link
                        href={`/facturen/${fac.id}`}
                        className="inline-flex h-10 items-center border border-line px-3.5 text-sm font-semibold text-ink hover:bg-wash"
                      >
                        Factuur openen
                      </Link>
                    ) : null}
                    <button
                      type="button"
                      disabled={busyId === `${actie.id}-factuur`}
                      onClick={() => void verstuurAanbetalingsFactuur(actie)}
                      className="inline-flex h-10 items-center bg-green px-4 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                    >
                      {busyId === `${actie.id}-factuur`
                        ? "Bezig…"
                        : pool.length === 0
                          ? "Aanmaken & versturen"
                          : "Versturen naar klant"}
                    </button>
                  </div>
                </div>
              );
            })()
          : null}

        {row.kind === "edwin_doorsturen" && actie.project ? (
          <div className="rounded-sm border border-line bg-white px-3.5 py-3">
            <p className="text-sm font-semibold text-ink">
              Gegevens doorsturen naar Edwin
            </p>
            <p className="mt-0.5 text-[12px] text-muted">
              Stuur klantgegevens via WhatsApp zodat Edwin de
              Warmtefonds-afspraak kan inplannen.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busyId === `${actie.id}-edwin`}
                onClick={() => {
                  const bedragen = kickoffWarmtefondsBedragen(
                    actie.project!,
                    facturen.filter(
                      (f) =>
                        f.project_id === actie.projectId ||
                        f.lead_id === actie.leadId
                    )
                  );
                  const lead =
                    leads.find((l) => l.id === actie.leadId) || null;
                  const bericht = edwinWarmtefondsWhatsappBericht({
                    leadNaam: actie.leadNaam,
                    telefoon: actie.telefoon || lead?.telefoon || null,
                    straat: lead?.straat || null,
                    postcode: lead?.postcode || null,
                    huisnummer: lead?.huisnummer || null,
                    toevoeging: lead?.toevoeging || null,
                    plaats: actie.plaats || lead?.plaats || null,
                    offerteNummer: actie.offerteNummer || null,
                    projectNummer: actie.projectNummer || null,
                    aanbetalingInc: bedragen.aanbetalingInc,
                    warmtefondsInc: bedragen.warmtefondsInc,
                  });
                  window.open(edwinWhatsappUrl(bericht), "_blank");
                  setEdwinGestuurd(true);
                }}
                className="inline-flex h-9 items-center bg-[#25D366] px-3.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                WhatsApp {FINANCIERINGSMAN_NAAM}
              </button>
              <button
                type="button"
                disabled={
                  busyId === `${actie.id}-edwin-done` || !edwinGestuurd
                }
                onClick={async () => {
                  await updateFinancieringStatusFromActie(
                    actie,
                    "doorgestuurd_naar_edwin"
                  );
                  await maybeCompleteStap1(actie, {
                    edwinDone: true,
                    project: actie.project,
                  });
                }}
                className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-40"
              >
                Doorgestuurd — afvinken
              </button>
            </div>
            {!edwinGestuurd ? (
              <p className="mt-2 text-[11px] text-muted">
                Eerst WhatsApp openen, daarna afvinken.
              </p>
            ) : null}
          </div>
        ) : null}

        {row.kind === "volgende_stap" &&
        installatie &&
        !restfactuur &&
        actie.projectId ? (
          <div
            className={
              compact
                ? "space-y-2 border border-line bg-wash/50 p-2.5"
                : "space-y-3 border border-line bg-wash/50 p-3"
            }
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
              Aanbevolen installatie
            </p>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Partner
              <select
                value={selectedPartner || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setPartnerKeuze((p) => {
                    if (!v) {
                      const next = { ...p };
                      delete next[actie.id];
                      return next;
                    }
                    return { ...p, [actie.id]: v };
                  });
                  setInstallatieAtKeuze((p) => {
                    const next = { ...p };
                    delete next[actie.id];
                    return next;
                  });
                }}
                className="mt-1 block w-full max-w-md border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              >
                <option value="">Kies partner…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.naam}
                  </option>
                ))}
              </select>
            </label>
            {selectedPartner ? (
              <PartnerSlotPicker
                partnerId={selectedPartner}
                soort="installatie"
                leadId={actie.leadId}
                projectId={actie.projectId}
                excludeProjectId={actie.projectId}
                showBest
                lockBestToPartner
                compact={compact}
                afterIso={actie.project?.schouw_at || null}
                value={installatieAtKeuze[actie.id] || null}
                onPartnerChange={(pid) =>
                  setPartnerKeuze((p) => ({ ...p, [actie.id]: pid }))
                }
                onChange={(iso) =>
                  setInstallatieAtKeuze((p) => {
                    if (!iso) {
                      const next = { ...p };
                      delete next[actie.id];
                      return next;
                    }
                    return { ...p, [actie.id]: iso };
                  })
                }
              />
            ) : null}
            <button
              type="button"
              disabled={
                busyId === `${actie.id}-installatie` ||
                !selectedPartner ||
                !installatieAtKeuze[actie.id]
              }
              onClick={() => void planInstallatieFromActie(actie)}
              className="inline-flex h-10 items-center bg-green px-4 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-40"
            >
              {busyId === `${actie.id}-installatie`
                ? "Bezig…"
                : "Installatie vastleggen"}
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  async function planInstallatieFromActie(actie: BackofficeActie) {
    if (!actie.projectId) return;
    const partnerId =
      partnerKeuze[actie.id] ||
      actie.project?.installatie_partner_id ||
      defaultPartnerId;
    const iso = installatieAtKeuze[actie.id];
    if (!partnerId || !iso) {
      setError("Kies partner en installatie-slot");
      return;
    }
    setBusyId(`${actie.id}-installatie`);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${actie.projectId}/installatie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installatie_at: new Date(iso).toISOString(),
          installatie_partner_id: partnerId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Installatie opslaan mislukt");
      if (data.project) onProjectUpdated?.(data.project as Project);
      setExpandedRow(null);
      setInstallatieAtKeuze((p) => {
        const next = { ...p };
        delete next[actie.id];
        return next;
      });
      setMsg("Installatie ingepland.");
      if (actionView) {
        if (jumpPinnedKey) setJumpPinnedKey(null);
        else if (
          selectedIndex >= 0 &&
          selectedIndex < visibleRows.length - 1
        ) {
          goNextActie();
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Installatie opslaan mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function planSchouwWeek(actie: BackofficeActie) {
    if (!actie.projectId || !actie.project) return;
    const saleAt = actie.saleAt
      ? new Date(actie.saleAt)
      : saleMomentVanProject(actie.project);
    const recommended = recommendedSchouwWeekForProject(actie.project, saleAt);
    const recommendedValue = schouwWeekValue(recommended.jaar, recommended.week);
    const exactLocal = schouwAtKeuze[actie.id]?.trim() || "";
    let payload: Record<string, unknown> = {};

    if (exactLocal) {
      const parsed = new Date(exactLocal);
      if (Number.isNaN(parsed.getTime())) {
        setError("Ongeldige schouwdag");
        return;
      }
      const derived = schouwWeekFromDate(parsed);
      payload = {
        schouw_at: parsed.toISOString(),
        schouw_jaar: derived.jaar,
        schouw_week: derived.week,
      };
    } else {
      const chosen = weekKeuze[actie.id] || recommendedValue;
      const opt = weekOptions.find((o) => o.value === chosen);
      if (!opt) {
        setError("Kies een geldige schouwweek");
        return;
      }
      payload = {
        schouw_jaar: opt.jaar,
        schouw_week: opt.week,
      };
    }

    const partnerId =
      partnerKeuze[actie.id] ||
      actie.project.installatie_partner_id ||
      defaultPartnerId;
    if (!partnerId) {
      setError("Kies een installatiepartner");
      return;
    }

    setBusyId(`${actie.id}-schouw`);
    setError(null);
    try {
      const res = await fetch(`/api/projecten/${actie.projectId}/schouw`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          installatie_partner_id: partnerId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Schouw opslaan mislukt");
      if (data.project) onProjectUpdated?.(data.project as Project);
      if (data.mails?.klant?.ok) {
        // ok — klantmail verstuurd
      } else if (data.mails?.klant?.skipped) {
        setError(
          data.mails.klant.error ||
            "Schouw gezet, maar geen klantmail (geen e-mailadres op de lead)"
        );
      } else if (data.mails?.klant?.ok === false) {
        setError(
          data.mails.klant.error ||
            "Schouw gezet, maar mail naar klant mislukt"
        );
      }
      setExpandedRow(null);
      setSchouwAtKeuze((p) => {
        const next = { ...p };
        delete next[actie.id];
        return next;
      });
      await maybeCompleteStap1(actie, {
        schouwDone: true,
        project: data.project as Project,
      });
      void loadProjectTaken();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function copyBericht(actie: BackofficeActie) {
    try {
      await navigator.clipboard.writeText(financieringSchakelBericht(actie));
      setCopiedId(actie.id);
      window.setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setError("Kopiëren mislukt");
    }
  }

  const tabEmpty =
    visibleRows.length === 0 && visibleNazorgTaken.length === 0;

  const selectedEigenaar = selectedRow
    ? eigenaarVoorActie(
        selectedRow.actie,
        projecten,
        adviseurs,
        defaultEigenaarId
      )
    : null;

  const selectedIndex = selectedRow
    ? visibleRows.findIndex((r) => r.key === selectedRow.key)
    : -1;

  const todayKey = ymdAmsterdam(new Date());
  const focusDayLabel = formatFocusDayLabel(focusDayKey);

  function openActionView(key?: string) {
    const target =
      key ||
      selectedKey ||
      visibleRows[0]?.key ||
      null;
    const row = target
      ? visibleRows.find((r) => r.key === target) ||
        openRows.find((r) => r.key === target) ||
        null
      : null;
    if (row) {
      const dueYmd = ymdAmsterdam(new Date(row.dueAt));
      const today = ymdAmsterdam(new Date());
      // Achterstallig valt onder vandaag in focusmodus
      setFocusDayKey(dueYmd < today ? today : dueYmd);
      setSelectedKey(row.key);
    }
    setExpandedRow(null);
    setActionView(true);
  }

  function goPrevActie() {
    if (jumpPinnedKey) {
      exitJumpPin();
      return;
    }
    if (selectedIndex <= 0) return;
    setSelectedKey(visibleRows[selectedIndex - 1]!.key);
  }

  function goNextActie() {
    if (jumpPinnedKey) {
      exitJumpPin();
      return;
    }
    if (selectedIndex < 0 || selectedIndex >= visibleRows.length - 1) return;
    setSelectedKey(visibleRows[selectedIndex + 1]!.key);
  }

  function shiftFocusDay(delta: number) {
    setJumpPinnedKey(null);
    setFocusDayKey((prev) => shiftDayKey(prev, delta));
  }

  function focusFactuurKaart(fac: Factuur | null | undefined, actie: BackofficeActie) {
    const lead = leads.find((l) => l.id === actie.leadId) || null;
    const straat = [lead?.straat, lead?.huisnummer, lead?.toevoeging]
      .filter(Boolean)
      .join(" ")
      .trim();
    const plaats = [lead?.postcode, lead?.plaats].filter(Boolean).join(" ").trim();
    const inc = fac ? Number(fac.bedrag_inc_btw) || 0 : null;
    const factuurId = fac?.id || actie.factuurId || null;
    const nummer = fac?.factuur_nummer || actie.factuurNummer || "—";

    return (
      <article className="flex h-full min-h-0 flex-col border border-line bg-white">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-3 py-2">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Factuur
            </p>
            <p className="truncate font-mono text-sm font-semibold text-ink">
              {nummer}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-display text-base font-semibold tabular-nums text-ink">
              {inc != null ? formatEuro(inc) : "—"}
            </p>
            <p className="text-[11px] font-medium text-muted">
              {fac?.status || "open"}
              {fac?.vervaldatum
                ? ` · vervalt ${formatDateShort(fac.vervaldatum)}`
                : ""}
            </p>
          </div>
        </div>
        {factuurId ? (
          <iframe
            key={factuurId}
            title={`Factuur ${nummer}`}
            src={`/api/facturen/${factuurId}/pdf?inline=1`}
            className="min-h-0 w-full flex-1 border-0 bg-[#F3F4F3]"
          />
        ) : (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3 text-[13px]">
            <p className="font-semibold text-ink">
              {lead?.naam || actie.leadNaam}
            </p>
            {straat ? <p className="text-muted">{straat}</p> : null}
            {plaats ? <p className="text-muted">{plaats}</p> : null}
            {lead?.email ? (
              <p className="text-muted">{lead.email}</p>
            ) : null}
            {fac?.omschrijving ? (
              <p className="border-t border-line pt-2 text-ink">
                {fac.omschrijving}
              </p>
            ) : (
              <p className="text-muted">Geen factuur om te tonen.</p>
            )}
          </div>
        )}
      </article>
    );
  }

  function focusActieIcoon(
    kind: "check" | "mail" | "calendar" | "phone" | "clock" | "bolt" | "pin"
  ) {
    const common = "h-4 w-4";
    switch (kind) {
      case "check":
        return (
          <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
            <path
              d="M8 12.5 10.8 15.2 16.2 9.5"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case "mail":
        return (
          <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
            <rect
              x="3.5"
              y="5.5"
              width="17"
              height="13"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="m4 7 8 6 8-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case "calendar":
        return (
          <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
            <rect
              x="3.5"
              y="5"
              width="17"
              height="15"
              rx="1.5"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path d="M8 3.5v3M16 3.5v3M3.5 9.5h17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        );
      case "phone":
        return (
          <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
            <path
              d="M8.5 4.5h2.2l1 4.2-1.7 1a10 10 0 0 0 4.3 4.3l1-1.7 4.2 1v2.2A2 2 0 0 1 17.5 18 13.5 13.5 0 0 1 6 6.5a2 2 0 0 1 2.5-2Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        );
      case "clock":
        return (
          <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
            <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 7.5V12l3.2 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        );
      case "bolt":
        return (
          <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
            <path
              d="M13 3 6.5 13.5H12l-1 7.5L18.5 10H13L13 3Z"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        );
      case "pin":
        return (
          <svg viewBox="0 0 24 24" fill="none" className={common} aria-hidden>
            <path
              d="M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <circle cx="12" cy="11" r="2" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        );
    }
  }

  /** Actiekaart: icoon + titel + wat er gebeurt. */
  function focusActieKaart(opts: {
    icon: "check" | "mail" | "calendar" | "phone" | "clock" | "bolt" | "pin";
    titel: string;
    uitleg: string;
    onClick: () => void;
    disabled?: boolean;
    tone?: "default" | "green" | "orange" | "soft-orange";
  }) {
    const tone = opts.tone || "default";
    const shell =
      tone === "green"
        ? "border-green/40 bg-green text-white hover:bg-green-dark"
        : tone === "orange"
          ? "border-orange/40 bg-orange text-white hover:opacity-90"
          : tone === "soft-orange"
            ? "border-[#F3D2B8] bg-[#FFF4EB] text-ink hover:bg-[#FFE8D6]"
            : "border-line bg-white text-ink hover:bg-wash";
    const iconWrap =
      tone === "green" || tone === "orange"
        ? "bg-white/20 text-white"
        : tone === "soft-orange"
          ? "bg-orange/15 text-orange"
          : "bg-wash text-ink";
    const uitlegCls =
      tone === "green" || tone === "orange"
        ? "text-white/85"
        : "text-muted";
    return (
      <button
        type="button"
        disabled={opts.disabled}
        onClick={opts.onClick}
        className={[
          "flex w-full items-center gap-2.5 border px-2.5 py-2.5 text-left transition disabled:opacity-45",
          shell,
        ].join(" ")}
      >
        <span
          className={[
            "inline-flex h-9 w-9 shrink-0 items-center justify-center",
            iconWrap,
          ].join(" ")}
        >
          {focusActieIcoon(opts.icon)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-snug">
            {opts.titel}
          </span>
          <span className={["mt-0.5 block text-[11px] leading-snug", uitlegCls].join(" ")}>
            {opts.uitleg}
          </span>
        </span>
        <span className="shrink-0 text-sm opacity-60" aria-hidden>
          ›
        </span>
      </button>
    );
  }

  /** Datum/tijd voor vervolg — compact, boven de actiekaarten. */
  function focusWanneerKiezer() {
    return (
      <div className="space-y-1.5 border border-line bg-white px-2.5 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
          Wanneer?
        </p>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            onClick={() => setOpvolgMode("algemeen")}
            className={[
              "h-8 text-[11px] font-semibold",
              opvolgMode === "algemeen"
                ? "bg-ink text-white"
                : "border border-line bg-white text-ink hover:bg-wash",
            ].join(" ")}
          >
            Algemeen
          </button>
          <button
            type="button"
            onClick={() => setOpvolgMode("specifiek")}
            className={[
              "h-8 text-[11px] font-semibold",
              opvolgMode === "specifiek"
                ? "bg-ink text-white"
                : "border border-line bg-white text-ink hover:bg-wash",
            ].join(" ")}
          >
            Specifiek
          </button>
        </div>
        <p className="text-[11px] leading-snug text-muted">
          {opvolgMode === "algemeen"
            ? "Die dag zonder vast tijdstip — tussen de andere acties."
            : "Vast moment (klant afspraak of zelf gekozen) + optionele notitie."}
        </p>
        <div
          className={
            opvolgMode === "specifiek"
              ? "grid grid-cols-2 gap-1.5"
              : "grid grid-cols-1"
          }
        >
          <label className="block min-w-0">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Datum
            </span>
            <input
              type="date"
              value={opvolgDate}
              onChange={(e) => setOpvolgDate(e.target.value)}
              className="h-9 w-full border border-line bg-white px-2 text-[12px] text-ink"
            />
          </label>
          {opvolgMode === "specifiek" ? (
            <label className="block min-w-0">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
                Tijd
              </span>
              <input
                type="time"
                value={opvolgTime}
                onChange={(e) => setOpvolgTime(e.target.value)}
                className="h-9 w-full border border-line bg-white px-2 text-[12px] text-ink"
              />
            </label>
          ) : null}
        </div>
        {opvolgMode === "specifiek" ? (
          <label className="block">
            <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted">
              Notitie
            </span>
            <textarea
              value={opvolgNote}
              onChange={(e) => setOpvolgNote(e.target.value)}
              rows={2}
              placeholder="Bijv. bel na 14:00 / klant op werk"
              className="w-full resize-none border border-line bg-white px-2 py-1.5 text-[12px] text-ink placeholder:text-muted"
            />
          </label>
        ) : null}
      </div>
    );
  }

  /**
   * Vervolg-actiekaarten (terugbel / betaalt later).
   * Datum komt uit focusWanneerKiezer erboven.
   */
  function focusVervolgBlok(
    actie: BackofficeActie,
    opts?: { factuurUitkomst?: boolean }
  ) {
    const busyOpvolg = busyId === `${actie.id}-opvolg`;
    const busyBetaalt = busyId === `${actie.id}-aangegeven`;
    const whenLabel =
      opvolgMode === "specifiek"
        ? `${formatFocusDayLabel(opvolgDate)} ${opvolgTime}`
        : formatFocusDayLabel(opvolgDate);

    return (
      <div className="space-y-1.5">
        {focusWanneerKiezer()}
        {opts?.factuurUitkomst ? (
          focusActieKaart({
            icon: "calendar",
            titel: `Betaalt later · ${formatFocusDayLabel(opvolgDate)}`,
            uitleg:
              "Klant heeft een betaaldatum doorgegeven. Die dag komt “betaling controleren” terug.",
            disabled: !actie.factuurId || busyBetaalt,
            onClick: () => void setAangegevenTeBetalen(actie, opvolgDate),
          })
        ) : null}
        {focusActieKaart({
          icon: "phone",
          titel: "Niet bereikt",
          uitleg: "Geen gehoor — automatisch morgen opnieuw in de actielijst.",
          disabled: !actie.projectId || busyOpvolg,
          tone: "soft-orange",
          onClick: () => void planOpvolging(actie, "niet_bereikt"),
        })}
        {focusActieKaart({
          icon: "clock",
          titel: `Zet terugbel · ${whenLabel}`,
          uitleg:
            opvolgMode === "specifiek"
              ? "Zet een terugbel-actie op dit exacte moment."
              : "Zet een terugbel-actie op die dag, zonder vast tijdstip.",
          disabled: !actie.projectId || busyOpvolg,
          tone: "orange",
          onClick: () => void planOpvolging(actie, "wacht_klant"),
        })}
      </div>
    );
  }

  function categoryPillForRow(row: TaskRow): { label: string; className: string } {
    if (row.actie.soort === "bel_schouw_aanbetaling") {
      const m = SECTION_META.stap1;
      return { label: m.label, className: m.accent };
    }
    // WF wacht-extern: pill = fase (Afspraak / Goedkeuring), niet generiek Warmtefonds
    if (
      row.kind === "wacht_warmtefonds" &&
      (row.section === "wf_afspraak" || row.section === "wf_goedkeuring")
    ) {
      const m = SECTION_META[row.section];
      return {
        label:
          row.section === "wf_afspraak"
            ? "Afspraak WF"
            : "Wachten op goedkeuring WF",
        className: m.accent,
      };
    }
    const fromType = TYPE_PILL[row.kind];
    if (fromType) return fromType;
    const m = SECTION_META[row.section];
    return {
      label: m?.label || "Actie",
      className: m?.accent || "bg-wash text-muted",
    };
  }

  return (
    <div
      className={
        actionView
          ? "flex h-[calc(100dvh-5.25rem)] max-h-[calc(100dvh-5.25rem)] flex-col overflow-hidden px-3 pt-2 pb-2"
          : "space-y-4 px-5 pb-6 pt-4"
      }
    >
      {error && (
        <p className="shrink-0 border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-1.5 text-sm text-[#C45A12]">
          {error}
        </p>
      )}
      {msg ? (
        <p className="shrink-0 border border-green/30 bg-green-soft px-3 py-1.5 text-sm text-green-dark">
          {msg}
        </p>
      ) : null}

      {actionView ? null : (
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-ink">
            Acties
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Overzicht — open focusmodus om per dag te werken
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted">
            <select
              value={medewerkerId}
              onChange={(e) => setMedewerkerId(e.target.value)}
              className="min-w-[10rem] border border-line bg-white px-2.5 py-2 text-sm text-ink outline-none focus:border-green"
            >
              {adviseurId ? (
                <option value={adviseurId}>Mijn acties</option>
              ) : null}
              <option value="">Alle medewerkers</option>
              {medewerkers
                .filter((a) => a.id !== adviseurId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.naam}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => openActionView()}
            className="bg-orange px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            Focusmodus →
          </button>
        </div>
      </div>
      )}

      {actionView ? null : (
      <div className="flex flex-wrap items-center gap-1 border-b border-line">
        {ACTIE_BUCKETS.map((b) => {
          const active = bucket === b.id;
          const n = bucketCounts[b.id];
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setBucket(b.id);
                setSelectedKey(null);
                setExpandedRow(null);
                setActionView(false);
              }}
              className={[
                "inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition",
                active
                  ? "border-orange text-orange"
                  : "border-transparent text-muted hover:text-ink",
              ].join(" ")}
            >
              <span
                className={
                  active
                    ? b.id === "te_laat"
                      ? "text-[#C62828]"
                      : "text-orange"
                    : "text-muted"
                }
              >
                <BucketIcon icon={b.icon} className="h-4 w-4" />
              </span>
              {b.label}
              <span
                className={[
                  "tabular-nums",
                  active ? "text-ink" : "text-muted",
                ].join(" ")}
              >
                {n}
              </span>
            </button>
          );
        })}
        <div className="ml-auto pb-2">
          <input
            type="search"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek…"
            className="w-40 border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-green sm:w-52"
          />
        </div>
      </div>
      )}

      {actionView ? null : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Soort
          </span>
          {SOORT_FILTER_ORDER.filter((id) => {
            if (id === "alle") return true;
            return (soortCounts[id] || 0) > 0;
          }).map((id) => {
            const active = soortFilter === id;
            const n = soortCounts[id] || 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSoortFilter(id);
                  setSelectedKey(null);
                  setExpandedRow(null);
                }}
                className={[
                  "inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-semibold transition",
                  active
                    ? "bg-ink text-white"
                    : "border border-line bg-white text-muted hover:border-ink/30 hover:text-ink",
                ].join(" ")}
              >
                {soortFilterLabel(id)}
                {id !== "alle" ? (
                  <span
                    className={
                      active ? "tabular-nums text-white/70" : "tabular-nums"
                    }
                  >
                    {n}
                  </span>
                ) : (
                  <span
                    className={
                      active ? "tabular-nums text-white/70" : "tabular-nums"
                    }
                  >
                    {soortCounts.alle || 0}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {showCreate && !actionView ? (
        <div className="space-y-3 border border-line bg-wash px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Nieuwe actie
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-xs text-muted sm:col-span-2 lg:col-span-3">
              Omschrijving *
              <input
                type="text"
                value={newTitel}
                onChange={(e) => setNewTitel(e.target.value)}
                placeholder="Bijv. Klant nabellen over planning"
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
            </label>
            <label className="block text-xs text-muted sm:col-span-2 lg:col-span-3">
              Extra notitie
              <textarea
                value={newOmschrijving}
                onChange={(e) => setNewOmschrijving(e.target.value)}
                rows={2}
                placeholder="Optioneel"
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
            </label>
            <label className="block text-xs text-muted">
              Project *
              <select
                value={newProjectId}
                onChange={(e) => setNewProjectId(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              >
                <option value="">Kies project…</option>
                {projectOpties.map((p) => {
                  const leadNaam =
                    leads.find((l) => l.id === p.lead_id)?.naam || "";
                  return (
                    <option key={p.id} value={p.id}>
                      {p.project_nummer}
                      {leadNaam ? ` · ${leadNaam}` : ""}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="block text-xs text-muted">
              Medewerker *
              <select
                value={newPersonId}
                onChange={(e) => setNewPersonId(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              >
                <option value="">Kies medewerker…</option>
                {medewerkers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.naam}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-muted">
              Deadline *
              <input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              />
            </label>
            <label className="block text-xs text-muted">
              Afdeling
              <select
                value={newAfdeling}
                onChange={(e) => setNewAfdeling(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
              >
                {PROJECT_AFDELINGEN.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            disabled={creating}
            onClick={() => void createHandmatigeActie()}
            className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-dark disabled:opacity-50"
          >
            {creating ? "Bezig…" : "Actie aanmaken"}
          </button>
        </div>
      ) : null}

      {actionView ? null : (
      <div className="min-w-0 space-y-3">
      {tabEmpty ? (
        <div className="border border-line bg-white px-4 py-14 text-center text-sm text-muted">
          <p>Geen openstaande acties in deze filter.</p>
          {medewerkerId && openRows.length > 0 ? (
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed">
              Er zijn wel {openRows.length} openstaande acties in totaal. Kies{" "}
              <button
                type="button"
                onClick={() => setMedewerkerId("")}
                className="font-semibold text-green-deeper underline"
              >
                Alle medewerkers
              </button>
              . Warmtefonds “in behandeling” staat onder{" "}
              <button
                type="button"
                onClick={() => {
                  setMedewerkerId("");
                  setBucket("wacht_extern");
                }}
                className="font-semibold text-green-deeper underline"
              >
                Wacht op extern
              </button>
              .
            </p>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto border border-line bg-white">
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-wash/40 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                <th className="px-3 py-2.5 font-semibold">Klant / project</th>
                <th className="px-3 py-2.5 font-semibold">Wat moet ik doen?</th>
                <th className="w-[9rem] px-3 py-2.5 font-semibold">Eigenaar</th>
                <th className="w-[11rem] px-3 py-2.5 font-semibold">
                  Deadline
                </th>
                <th className="w-[6.5rem] px-3 py-2.5 text-right font-semibold">
                  {" "}
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleNazorgTaken.map((taak) => {
                    const overdue =
                      Boolean(taak.due_at) &&
                      new Date(taak.due_at!).getTime() < Date.now();
                    const leadNaam =
                      taak.projecten?.leads?.naam ||
                      leads.find((l) => l.id === taak.projecten?.lead_id)
                        ?.naam ||
                      "—";
                    const due = taak.due_at || new Date().toISOString();
                    const pill = deadlinePill({
                      dueAt: due,
                      overdue,
                      vastgelopen: overdue && calendarDaysUntil(due) <= -2,
                    });
                    const eigenaarNaam =
                      taak.verantwoordelijke?.naam ||
                      adviseurs.find((a) => a.id === taak.verantwoordelijke_id)
                        ?.naam ||
                      "Niet toegewezen";
                    return (
                      <tr
                        key={taak.id}
                        className="border-b border-line last:border-b-0 hover:bg-[#FAFBFA]"
                      >
                        <td className="px-3 py-3 align-middle">
                          <p className="font-semibold text-ink">{leadNaam}</p>
                          {taak.projecten?.project_nummer ? (
                            <p className="mt-0.5 font-mono text-[11px] text-muted">
                              {taak.projecten.project_nummer}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-ink">{taak.titel}</p>
                            <span className="rounded-sm bg-[#F3F0FF] px-1.5 py-0.5 text-[10px] font-semibold text-[#5B21B6]">
                              Nazorg
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-muted">
                            After sales
                          </p>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-soft text-[10px] font-bold text-green-deeper">
                              {initialsVanNaam(eigenaarNaam)}
                            </span>
                            <span className="truncate text-xs font-medium text-ink">
                              {eigenaarNaam.split(" ")[0]}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 align-middle">
                          <p className="text-[12px] font-semibold tabular-nums text-ink">
                            {pill.when}
                          </p>
                          <p
                            className={[
                              "mt-0.5 text-[11px] font-semibold",
                              pill.className,
                            ].join(" ")}
                          >
                            {pill.label}
                          </p>
                        </td>
                        <td className="px-3 py-3 align-middle text-right">
                          <div className="flex justify-end gap-1.5">
                            {taak.project_id && isOverstapNazorgTaak(taak) ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setOverstapMail({
                                    projectId: taak.project_id,
                                    taakId: taak.id,
                                    klantNaam: leadNaam,
                                    projectNummer:
                                      taak.projecten?.project_nummer || null,
                                  })
                                }
                                className="inline-flex h-8 items-center border border-line px-2.5 text-[11px] font-semibold text-ink hover:bg-wash"
                              >
                                Open →
                              </button>
                            ) : taak.project_id ? (
                              <Link
                                href={`/projecten/${taak.project_id}`}
                                className="inline-flex h-8 items-center border border-line px-2.5 text-[11px] font-semibold text-ink hover:bg-wash"
                              >
                                Open →
                              </Link>
                            ) : null}
                            <button
                              type="button"
                              disabled={busyId === taak.id}
                              onClick={() => void voltooiHandmatigeTaak(taak)}
                              className="inline-flex h-8 items-center bg-green px-2.5 text-[11px] font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                            >
                              {busyId === taak.id ? "…" : "Afronden"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              {visibleRows.map((row) => {
                const actie = row.actie;
                const isSelected = selectedKey === row.key;
                const duePill = deadlinePill({
                  dueAt: row.dueAt,
                  overdue: row.overdue,
                  vastgelopen: actie.vastgelopen,
                });
                const eigenaar = eigenaarVoorActie(
                  actie,
                  projecten,
                  adviseurs,
                  defaultEigenaarId
                );
                const cat = categoryPillForRow(row);

                return (
                  <tr
                    key={row.key}
                    onClick={() => openActionView(row.key)}
                    className={[
                      "cursor-pointer border-b border-line last:border-b-0",
                      isSelected
                        ? "bg-green-soft/60"
                        : "hover:bg-[#FAFBFA]",
                    ].join(" ")}
                  >
                    <td className="px-3 py-3 align-middle">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink">{row.klant}</p>
                        <span
                          className={[
                            "rounded-sm px-1.5 py-0.5 text-[10px] font-semibold",
                            cat.className,
                          ].join(" ")}
                        >
                          {cat.label}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[11px] text-muted">
                        {actie.projectNummer ||
                          actie.offerteNummer ||
                          "—"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <p className="font-semibold leading-snug text-ink">
                        {row.titel}
                      </p>
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted">
                        {actie.detail ||
                          actie.reden ||
                          actie.annuleringsReden ||
                          row.meta ||
                          "—"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-green-soft text-[10px] font-bold text-green-deeper">
                          {eigenaar.initials}
                        </span>
                        <span className="truncate text-xs font-medium text-ink">
                          {eigenaar.naam.split(" ")[0]}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-middle">
                      <p className="text-[12px] font-semibold tabular-nums text-ink">
                        {duePill.when}
                      </p>
                      <p
                        className={[
                          "mt-0.5 text-[11px] font-semibold",
                          duePill.className,
                        ].join(" ")}
                      >
                        {duePill.label}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 align-middle text-right">
                      <span
                        className={[
                          "inline-flex h-8 items-center px-3 text-[11px] font-semibold",
                          isSelected
                            ? "bg-orange text-white"
                            : "border border-line text-ink",
                        ].join(" ")}
                      >
                        Open →
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {geenEigenaarCount > 0 ? (
        <p className="text-[11px] text-muted">
          {geenEigenaarCount} zonder eigenaar — standaard Tarik.
        </p>
      ) : null}
      </div>
      )}

      {actionView ? (() => {
        const actie = selectedRow?.actie;
        const project = actie?.project;
        const warmtefonds = project ? isWarmtefondsProject(project) : false;
        const lead = actie
          ? leads.find((l) => l.id === actie.leadId) || null
          : null;
        const tel = actie?.telefoon || lead?.telefoon || null;
        const hasNotes =
          Boolean(project?.backoffice_notitie?.trim()) ||
          Boolean(project?.installateur_notitie?.trim());

        return (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden border border-line bg-white">
            {/* Dagkiezer + terugbel-zoek */}
            <div className="shrink-0 space-y-1.5 border-b border-line px-3 py-2 sm:px-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setJumpPinnedKey(null);
                      setFocusJumpQ("");
                      setActionView(false);
                    }}
                    className="text-xs font-semibold text-muted hover:text-ink"
                  >
                    ← Lijst
                  </button>
                  <span
                    className="hidden h-4 w-px bg-line sm:block"
                    aria-hidden
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => shiftFocusDay(-1)}
                      aria-label="Vorige dag"
                      className="inline-flex h-9 w-9 items-center justify-center border border-line bg-white text-ink hover:bg-wash"
                    >
                      ‹
                    </button>
                    <label className="relative">
                      <span className="sr-only">Datum</span>
                      <input
                        type="date"
                        value={focusDayKey}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
                            setJumpPinnedKey(null);
                            setFocusDayKey(v);
                          }
                        }}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                      <span className="inline-flex h-9 min-w-[11rem] items-center justify-center border border-line bg-wash px-3 text-sm font-semibold capitalize text-ink">
                        {focusDayLabel}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => shiftFocusDay(1)}
                      aria-label="Volgende dag"
                      className="inline-flex h-9 w-9 items-center justify-center border border-line bg-white text-ink hover:bg-wash"
                    >
                      ›
                    </button>
                  </div>
                  {focusDayKey !== todayKey ? (
                    <button
                      type="button"
                      onClick={() => {
                        setJumpPinnedKey(null);
                        setFocusDayKey(todayKey);
                      }}
                      className="h-9 border border-line bg-white px-2.5 text-xs font-semibold text-ink hover:bg-wash"
                    >
                      Vandaag
                    </button>
                  ) : null}
                  <p className="text-xs text-muted">
                    <span className="font-semibold tabular-nums text-ink">
                      {visibleRows.length}
                    </span>{" "}
                    {visibleRows.length === 1 ? "actie" : "acties"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-muted">
                    <select
                      value={medewerkerId}
                      onChange={(e) => setMedewerkerId(e.target.value)}
                      className="h-9 min-w-[9rem] border border-line bg-white px-2 text-sm text-ink outline-none focus:border-green"
                    >
                      {adviseurId ? (
                        <option value={adviseurId}>Mijn acties</option>
                      ) : null}
                      <option value="">Alle</option>
                      {medewerkers
                        .filter((a) => a.id !== adviseurId)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.naam}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowWachtExtern((v) => !v)}
                    className={[
                      "h-9 border px-2.5 text-xs font-semibold",
                      showWachtExtern
                        ? "border-ink bg-ink text-white"
                        : "border-line bg-white text-muted hover:text-ink",
                    ].join(" ")}
                  >
                    Wacht extern
                  </button>
                </div>
              </div>

              <div className="relative max-w-xl">
                <input
                  type="search"
                  value={focusJumpQ}
                  onChange={(e) => setFocusJumpQ(e.target.value)}
                  placeholder="Terugbel? Zoek op telefoon of postcode…"
                  className="h-10 w-full border border-line bg-white px-3 text-sm text-ink outline-none placeholder:text-muted focus:border-green"
                  autoComplete="off"
                />
                {focusJumpQ.trim().length >= 2 ? (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-y-auto border border-line bg-white shadow-lg">
                    {focusJumpHits.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-muted">
                        Geen openstaande actie voor dit zoekwoord.
                      </p>
                    ) : (
                      <ul>
                        {focusJumpHits.map((row) => {
                          const lead = leads.find(
                            (l) => l.id === row.actie.leadId
                          );
                          const tel =
                            row.actie.telefoon || lead?.telefoon || null;
                          const pc = lead?.postcode || null;
                          const active = row.key === jumpPinnedKey;
                          return (
                            <li key={row.key}>
                              <button
                                type="button"
                                onClick={() => openJumpHit(row)}
                                className={[
                                  "flex w-full flex-col gap-0.5 border-b border-line px-3 py-2.5 text-left last:border-b-0",
                                  active
                                    ? "bg-orange/10"
                                    : "hover:bg-wash",
                                ].join(" ")}
                              >
                                <span className="flex flex-wrap items-baseline justify-between gap-2">
                                  <span className="text-sm font-semibold text-ink">
                                    {row.klant}
                                  </span>
                                  <span className="text-[11px] font-medium text-muted">
                                    {row.actie.projectNummer ||
                                      row.actie.offerteNummer ||
                                      "—"}
                                  </span>
                                </span>
                                <span className="text-[12px] text-ink">
                                  {row.titel}
                                </span>
                                <span className="text-[11px] text-muted">
                                  {[tel, pc, row.actie.plaats || lead?.plaats]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            {!selectedRow || !actie ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-20 text-center">
                <p className="font-display text-xl font-semibold text-ink">
                  Niks voor {focusDayLabel.toLowerCase()}
                </p>
                <p className="max-w-sm text-sm text-muted">
                  Geen openstaande acties op deze dag. Kies een andere datum of
                  open de lijst.
                </p>
                <div className="mt-2 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => shiftFocusDay(1)}
                    className="h-9 border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-wash"
                  >
                    Volgende dag →
                  </button>
                  {focusDayKey !== todayKey ? (
                    <button
                      type="button"
                      onClick={() => setFocusDayKey(todayKey)}
                      className="h-9 bg-orange px-3 text-xs font-semibold text-white hover:opacity-90"
                    >
                      Naar vandaag
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <>
                {/* Klant · acties · pijltjes rechts vast (niet meeschuiven met Bel/Notitie) */}
                <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 sm:px-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="truncate text-sm font-semibold text-ink">
                        {actie.leadNaam}
                      </p>
                      <p className="truncate text-[11px] text-muted">
                        {jumpPinnedKey ? (
                          <>
                            <span className="font-semibold text-orange">
                              Via zoeken
                            </span>
                            {" · "}
                            <button
                              type="button"
                              onClick={exitJumpPin}
                              className="font-semibold text-ink underline-offset-2 hover:underline"
                            >
                              terug
                            </button>
                          </>
                        ) : (
                          <>
                            {selectedIndex + 1}/{visibleRows.length}
                          </>
                        )}
                        {" · "}
                        <span className="font-mono">
                          {actie.projectNummer || actie.offerteNummer || "—"}
                        </span>
                        {warmtefonds ? " · WF" : ""}
                      </p>
                    </div>
                    <p className="truncate text-[12px] font-semibold text-ink">
                      {selectedRow.titel}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center justify-end gap-1.5">
                    {tel ? (
                      <a
                        href={`tel:${tel.replace(/\s/g, "")}`}
                        onClick={() =>
                          void logBelContact(
                            actie,
                            `Gebeld via Acties · ${tel}`
                          )
                        }
                        className="inline-flex h-8 items-center bg-green px-2.5 text-xs font-semibold text-white hover:bg-green-dark"
                      >
                        Bel
                      </a>
                    ) : null}
                    {hasNotes ? (
                      <button
                        type="button"
                        onClick={() => setNotesOpen((v) => !v)}
                        className={[
                          "inline-flex h-8 items-center border px-2 text-[11px] font-semibold",
                          notesOpen
                            ? "border-ink bg-ink text-white"
                            : "border-line bg-white text-ink hover:bg-wash",
                        ].join(" ")}
                      >
                        Notitie
                      </button>
                    ) : null}
                    {actie.projectId ? (
                      <Link
                        href={`/projecten/${actie.projectId}?from=acties`}
                        className="inline-flex h-8 items-center border border-line px-2 text-[11px] font-semibold text-ink hover:bg-wash"
                      >
                        Project
                      </Link>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={!jumpPinnedKey && selectedIndex <= 0}
                      onClick={goPrevActie}
                      aria-label="Vorige actie"
                      className="inline-flex h-8 w-8 items-center justify-center border border-line bg-white text-sm font-semibold text-ink hover:bg-wash disabled:opacity-35"
                    >
                      ‹
                    </button>
                    <button
                      type="button"
                      disabled={
                        !jumpPinnedKey &&
                        (selectedIndex < 0 ||
                          selectedIndex >= visibleRows.length - 1)
                      }
                      onClick={goNextActie}
                      aria-label="Volgende actie"
                      className="inline-flex h-8 w-8 items-center justify-center border border-line bg-white text-sm font-semibold text-ink hover:bg-wash disabled:opacity-35"
                    >
                      ›
                    </button>
                  </div>
                </div>

                {/* Split: links content · rechts acties */}
                <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 overflow-hidden px-3 py-2 lg:grid-cols-[minmax(0,1.25fr)_minmax(17rem,0.9fr)] sm:px-4">
                  {/* LINKS — factuur / agenda */}
                  <div className="min-h-0 overflow-hidden">
                    {selectedRow.kind === "nabellen" ||
                    selectedRow.kind === "wf_aanbetaling_herinnering" ||
                    selectedRow.kind === "factuur_versturen" ? (
                      focusFactuurKaart(
                        (actie.factuurId
                          ? facturen.find((f) => f.id === actie.factuurId)
                          : null) ||
                          aanbetalingDraftsVoorActie(actie, facturen)[0] ||
                          null,
                        actie
                      )
                    ) : selectedRow.kind === "herplan" ? (
                      <div className="flex h-full min-h-0 flex-col overflow-hidden border border-line bg-white">
                        <div className="shrink-0 border-b border-line px-2.5 py-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                            Slimme inplanner
                          </p>
                          <p className="mt-0.5 text-[12px] text-muted">
                            Kies adviseur + beste slot voor {actie.leadNaam}.
                          </p>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2.5">
                          {(() => {
                            const lead =
                              leads.find((l) => l.id === actie.leadId) || null;
                            if (!lead) {
                              return (
                                <div className="space-y-2">
                                  <p className="text-sm text-muted">
                                    Lead niet geladen — open de lead om te
                                    herplannen.
                                  </p>
                                  <Link
                                    href={`/leads/${actie.leadId}`}
                                    className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark"
                                  >
                                    Open lead
                                  </Link>
                                </div>
                              );
                            }
                            return (
                              <LeadAfspraakPlannen
                                lead={lead}
                                adviseurs={adviseurs}
                                onPlanned={() => {
                                  void (async () => {
                                    await voltooiHerplan(actie);
                                    setMsg(
                                      "Afspraak herpland — actie afgerond."
                                    );
                                    if (
                                      selectedIndex >= 0 &&
                                      selectedIndex < visibleRows.length - 1
                                    ) {
                                      goNextActie();
                                    }
                                  })();
                                }}
                              />
                            );
                          })()}
                        </div>
                      </div>
                    ) : selectedRow.kind === "schouw_inplannen" ||
                      selectedRow.kind === "schouw_week" ||
                      (selectedRow.kind === "volgende_stap" &&
                        isInstallatieActie(actie)) ? (
                      <div className="flex h-full min-h-0 flex-col overflow-hidden border border-line bg-white p-2.5">
                        <p className="mb-1.5 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
                          {isInstallatieActie(actie)
                            ? "Installatie-agenda"
                            : "Schouw-agenda"}
                        </p>
                        <div className="min-h-0 flex-1 overflow-y-auto">
                          {(() => {
                            const pid =
                              partnerKeuze[actie.id] ||
                              actie.project?.installatie_partner_id ||
                              defaultPartnerId;
                            if (!pid) {
                              return (
                                <p className="text-sm text-muted">
                                  Kies rechts eerst een partner.
                                </p>
                              );
                            }
                            return (
                              <PartnerSlotPicker
                                partnerId={pid}
                                soort={
                                  isInstallatieActie(actie)
                                    ? "installatie"
                                    : "schouw"
                                }
                                leadId={actie.leadId}
                                projectId={actie.projectId || null}
                                excludeProjectId={actie.projectId || null}
                                compact
                                showBest
                                lockBestToPartner={isInstallatieActie(actie)}
                                afterIso={
                                  isInstallatieActie(actie)
                                    ? actie.project?.schouw_at || null
                                    : null
                                }
                                value={
                                  isInstallatieActie(actie)
                                    ? installatieAtKeuze[actie.id] || null
                                    : schouwAtKeuze[actie.id] || null
                                }
                                onPartnerChange={(id) =>
                                  setPartnerKeuze((p) => ({
                                    ...p,
                                    [actie.id]: id,
                                  }))
                                }
                                onChange={(iso) => {
                                  if (isInstallatieActie(actie)) {
                                    setInstallatieAtKeuze((p) => {
                                      if (!iso) {
                                        const n = { ...p };
                                        delete n[actie.id];
                                        return n;
                                      }
                                      return { ...p, [actie.id]: iso };
                                    });
                                  } else {
                                    setSchouwAtKeuze((p) => {
                                      if (!iso) {
                                        const n = { ...p };
                                        delete n[actie.id];
                                        return n;
                                      }
                                      return { ...p, [actie.id]: iso };
                                    });
                                  }
                                }}
                              />
                            );
                          })()}
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center border border-line bg-wash/40 px-4 text-center text-sm text-muted">
                        {selectedRow.titel}
                      </div>
                    )}
                  </div>

                  {/* RECHTS — wat jij doet (actiekaarten met icoon + uitleg) */}
                  <div className="flex min-h-0 flex-col gap-2 overflow-y-auto border border-line bg-[#FAFBFA] p-2.5">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                        Wat wil je doen?
                      </p>
                      <p className="mt-0.5 text-sm font-semibold leading-snug text-ink">
                        {selectedRow.titel}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted">
                        Kies één uitkomst. Elke knop legt uit wat er gebeurt.
                      </p>
                    </div>

                    {selectedRow.kind === "nabellen" ? (
                      <div className="space-y-1.5">
                        {focusActieKaart({
                          icon: "check",
                          titel:
                            busyId === `${actie.id}-betaald`
                              ? "Bezig…"
                              : "Is betaald → klaar",
                          uitleg:
                            "Betaling is binnen. Factuur wordt gemarkeerd als betaald.",
                          tone: "green",
                          disabled: busyId === `${actie.id}-betaald`,
                          onClick: () => void markFactuurBetaald(actie),
                        })}
                        {focusActieKaart({
                          icon: "mail",
                          titel:
                            busyId === `${actie.id}-herstuur`
                              ? "Bezig…"
                              : "Factuur opnieuw mailen",
                          uitleg:
                            "Stuur de factuur nog eens naar de klant (PDF bijlage).",
                          disabled: busyId === `${actie.id}-herstuur`,
                          onClick: () => void opnieuwVerstuurFactuur(actie),
                        })}
                        {focusVervolgBlok(actie, { factuurUitkomst: true })}
                      </div>
                    ) : selectedRow.kind === "wf_aanbetaling_herinnering" ? (
                      <div className="space-y-1.5">
                        {focusActieKaart({
                          icon: "mail",
                          titel:
                            busyId === `${actie.id}-wf-herinnering`
                              ? "Bezig…"
                              : "Stuur herinneringsmail",
                          uitleg:
                            "Vriendelijke herinnering: aanbetaling nodig voor Warmtefonds-aanvraag.",
                          tone: "orange",
                          disabled:
                            busyId === `${actie.id}-wf-herinnering`,
                          onClick: () =>
                            void stuurWfAanbetalingHerinnering(actie),
                        })}
                        {focusActieKaart({
                          icon: "check",
                          titel:
                            busyId === `${actie.id}-betaald`
                              ? "Bezig…"
                              : "Is betaald → klaar",
                          uitleg:
                            "Aanbetaling is binnen. Factuur markeren als betaald.",
                          tone: "green",
                          disabled: busyId === `${actie.id}-betaald`,
                          onClick: () => void markFactuurBetaald(actie),
                        })}
                        {focusVervolgBlok(actie, { factuurUitkomst: true })}
                      </div>
                    ) : selectedRow.kind === "factuur_versturen" ? (
                      <div className="space-y-1.5">
                        {focusActieKaart({
                          icon: "mail",
                          titel:
                            busyId === `${actie.id}-factuur`
                              ? "Bezig…"
                              : "Versturen naar klant",
                          uitleg:
                            "Maak/verstuur de aanbetalingsfactuur naar de klant.",
                          tone: "green",
                          disabled: busyId === `${actie.id}-factuur`,
                          onClick: () =>
                            void verstuurAanbetalingsFactuur(actie),
                        })}
                        {focusVervolgBlok(actie)}
                      </div>
                    ) : selectedRow.kind === "schouw_inplannen" ||
                      selectedRow.kind === "schouw_week" ||
                      (selectedRow.kind === "volgende_stap" &&
                        isInstallatieActie(actie)) ? (
                      <>
                        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Partner
                          <select
                            value={
                              partnerKeuze[actie.id] ||
                              actie.project?.installatie_partner_id ||
                              defaultPartnerId ||
                              ""
                            }
                            onChange={(e) => {
                              const v = e.target.value;
                              setPartnerKeuze((p) => ({
                                ...p,
                                [actie.id]: v,
                              }));
                              setSchouwAtKeuze((p) => {
                                const n = { ...p };
                                delete n[actie.id];
                                return n;
                              });
                              setInstallatieAtKeuze((p) => {
                                const n = { ...p };
                                delete n[actie.id];
                                return n;
                              });
                            }}
                            className="mt-1 block h-9 w-full border border-line bg-white px-2 text-sm outline-none focus:border-green"
                          >
                            <option value="">Kies partner…</option>
                            {partners.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.naam}
                              </option>
                            ))}
                          </select>
                        </label>
                        {focusActieKaart({
                          icon: "pin",
                          titel:
                            busyId === `${actie.id}-schouw` ||
                            busyId === `${actie.id}-installatie`
                              ? "Bezig…"
                              : isInstallatieActie(actie)
                                ? "Installatie vastleggen"
                                : selectedRow.kind === "schouw_week"
                                  ? "Schouwweek zetten"
                                  : "Schouwdag vastleggen",
                          uitleg: isInstallatieActie(actie)
                            ? "Leg de gekozen installatieslot vast bij de partner."
                            : selectedRow.kind === "schouw_week"
                              ? "Zet de schouwweek (placeholder) op dit project."
                              : "Leg de gekozen schouwslot vast bij de partner.",
                          tone: "orange",
                          disabled:
                            busyId === `${actie.id}-schouw` ||
                            busyId === `${actie.id}-installatie` ||
                            !(
                              partnerKeuze[actie.id] ||
                              actie.project?.installatie_partner_id ||
                              defaultPartnerId
                            ) ||
                            (selectedRow.kind !== "schouw_week" &&
                              !(
                                schouwAtKeuze[actie.id] ||
                                installatieAtKeuze[actie.id]
                              )),
                          onClick: () => {
                            if (
                              selectedRow.kind === "volgende_stap" &&
                              isInstallatieActie(actie)
                            ) {
                              void planInstallatieFromActie(actie);
                            } else {
                              void planSchouwWeek(actie);
                            }
                          },
                        })}
                        {focusVervolgBlok(actie)}
                      </>
                    ) : selectedRow.kind === "herplan" ? (
                      <div className="space-y-1.5">
                        <p className="text-[11px] leading-snug text-muted">
                          Plan links een nieuw slot met de slimme inplanner.
                          Daarna is deze herplan-actie klaar.
                        </p>
                        {focusActieKaart({
                          icon: "pin",
                          titel: "Open inplanner in popup",
                          uitleg:
                            "Zelfde planner als links, in een groter venster.",
                          onClick: () => setHerplanActie(actie),
                        })}
                        {focusVervolgBlok(actie)}
                        {focusActieKaart({
                          icon: "check",
                          titel:
                            busyId === `${actie.id}-afronden`
                              ? "…"
                              : "Al herpland → afronden",
                          uitleg:
                            "Afspraak staat al elders gezet. Rond deze actie af en ga door.",
                          tone: "green",
                          disabled: busyId === `${actie.id}-afronden`,
                          onClick: () => void afrondenEnVolgende(selectedRow),
                        })}
                      </div>
                    ) : (
                      <>
                        {actieWerkPanel(selectedRow, {
                          hideContact: true,
                          compact: true,
                        })}
                        {focusVervolgBlok(actie)}
                      </>
                    )}

                    {notesOpen ? (
                      <div className="max-h-24 overflow-y-auto">
                        <SaleNotitiesAside
                          actie={actie}
                          projecten={projecten}
                          forceShow
                        />
                      </div>
                    ) : null}

                    {selectedRow.kind !== "nabellen" &&
                    selectedRow.kind !== "wf_aanbetaling_herinnering" &&
                    selectedRow.kind !== "factuur_versturen" &&
                    selectedRow.kind !== "schouw_inplannen" &&
                    selectedRow.kind !== "schouw_week" &&
                    selectedRow.kind !== "herplan" &&
                    !(
                      selectedRow.kind === "volgende_stap" &&
                      isInstallatieActie(actie)
                    ) ? (
                      <button
                        type="button"
                        disabled={busyId === `${actie.id}-afronden`}
                        onClick={() => void afrondenEnVolgende(selectedRow)}
                        className="mt-auto flex h-9 w-full items-center justify-center bg-ink text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
                      >
                        {busyId === `${actie.id}-afronden`
                          ? "…"
                          : "Afronden & volgende →"}
                      </button>
                    ) : null}

                    <ActiesEmailInbox
                      email={
                        leads.find((l) => l.id === actie.leadId)?.email || null
                      }
                      leadId={actie.leadId}
                      leadNaam={actie.leadNaam}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })() : null}


      {herplanActie ? (
        <HerplanPopup
          actie={herplanActie}
          lead={leads.find((l) => l.id === herplanActie.leadId) || null}
          adviseurs={adviseurs}
          onClose={() => setHerplanActie(null)}
          onPlanned={async () => {
            const actie = herplanActie;
            setHerplanActie(null);
            await voltooiHerplan(actie);
            setMsg("Afspraak herpland — actie afgerond.");
          }}
        />
      ) : null}

      {inkoopActie ? (
        <InkoopPopup
          actie={inkoopActie}
          onClose={() => setInkoopActie(null)}
        />
      ) : null}

      {overstapMail ? (
        <VerstuurDatumOptieModal
          projectId={overstapMail.projectId}
          klantNaam={overstapMail.klantNaam}
          projectNummer={overstapMail.projectNummer}
          initialSoort="overstap"
          lockSoort
          onClose={() => setOverstapMail(null)}
          onSent={() => {
            setMsg("Overstap-mail verstuurd naar de klant.");
            void loadProjectTaken();
          }}
        />
      ) : null}

      {contactMailProject ? (
        <KlantContactMailModal
          project={contactMailProject}
          initialTemplate="annulering_of_installatie"
          onClose={() => setContactMailProject(null)}
          onSent={() => {
            const p = contactMailProject;
            const completedAt = new Date().toISOString();
            void (async () => {
              try {
                const res = await fetch(`/api/projecten/${p.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    aangetekende_brief_verstuurd_at: completedAt,
                  }),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && (data as { project?: Project }).project) {
                  onProjectUpdated?.(
                    (data as { project: Project }).project
                  );
                  void logBackofficeActieEvent({
                    soort: "aangetekende_brief",
                    leadId: p.lead_id,
                    projectId: p.id,
                    adviseurId,
                    completedAt,
                  });
                }
              } catch {
                /* best-effort */
              }
            })();
            setMsg(
              "Mail verstuurd — over 5 dagen volgt de controle-actie (dag 6: factuur indien geen reactie)."
            );
            setContactMailProject(null);
          }}
        />
      ) : null}
    </div>
  );
}

function InkoopPopup({
  actie,
  onClose,
}: {
  actie: BackofficeActie;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal
        aria-label="Materiaal inkopen"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden border border-line bg-white shadow-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Purchasing · inkoop
            </p>
            <h2 className="mt-0.5 font-display text-xl font-semibold text-ink">
              {actie.leadNaam || "Materiaal bestellen"}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {[actie.projectNummer, actie.plaats].filter(Boolean).join(" · ") ||
                "Standaard accessoires bij Apex"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-wash"
          >
            Sluiten
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <ul className="grid gap-3 sm:grid-cols-3">
            {INKOOP_PRODUCT_IMAGES.map((p) => (
              <li
                key={p.key}
                className="flex flex-col overflow-hidden border border-line bg-wash"
              >
                <div className="flex aspect-square items-center justify-center bg-[#0a0a0a] p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.imageSrc}
                    alt={p.naam}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <p className="text-sm font-semibold leading-snug text-ink">
                    {p.naam}
                  </p>
                  <a
                    href={apexProductUrl(p.sku, p.naam)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-auto text-xs font-semibold text-green-dark hover:underline"
                  >
                    Apex → winkelwagen
                  </a>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
            <Link
              href="/?tab=purchasing"
              className="inline-flex h-10 items-center bg-orange px-4 text-sm font-semibold text-white hover:opacity-90"
            >
              Open purchasing-tab
            </Link>
            {actie.projectId ? (
              <Link
                href={`/projecten/${actie.projectId}?from=acties`}
                className="inline-flex h-10 items-center border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-wash"
              >
                Open project
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function HerplanPopup({
  actie,
  lead,
  adviseurs,
  onClose,
  onPlanned,
}: {
  actie: BackofficeActie;
  lead: Lead | null;
  adviseurs: Adviseur[];
  onClose: () => void;
  onPlanned: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal
        aria-label="Afspraak herplannen"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden border border-line bg-white shadow-xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Herplannen
            </p>
            <h2 className="mt-0.5 font-display text-xl font-semibold text-ink">
              {actie.leadNaam}
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {[actie.telefoon, actie.plaats].filter(Boolean).join(" · ") ||
                "Kies adviseur + slot via route planner"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-line bg-white px-3 py-1.5 text-sm font-semibold text-ink hover:bg-wash"
          >
            Sluiten
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {lead ? (
            <LeadAfspraakPlannen
              lead={lead}
              adviseurs={adviseurs}
              onCancel={onClose}
              onPlanned={onPlanned}
            />
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Lead niet in geheugen — open de lead om te herplannen.
              </p>
              <Link
                href={`/leads/${actie.leadId}`}
                className="inline-flex h-10 items-center bg-green px-4 text-sm font-semibold text-white hover:bg-green-dark"
              >
                Open lead
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
