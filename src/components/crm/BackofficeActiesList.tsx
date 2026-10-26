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
  actiesVoorActiesTab,
  openBackofficeActies,
  recommendedSchouwWeekForProject,
  saleMomentVanProject,
  type BackofficeActie,
} from "@/lib/backoffice-acties";
import { logBackofficeActieEvent } from "@/lib/backoffice-actie-events";
import { formatEuro } from "@/lib/format";
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
  isKickoffComplete,
  kickoffWarmtefondsBedragen,
  projectKickoffItems,
} from "@/lib/project-kickoff";
import { LeadAfspraakPlannen } from "./LeadAfspraakPlannen";
import { PartnerSlotPicker } from "./PartnerSlotPicker";
import { INKOOP_PRODUCT_IMAGES } from "@/lib/inkoop-product-images";
import { apexProductUrl } from "@/lib/apex-product-url";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";

type SectionId =
  | "herplan"
  | "schouw"
  | "volgende"
  | "inkoop"
  | "warmtefonds"
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
    | "nabellen"
    | "aangetekende_brief";
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
    nabellen: {
      label: "Factuur",
      className: "bg-[#FFF0E6] text-[#C45A12]",
    },
    aangetekende_brief: {
      label: "Aangetekend",
      className: "bg-[#FFF0E6] text-[#9A3B1A]",
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

const SOORT_FILTER_ORDER: SoortFilter[] = [
  "alle",
  "stap1",
  "schouw",
  "factuur",
  "inkoop",
  "volgende",
  "warmtefonds",
  "herplan",
  "aangetekend",
  "handmatig",
  "nazorg",
];

function soortFilterLabel(id: SoortFilter): string {
  if (id === "alle") return "Alles";
  if (id === "nazorg") return "Nazorg";
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

function isWachtOpExtern(actie: BackofficeActie): boolean {
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

function bucketVoorActie(
  actie: BackofficeActie,
  now = new Date()
): ActieBucket {
  if (isWachtOpExtern(actie) && !actie.overdue && !actie.vastgelopen) {
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

function SaleNotities({
  actie,
  projecten,
}: {
  actie: BackofficeActie;
  projecten: Project[];
}) {
  const project =
    actie.project ||
    (actie.projectId
      ? projecten.find((p) => p.id === actie.projectId)
      : projecten.find((p) => p.lead_id === actie.leadId));
  if (!project) return null;

  const backoffice = project.backoffice_notitie?.trim() || "";
  const installateur = project.installateur_notitie?.trim() || "";
  if (!backoffice && !installateur) return null;

  return (
    <div className="mt-1.5 space-y-1 rounded border border-line/80 bg-wash/40 px-2 py-1.5 text-[11px] leading-snug text-muted">
      {backoffice ? (
        <p>
          <span className="font-semibold text-ink">Backoffice</span>
          {project.backoffice_notitie_door?.trim() ? (
            <span className="text-[10px] text-muted">
              {" "}
              · {project.backoffice_notitie_door.trim()}
            </span>
          ) : null}
          <span className="mt-0.5 block whitespace-pre-wrap text-ink/90">
            {backoffice}
          </span>
        </p>
      ) : null}
      {installateur ? (
        <p className={backoffice ? "border-t border-line/60 pt-1" : ""}>
          <span className="font-semibold text-ink">Installateur</span>
          {project.installateur_notitie_door?.trim() ? (
            <span className="text-[10px] text-muted">
              {" "}
              · {project.installateur_notitie_door.trim()}
            </span>
          ) : null}
          <span className="mt-0.5 block whitespace-pre-wrap text-ink/90">
            {installateur}
          </span>
        </p>
      ) : null}
    </div>
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
      rows.push({
        key: `${actie.id}-wf-wacht`,
        section: "warmtefonds",
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
        titel: `Nabellen ${actie.factuurNummer || "factuur"}`,
        klant: actie.leadNaam,
        meta: actie.factuurNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue,
        done: false,
      });
      continue;
    }
    if (actie.soort === "bel_schouw_aanbetaling") {
      const drafts = draftFacturenVoorActie(actie, facturen);
      const sent = verzondenFacturenVoorActie(actie, facturen);
      const needsFactuur =
        Number(actie.project?.aanbetaling_te_innen_inc) > 0 ||
        drafts.length > 0 ||
        sent.length > 0;
      const factuurDone = !needsFactuur || sent.length > 0;
      const schouwDone = Boolean(
        actie.project?.schouw_week || actie.project?.schouw_at
      );

      if (needsFactuur) {
        rows.push({
          key: `${actie.id}-factuur`,
          section: "stap1",
          actie,
          kind: "factuur_versturen",
          titel: "Aanbetalingsfactuur versturen",
          klant: actie.leadNaam,
          meta: actie.projectNummer || undefined,
          dueAt: actie.deadlineAt,
          overdue: actie.overdue && !factuurDone,
          done: factuurDone,
        });
      }
      rows.push({
        key: `${actie.id}-schouw`,
        section: "stap1",
        actie,
        kind: "schouw_week",
        titel: "Schouwweek plannen",
        klant: actie.leadNaam,
        meta: actie.projectNummer || undefined,
        dueAt: actie.deadlineAt,
        overdue: actie.overdue && !schouwDone,
        done: schouwDone,
      });
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
  const [weekKeuze, setWeekKeuze] = useState<Record<string, string>>({});
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
   */
  const [medewerkerId, setMedewerkerId] = useState("");
  /** Focusmodus: werkvolgorde + checklist + klant (zoals mockup Action view). */
  const [actionView, setActionView] = useState(false);
  /** Welke gekoppelde gesprek-stappen openstaan in de zijkant. */
  const [gesprekOpen, setGesprekOpen] = useState<Record<string, boolean>>({});
  const [edwinGestuurd, setEdwinGestuurd] = useState(false);
  /** Laatste bel-moment in deze sessie (Action view). */
  const [laatsteContactAt, setLaatsteContactAt] = useState<string | null>(null);
  const [herplanActie, setHerplanActie] = useState<BackofficeActie | null>(
    null
  );
  const [inkoopActie, setInkoopActie] = useState<BackofficeActie | null>(null);

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

  // Session/adviseurs laden asynchroon → default filter één keer zetten
  const filterDefaultGezet = useRef(false);
  useEffect(() => {
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
  }, [adviseurId, adviseurs]);
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

  const openRows = useMemo(() => rows.filter((r) => !r.done), [rows]);

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
          projectStatus === "geannuleerd"
        ) {
          return false;
        }
        const key = (t.auto_key || "").toLowerCase();
        const titel = (t.titel || "").toLowerCase();
        return (
          key.includes("overstap") ||
          key.includes("btw_terug") ||
          titel.includes("overstap") ||
          titel.includes("btw terug") ||
          titel.includes("dynamische")
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
      if (bucketVoorActie(r.actie) !== bucket) return false;
      if (soortFilter === "nazorg") return false;
      if (soortFilter !== "alle" && r.section !== soortFilter) return false;
      if (medewerkerId) {
        const eigenaar = eigenaarVoorActie(
          r.actie,
          projecten,
          adviseurs,
          defaultEigenaarId
        );
        if (eigenaar.id !== medewerkerId) return false;
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
    bucket,
    soortFilter,
    zoek,
    medewerkerId,
    projecten,
    adviseurs,
    defaultEigenaarId,
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

  const selectedRow = useMemo(
    () => visibleRows.find((r) => r.key === selectedKey) || null,
    [visibleRows, selectedKey]
  );

  const selectedIsKickoff =
    selectedRow?.actie.soort === "bel_schouw_aanbetaling" ||
    selectedRow?.kind === "factuur_versturen" ||
    selectedRow?.kind === "schouw_week";

  const selectedProjectFacturen = useMemo(() => {
    const pid = selectedRow?.actie.projectId;
    if (!pid) return [] as Factuur[];
    return facturen.filter((f) => f.project_id === pid || f.offerte_id === selectedRow?.actie.offerteId);
  }, [facturen, selectedRow]);

  const selectedKickoffItems = useMemo(() => {
    const project = selectedRow?.actie.project;
    if (!project || !selectedIsKickoff) return [];
    return projectKickoffItems(project, selectedProjectFacturen);
  }, [selectedRow, selectedIsKickoff, selectedProjectFacturen]);

  // Bij selectie: gekoppelde stappen openklappen (open items + focus op gekozen soort)
  useEffect(() => {
    const row = visibleRows.find((r) => r.key === selectedKey) || null;
    if (!row) {
      setGesprekOpen({});
      setEdwinGestuurd(false);
      return;
    }
    const isKickoff =
      row.actie.soort === "bel_schouw_aanbetaling" ||
      row.kind === "factuur_versturen" ||
      row.kind === "schouw_week";
    if (isKickoff && row.actie.project) {
      const pid = row.actie.projectId;
      const related = facturen.filter(
        (f) =>
          f.project_id === pid ||
          (row.actie.offerteId && f.offerte_id === row.actie.offerteId)
      );
      const items = projectKickoffItems(row.actie.project, related);
      const next: Record<string, boolean> = {};
      for (const item of items) next[item.id] = !item.done;
      if (row.kind === "factuur_versturen") next.aanbetaling = true;
      if (row.kind === "schouw_week") next.schouwweek = true;
      setGesprekOpen(next);
    } else {
      setGesprekOpen({ [row.kind]: true });
    }
    setEdwinGestuurd(false);
    setLaatsteContactAt(null);
    // Alleen bij wissel van geselecteerde rij
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

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
      const project = await patchProject(actie, {
        bel_schouw_aanbetaling_at: completedAt,
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
    if (actie.soort === "nabellen_factuur") {
      setError(
        "Factuur-acties verwijder je door de factuur als betaald te markeren, of via het factuur-scherm."
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

  async function maybeCompleteStap1(
    actie: BackofficeActie,
    opts: {
      factuurDone?: boolean;
      schouwDone?: boolean;
      project?: Project;
    }
  ) {
    const project = opts.project || actie.project;
    const schouwDone =
      opts.schouwDone || Boolean(project?.schouw_week || project?.schouw_at);
    const drafts = draftFacturenVoorActie(actie, facturen);
    const sent = verzondenFacturenVoorActie(actie, facturen);
    const needsFactuur =
      Number(project?.aanbetaling_te_innen_inc) > 0 || drafts.length > 0;
    const factuurDone =
      opts.factuurDone || !needsFactuur || sent.length > 0 || drafts.length === 0;
    if (schouwDone && factuurDone && actie.projectId) {
      const completedAt = new Date().toISOString();
      await patchProject(actie, {
        bel_schouw_aanbetaling_at: completedAt,
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
        "Aangetekende brief markeren als verstuurd/afgerond? De actie verdwijnt dan uit de lijst."
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
      setMsg("Aangetekende brief gemarkeerd als afgerond.");
    }
  }

  async function markFactuurBetaald(actie: BackofficeActie) {
    if (!actie.factuurId) return;
    if (!confirm(`Factuur ${actie.factuurNummer || ""} markeren als betaald?`)) {
      return;
    }
    setBusyId(actie.id);
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
      void loadProjectTaken();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Markeren mislukt");
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
    const drafts = draftFacturenVoorActie(actie, facturen);
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

  /** Niet bereikt → morgen opnieuw (handmatige opvolgtaak). */
  async function planOpvolging(
    actie: BackofficeActie,
    soort: "niet_bereikt" | "wacht_klant"
  ) {
    if (!actie.projectId) {
      setError("Geen project om opvolging op te zetten.");
      return;
    }
    const due = new Date();
    due.setDate(due.getDate() + (soort === "wacht_klant" ? 3 : 1));
    due.setHours(17, 0, 0, 0);
    const titel =
      soort === "wacht_klant"
        ? `Wacht op klant: ${actie.titel}`
        : `Nabellen (niet bereikt): ${actie.titel}`;
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
          verantwoordelijke_id:
            medewerkerId || adviseurId || defaultEigenaarId || undefined,
          due_at: due.toISOString(),
          notities:
            soort === "wacht_klant"
              ? "Via Acties: wacht op reactie klant"
              : "Via Acties: klant niet bereikt",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opvolging mislukt"
        );
      }
      await logBelContact(
        actie,
        soort === "wacht_klant" ? "Wacht op klant" : "Niet bereikt"
      );
      setMsg(
        soort === "wacht_klant"
          ? "Opvolging gezet: wacht op klant (over 3 dagen)."
          : "Opvolging gezet: morgen opnieuw bellen."
      );
      void loadProjectTaken();
      // Door naar volgende in focusmodus
      if (actionView) {
        if (selectedIndex >= 0 && selectedIndex < visibleRows.length - 1) {
          goNextActie();
        } else {
          setActionView(false);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opvolging mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function afrondenEnVolgende(row: TaskRow) {
    const actie = row.actie;
    setBusyId(`${actie.id}-afronden`);
    setError(null);
    try {
      if (
        selectedIsKickoff &&
        actie.project &&
        isKickoffComplete(actie.project, selectedProjectFacturen)
      ) {
        await maybeCompleteStap1(actie, {
          factuurDone: true,
          schouwDone: true,
          project: actie.project,
        });
        setMsg("Kickoff afgerond.");
      } else if (row.kind === "herplan") {
        await voltooiHerplan(actie);
      } else if (row.kind === "nabellen") {
        await markFactuurBetaald(actie);
      } else if (row.kind === "financiering") {
        await markFinancieringGeschakeld(actie);
      } else if (row.kind === "aangetekende_brief") {
        await markAangetekendeBriefAfgerond(actie);
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

      if (selectedIndex >= 0 && selectedIndex < visibleRows.length - 1) {
        goNextActie();
      } else {
        setActionView(false);
        setExpandedRow(null);
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
    return t.includes("installatie");
  }

  /** Werkpaneel: echte knoppen per actiesoort (lijst + action view). */
  function actieWerkPanel(
    row: TaskRow,
    opts?: { hideContact?: boolean }
  ) {
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
        row.kind === "volgende_stap" ? (
          <p className="text-[12px] leading-relaxed text-muted">
            <span className="font-semibold text-ink">Waarom: </span>
            {actie.reden || actie.detail}
          </p>
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

          {row.kind === "nabellen" ? (
            <button
              type="button"
              onClick={() => void markFactuurBetaald(actie)}
              className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark"
            >
              Markeer betaald
            </button>
          ) : null}

          {row.kind === "aangetekende_brief" ? (
            <button
              type="button"
              disabled={busyId === `${actie.id}-aangetekend`}
              onClick={() => void markAangetekendeBriefAfgerond(actie)}
              className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
            >
              Brief afgerond
            </button>
          ) : null}

          {actie.projectId ? (
            <Link
              href={`/projecten/${actie.projectId}?from=acties`}
              className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold text-ink hover:bg-wash"
            >
              Open project
            </Link>
          ) : null}
        </div>

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
          row.kind === "schouw_inplannen") ? (
          <div className="space-y-3 border border-line bg-white px-4 py-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wash text-[11px] font-bold text-muted">
                1
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">
                  {actie.planSchouwdag || row.kind === "schouw_inplannen"
                    ? "Exacte schouwdag afspreken"
                    : "Schouwweek zetten"}
                </p>
                {actie.schouwWeekLabel ? (
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
                  <div className="mt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Beschikbaar slot
                    </p>
                    <div className="mt-1.5">
                      <PartnerSlotPicker
                        partnerId={selectedPartner}
                        soort="schouw"
                        leadId={actie.leadId}
                        excludeProjectId={actie.projectId || null}
                        value={selectedSchouwAt || null}
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
                  className="mt-4 inline-flex h-10 items-center bg-orange px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
                >
                  {busyId === `${actie.id}-schouw`
                    ? "Bezig…"
                    : actie.planSchouwdag || row.kind === "schouw_inplannen"
                      ? "Schouwdag vastleggen"
                      : "Schouwweek zetten"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Kickoff aanbetaling (compact) */}
        {row.kind === "factuur_versturen" && !restfactuur ? (
          <div className="rounded-sm border border-line bg-white px-3.5 py-3">
            <p className="text-sm font-semibold text-ink">Factuur versturen</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {drafts.length > 1 ? (
                <select
                  value={selectedFactuur}
                  onChange={(e) =>
                    setFactuurKeuze((p) => ({
                      ...p,
                      [actie.id]: e.target.value,
                    }))
                  }
                  className="h-9 border border-line bg-white px-2 text-xs"
                >
                  <option value="">Concept…</option>
                  {drafts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.factuur_nummer}
                    </option>
                  ))}
                </select>
              ) : null}
              <button
                type="button"
                disabled={busyId === `${actie.id}-factuur`}
                onClick={() => void verstuurAanbetalingsFactuur(actie)}
                className="inline-flex h-9 items-center bg-green px-3 text-xs font-semibold text-white disabled:opacity-50"
              >
                {drafts.length === 0 ? "Aanmaken & versturen" : "Versturen"}
              </button>
            </div>
          </div>
        ) : null}

        {row.kind === "volgende_stap" && installatie && !restfactuur ? (
          <p className="text-[12px] text-muted">
            Installatie plannen doe je op het project (agenda / partner-slots).
            {actie.projectId ? (
              <>
                {" "}
                <Link
                  href={`/projecten/${actie.projectId}?from=acties`}
                  className="font-semibold text-green-deeper hover:underline"
                >
                  Open project →
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>
    );
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

  function openActionView(key?: string) {
    const target =
      key ||
      selectedKey ||
      visibleRows[0]?.key ||
      null;
    if (!target) return;
    setSelectedKey(target);
    setExpandedRow(null);
    setActionView(true);
  }

  function goPrevActie() {
    if (selectedIndex <= 0) return;
    setSelectedKey(visibleRows[selectedIndex - 1].key);
  }

  function goNextActie() {
    if (selectedIndex < 0 || selectedIndex >= visibleRows.length - 1) return;
    setSelectedKey(visibleRows[selectedIndex + 1].key);
  }

  function categoryPillForRow(row: TaskRow): { label: string; className: string } {
    if (row.actie.soort === "bel_schouw_aanbetaling") {
      const m = SECTION_META.stap1;
      return { label: m.label, className: m.accent };
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
    <div className="space-y-4 px-5 pb-6 pt-4">
      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-sm text-[#C45A12]">
          {error}
        </p>
      )}
      {msg ? (
        <p className="border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-dark">
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
            Je werkvoorraad, op volgorde van deadline
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
            disabled={visibleRows.length === 0}
            onClick={() => openActionView()}
            className="bg-orange px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Start Action view →
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

      {actionView && selectedRow ? null : (
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
                            {taak.project_id ? (
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

      {actionView && selectedRow ? (() => {
        const actie = selectedRow.actie;
        const due = deadlinePill({
          dueAt: selectedRow.dueAt,
          overdue: selectedRow.overdue,
          vastgelopen: actie.vastgelopen,
        });
        const project = actie.project;
        const warmtefonds = project ? isWarmtefondsProject(project) : false;
        const drafts = draftFacturenVoorActie(actie, facturen);
        const saleAt = actie.saleAt
          ? new Date(actie.saleAt)
          : project
            ? saleMomentVanProject(project)
            : new Date();
        const recommended = project
          ? recommendedSchouwWeekForProject(project, saleAt)
          : { jaar: saleAt.getFullYear(), week: 1 };
        const recommendedValue = schouwWeekValue(
          recommended.jaar,
          recommended.week
        );
        const selectedWeek = weekKeuze[actie.id] || recommendedValue;
        const selectedFactuur =
          factuurKeuze[actie.id] ||
          (drafts.length === 1 ? drafts[0].id : "");
        const selectedPartner =
          partnerKeuze[actie.id] ||
          project?.installatie_partner_id ||
          defaultPartnerId;
        const bedragen = project
          ? kickoffWarmtefondsBedragen(project, selectedProjectFacturen)
          : { aanbetalingInc: null, warmtefondsInc: null };
        const lead = leads.find((l) => l.id === actie.leadId) || null;
        const tel = actie.telefoon || lead?.telefoon || null;
        const eigenaar = selectedEigenaar;
        const canFinish = selectedIsKickoff
          ? Boolean(
              project &&
                isKickoffComplete(project, selectedProjectFacturen)
            )
          : true;

        const doel = selectedIsKickoff
          ? warmtefonds
            ? "Schouwweek afspreken, BTW-factuur versturen en Warmtefonds-overdracht vastleggen."
            : "Schouwweek afspreken en aanbetalingsfactuur versturen."
          : selectedRow.kind === "schouw_inplannen"
            ? "Exacte schouwdag en tijd met de klant afspreken."
            : selectedRow.kind === "herplan"
              ? "Nieuwe afspraak inplannen."
              : selectedRow.kind === "bestel_materiaal"
                ? "Materiaalbestelling vastleggen."
                : selectedRow.kind === "financiering"
                  ? "Warmtefonds / financiering oppakken."
                  : selectedRow.kind === "wacht_warmtefonds"
                    ? "Wachten tot Warmtefonds goedgekeurd is — daarna schouw plannen."
                    : selectedRow.kind === "nabellen"
                      ? "Openstaande betaling afronden."
                      : isRestfactuurActie(actie)
                        ? "Restfactuur opstellen en versturen."
                        : isInstallatieActie(actie)
                          ? "Installatie inplannen."
                          : actie.reden || null;

        return (
          <div className="flex min-h-[min(78vh,44rem)] flex-col border border-line bg-white">
            {/* Top: navigatie */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setActionView(false)}
                  className="text-xs font-semibold text-muted hover:text-ink"
                >
                  ← Lijst
                </button>
                <p className="text-xs text-muted">
                  Taak{" "}
                  <span className="font-semibold text-ink">
                    {selectedIndex + 1}
                  </span>{" "}
                  van {visibleRows.length}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={selectedIndex <= 0}
                  onClick={goPrevActie}
                  className="h-8 border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-35"
                >
                  Vorige
                </button>
                <button
                  type="button"
                  disabled={
                    selectedIndex < 0 ||
                    selectedIndex >= visibleRows.length - 1
                  }
                  onClick={goNextActie}
                  className="h-8 border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-35"
                >
                  Volgende
                </button>
              </div>
            </div>

            {/* Queue: horizontale strip */}
            <div className="flex gap-1.5 overflow-x-auto border-b border-line bg-wash/50 px-3 py-2">
              {visibleRows.map((row, idx) => {
                const active = row.key === selectedRow.key;
                const rowDue = deadlinePill({
                  dueAt: row.dueAt,
                  overdue: row.overdue,
                  vastgelopen: row.actie.vastgelopen,
                });
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => setSelectedKey(row.key)}
                    title={`${row.klant} — ${row.titel}`}
                    className={[
                      "shrink-0 border px-2.5 py-1.5 text-left transition",
                      active
                        ? "border-orange bg-white shadow-sm"
                        : "border-transparent bg-transparent hover:border-line hover:bg-white",
                    ].join(" ")}
                  >
                    <p className="max-w-[9rem] truncate text-[11px] font-semibold text-ink">
                      {idx + 1}. {row.klant}
                    </p>
                    <p
                      className={[
                        "mt-0.5 text-[10px] font-medium",
                        rowDue.className,
                      ].join(" ")}
                    >
                      {rowDue.when.split(" - ")[0]}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Klantstrip */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center bg-green-soft text-[11px] font-bold text-green-deeper">
                  {initialsVanNaam(actie.leadNaam)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {actie.leadNaam}
                  </p>
                  <p className="truncate text-[11px] text-muted">
                    <span className="font-mono">
                      {actie.projectNummer || actie.offerteNummer || "—"}
                    </span>
                    {warmtefonds ? " · Warmtefonds" : ""}
                    {eigenaar
                      ? ` · ${eigenaar.naam.split(" ")[0]}`
                      : ""}
                    {laatsteContactAt
                      ? ` · contact ${formatInTimeZone(
                          new Date(laatsteContactAt),
                          AMSTERDAM_TZ,
                          "d MMM HH:mm",
                          { locale: nl }
                        )}`
                      : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={[
                    "inline-flex items-center px-2 py-1 text-[11px] font-semibold",
                    selectedRow.overdue || actie.vastgelopen
                      ? "bg-[#FEE2E2] text-[#991B1B]"
                      : "bg-[#FFF0E6] text-[#C45A12]",
                  ].join(" ")}
                >
                  {due.when}
                </span>
                {tel ? (
                  <a
                    href={`tel:${tel.replace(/\s/g, "")}`}
                    onClick={() =>
                      void logBelContact(
                        actie,
                        `Gebeld via Acties · ${tel}`
                      )
                    }
                    className="inline-flex h-9 items-center gap-1.5 bg-green px-3.5 text-xs font-semibold text-white hover:bg-green-dark"
                  >
                    Bel {tel}
                  </a>
                ) : null}
                {actie.projectId ? (
                  <Link
                    href={`/projecten/${actie.projectId}?from=acties`}
                    className="inline-flex h-9 items-center border border-line px-3 text-xs font-semibold text-ink hover:bg-wash"
                  >
                    Project
                  </Link>
                ) : null}
              </div>
            </div>

            {/* Werkruimte */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <div className="mx-auto w-full max-w-2xl space-y-5">
                <div>
                  <h3 className="font-display text-xl font-semibold leading-snug text-ink sm:text-[1.4rem]">
                    {selectedRow.titel}
                  </h3>
                  {doel ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
                      {doel}
                    </p>
                  ) : null}
                </div>

                {selectedIsKickoff && selectedKickoffItems.length > 0 ? (
                  <ol className="space-y-2">
                    {selectedKickoffItems.map((item, idx) => (
                      <li
                        key={item.id}
                        className={[
                          "border px-4 py-3.5",
                          item.done
                            ? "border-green/20 bg-green-soft/20"
                            : "border-line bg-white",
                        ].join(" ")}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={[
                              "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center text-[11px] font-bold",
                              item.done
                                ? "bg-green text-white"
                                : "bg-wash text-muted",
                            ].join(" ")}
                          >
                            {item.done ? "✓" : idx + 1}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink">
                              {item.label}
                            </p>
                            {item.detail ? (
                              <p className="mt-0.5 text-[11px] text-muted">
                                {item.detail}
                                {item.id === "aanbetaling" &&
                                bedragen.aanbetalingInc != null
                                  ? ` · ${formatEuro(bedragen.aanbetalingInc)}`
                                  : ""}
                              </p>
                            ) : null}

                            {!item.done && item.id === "aanbetaling" ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                {drafts.length > 1 ? (
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
                                    <option value="">Draft…</option>
                                    {drafts.map((f) => (
                                      <option key={f.id} value={f.id}>
                                        {f.factuur_nummer}
                                      </option>
                                    ))}
                                  </select>
                                ) : null}
                                <button
                                  type="button"
                                  disabled={busyId === `${actie.id}-factuur`}
                                  onClick={() =>
                                    void verstuurAanbetalingsFactuur(actie)
                                  }
                                  className="h-9 bg-green px-3.5 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
                                >
                                  {busyId === `${actie.id}-factuur`
                                    ? "Bezig…"
                                    : drafts.length === 0
                                      ? "Aanmaken & versturen"
                                      : "Factuur versturen"}
                                </button>
                              </div>
                            ) : null}

                            {!item.done && item.id === "wf_afspraak" ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  disabled={busyId === `${actie.id}-edwin`}
                                  onClick={async () => {
                                    setBusyId(`${actie.id}-edwin`);
                                    try {
                                      const bericht =
                                        edwinWarmtefondsWhatsappBericht({
                                          leadNaam: actie.leadNaam,
                                          telefoon:
                                            actie.telefoon ||
                                            lead?.telefoon ||
                                            null,
                                          straat: lead?.straat || null,
                                          postcode: lead?.postcode || null,
                                          huisnummer:
                                            lead?.huisnummer || null,
                                          toevoeging:
                                            lead?.toevoeging || null,
                                          plaats:
                                            actie.plaats ||
                                            lead?.plaats ||
                                            null,
                                          offerteNummer:
                                            actie.offerteNummer || null,
                                          projectNummer:
                                            actie.projectNummer || null,
                                          aanbetalingInc:
                                            bedragen.aanbetalingInc,
                                          warmtefondsInc:
                                            bedragen.warmtefondsInc,
                                        });
                                      window.open(
                                        edwinWhatsappUrl(bericht),
                                        "_blank"
                                      );
                                      setEdwinGestuurd(true);
                                    } finally {
                                      setBusyId(null);
                                    }
                                  }}
                                  className="h-9 bg-[#25D366] px-3.5 text-xs font-semibold text-white disabled:opacity-50"
                                >
                                  WhatsApp {FINANCIERINGSMAN_NAAM}
                                </button>
                                {edwinGestuurd ? (
                                  <button
                                    type="button"
                                    disabled={
                                      busyId === `${actie.id}-edwin-done`
                                    }
                                    onClick={async () => {
                                      if (!actie.projectId) return;
                                      setBusyId(`${actie.id}-edwin-done`);
                                      try {
                                        const res = await fetch(
                                          `/api/projecten/${actie.projectId}`,
                                          {
                                            method: "PATCH",
                                            headers: {
                                              "Content-Type":
                                                "application/json",
                                            },
                                            body: JSON.stringify({
                                              financiering_status:
                                                "doorgestuurd_naar_edwin",
                                            }),
                                          }
                                        );
                                        const data = await res
                                          .json()
                                          .catch(() => ({}));
                                        if (!res.ok) {
                                          throw new Error(
                                            (data as { error?: string })
                                              .error || "Mislukt"
                                          );
                                        }
                                        if (data.project) {
                                          onProjectUpdated?.(
                                            data.project as Project
                                          );
                                        }
                                        setMsg(
                                          "Warmtefonds-overdracht vastgelegd."
                                        );
                                      } catch (e) {
                                        setError(
                                          e instanceof Error
                                            ? e.message
                                            : "Mislukt"
                                        );
                                      } finally {
                                        setBusyId(null);
                                      }
                                    }}
                                    className="h-9 border border-line px-3 text-xs font-semibold text-ink hover:bg-wash"
                                  >
                                    Afvinken
                                  </button>
                                ) : null}
                              </div>
                            ) : null}

                            {!item.done && item.id === "schouwweek" ? (
                              <div className="mt-3 flex flex-wrap items-end gap-2">
                                <label className="min-w-[12rem] flex-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                  Schouwweek
                                  <select
                                    value={selectedWeek}
                                    onChange={(e) =>
                                      setWeekKeuze((p) => ({
                                        ...p,
                                        [actie.id]: e.target.value,
                                      }))
                                    }
                                    className="mt-1 block h-9 w-full border border-line bg-white px-2.5 text-xs outline-none focus:border-green"
                                  >
                                    {weekOptions.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label}
                                        {o.value === recommendedValue
                                          ? " · aanbevolen"
                                          : ""}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                                  Partner
                                  <select
                                    value={selectedPartner}
                                    onChange={(e) =>
                                      setPartnerKeuze((p) => ({
                                        ...p,
                                        [actie.id]: e.target.value,
                                      }))
                                    }
                                    className="mt-1 block h-9 min-w-[10rem] border border-line bg-white px-2.5 text-xs outline-none focus:border-green"
                                  >
                                    <option value="">Kies…</option>
                                    {partners.map((p) => (
                                      <option key={p.id} value={p.id}>
                                        {p.naam}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <button
                                  type="button"
                                  disabled={
                                    busyId === `${actie.id}-schouw` ||
                                    !selectedPartner
                                  }
                                  onClick={() => void planSchouwWeek(actie)}
                                  className="h-9 bg-orange px-3.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                                >
                                  Schouwweek zetten
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                ) : (
                  actieWerkPanel(selectedRow, { hideContact: true })
                )}
              </div>
            </div>

            {/* Footer: opvolgen + afronden */}
            <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-white px-4 py-3 sm:px-5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === `${actie.id}-opvolg`}
                  onClick={() => void planOpvolging(actie, "niet_bereikt")}
                  className="h-9 border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
                >
                  Niet bereikt
                </button>
                <button
                  type="button"
                  disabled={busyId === `${actie.id}-opvolg`}
                  onClick={() => void planOpvolging(actie, "wacht_klant")}
                  className="h-9 border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
                >
                  Wacht op klant
                </button>
              </div>
              <div className="flex flex-col items-stretch gap-1 sm:items-end">
                <button
                  type="button"
                  disabled={
                    !canFinish || busyId === `${actie.id}-afronden`
                  }
                  onClick={() => void afrondenEnVolgende(selectedRow)}
                  className="h-10 bg-orange px-5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busyId === `${actie.id}-afronden`
                    ? "Bezig…"
                    : "Afronden & volgende →"}
                </button>
                {!canFinish ? (
                  <p className="text-[11px] text-muted">
                    Rond eerst de stappen hierboven af.
                  </p>
                ) : null}
              </div>
            </div>
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
