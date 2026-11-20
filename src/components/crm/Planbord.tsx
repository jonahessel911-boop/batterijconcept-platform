"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type {
  InstallatiePartner,
  InstallatiePartnerKoppel,
  InstallatiePartnerTeamgenoot,
  Project,
  ServiceVerzoek,
} from "@/types/database";
import {
  AMSTERDAM_TZ,
  adresRegel,
  formatDateShort,
  formatDateTimeNl,
  formatTimeNl,
} from "@/lib/format";
import {
  normalizeProjectStatus,
  resolveInstallateurStatusLabel,
  resolveProjectStatusLabel,
} from "@/lib/labels";
import { isOrderVolledigBetaald } from "@/lib/aanbetaling";
import {
  FOTO_BATTERIJ_OMSCHRIJVING,
  FOTO_METERKAST_OMSCHRIJVING,
  isFotoBatterij,
  isFotoMeterkast,
  isOpleveringsrapportBewijs,
  isSchouwFormulierBewijs,
  isServiceFoto,
  isVideoInstallatie,
  OPLEVERINGSRAPPORT_OMSCHRIJVING,
  SERVICE_FOTO_OMSCHRIJVING,
  SCHOUW_FORMULIER_OMSCHRIJVING,
  VIDEO_INSTALLATIE_OMSCHRIJVING,
} from "@/lib/project-documenten";
import { validateInstallatieVideoDuration } from "@/lib/installatie-video";
import { batterijPurchasingStatus } from "@/lib/project-inkoop-checklist";
import { medewerkerNaamVanProject } from "@/lib/project-medewerker";
import {
  koppelBevatMonteur,
  koppelWeergaveNaam,
} from "@/lib/installatie-koppel";
import {
  installatieProductRegelsVoorMonteur,
  isInstallatieProductRegel,
} from "@/lib/offerte-regels";
import { installatieBatterijKortLabel } from "@/lib/offerte-batterij-merk";
import {
  isServiceVvInstallatie,
  SERVICE_VV_INSTALLATIE,
} from "@/lib/oplever-formulier";
import { toOperationalStatus } from "@/lib/project-status-config";
import {
  duurMinutenVoorKind,
  formatDuurLabel,
} from "@/lib/planning-duur";
import { resolveMateriaalLeverdatum } from "@/lib/materiaal-leverdatum";
import { OpleverFormulierModal } from "@/components/crm/OpleverFormulierModal";
import { PartnerSlotPicker } from "@/components/crm/PartnerSlotPicker";
import { SchouwFormulierModal } from "@/components/crm/SchouwFormulierModal";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Check, Copy, Phone, UserRound, Users, X } from "lucide-react";
import {
  agendaWeekJumpOptions,
  isSchouwdagDefinitief,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import {
  MAX_INSTALLATIES_PER_DAG,
  PARTNER_VENSTERS,
  installatieDuurMinutenVanaf,
  partnerAfblokKey,
  vensterBoundsUtc,
  type PartnerVenster,
} from "@/lib/partner-slots";
import {
  PORTAL_INSTALLATIES_VANAF,
  isInstallatieVanafCutoff,
} from "@/lib/installatie-vanaf";
import {
  feestdagOp,
  feestdagPlanningFout,
} from "@/lib/nl-feestdagen";

type PlanSoort = "schouwweek" | "schouwdag" | "installatie" | "service";
type AgendaView = "week" | "dag" | "maand" | "lijst";

type PlanbordBar = {
  key: string;
  project: Project;
  kind: "schouwweek" | "schouw" | "installatie" | "service" | "levering";
  /** Inclusive day keys in the visible week */
  dayKeys: string[];
  label: string;
  /** Exacte datum/tijd voor weergave */
  whenLabel: string | null;
  /** ISO starttijd (null bij alleen schouwweek) */
  at: string | null;
  duurMinuten: number;
  partnerId: string | null;
  /** Kort product, bijv. "Alpha ESS 9,3" */
  batterijKort?: string | null;
};

type DayCol = { key: string; date: Date; weekend: boolean };

/** Geannuleerde orders horen niet op het planbord. */
function isActiefOpPlanbord(p: Project): boolean {
  const st = normalizeProjectStatus(p.status);
  // HOLD hoort bij Offertes tot sales het fixt; annulering blijft uit planbord
  return st !== "annulering" && st !== "hold_sales_actie";
}

function leadOf(p: Project) {
  return Array.isArray(p.leads) ? p.leads[0] : p.leads;
}

function partnerOf(p: Project) {
  return Array.isArray(p.installatie_partners)
    ? p.installatie_partners[0]
    : p.installatie_partners;
}

function weekDaysFrom(anchor: Date): DayCol[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const dow = date.getDay();
    return {
      // Altijd Amsterdam-kalenderdag — niet machine-timezone via format()
      key: formatInTimeZone(
        fromZonedTime(
          new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            12,
            0,
            0
          ),
          AMSTERDAM_TZ
        ),
        AMSTERDAM_TZ,
        "yyyy-MM-dd"
      ),
      date,
      weekend: dow === 0 || dow === 6,
    };
  });
}

function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDatetimeForDay(dayKey: string, hour = 9): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const local = new Date(y, m - 1, d, hour, 0, 0, 0);
  return toDatetimeLocalValue(local);
}

function projectTitle(p: Project): string {
  const lead = leadOf(p);
  return p.titel?.trim() || lead?.naam || p.project_nummer || "Project";
}

function klantNaam(p: Project): string {
  const lead = leadOf(p);
  return lead?.naam?.trim() || p.titel?.trim() || p.project_nummer || "Klant";
}

/** Achternaam voor compacte matrix: "H. Roest - Riemer" → "Roest - Riemer". */
function klantAchternaam(p: Project): string {
  const naam = klantNaam(p);
  const initials = naam.match(/^(?:[A-Z]\.\s*)+(.+)$/i);
  if (initials?.[1]) return initials[1].trim();
  const parts = naam.trim().split(/\s+/);
  if (parts.length >= 2) return parts.slice(1).join(" ");
  return naam;
}

function koppelRijLabel(k: InstallatiePartnerKoppel): string {
  const naam = (k.naam || "").trim();
  if (naam) return naam;
  return koppelWeergaveNaam(k);
}

function installatieKoppelIdVoorBar(
  bar: PlanbordBar,
  koppels: InstallatiePartnerKoppel[]
): string | null {
  const id = bar.project.installatie_koppel_id;
  if (id) return id;
  const tg = bar.project.installatie_teamgenoot_id;
  if (tg) {
    const viaMonteur = koppels.find((k) => koppelBevatMonteur(k, tg));
    if (viaMonteur) return viaMonteur.id;
  }
  const partnerId =
    bar.project.installatie_partner_id || bar.partnerId || null;
  if (!partnerId) return null;
  const vanPartner = koppels.filter((k) => k.partner_id === partnerId);
  if (vanPartner.length === 1) return vanPartner[0].id;
  return null;
}

function offerteRegelsVanProject(p: Project): {
  omschrijving?: string | null;
  aantal?: number | null;
}[] {
  const off = Array.isArray(p.offertes) ? p.offertes[0] : p.offertes;
  const regels = (
    off as { offerte_regels?: { omschrijving?: string | null; aantal?: number | null }[] } | null
  )?.offerte_regels;
  return Array.isArray(regels) ? regels : [];
}

function batterijKortVoorProject(
  p: Project,
  labels?: Record<string, string>
): string | null {
  const fromMap = p.offerte_id ? labels?.[p.offerte_id] : null;
  if (fromMap) return fromMap;
  return installatieBatterijKortLabel(offerteRegelsVanProject(p));
}

function installatieKopTekst(bar: PlanbordBar): string {
  return bar.batterijKort
    ? `Installatie - ${bar.batterijKort}`
    : "Installatie";
}

function stampBatterijOpBars(
  bars: PlanbordBar[],
  labels: Record<string, string>
): PlanbordBar[] {
  return bars.map((b) =>
    b.kind === "installatie"
      ? { ...b, batterijKort: batterijKortVoorProject(b.project, labels) }
      : b
  );
}

type OfferteRegelKort = {
  omschrijving?: string | null;
  aantal?: number | null;
  prijs_ex_btw?: number | null;
  sort_order?: number | null;
};

function productenUitOfferteRegels(
  regels: OfferteRegelKort[]
): { omschrijving: string; aantal: number }[] {
  const producten = installatieProductRegelsVoorMonteur(regels);
  if (producten.length > 0) return producten;
  return regels
    .filter((r) =>
      isInstallatieProductRegel({
        omschrijving: r.omschrijving,
        prijs_ex_btw: r.prijs_ex_btw,
      })
    )
    .map((r) => ({
      omschrijving: (r.omschrijving || "").trim(),
      aantal: Math.max(1, Number(r.aantal) || 1),
    }))
    .filter((r) => r.omschrijving);
}

function klantPlaats(p: Project): string | null {
  return leadOf(p)?.plaats?.trim() || null;
}

function projectSearchText(p: Project): string {
  const lead = leadOf(p);
  const adres = lead ? adresRegel(lead) : "";
  return [
    p.project_nummer,
    p.titel,
    lead?.naam,
    lead?.plaats,
    lead?.straat,
    lead?.postcode,
    adres,
    partnerOf(p)?.naam,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function barMatchesAgendaFilter(
  bar: PlanbordBar,
  filter: { kind: "all" } | { kind: "person"; id: string } | { kind: "koppel"; id: string },
  koppels: InstallatiePartnerKoppel[]
): boolean {
  if (filter.kind === "all") return true;
  const p = bar.project;
  const isSchouw = bar.kind === "schouw" || bar.kind === "schouwweek";
  if (filter.kind === "person") {
    if (isSchouw) return p.installatie_teamgenoot_id === filter.id;
    if (bar.kind === "installatie") {
      if (p.installatie_koppel_id) {
        const k = koppels.find((x) => x.id === p.installatie_koppel_id);
        return koppelBevatMonteur(k, filter.id);
      }
      return p.installatie_teamgenoot_id === filter.id;
    }
    if (bar.kind === "service") {
      return p.service_teamgenoot_id === filter.id;
    }
    return p.installatie_teamgenoot_id === filter.id;
  }
  if (bar.kind === "installatie") {
    return p.installatie_koppel_id === filter.id;
  }
  const k = koppels.find((x) => x.id === filter.id);
  if (bar.kind === "service") {
    return koppelBevatMonteur(k, p.service_teamgenoot_id);
  }
  return koppelBevatMonteur(k, p.installatie_teamgenoot_id);
}

/** Alleen definitieve schouwdagen / installaties — geen schouwweken. */
function barsForWeek(
  projects: Project[],
  days: DayCol[],
  opts?: { installatieVanaf?: string | null }
): PlanbordBar[] {
  if (!days.length) return [];
  const daySet = new Set(days.map((d) => d.key));
  const bars: PlanbordBar[] = [];

  for (const p of projects) {
    if (!isActiefOpPlanbord(p)) continue;
    const partnerId = p.installatie_partner_id || partnerOf(p)?.id || null;
    const title = projectTitle(p);

    // Alleen definitieve schouwdag — niet de week-placeholder (maandag 12:00).
    if (p.schouw_at && isSchouwdagDefinitief(p)) {
      const key = dayKeyAmsterdam(p.schouw_at);
      if (daySet.has(key)) {
        bars.push({
          key: `${p.id}-schouw`,
          project: p,
          kind: "schouw",
          dayKeys: [key],
          label: `Schouw · ${formatTimeNl(p.schouw_at)} · ${title}`,
          whenLabel: formatDateTimeNl(p.schouw_at),
          at: p.schouw_at,
          duurMinuten: duurMinutenVoorKind("schouw"),
          partnerId,
        });
      }
    }

    if (
      p.installatie_at &&
      (!opts?.installatieVanaf ||
        isInstallatieVanafCutoff(p.installatie_at, null, opts.installatieVanaf))
    ) {
      const key = dayKeyAmsterdam(p.installatie_at);
      if (daySet.has(key)) {
        bars.push({
          key: `${p.id}-installatie`,
          project: p,
          kind: "installatie",
          dayKeys: [key],
          label: `Installatie · ${formatTimeNl(p.installatie_at)} · ${title}`,
          whenLabel: formatDateTimeNl(p.installatie_at),
          at: p.installatie_at,
          duurMinuten: installatieDuurMinutenVanaf(p.installatie_at),
          partnerId,
        });
      }
    }

    if (p.service_at) {
      const key = dayKeyAmsterdam(p.service_at);
      if (daySet.has(key)) {
        bars.push({
          key: `${p.id}-service`,
          project: p,
          kind: "service",
          dayKeys: [key],
          label: `Service · ${formatTimeNl(p.service_at)} · ${title}`,
          whenLabel: formatDateTimeNl(p.service_at),
          at: p.service_at,
          duurMinuten: duurMinutenVoorKind("service"),
          partnerId,
        });
      }
    }

    const leverdatum = resolveMateriaalLeverdatum(p);
    if (leverdatum) {
      const key = dayKeyAmsterdam(leverdatum);
      if (daySet.has(key)) {
        bars.push({
          key: `${p.id}-levering`,
          project: p,
          kind: "levering",
          dayKeys: [key],
          label: `LEVERING - INKOOP - ${title}`,
          whenLabel: formatDateShort(leverdatum),
          at: leverdatum,
          duurMinuten: duurMinutenVoorKind("levering"),
          partnerId,
        });
      }
    }
  }

  return bars;
}

function isBarPast(bar: PlanbordBar, now = new Date()): boolean {
  if (bar.kind === "installatie") {
    const st = normalizeProjectStatus(bar.project.status);
    if (
      st === "installatie_voltooid" ||
      st === "after_sale" ||
      st === "review_gevraagd" ||
      st === "afgerond" ||
      st === "service"
    ) {
      return true;
    }
  }
  if (!bar.at) return false;
  const end =
    new Date(bar.at).getTime() + Math.max(bar.duurMinuten, 1) * 60_000;
  return end < now.getTime();
}

type LaidOutDayBar = {
  bar: PlanbordBar;
  col: number;
  colCount: number;
};

/** Zet overlappende afspraken naast elkaar (zelfde starttijd = beide zichtbaar). */
function layoutDayBars(bars: PlanbordBar[]): LaidOutDayBar[] {
  const sorted = [...bars]
    .filter((b) => b.at)
    .sort(
      (a, b) =>
        (a.at || "").localeCompare(b.at || "") || a.key.localeCompare(b.key)
    );
  if (sorted.length === 0) return [];

  type Item = {
    bar: PlanbordBar;
    start: number;
    end: number;
    col: number;
  };
  const items: Item[] = sorted.map((bar) => {
    const start = new Date(bar.at!).getTime();
    const end = start + Math.max(bar.duurMinuten, 15) * 60_000;
    return { bar, start, end, col: 0 };
  });

  const colEndTimes: number[] = [];
  for (const item of items) {
    let placed = false;
    for (let c = 0; c < colEndTimes.length; c++) {
      if (colEndTimes[c]! <= item.start) {
        item.col = c;
        colEndTimes[c] = item.end;
        placed = true;
        break;
      }
    }
    if (!placed) {
      item.col = colEndTimes.length;
      colEndTimes.push(item.end);
    }
  }

  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let x = i;
    while (parent[x] !== x) x = parent[x]!;
    let y = i;
    while (parent[y] !== y) {
      const next = parent[y]!;
      parent[y] = x;
      y = next;
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (items[i]!.start < items[j]!.end && items[j]!.start < items[i]!.end) {
        union(i, j);
      }
    }
  }

  const clusterCols = new Map<number, number>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    clusterCols.set(
      root,
      Math.max(clusterCols.get(root) || 0, items[i]!.col + 1)
    );
  }

  return items.map((item, i) => ({
    bar: item.bar,
    col: item.col,
    colCount: clusterCols.get(find(i)) || 1,
  }));
}

/** Alle timed afspraken (voor lijst / maand), chronologisch. */
function allTimedBars(
  projects: Project[],
  opts?: { installatieVanaf?: string | null }
): PlanbordBar[] {
  const bars: PlanbordBar[] = [];
  for (const p of projects) {
    if (!isActiefOpPlanbord(p)) continue;
    const partnerId = p.installatie_partner_id || partnerOf(p)?.id || null;
    const title = projectTitle(p);
    if (p.schouw_at && isSchouwdagDefinitief(p)) {
      bars.push({
        key: `${p.id}-schouw`,
        project: p,
        kind: "schouw",
        dayKeys: [dayKeyAmsterdam(p.schouw_at)],
        label: `Schouw · ${formatTimeNl(p.schouw_at)} · ${title}`,
        whenLabel: formatDateTimeNl(p.schouw_at),
        at: p.schouw_at,
        duurMinuten: duurMinutenVoorKind("schouw"),
        partnerId,
      });
    }
    if (
      p.installatie_at &&
      (!opts?.installatieVanaf ||
        isInstallatieVanafCutoff(p.installatie_at, null, opts.installatieVanaf))
    ) {
      bars.push({
        key: `${p.id}-installatie`,
        project: p,
        kind: "installatie",
        dayKeys: [dayKeyAmsterdam(p.installatie_at)],
        label: `Installatie · ${formatTimeNl(p.installatie_at)} · ${title}`,
        whenLabel: formatDateTimeNl(p.installatie_at),
        at: p.installatie_at,
        duurMinuten: installatieDuurMinutenVanaf(p.installatie_at),
        partnerId,
      });
    }
    if (p.service_at) {
      bars.push({
        key: `${p.id}-service`,
        project: p,
        kind: "service",
        dayKeys: [dayKeyAmsterdam(p.service_at)],
        label: `Service · ${formatTimeNl(p.service_at)} · ${title}`,
        whenLabel: formatDateTimeNl(p.service_at),
        at: p.service_at,
        duurMinuten: duurMinutenVoorKind("service"),
        partnerId,
      });
    }
    const leverdatum = resolveMateriaalLeverdatum(p);
    if (leverdatum) {
      bars.push({
        key: `${p.id}-levering`,
        project: p,
        kind: "levering",
        dayKeys: [dayKeyAmsterdam(leverdatum)],
        label: `LEVERING - INKOOP - ${title}`,
        whenLabel: formatDateShort(leverdatum),
        at: leverdatum,
        duurMinuten: duurMinutenVoorKind("levering"),
        partnerId,
      });
    }
  }
  return bars.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

const KIND_STYLE: Record<
  PlanbordBar["kind"],
  { bg: string; text: string; border: string; accent: string; muted: string }
> = {
  schouwweek: {
    bg: "bg-[#FEF9C3]",
    text: "text-[#854D0E]",
    border: "border-[#FDE047]",
    accent: "bg-[#CA8A04]",
    muted: "text-[#854D0E]/80",
  },
  /** Schouwdag = geel */
  schouw: {
    bg: "bg-[#FEF9C3]",
    text: "text-[#854D0E]",
    border: "border-[#FACC15]",
    accent: "bg-[#CA8A04]",
    muted: "text-[#854D0E]/80",
  },
  /** Installatie = zacht groen (zelfde stijl als schouw) */
  installatie: {
    bg: "bg-[#ECFDF5]",
    text: "text-[#047857]",
    border: "border-[#A7F3D0]",
    accent: "bg-[#059669]",
    muted: "text-[#047857]/80",
  },
  /** Service = zacht terracotta */
  service: {
    bg: "bg-[#FFF7ED]",
    text: "text-[#C2410C]",
    border: "border-[#FED7AA]",
    accent: "bg-[#EA580C]",
    muted: "text-[#C2410C]/80",
  },
  /** Levering inkoop = zacht oranje */
  levering: {
    bg: "bg-[#FFF7ED]",
    text: "text-[#9A3412]",
    border: "border-[#FDBA74]",
    accent: "bg-[#F97316]",
    muted: "text-[#9A3412]/80",
  },
};

function planbordKindLabel(
  kind: PlanbordBar["kind"],
  short = false,
  project?: Project
): string {
  switch (kind) {
    case "installatie":
      return short ? "Inst." : "Installatie";
    case "service":
      if (isServiceVvInstallatie(project?.service_notities)) {
        return short ? "VV Inst." : SERVICE_VV_INSTALLATIE;
      }
      return "Service";
    case "levering":
      return short ? "LEVERING - INKOOP" : "Levering";
    case "schouwweek":
      return "Schouwweek";
    default:
      return "Schouw";
  }
}

function endAtFromStart(at: string, duurMinuten: number): Date {
  return new Date(new Date(at).getTime() + Math.max(duurMinuten, 0) * 60_000);
}

/** Bijv. "09:00–12:00" */
function formatTimeRangeNl(
  at: string | null | undefined,
  duurMinuten: number
): string | null {
  if (!at) return null;
  const start = formatTimeNl(at);
  if (duurMinuten <= 0) return start;
  return `${start}–${formatTimeNl(endAtFromStart(at, duurMinuten))}`;
}

const DAY_START_HOUR = 7;
const DAY_END_HOUR = 20;
const HOUR_PX = 72;

function eventHeightPx(duurMinuten: number): number {
  const minH = HOUR_PX * 0.45;
  if (duurMinuten <= 0) return minH;
  return Math.max(minH, (duurMinuten / 60) * HOUR_PX);
}

function minutesFromMidnightAmsterdam(iso: string): number {
  const hm = formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "H:m");
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function eventTopPx(iso: string | null | undefined): number {
  if (!iso) return 0;
  const mins = minutesFromMidnightAmsterdam(iso);
  const clamped = Math.max(
    DAY_START_HOUR * 60,
    Math.min((DAY_END_HOUR - 0.25) * 60, mins)
  );
  return ((clamped - DAY_START_HOUR * 60) / 60) * HOUR_PX;
}

function PhoneCopyIcon({
  telefoon,
  stopPropagation = true,
}: {
  telefoon: string;
  stopPropagation?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      title={copied ? "Gekopieerd" : `Kopieer ${telefoon}`}
      className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-line bg-white text-ink hover:bg-wash"
      onClick={async (e) => {
        if (stopPropagation) e.stopPropagation();
        try {
          await navigator.clipboard.writeText(telefoon);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          (e.currentTarget as HTMLElement).click();
        }
      }}
      aria-label="Telefoonnummer kopiëren"
    >
      {copied ? (
        <Check className="size-3.5 text-[#0D9488]" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </span>
  );
}

function hourLabels(): number[] {
  const out: number[] = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h++) out.push(h);
  return out;
}

function mailSummary(mails: {
  klant?: { ok?: boolean; skipped?: boolean; error?: string };
  partner?: { ok?: boolean; skipped?: boolean; error?: string };
}): { ok: string; warn: string | null } {
  const parts: string[] = [];
  const warns: string[] = [];
  if (mails.klant?.ok) parts.push("klant");
  else if (mails.klant?.skipped)
    warns.push(mails.klant.error || "geen klantmail");
  else if (mails.klant?.error) warns.push(`klant: ${mails.klant.error}`);

  if (mails.partner?.ok) parts.push("installateur");
  else if (mails.partner?.skipped)
    warns.push(mails.partner.error || "geen partnermail");
  else if (mails.partner?.error) warns.push(`partner: ${mails.partner.error}`);

  return {
    ok:
      parts.length > 0
        ? `Bevestiging verstuurd naar ${parts.join(" + ")}.`
        : "Afspraak opgeslagen.",
    warn: warns.length ? warns.join(" · ") : null,
  };
}

function PlanInplannenPanel({
  open,
  dayKey,
  defaultPartnerId,
  defaultSoort,
  defaultVenster,
  projects,
  partners,
  onClose,
  onSaved,
}: {
  open: boolean;
  dayKey: string | null;
  defaultPartnerId: string | null;
  defaultSoort?: PlanSoort | null;
  defaultVenster?: PartnerVenster | null;
  projects: Project[];
  partners: InstallatiePartner[];
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [soort, setSoort] = useState<PlanSoort>("schouwdag");
  const [partnerId, setPartnerId] = useState("");
  const [teamgenootId, setTeamgenootId] = useState("");
  const [teamgenoten, setTeamgenoten] = useState<
    InstallatiePartnerTeamgenoot[]
  >([]);
  const [teamgenotenLoading, setTeamgenotenLoading] = useState(false);
  const [datetimeLocal, setDatetimeLocal] = useState("");
  const [slotIso, setSlotIso] = useState<string | null>(null);
  const [schouwWeek, setSchouwWeek] = useState("");
  const [notities, setNotities] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Na schouwdag: installatie-opvolg in hetzelfde paneel */
  const [installatieFollowUp, setInstallatieFollowUp] = useState<{
    project: Project;
    partnerId: string;
    schouwAt: string | null;
  } | null>(null);

  useEffect(() => {
    if (!open || !dayKey) return;
    setQuery("");
    setSelectedId(null);
    setSoort(defaultSoort || "schouwdag");
    setPartnerId(defaultPartnerId || "");
    setTeamgenootId("");
    setDatetimeLocal(
      defaultDatetimeForDay(
        dayKey,
        defaultVenster === "middag" ? 13 : 8
      )
    );
    setSlotIso(
      defaultSoort === "installatie" && defaultVenster
        ? vensterBoundsUtc(dayKey, defaultVenster).start.toISOString()
        : null
    );
    const w = schouwWeekFromDate(dayKey + "T12:00:00");
    setSchouwWeek(schouwWeekValue(w.jaar, w.week));
    setNotities("");
    setError(null);
    setPickerOpen(true);
    setInstallatieFollowUp(null);
  }, [open, dayKey, defaultPartnerId, defaultSoort, defaultVenster]);

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) || null,
    [projects, selectedId]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects.slice(0, 40);
    return projects
      .filter((p) => projectSearchText(p).includes(q))
      .slice(0, 40);
  }, [projects, query]);

  useEffect(() => {
    if (!selected) return;
    if (!partnerId && selected.installatie_partner_id) {
      setPartnerId(selected.installatie_partner_id);
    }
    if (
      selected.installatie_partner_id &&
      selected.installatie_partner_id === partnerId &&
      !teamgenootId &&
      selected.installatie_teamgenoot_id
    ) {
      setTeamgenootId(selected.installatie_teamgenoot_id);
    }
  }, [selected, partnerId, teamgenootId]);

  const teamgenotenVoorSoort = useMemo(() => {
    return teamgenoten.filter((t) => {
      if (soort === "schouwdag" || soort === "schouwweek") {
        return t.kan_schouw === true;
      }
      if (soort === "service") {
        return t.kan_service === true;
      }
      if (soort === "installatie") {
        return t.kan_installatie !== false;
      }
      return true;
    });
  }, [teamgenoten, soort]);

  useEffect(() => {
    if (!teamgenootId) return;
    if (!teamgenotenVoorSoort.some((t) => t.id === teamgenootId)) {
      setTeamgenootId("");
    }
  }, [teamgenotenVoorSoort, teamgenootId]);

  useEffect(() => {
    if (!partnerId) {
      setTeamgenoten([]);
      setTeamgenootId("");
      return;
    }
    let cancelled = false;
    setTeamgenotenLoading(true);
    void fetch(
      `/api/installatie-partners/teamgenoten?partner_id=${encodeURIComponent(partnerId)}`
    )
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setTeamgenoten([]);
          return;
        }
        setTeamgenoten(
          (data.teamgenoten as InstallatiePartnerTeamgenoot[]) || []
        );
      })
      .catch(() => {
        if (!cancelled) setTeamgenoten([]);
      })
      .finally(() => {
        if (!cancelled) setTeamgenotenLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partnerId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setError("Kies een project");
      return;
    }
    if (!partnerId) {
      setError("Kies een installatiepartner");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (soort === "schouwweek" || soort === "schouwdag") {
        if (soort === "schouwdag" && !teamgenootId) {
          throw new Error("Kies iemand die mag schouwen");
        }
        const payload: Record<string, unknown> = {
          installatie_partner_id: partnerId,
          installatie_teamgenoot_id: teamgenootId || null,
          schouw_notities: notities.trim() || null,
        };
        if (soort === "schouwdag") {
          const parsed = slotIso
            ? new Date(slotIso)
            : datetimeLocal.trim()
              ? new Date(datetimeLocal)
              : null;
          if (!parsed || Number.isNaN(parsed.getTime())) {
            throw new Error("Kies een schouw-slot");
          }
          const feestdagFout = feestdagPlanningFout(parsed);
          if (feestdagFout) throw new Error(feestdagFout);
          payload.schouw_at = parsed.toISOString();
          const derived = schouwWeekFromDate(parsed);
          payload.schouw_jaar = derived.jaar;
          payload.schouw_week = derived.week;
        } else {
          const opt = parseSchouwWeekValue(schouwWeek);
          if (!opt) throw new Error("Kies een schouwweek");
          payload.schouw_jaar = opt.jaar;
          payload.schouw_week = opt.week;
        }
        const res = await fetch(`/api/projecten/${selected.id}/schouw`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Inplannen mislukt"
          );
        }
        const summary = mailSummary(
          (data as { mails?: Parameters<typeof mailSummary>[0] }).mails || {}
        );
        if (summary.warn) setError(summary.warn);
        const saved = (data as { project: Project }).project;
        onSaved(saved);
        // Schouwdag → meteen installatie-advies (zelfde partner, na schouw)
        if (
          soort === "schouwdag" &&
          saved.schouw_at &&
          !saved.installatie_at
        ) {
          setInstallatieFollowUp({
            project: saved,
            partnerId,
            schouwAt: saved.schouw_at,
          });
          setSelectedId(saved.id);
          setSoort("installatie");
          setSlotIso(null);
          setDatetimeLocal("");
          setNotities("");
          setPickerOpen(false);
          return;
        }
        onClose();
        return;
      }

      const parsed = slotIso
        ? new Date(slotIso)
        : datetimeLocal.trim()
          ? new Date(datetimeLocal)
          : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        throw new Error(
          soort === "service"
            ? "Kies servicedatum + tijd"
            : soort === "installatie"
              ? "Kies een installatie-slot"
              : "Kies een schouw-slot"
        );
      }
      if (soort === "installatie") {
        const feestdagFout = feestdagPlanningFout(parsed);
        if (feestdagFout) throw new Error(feestdagFout);
      }
      if (soort === "service") {
        if (!notities.trim()) {
          throw new Error(
            "Notitie is verplicht bij inplannen van een service-afspraak"
          );
        }
        if (!teamgenootId) {
          throw new Error("Kies een monteur met Service in het account");
        }
        const res = await fetch(`/api/projecten/${selected.id}/service`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_at: parsed.toISOString(),
            installatie_partner_id: partnerId,
            service_teamgenoot_id: teamgenootId,
            service_notities: notities.trim(),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (data as { error?: string }).error || "Inplannen mislukt"
          );
        }
        const summary = mailSummary(
          (data as { mails?: Parameters<typeof mailSummary>[0] }).mails || {}
        );
        if (summary.warn) setError(summary.warn);
        onSaved((data as { project: Project }).project);
        onClose();
        return;
      }
      const res = await fetch(`/api/projecten/${selected.id}/installatie`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          installatie_at: parsed.toISOString(),
          installatie_partner_id: partnerId,
          installatie_notities: notities.trim() || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Inplannen mislukt"
        );
      }
      const summary = mailSummary(
        (data as { mails?: Parameters<typeof mailSummary>[0] }).mails || {}
      );
      if (summary.warn) setError(summary.warn);
      onSaved((data as { project: Project }).project);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  const lead = selected ? leadOf(selected) : null;
  const status = selected
    ? normalizeProjectStatus(selected.status)
    : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-3xl flex-col border-l border-line bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">
              {installatieFollowUp
                ? "Aanbevolen installatie"
                : "Project inplannen"}
            </h2>
            {installatieFollowUp ? (
              <p className="mt-0.5 text-xs text-muted">
                Schouw gezet — kies nu een installatieslot (zelfde partner
                voorkeur, na schouwdag).
              </p>
            ) : dayKey ? (
              <p className="mt-0.5 text-xs text-muted">
                {formatDateShort(dayKey + "T12:00:00")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border border-line px-2.5 py-1.5 text-sm text-muted hover:bg-wash"
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={(e) => void submit(e)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1fr_16rem]">
            <div className="space-y-4 overflow-auto border-b border-line p-5 lg:border-b-0 lg:border-r">
              <div className="relative">
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Project *
                </label>
                <input
                  value={
                    selected && !pickerOpen
                      ? projectTitle(selected)
                      : query
                  }
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPickerOpen(true);
                    if (selected) setSelectedId(null);
                  }}
                  onFocus={() => setPickerOpen(true)}
                  placeholder="Zoeken…"
                  className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                />
                {pickerOpen && (
                  <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto border border-line bg-white shadow-lg">
                    {filtered.length === 0 ? (
                      <li className="px-3 py-3 text-sm text-muted">
                        Geen projecten gevonden.
                      </li>
                    ) : (
                      filtered.map((p) => {
                        const l = leadOf(p);
                        return (
                          <li key={p.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedId(p.id);
                                setQuery("");
                                setPickerOpen(false);
                              }}
                              className="w-full border-b border-line px-3 py-2.5 text-left hover:bg-wash"
                            >
                              <p className="text-sm font-semibold text-ink">
                                {projectTitle(p)}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {p.project_nummer}
                                {l ? ` · ${adresRegel(l)}` : ""}
                              </p>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                )}
              </div>

              <fieldset>
                <legend className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Type
                </legend>
                <div className="mt-1.5 grid grid-cols-3 gap-2">
                  {(
                    [
                      ["schouwdag", "Schouwdag"],
                      ["installatie", "Installatie"],
                      ["service", "Service"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSoort(id)}
                      className={[
                        "border px-2 py-2 text-xs font-semibold",
                        soort === id
                          ? id === "installatie"
                            ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#047857]"
                            : id === "service"
                              ? "border-[#FED7AA] bg-[#FFF7ED] text-[#C2410C]"
                              : "border-[#CA8A04] bg-[#FEF9C3] text-[#854D0E]"
                          : "border-line text-muted hover:bg-wash",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted">
                  Schouwweek plan je op het project zelf (nog niet definitief).
                </p>
              </fieldset>

              <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                Installatiepartner *
                <select
                  value={partnerId}
                  onChange={(e) => {
                    setPartnerId(e.target.value);
                    setTeamgenootId("");
                    setDatetimeLocal(
                      dayKey
                        ? defaultDatetimeForDay(
                            dayKey,
                            soort === "installatie"
                              ? defaultVenster === "middag"
                                ? 13
                                : 8
                              : 9
                          )
                        : ""
                    );
                    setSlotIso(null);
                  }}
                  required
                  className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                >
                  <option value="">Kies…</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.naam}
                    </option>
                  ))}
                </select>
              </label>

              {partnerId && soort === "service" ? (
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Medewerker (service)
                  <select
                    value={teamgenootId}
                    disabled={teamgenotenLoading}
                    onChange={(e) => setTeamgenootId(e.target.value)}
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green disabled:opacity-60"
                  >
                    <option value="">
                      {teamgenotenLoading
                        ? "Laden…"
                        : teamgenotenVoorSoort.length === 0
                          ? "Niemand met Service in het account"
                          : "Kies iemand met Service…"}
                    </option>
                    {teamgenotenVoorSoort.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.naam}
                      </option>
                    ))}
                  </select>
                </label>
              ) : partnerId ? (
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Medewerker (schouw)
                  <select
                    value={teamgenootId}
                    disabled={teamgenotenLoading}
                    onChange={(e) => setTeamgenootId(e.target.value)}
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green disabled:opacity-60"
                  >
                    <option value="">
                      {teamgenotenLoading
                        ? "Laden…"
                        : teamgenotenVoorSoort.length === 0
                          ? "Niemand met Schouw in het account"
                          : "Nog niet gekoppeld…"}
                    </option>
                    {teamgenotenVoorSoort.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.naam}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              {soort === "schouwweek" ? (
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Schouwweek
                  <select
                    value={schouwWeek}
                    onChange={(e) => setSchouwWeek(e.target.value)}
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                    required
                  >
                    {agendaWeekJumpOptions(4, 40).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : soort === "service" ? (
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Servicedatum + tijd
                  <input
                    type="datetime-local"
                    value={datetimeLocal}
                    onChange={(e) => setDatetimeLocal(e.target.value)}
                    required
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                  />
                </label>
              ) : partnerId ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    {soort === "installatie"
                      ? "Kies installatie-slot *"
                      : "Kies schouw-slot *"}
                  </p>
                  <div className="mt-1.5">
                    <PartnerSlotPicker
                      partnerId={partnerId}
                      soort={soort === "installatie" ? "installatie" : "schouw"}
                      leadId={
                        (lead as { id?: string } | null)?.id ||
                        selected?.lead_id ||
                        null
                      }
                      projectId={selected?.id || null}
                      excludeProjectId={selected?.id || null}
                      dayKey={installatieFollowUp ? null : dayKey}
                      showBest={
                        Boolean(installatieFollowUp) ||
                        Boolean(selected?.id && !dayKey)
                      }
                      lockBestToPartner={Boolean(installatieFollowUp)}
                      afterIso={installatieFollowUp?.schouwAt || null}
                      value={slotIso}
                      onPartnerChange={(pid) => {
                        setPartnerId(pid);
                        setTeamgenootId("");
                      }}
                      onChange={(iso) => {
                        setSlotIso(iso);
                        if (!iso) {
                          setDatetimeLocal(
                            !installatieFollowUp && dayKey
                              ? defaultDatetimeForDay(
                                  dayKey,
                                  soort === "installatie"
                                    ? defaultVenster === "middag"
                                      ? 13
                                      : 8
                                    : 9
                                )
                              : ""
                          );
                          return;
                        }
                        setDatetimeLocal(
                          formatInTimeZone(
                            new Date(iso),
                            AMSTERDAM_TZ,
                            "yyyy-MM-dd'T'HH:mm"
                          )
                        );
                      }}
                      disabled={busy}
                    />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  Kies eerst een installatiepartner om open slots te zien.
                </p>
              )}

              {soort === "service" ? (
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Notitie voor installateur *
                  <textarea
                    value={notities}
                    onChange={(e) => setNotities(e.target.value)}
                    required
                    rows={3}
                    placeholder="Wat moet de monteur doen / weten bij deze service…"
                    className="mt-1.5 w-full resize-y border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                  />
                  <span className="mt-1 block text-[11px] font-normal normal-case tracking-normal text-muted">
                    Verplicht — zichtbaar op de service-afspraak in de agenda.
                  </span>
                </label>
              ) : (
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Label / notities
                  <input
                    value={notities}
                    onChange={(e) => setNotities(e.target.value)}
                    placeholder="Optioneel"
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                  />
                </label>
              )}

              {error ? (
                <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="overflow-auto bg-wash p-4">
              {!selected ? (
                <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 px-2 text-center">
                  <p className="text-sm text-muted">
                    Selecteer een project om de details te zien
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="border border-line bg-white p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="font-display text-base font-semibold text-ink">
                        {projectTitle(selected)}
                      </h3>
                      {status ? (
                        <span className="bg-[#FFF0E6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#C45A12]">
                          {resolveProjectStatusLabel(status, selected)}
                        </span>
                      ) : null}
                    </div>
                    <dl className="mt-3 space-y-2 text-sm">
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Klant
                        </dt>
                        <dd className="text-ink">{lead?.naam || "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Locatie
                        </dt>
                        <dd className="text-ink">
                          {lead ? adresRegel(lead) : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          Nummer
                        </dt>
                        <dd className="tabular-nums text-ink">
                          {selected.project_nummer}
                        </dd>
                      </div>
                    </dl>
                    <Link
                      href={`/projecten/${selected.id}?from=agenda`}
                      className="mt-4 inline-block text-sm font-semibold text-green-deeper hover:underline"
                    >
                      Open project →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
            {installatieFollowUp ? (
              <button
                type="button"
                onClick={onClose}
                className="border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-wash"
              >
                Later kiezen
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-wash"
              >
                Annuleren
              </button>
            )}
            <button
              type="submit"
              disabled={
                busy ||
                !selected ||
                (soort === "service" && !notities.trim())
              }
              className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50"
            >
              {busy
                ? "Bezig…"
                : installatieFollowUp
                  ? "Installatie opslaan"
                  : "Opslaan"}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

type SchouwDocInfo = {
  url: string;
  bestandsnaam: string | null;
};

type PlanbordFotoRij = {
  omschrijving: string | null;
  url: string | null;
  bestandsnaam: string | null;
  storage_path?: string | null;
  created_at: string;
};

function pickLatestPlanbordDoc(
  fotos: PlanbordFotoRij[],
  pred: (f: PlanbordFotoRij) => boolean
): SchouwDocInfo | null {
  const docs = fotos
    .filter((f) => pred(f) && f.url)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const last = docs[docs.length - 1];
  return last?.url
    ? { url: last.url, bestandsnaam: last.bestandsnaam }
    : null;
}

function leadAdresLines(lead: ReturnType<typeof leadOf>): string[] {
  if (!lead) return [];
  const nr = [lead.huisnummer, lead.toevoeging].filter(Boolean).join("");
  const line1 = [lead.straat, nr].filter(Boolean).join(" ");
  const line2 = [lead.postcode, lead.plaats].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean);
}

function EventCard({
  bar,
  schouwDoc,
  compact = false,
  selected = false,
  hidePartner = false,
  koppels = [],
  onSelect,
}: {
  bar: PlanbordBar;
  schouwDoc?: SchouwDocInfo | null;
  compact?: boolean;
  selected?: boolean;
  hidePartner?: boolean;
  koppels?: InstallatiePartnerKoppel[];
  onSelect?: () => void;
}) {
  const style = KIND_STYLE[bar.kind];
  const lead = leadOf(bar.project);
  const partner = hidePartner ? null : partnerOf(bar.project);
  const isSchouwBar = bar.kind === "schouw" || bar.kind === "schouwweek";
  const past = isBarPast(bar);
  const kindLabel =
    bar.kind === "installatie"
      ? installatieKopTekst(bar)
      : planbordKindLabel(bar.kind, false, bar.project);
  const timeRange = formatTimeRangeNl(bar.at, bar.duurMinuten);
  const naam = klantNaam(bar.project);
  const plaats = klantPlaats(bar.project);
  const adresLines = leadAdresLines(lead);
  const tel = lead?.telefoon?.trim() || null;
  const duurLabel =
    bar.duurMinuten > 0 ? formatDuurLabel(bar.duurMinuten) : null;
  const missingSchouw =
    isSchouwBar && schouwDoc !== undefined && !schouwDoc?.url;
  const koppel =
    bar.kind === "installatie" && bar.project.installatie_koppel_id
      ? koppels.find((k) => k.id === bar.project.installatie_koppel_id)
      : null;
  const medewerkerLabel =
    bar.kind === "service"
      ? bar.project.monteur?.trim() ||
        medewerkerNaamVanProject(bar.project) ||
        null
      : (koppel ? koppelWeergaveNaam(koppel) : null) ||
        medewerkerNaamVanProject(bar.project) ||
        null;
  const monteurLabel = hidePartner
    ? medewerkerLabel
    : partner?.naam &&
        medewerkerLabel &&
        medewerkerLabel !== partner.naam
      ? `${partner.naam} · ${medewerkerLabel}`
      : partner?.naam || medewerkerLabel || null;
  const subLine = [plaats, !compact ? adresLines[0] : null, monteurLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "group flex w-full items-stretch overflow-hidden rounded border text-left transition-shadow",
        style.bg,
        style.border,
        past ? "opacity-50 grayscale-[0.3]" : "",
        selected
          ? "ring-2 ring-[#0D9488]/35 ring-offset-1"
          : "hover:shadow-xs",
      ].join(" ")}
    >
      <span className={`w-0.5 shrink-0 ${style.accent}`} aria-hidden />
      <div className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0">
            <span
              className={[
                "text-[8px] font-bold uppercase tracking-[0.05em]",
                style.text,
              ].join(" ")}
            >
              {kindLabel}
            </span>
            {timeRange ? (
              <span
                className={[
                  "text-[10px] font-semibold tabular-nums text-ink",
                  past ? "line-through opacity-70" : "",
                ].join(" ")}
              >
                {compact && bar.at ? formatTimeNl(bar.at) : timeRange}
                {!compact && duurLabel ? (
                  <span className="font-medium text-muted"> · {duurLabel}</span>
                ) : null}
              </span>
            ) : null}
            {past ? (
              <span className="rounded bg-black/5 px-1 py-px text-[8px] font-semibold text-muted">
                Geweest
              </span>
            ) : null}
          </div>
          <p
            className="truncate text-xs font-semibold leading-tight text-ink"
            title={naam}
          >
            {naam}
          </p>
          {subLine ? (
            <p className="truncate text-[10px] leading-tight text-muted">
              {subLine}
            </p>
          ) : null}
        </div>
        {(tel || missingSchouw) && (
          <div className="flex shrink-0 items-center gap-0.5">
            {tel ? <PhoneCopyIcon telefoon={tel} /> : null}
            {missingSchouw ? (
              <span
                className="inline-flex size-5 items-center justify-center rounded border border-[#FDBA74] bg-[#FFF7ED] text-[9px] font-bold text-[#C45A12]"
                title="Schouwformulier ontbreekt"
              >
                !
              </span>
            ) : null}
          </div>
        )}
      </div>
    </button>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5 border-b border-line/70 py-3.5 last:border-b-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
        {label}
      </dt>
      <dd className="text-sm text-ink sm:text-[15px]">{children}</dd>
    </div>
  );
}

const SCHOUW_DONE_STATUSES = new Set([
  "schouw_voltooid",
  "restfactuur_verstuurd",
  "restfactuur_betaald",
  "materiaal_besteld",
  "installatie_ingepland",
  "installatie_voltooid",
  "after_sale",
  "review_gevraagd",
  "afgerond",
]);

function StatusCheckRow({
  ok,
  label,
  loading = false,
}: {
  ok: boolean;
  label: string;
  loading?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 text-sm">
      {loading ? (
        <span
          className="inline-flex size-5 items-center justify-center rounded-full border border-line text-[10px] text-muted"
          aria-hidden
        >
          …
        </span>
      ) : ok ? (
        <span
          className="inline-flex size-5 items-center justify-center rounded-full bg-[#0D9488] text-white"
          title="Ja"
          aria-label="Ja"
        >
          <Check className="size-3" strokeWidth={3} />
        </span>
      ) : (
        <span
          className="inline-flex size-5 items-center justify-center rounded-full bg-[#FDECEA] text-[#C62828]"
          title="Nee"
          aria-label="Nee"
        >
          <X className="size-3" strokeWidth={3} />
        </span>
      )}
      <span className={ok && !loading ? "font-medium text-ink" : "text-muted"}>
        {label}
      </span>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
    >
      <Copy data-icon="inline-start" />
      {copied ? "Gekopieerd" : "Kopieer"}
    </Button>
  );
}

function RequiredDocUploadBlock({
  label,
  missingLabel,
  uploadLabel,
  defaultFilename,
  doc,
  allowUpload,
  uploading,
  uploadOk,
  uploadError,
  onUpload,
  onMaakFormulier,
  accept = "image/*,application/pdf,.pdf",
  capture,
  noteDraft,
  onNoteChange,
  noteBusy,
  noteMsg,
  onSaveNote,
  notePlaceholder,
  noteTitle,
  fallbackNotities,
  mediaKind = "file",
}: {
  label: string;
  missingLabel: string;
  uploadLabel: string;
  defaultFilename: string;
  doc: SchouwDocInfo | null | undefined;
  allowUpload: boolean;
  uploading: boolean;
  uploadOk: string | null;
  uploadError: string | null;
  onUpload: (file: File) => void;
  /** Optioneel: digitaal formulier → PDF (schouw). */
  onMaakFormulier?: (() => void) | null;
  accept?: string;
  capture?: boolean | "user" | "environment";
  noteDraft: string;
  onNoteChange: (v: string) => void;
  noteBusy: boolean;
  noteMsg: string | null;
  onSaveNote: (() => void) | null;
  notePlaceholder: string;
  noteTitle: string;
  fallbackNotities: string | null;
  mediaKind?: "file" | "video";
}) {
  const captureAttr =
    capture === true ? "environment" : capture === false ? undefined : capture;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{label}</p>
      {doc?.url ? (
        <div className="flex flex-col gap-2">
          {mediaKind === "video" ? (
            <video
              src={doc.url}
              controls
              playsInline
              className="max-h-56 w-full rounded-md border border-line bg-black"
            />
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            download={doc.bestandsnaam || defaultFilename}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {doc.bestandsnaam || "Openen / downloaden"}
          </a>
          {allowUpload ? (
            <label
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "cursor-pointer"
              )}
            >
              {uploading ? "Uploaden…" : "Vervangen"}
              <input
                type="file"
                accept={accept}
                {...(captureAttr ? { capture: captureAttr } : {})}
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) onUpload(file);
                  e.target.value = "";
                }}
              />
            </label>
          ) : null}
          {allowUpload && onMaakFormulier ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={onMaakFormulier}
            >
              Nieuw formulier
            </Button>
          ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Alert className="border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]">
            <AlertDescription>{missingLabel}</AlertDescription>
          </Alert>
          {allowUpload ? (
            <div className="flex flex-col gap-2">
              {onMaakFormulier ? (
                <Button
                  type="button"
                  className="w-full"
                  size="lg"
                  disabled={uploading}
                  onClick={onMaakFormulier}
                >
                  Maak formulier
                </Button>
              ) : null}
              <label
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "w-full cursor-pointer justify-center"
                )}
              >
                {uploading ? "Uploaden…" : uploadLabel}
                <input
                  type="file"
                  accept={accept}
                  {...(captureAttr ? { capture: captureAttr } : {})}
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onUpload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          ) : null}
        </div>
      )}
      {uploadOk ? (
        <Alert className="border-green/30 bg-green-soft text-green-dark">
          <AlertDescription>{uploadOk}</AlertDescription>
        </Alert>
      ) : null}
      {uploadError ? (
        <Alert variant="destructive">
          <AlertDescription>{uploadError}</AlertDescription>
        </Alert>
      ) : null}

      {onSaveNote ? (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="space-y-1.5">
            <Label htmlFor="planbord-note">{noteTitle} *</Label>
            <Textarea
              id="planbord-note"
              value={noteDraft}
              onChange={(e) => onNoteChange(e.target.value)}
              rows={3}
              required
              placeholder={notePlaceholder}
            />
          </div>
          <p className="text-[11px] text-muted">
            Notitie is verplicht bij afronden.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={noteBusy || !noteDraft.trim()}
            onClick={onSaveNote}
          >
            {noteBusy ? "Opslaan…" : "Notitie opslaan"}
          </Button>
          {noteMsg ? (
            <Alert
              className={
                noteMsg.includes("mislukt") ||
                noteMsg.includes("Fout") ||
                noteMsg.includes("verplicht")
                  ? undefined
                  : "border-green/30 bg-green-soft text-green-dark"
              }
              variant={
                noteMsg.includes("mislukt") ||
                noteMsg.includes("Fout") ||
                noteMsg.includes("verplicht")
                  ? "destructive"
                  : "default"
              }
            >
              <AlertDescription>{noteMsg}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : fallbackNotities ? (
        <div className="border-t border-line pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
            Notitie
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">
            {fallbackNotities}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function AgendaItemSidebar({
  bar,
  schouwDoc,
  opleveringDoc,
  partners,
  projectHref,
  hidePartner = false,
  portalMode = false,
  allowSchouwUpload = false,
  allowOpleveringUpload = false,
  allowServiceComplete = false,
  allowMedewerkerWijzig = false,
  portalToken,
  fotosUploadUrl,
  notesPatchUrl,
  onSchouwDocChange,
  onOpleveringDocChange,
  onProjectUpdated,
  onMedewerkerGewijzigd,
  koppels: agendaKoppelsProp,
  offerteRegels,
  onClose,
}: {
  bar: PlanbordBar;
  schouwDoc?: SchouwDocInfo | null;
  opleveringDoc?: SchouwDocInfo | null;
  partners: InstallatiePartner[];
  projectHref: (projectId: string) => string;
  hidePartner?: boolean;
  /** Installatiepartner-portaal: andere checklist, geen betaalstatus. */
  portalMode?: boolean;
  allowSchouwUpload?: boolean;
  allowOpleveringUpload?: boolean;
  /** Service afvinken + optionele foto’s. */
  allowServiceComplete?: boolean;
  /** Medewerker wisselen (CRM of partner-beheerder). */
  allowMedewerkerWijzig?: boolean;
  portalToken?: string | null;
  /** Override upload endpoint (portal token API). */
  fotosUploadUrl?: string | null;
  /** Override notes PATCH endpoint (portal token API). */
  notesPatchUrl?: string | null;
  onSchouwDocChange?: (projectId: string, doc: SchouwDocInfo | null) => void;
  onOpleveringDocChange?: (
    projectId: string,
    doc: SchouwDocInfo | null
  ) => void;
  onProjectUpdated?: (project: Project) => void;
  onMedewerkerGewijzigd?: (teamgenootId: string | null) => void;
  koppels?: InstallatiePartnerKoppel[];
  offerteRegels?: OfferteRegelKort[];
  onClose: () => void;
}) {
  const project = bar.project;
  const lead = leadOf(project);
  const partnerJoined = partnerOf(project);
  const partner =
    partners.find((p) => p.id === (bar.partnerId || project.installatie_partner_id)) ||
    partnerJoined ||
    null;
  const kindChip = planbordKindLabel(bar.kind, false, bar.project);
  const batterijKort =
    bar.kind === "installatie" ? bar.batterijKort?.trim() || null : null;
  const when =
    bar.kind === "installatie"
      ? project.installatie_at
      : bar.kind === "service"
        ? project.service_at
        : bar.kind === "levering"
          ? resolveMateriaalLeverdatum(project)
          : bar.kind === "schouw"
            ? project.schouw_at
            : null;
  const tel = lead?.telefoon?.trim() || null;
  const email = lead?.email?.trim() || null;
  const adresLines = leadAdresLines(lead);
  const status = normalizeProjectStatus(project.status);
  const SERVICE_AFROND_MARKER = "— Afronding —";
  const rawServiceNotities = project.service_notities?.trim() || "";
  const serviceWerkbon = rawServiceNotities
    ? rawServiceNotities.split(SERVICE_AFROND_MARKER)[0].trim()
    : "";
  const serviceAfrondBestaand = rawServiceNotities.includes(SERVICE_AFROND_MARKER)
    ? rawServiceNotities.split(SERVICE_AFROND_MARKER).slice(1).join(SERVICE_AFROND_MARKER).trim()
    : "";
  const notities =
    bar.kind === "installatie"
      ? project.installatie_notities?.trim()
      : bar.kind === "service"
        ? serviceWerkbon || null
        : bar.kind === "levering"
          ? null
          : project.schouw_notities?.trim();
  const duurLabel =
    bar.duurMinuten > 0 ? formatDuurLabel(bar.duurMinuten) : null;
  const showSchouwForm =
    bar.kind === "schouw" || bar.kind === "schouwweek";
  const showOplevering = bar.kind === "installatie";
  const showService = bar.kind === "service";
  const [localDoc, setLocalDoc] = useState<SchouwDocInfo | null | undefined>(
    schouwDoc
  );
  const [localOplevering, setLocalOplevering] = useState<
    SchouwDocInfo | null | undefined
  >(opleveringDoc);
  const [localMeterkast, setLocalMeterkast] = useState<
    SchouwDocInfo | null | undefined
  >(undefined);
  const [localBatterij, setLocalBatterij] = useState<
    SchouwDocInfo | null | undefined
  >(undefined);
  const [localVideo, setLocalVideo] = useState<
    SchouwDocInfo | null | undefined
  >(undefined);
  const [serviceFotos, setServiceFotos] = useState<SchouwDocInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadOk, setUploadOk] = useState<string | null>(null);
  const [orderBetaald, setOrderBetaald] = useState<boolean | null>(null);
  const [betaaldLoading, setBetaaldLoading] = useState(true);
  const [noteDraft, setNoteDraft] = useState(
    bar.kind === "service" ? serviceAfrondBestaand : notities || ""
  );
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMsg, setNoteMsg] = useState<string | null>(null);
  const [serviceDoneLocal, setServiceDoneLocal] = useState(false);
  const [schouwFormOpen, setSchouwFormOpen] = useState(false);
  const [opleverFormOpen, setOpleverFormOpen] = useState(false);
  const [formTeamgenoten, setFormTeamgenoten] = useState<
    InstallatiePartnerTeamgenoot[]
  >([]);
  const [formKoppels, setFormKoppels] = useState<InstallatiePartnerKoppel[]>(
    []
  );
  const [medewerkerBusy, setMedewerkerBusy] = useState(false);
  const [medewerkerMsg, setMedewerkerMsg] = useState<string | null>(null);
  const [installatieProducten, setInstallatieProducten] = useState<
    { omschrijving: string; aantal: number }[] | null
  >(null);
  const [serviceVerzoeken, setServiceVerzoeken] = useState<
    Pick<
      ServiceVerzoek,
      "id" | "onderwerp" | "omschrijving" | "interne_notitie" | "status"
    >[]
  >([]);

  useEffect(() => {
    setLocalDoc(schouwDoc);
    setLocalOplevering(opleveringDoc);
    setLocalMeterkast(undefined);
    setLocalBatterij(undefined);
    setLocalVideo(undefined);
  }, [bar.key]);

  useEffect(() => {
    if (schouwDoc?.url) setLocalDoc(schouwDoc);
  }, [schouwDoc]);

  useEffect(() => {
    if (opleveringDoc?.url) setLocalOplevering(opleveringDoc);
  }, [opleveringDoc]);

  // Foto’s + documenten voor schouw/installatie sidebar.
  useEffect(() => {
    if (
      bar.kind !== "installatie" &&
      bar.kind !== "schouw" &&
      bar.kind !== "schouwweek"
    ) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url =
          fotosUploadUrl || `/api/projecten/${project.id}/fotos`;
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setLocalDoc((cur) => cur ?? null);
          setLocalOplevering((cur) => cur ?? null);
          setLocalMeterkast((cur) => cur ?? null);
          setLocalBatterij((cur) => cur ?? null);
          setLocalVideo((cur) => cur ?? null);
          return;
        }
        const fotos = (data.fotos || []) as PlanbordFotoRij[];
        setLocalDoc(
          pickLatestPlanbordDoc(fotos, (f) =>
            isSchouwFormulierBewijs(
              f.omschrijving,
              f.bestandsnaam,
              f.storage_path
            )
          )
        );
        setLocalMeterkast(
          pickLatestPlanbordDoc(fotos, (f) => isFotoMeterkast(f.omschrijving))
        );
        setLocalBatterij(
          pickLatestPlanbordDoc(fotos, (f) => isFotoBatterij(f.omschrijving))
        );
        setLocalVideo(
          pickLatestPlanbordDoc(fotos, (f) =>
            isVideoInstallatie(f.omschrijving)
          )
        );
        if (bar.kind === "installatie") {
          setLocalOplevering(
            pickLatestPlanbordDoc(fotos, (f) =>
              isOpleveringsrapportBewijs(
                f.omschrijving,
                f.bestandsnaam,
                f.storage_path
              )
            )
          );
        }
      } catch {
        if (!cancelled) {
          setLocalDoc((cur) => cur ?? null);
          setLocalOplevering((cur) => cur ?? null);
          setLocalMeterkast((cur) => cur ?? null);
          setLocalBatterij((cur) => cur ?? null);
          setLocalVideo((cur) => cur ?? null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bar.kind, bar.key, fotosUploadUrl, project.id]);

  const partnerIdForTeam =
    partner?.id || project.installatie_partner_id || null;
  useEffect(() => {
    if (!partnerIdForTeam && !portalToken) {
      setFormTeamgenoten([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url =
          portalMode && portalToken
            ? `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`
            : partnerIdForTeam
              ? `/api/installatie-partners/teamgenoten?partner_id=${encodeURIComponent(partnerIdForTeam)}`
              : null;
        if (!url) {
          setFormTeamgenoten([]);
          return;
        }
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setFormTeamgenoten(
          ((data.teamgenoten as InstallatiePartnerTeamgenoot[]) || []).filter(
            (t) => t.actief !== false
          )
        );
      } catch {
        if (!cancelled) setFormTeamgenoten([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerIdForTeam, bar.key, portalMode, portalToken]);

  useEffect(() => {
    if (!partnerIdForTeam && !portalToken) {
      setFormKoppels([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url =
          portalMode && portalToken
            ? `/api/installatie/${encodeURIComponent(portalToken)}/koppels`
            : partnerIdForTeam
              ? `/api/installatie-partners/koppels?partner_id=${encodeURIComponent(partnerIdForTeam)}`
              : null;
        if (!url) {
          setFormKoppels([]);
          return;
        }
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setFormKoppels(
          ((data.koppels as InstallatiePartnerKoppel[]) || []).filter(
            (k) => k.actief !== false
          )
        );
      } catch {
        if (!cancelled) setFormKoppels([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerIdForTeam, bar.key, portalMode, portalToken]);

  useEffect(() => {
    if (bar.kind !== "installatie") {
      setInstallatieProducten(null);
      return;
    }
    const nested = offerteRegelsVanProject(project);
    const seed =
      (offerteRegels && offerteRegels.length > 0
        ? offerteRegels
        : nested.length > 0
          ? nested
          : null) || null;
    if (seed) {
      setInstallatieProducten(productenUitOfferteRegels(seed));
    } else {
      setInstallatieProducten(null);
    }
    let cancelled = false;
    void (async () => {
      try {
        if (portalToken) {
          const res = await fetch(
            `/api/installatie/${encodeURIComponent(portalToken)}/orders/${encodeURIComponent(project.id)}/producten`
          );
          const data = await res.json().catch(() => ({}));
          if (cancelled || !res.ok) {
            if (!cancelled && !seed) setInstallatieProducten([]);
            return;
          }
          if (!cancelled) {
            setInstallatieProducten(
              (data.producten as { omschrijving: string; aantal: number }[]) ||
                []
            );
          }
          return;
        }
        const offerteId = project.offerte_id;
        if (!offerteId) {
          if (!cancelled && !seed) setInstallatieProducten([]);
          return;
        }
        const res = await fetch(
          `/api/planbord/offerte-regels?ids=${encodeURIComponent(offerteId)}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) {
          if (!cancelled && !seed) setInstallatieProducten([]);
          return;
        }
        const regels = (data.regels || []) as OfferteRegelKort[];
        if (!cancelled) {
          setInstallatieProducten(productenUitOfferteRegels(regels));
        }
      } catch {
        if (!cancelled && !seed) setInstallatieProducten([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    bar.kind,
    bar.key,
    portalToken,
    project.id,
    project.offerte_id,
    offerteRegels,
  ]);

  useEffect(() => {
    setNoteDraft(
      bar.kind === "service" ? serviceAfrondBestaand : notities || ""
    );
    setNoteMsg(null);
    setServiceDoneLocal(false);
    setUploadError(null);
    setUploadOk(null);
  }, [notities, serviceAfrondBestaand, bar.key, bar.kind]);

  useEffect(() => {
    if (!showService) {
      setServiceFotos([]);
      setServiceVerzoeken([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url =
          fotosUploadUrl || `/api/projecten/${project.id}/fotos`;
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const fotos = (data.fotos || []) as Array<{
          url?: string | null;
          bestandsnaam?: string | null;
          omschrijving?: string | null;
        }>;
        setServiceFotos(
          fotos
            .filter((f) => isServiceFoto(f.omschrijving) && f.url)
            .map((f) => ({
              url: f.url!,
              bestandsnaam: f.bestandsnaam || null,
            }))
        );
      } catch {
        /* ignore */
      }
    })();
    (async () => {
      try {
        const res = await fetch(
          `/api/service-verzoeken?project_id=${encodeURIComponent(project.id)}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const list = (data.verzoeken || []) as ServiceVerzoek[];
        // Open eerst; anders recentste afgehandelde (na afronden nog zichtbaar).
        const open = list.filter((v) => v.status === "open");
        const shown =
          open.length > 0
            ? open
            : list.slice(0, 1);
        setServiceVerzoeken(
          shown.map((v) => ({
            id: v.id,
            onderwerp: v.onderwerp,
            omschrijving: v.omschrijving,
            interne_notitie: v.interne_notitie,
            status: v.status,
          }))
        );
      } catch {
        if (!cancelled) setServiceVerzoeken([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showService, project.id, fotosUploadUrl, bar.key]);

  useEffect(() => {
    if (portalMode) {
      setBetaaldLoading(false);
      setOrderBetaald(null);
      return;
    }
    let cancelled = false;
    setBetaaldLoading(true);
    setOrderBetaald(null);
    (async () => {
      try {
        const off = Array.isArray(project.offertes)
          ? project.offertes[0]
          : project.offertes;
        let orderInc = Number(off?.totaal_inc_btw) || 0;

        const [facRes, projRes] = await Promise.all([
          fetch(`/api/projecten/${project.id}/facturen`),
          orderInc > 0
            ? Promise.resolve(null)
            : fetch(`/api/projecten/${project.id}`),
        ]);
        const facData = await facRes.json().catch(() => ({}));
        if (cancelled) return;
        if (!facRes.ok) {
          setOrderBetaald(false);
          return;
        }

        if (projRes) {
          const projData = await projRes.json().catch(() => ({}));
          if (!cancelled && projRes.ok) {
            const pOff = Array.isArray(projData.project?.offertes)
              ? projData.project.offertes[0]
              : projData.project?.offertes;
            orderInc = Number(pOff?.totaal_inc_btw) || orderInc;
          }
        }

        const facturen = (facData.facturen || []) as Array<{
          status: string;
          bedrag_inc_btw: number | null;
          omschrijving?: string | null;
          credit_van_factuur_id?: string | null;
        }>;
        setOrderBetaald(
          isOrderVolledigBetaald({
            facturen,
            orderIncBtw: orderInc,
          })
        );
      } catch {
        if (!cancelled) setOrderBetaald(false);
      } finally {
        if (!cancelled) setBetaaldLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project, portalMode]);

  const opStatus = toOperationalStatus(status);
  const meterkastOk = Boolean(localMeterkast?.url);
  const batterijFotoOk = Boolean(localBatterij?.url);
  const videoInstallatieOk = Boolean(localVideo?.url);
  const schouwVoltooid =
    (Boolean(localDoc?.url) && meterkastOk) ||
    SCHOUW_DONE_STATUSES.has(opStatus);
  const opleveringOk =
    (Boolean(localOplevering?.url) &&
      batterijFotoOk &&
      videoInstallatieOk) ||
    opStatus === "installatie_voltooid" ||
    opStatus === "after_sale" ||
    opStatus === "review_gevraagd" ||
    opStatus === "service";
  const serviceAfgerond =
    serviceDoneLocal ||
    (Boolean(project.service_at) &&
      (Boolean(serviceAfrondBestaand) ||
        (Boolean(project.service_notities?.trim()) &&
          opStatus !== "service")));
  const orderVolledigBetaald = orderBetaald === true;
  const batterijKoop = batterijPurchasingStatus(project.materiaal_checks);
  const batterijBesteld = batterijKoop.besteld;
  const batterijBijKlant = batterijKoop.geleverd;
  const schouwMedewerker = medewerkerNaamVanProject(project);
  const huidigeMedewerkerId = project.installatie_teamgenoot_id || "";
  const huidigeKoppelId = project.installatie_koppel_id || "";
  const koppelsVoorSelect = formKoppels.length
    ? formKoppels
    : agendaKoppelsProp || [];
  const huidigeKoppel =
    koppelsVoorSelect.find((k) => k.id === huidigeKoppelId) || null;
  const koppelLabel = huidigeKoppel
    ? koppelWeergaveNaam(huidigeKoppel)
    : null;
  const isInstallatieBar = bar.kind === "installatie";
  const isSchouwBarSidebar =
    bar.kind === "schouw" || bar.kind === "schouwweek";
  const isServiceBar = bar.kind === "service";
  const huidigeServiceId = project.service_teamgenoot_id || "";
  const serviceKeuzes = useMemo(
    () =>
      formTeamgenoten.filter(
        (t) =>
          t.actief !== false &&
          (t.kan_service === true || t.id === huidigeServiceId)
      ),
    [formTeamgenoten, huidigeServiceId]
  );
  const medewerkerKeuzes = useMemo(() => {
    let list = formTeamgenoten.filter((t) => t.actief !== false);
    if (isSchouwBarSidebar) {
      list = list.filter(
        (t) => t.kan_schouw === true || t.id === huidigeMedewerkerId
      );
    }
    return list;
  }, [formTeamgenoten, isSchouwBarSidebar, huidigeMedewerkerId]);
  const notesEndpoint =
    notesPatchUrl ||
    (allowSchouwUpload || allowOpleveringUpload || allowServiceComplete
      ? `/api/projecten/${project.id}`
      : null);
  const medewerkerPatchUrl =
    notesPatchUrl || `/api/projecten/${project.id}`;

  async function saveMedewerker(id: string) {
    if (!allowMedewerkerWijzig) return;
    const nextId = id.trim() || null;
    if ((huidigeMedewerkerId || null) === nextId) return;
    setMedewerkerBusy(true);
    setMedewerkerMsg(null);
    try {
      const res = await fetch(medewerkerPatchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installatie_teamgenoot_id: nextId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Medewerker opslaan mislukt"
        );
      }
      const updated =
        (data as { project?: Project; order?: Project }).project ||
        (data as { order?: Project }).order;
      const naam =
        medewerkerKeuzes.find((t) => t.id === nextId)?.naam ||
        formTeamgenoten.find((t) => t.id === nextId)?.naam ||
        null;
      const nextProject = {
        ...project,
        ...(updated || {}),
        installatie_teamgenoot_id: nextId,
      } as Project;
      onProjectUpdated?.(nextProject);
      onMedewerkerGewijzigd?.(nextId);
      setMedewerkerMsg(
        naam ? `Staat nu in de agenda van ${naam}.` : "Medewerker ontkoppeld."
      );
    } catch (err) {
      setMedewerkerMsg(
        err instanceof Error ? err.message : "Medewerker opslaan mislukt"
      );
    } finally {
      setMedewerkerBusy(false);
    }
  }

  async function saveKoppel(id: string) {
    if (!allowMedewerkerWijzig) return;
    const nextId = id.trim() || null;
    if ((huidigeKoppelId || null) === nextId) return;
    setMedewerkerBusy(true);
    setMedewerkerMsg(null);
    try {
      const res = await fetch(medewerkerPatchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installatie_koppel_id: nextId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Koppel opslaan mislukt"
        );
      }
      const updated =
        (data as { project?: Project; order?: Project }).project ||
        (data as { order?: Project }).order;
      const k =
        koppelsVoorSelect.find((x) => x.id === nextId) || null;
      const naam = k ? koppelWeergaveNaam(k) : null;
      const nextProject = {
        ...project,
        ...(updated || {}),
        installatie_koppel_id: nextId,
        monteur: naam,
      } as Project;
      onProjectUpdated?.(nextProject);
      setMedewerkerMsg(
        naam ? `Staat nu in de agenda van ${naam}.` : "Koppel ontkoppeld."
      );
    } catch (err) {
      setMedewerkerMsg(
        err instanceof Error ? err.message : "Koppel opslaan mislukt"
      );
    } finally {
      setMedewerkerBusy(false);
    }
  }

  async function saveServiceMedewerker(id: string) {
    if (!allowMedewerkerWijzig) return;
    const nextId = id.trim() || null;
    if ((huidigeServiceId || null) === nextId) return;
    setMedewerkerBusy(true);
    setMedewerkerMsg(null);
    try {
      const res = await fetch(medewerkerPatchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service_teamgenoot_id: nextId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Service-monteur opslaan mislukt"
        );
      }
      const updated =
        (data as { project?: Project; order?: Project }).project ||
        (data as { order?: Project }).order;
      const naam =
        serviceKeuzes.find((t) => t.id === nextId)?.naam || null;
      const nextProject = {
        ...project,
        ...(updated || {}),
        service_teamgenoot_id: nextId,
        monteur: naam || project.monteur,
      } as Project;
      onProjectUpdated?.(nextProject);
      onMedewerkerGewijzigd?.(nextId);
      setMedewerkerMsg(
        naam ? `Staat nu in de agenda van ${naam}.` : "Service-monteur ontkoppeld."
      );
    } catch (err) {
      setMedewerkerMsg(
        err instanceof Error ? err.message : "Service-monteur opslaan mislukt"
      );
    } finally {
      setMedewerkerBusy(false);
    }
  }

  async function uploadRequiredDoc(
    file: File,
    kind: "schouw" | "oplevering" | "meterkast" | "batterij" | "video"
  ) {
    const needsNote = kind === "schouw" || kind === "oplevering";
    if (needsNote && !noteDraft.trim()) {
      setUploadError("Notitie is verplicht bij afronden.");
      setNoteMsg("Notitie is verplicht bij afronden.");
      return;
    }
    if (kind === "video") {
      const check = await validateInstallatieVideoDuration(file);
      if (!check.ok) {
        setUploadError(check.error);
        return;
      }
    }
    setUploading(true);
    setUploadError(null);
    setUploadOk(null);
    try {
      if (needsNote && notesEndpoint) {
        await saveSidebarNotitie(false);
      }
      const form = new FormData();
      form.append("file", file);
      const omschrijving =
        kind === "schouw"
          ? SCHOUW_FORMULIER_OMSCHRIJVING
          : kind === "oplevering"
            ? OPLEVERINGSRAPPORT_OMSCHRIJVING
            : kind === "meterkast"
              ? FOTO_METERKAST_OMSCHRIJVING
              : kind === "video"
                ? VIDEO_INSTALLATIE_OMSCHRIJVING
                : FOTO_BATTERIJ_OMSCHRIJVING;
      form.append("omschrijving", omschrijving);
      if (kind === "schouw" || kind === "oplevering") {
        form.append("allow_pdf", "1");
      }
      if (kind === "video") {
        form.append("allow_video", "1");
      }
      const url =
        fotosUploadUrl || `/api/projecten/${project.id}/fotos`;
      const res = await fetch(url, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      const foto = data.foto as {
        url?: string | null;
        bestandsnaam?: string | null;
      } | null;
      const nextDoc =
        foto?.url
          ? { url: foto.url, bestandsnaam: foto.bestandsnaam || null }
          : null;
      if (kind === "schouw") {
        setLocalDoc(nextDoc);
        onSchouwDocChange?.(project.id, nextDoc);
      } else if (kind === "oplevering") {
        setLocalOplevering(nextDoc);
        onOpleveringDocChange?.(project.id, nextDoc);
      } else if (kind === "meterkast") {
        setLocalMeterkast(nextDoc);
      } else if (kind === "video") {
        setLocalVideo(nextDoc);
      } else {
        setLocalBatterij(nextDoc);
      }
      const adv = data.status_advance as
        | { advanced?: boolean; klaarVoorMateriaal?: boolean; to?: string }
        | undefined;
      if (data.project && typeof data.project === "object") {
        onProjectUpdated?.(data.project as Project);
      }
      if (kind === "oplevering" || kind === "batterij" || kind === "video") {
        setUploadOk(
          adv?.advanced
            ? "Geüpload · installatie voltooid."
            : kind === "batterij"
              ? "Foto batterij geüpload."
              : kind === "video"
                ? "Installatievideo geüpload."
                : "Opleveringsrapport geüpload."
        );
      } else if (adv?.advanced && adv.klaarVoorMateriaal) {
        setUploadOk(
          "Geüpload · alles betaald → klaar voor materiaalinkoop."
        );
      } else if (adv?.advanced) {
        setUploadOk("Geüpload · schouw voltooid.");
      } else if (kind === "meterkast") {
        setUploadOk("Foto meterkast geüpload.");
      } else {
        setUploadOk("Schouwformulier geüpload.");
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  async function uploadServiceFoto(file: File) {
    setUploading(true);
    setUploadError(null);
    setUploadOk(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("omschrijving", SERVICE_FOTO_OMSCHRIJVING);
      const url =
        fotosUploadUrl || `/api/projecten/${project.id}/fotos`;
      const res = await fetch(url, {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload mislukt");
      const foto = data.foto as {
        url?: string | null;
        bestandsnaam?: string | null;
      } | null;
      if (foto?.url) {
        setServiceFotos((prev) => [
          ...prev,
          { url: foto.url!, bestandsnaam: foto.bestandsnaam || null },
        ]);
      }
      setUploadOk("Foto geüpload (optioneel).");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload mislukt");
    } finally {
      setUploading(false);
    }
  }

  async function afrondService() {
    if (!noteDraft.trim()) {
      setNoteMsg("Notitie is verplicht bij afronden.");
      return;
    }
    setNoteBusy(true);
    setNoteMsg(null);
    setUploadError(null);
    try {
      const res = await fetch(`/api/projecten/${project.id}/service`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_notities: noteDraft.trim(),
          afronden: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Afronden mislukt"
        );
      }
      const updated = (data as { project?: Project }).project;
      if (updated) onProjectUpdated?.(updated);
      setServiceDoneLocal(true);
      setNoteMsg("Service afgevinkt.");
      setUploadOk("Service afgerond · zichtbaar als geweest op Planbord.");
    } catch (err) {
      setNoteMsg(err instanceof Error ? err.message : "Afronden mislukt");
    } finally {
      setNoteBusy(false);
    }
  }

  async function saveSidebarNotitie(showOk = true) {
    if (!notesEndpoint) return;
    if (!noteDraft.trim()) {
      setNoteMsg("Notitie is verplicht bij afronden.");
      throw new Error("Notitie is verplicht bij afronden.");
    }
    setNoteBusy(true);
    setNoteMsg(null);
    try {
      if (bar.kind === "levering") return;
      const body =
        bar.kind === "installatie"
          ? { installatie_notities: noteDraft.trim() }
          : bar.kind === "service"
            ? { service_notities: noteDraft.trim() }
            : { schouw_notities: noteDraft.trim() };
      const res = await fetch(notesEndpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Notitie opslaan mislukt"
        );
      }
      const updated = (data as { project?: Project; order?: Project }).project
        || (data as { order?: Project }).order;
      if (updated) onProjectUpdated?.(updated);
      else {
        onProjectUpdated?.({
          ...project,
          ...(bar.kind === "installatie"
            ? { installatie_notities: noteDraft.trim() }
            : bar.kind === "service"
              ? { service_notities: noteDraft.trim() }
              : { schouw_notities: noteDraft.trim() }),
        } as Project);
      }
      if (showOk) setNoteMsg("Notitie opgeslagen.");
    } catch (err) {
      setNoteMsg(err instanceof Error ? err.message : "Opslaan mislukt");
      throw err;
    } finally {
      setNoteBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-line bg-white shadow-xl">
        <div className="border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge
                variant="secondary"
                className={cn(
                  "h-5 shrink-0 rounded-full px-2 text-[10px] font-semibold uppercase tracking-[0.06em]",
                  bar.kind === "installatie" &&
                    "border border-[#047857]/25 bg-[#E8F6EC] text-[#047857]",
                  bar.kind === "levering" &&
                    "border border-[#EA580C]/25 bg-[#FFF0E6] text-[#EA580C]",
                  bar.kind === "service" &&
                    "border border-[#C45A12]/25 bg-[#FFF0E6] text-[#C45A12]",
                  bar.kind !== "installatie" &&
                    bar.kind !== "levering" &&
                    bar.kind !== "service" &&
                    "border border-[#854D0E]/25 bg-[#FFF8D6] text-[#854D0E]"
                )}
              >
                {kindChip}
              </Badge>
              {batterijKort ? (
                <span className="truncate text-[13px] font-medium text-ink">
                  {batterijKort}
                </span>
              ) : null}
              {isBarPast(bar) ? (
                <span className="text-[11px] font-medium text-muted">
                  Geweest
                </span>
              ) : null}
            </div>
            <h2 className="mt-2 font-display text-xl font-semibold tracking-tight text-ink">
              {lead?.naam || projectTitle(project)}
            </h2>
            {project.project_nummer ? (
              <p className="mt-0.5 font-mono text-sm text-muted">
                {project.project_nummer}
              </p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="shrink-0 text-muted hover:text-ink"
            aria-label="Sluiten"
          >
            <X className="size-4" />
          </Button>
        </div>
            <div className="mt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                {isInstallatieBar
                  ? "Koppel"
                  : isServiceBar
                    ? "Medewerker (service)"
                    : "Medewerker (schouw)"}
              </p>
              {allowMedewerkerWijzig && isInstallatieBar ? (
                <div className="mt-1.5">
                  <NativeSelect
                    value={huidigeKoppelId}
                    disabled={medewerkerBusy}
                    aria-label="Koppel"
                    onChange={(e) => void saveKoppel(e.target.value)}
                    className="w-full"
                  >
                    <NativeSelectOption value="">
                      {koppelsVoorSelect.length === 0
                        ? "Nog geen koppels"
                        : "Nog niet gekoppeld…"}
                    </NativeSelectOption>
                    {koppelsVoorSelect.map((k) => (
                      <NativeSelectOption key={k.id} value={k.id}>
                        {koppelWeergaveNaam(k)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {medewerkerMsg ? (
                    <p className="mt-1.5 text-xs text-muted">{medewerkerMsg}</p>
                  ) : null}
                </div>
              ) : allowMedewerkerWijzig && isServiceBar ? (
                <div className="mt-1.5">
                  <NativeSelect
                    value={huidigeServiceId}
                    disabled={medewerkerBusy}
                    aria-label="Service-monteur"
                    onChange={(e) => void saveServiceMedewerker(e.target.value)}
                    className="w-full"
                  >
                    <NativeSelectOption value="">
                      {serviceKeuzes.length === 0
                        ? "Niemand met Service"
                        : "Nog niet gekoppeld…"}
                    </NativeSelectOption>
                    {serviceKeuzes.map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>
                        {t.naam}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {medewerkerMsg ? (
                    <p className="mt-1.5 text-xs text-muted">{medewerkerMsg}</p>
                  ) : null}
                </div>
              ) : allowMedewerkerWijzig && isSchouwBarSidebar ? (
                <div className="mt-1.5">
                  <NativeSelect
                    value={huidigeMedewerkerId}
                    disabled={medewerkerBusy}
                    aria-label="Medewerker"
                    onChange={(e) => void saveMedewerker(e.target.value)}
                    className="w-full"
                  >
                    <NativeSelectOption value="">
                      {medewerkerKeuzes.length === 0
                        ? "Niemand met Schouw"
                        : "Nog niet gekoppeld…"}
                    </NativeSelectOption>
                    {medewerkerKeuzes.map((t) => (
                      <NativeSelectOption key={t.id} value={t.id}>
                        {t.naam}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {medewerkerMsg ? (
                    <p className="mt-1.5 text-xs text-muted">{medewerkerMsg}</p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-1 text-sm font-semibold text-ink">
                  {isInstallatieBar
                    ? koppelLabel || "Nog geen koppel"
                    : schouwMedewerker || "Nog niet gekoppeld"}
                </p>
              )}
            </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-1 sm:px-5">
          <dl>
            {when ? (
              <DetailRow label="Wanneer">
                {formatInTimeZone(new Date(when), AMSTERDAM_TZ, "EEEE d MMMM yyyy", {
                  locale: nl,
                })}
                <span className="mt-1 block font-semibold tabular-nums">
                  {formatTimeRangeNl(when, bar.duurMinuten) ||
                    formatTimeNl(when)}
                  {duurLabel ? (
                    <span className="ml-2 font-normal text-muted">
                      ({duurLabel})
                    </span>
                  ) : null}
                </span>
              </DetailRow>
            ) : bar.whenLabel ? (
              <DetailRow label="Wanneer">{bar.whenLabel}</DetailRow>
            ) : null}

            <DetailRow label="Status">
              <div className="space-y-2.5">
                <Badge
                  variant="secondary"
                  className="rounded-full border border-[#1A4A6E]/25 bg-[#E8F0F6] text-[11px] font-semibold text-[#1A4A6E]"
                >
                  {portalMode
                    ? resolveInstallateurStatusLabel(status, project)
                    : resolveProjectStatusLabel(status, project) || status}
                </Badge>
                <div className="space-y-2 rounded-lg border border-line bg-wash/60 px-3 py-2.5">
                  {portalMode ? (
                    <>
                      <StatusCheckRow
                        ok={batterijBesteld}
                        label="Batterij besteld"
                      />
                      {showSchouwForm ? (
                        <>
                          <StatusCheckRow
                            ok={Boolean(localDoc?.url)}
                            loading={localDoc === undefined}
                            label="Schouwformulier"
                          />
                          <StatusCheckRow
                            ok={meterkastOk}
                            loading={localMeterkast === undefined}
                            label="Foto meterkast"
                          />
                        </>
                      ) : null}
                      {showOplevering ? (
                        <>
                          <StatusCheckRow
                            ok={Boolean(localOplevering?.url)}
                            loading={localOplevering === undefined}
                            label="Opleverformulier"
                          />
                          <StatusCheckRow
                            ok={batterijFotoOk}
                            loading={localBatterij === undefined}
                            label="Foto batterij"
                          />
                          <StatusCheckRow
                            ok={videoInstallatieOk}
                            loading={localVideo === undefined}
                            label="Video installatie"
                          />
                          <StatusCheckRow
                            ok={batterijBijKlant}
                            label="Batterij is bij klant geleverd"
                          />
                        </>
                      ) : null}
                      {!showSchouwForm && !showOplevering ? (
                        <StatusCheckRow
                          ok={batterijBijKlant}
                          label="Batterij is bij klant geleverd"
                        />
                      ) : null}
                    </>
                  ) : (
                    <>
                      <StatusCheckRow
                        ok={batterijBesteld}
                        label="Batterij besteld"
                      />
                      <StatusCheckRow
                        ok={orderVolledigBetaald}
                        loading={betaaldLoading}
                        label="Order volledig betaald"
                      />
                      <StatusCheckRow
                        ok={schouwVoltooid}
                        loading={
                          showSchouwForm &&
                          localDoc === undefined &&
                          !SCHOUW_DONE_STATUSES.has(opStatus)
                        }
                        label="Schouw voltooid"
                      />
                      {showOplevering ? (
                        <StatusCheckRow
                          ok={opleveringOk}
                          loading={
                            localOplevering === undefined && !opleveringOk
                          }
                          label="Opleveringsrapport (handtekening)"
                        />
                      ) : null}
                      {showService ? (
                        <StatusCheckRow
                          ok={serviceAfgerond}
                          loading={false}
                          label="Service afgevinkt"
                        />
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            </DetailRow>

            {bar.kind === "installatie" ? (
              <DetailRow label="Producten">
                {installatieProducten === null ? (
                  <span className="text-muted">Laden…</span>
                ) : installatieProducten.length === 0 ? (
                  <span className="text-muted">Geen productregels op de offerte</span>
                ) : (
                  <ul className="space-y-1.5">
                    {installatieProducten.map((p, i) => {
                      const o = p.omschrijving.toLowerCase();
                      const extra =
                        o.includes("meterkast") || o.includes("noodstroom");
                      return (
                        <li
                          key={`${p.omschrijving}-${i}`}
                          className="flex items-start justify-between gap-3"
                        >
                          <span className="min-w-0 font-medium leading-snug">
                            {p.omschrijving}
                            {extra ? (
                              <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-muted">
                                Extra
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted">
                            {p.aantal}×
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </DetailRow>
            ) : null}

            <DetailRow label="Telefoon">
              {tel ? (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`tel:${tel}`}
                    className="font-semibold text-[#0F766E] hover:underline"
                  >
                    {tel}
                  </a>
                  <PhoneCopyIcon telefoon={tel} stopPropagation={false} />
                </div>
              ) : (
                <span className="text-muted">Niet bekend</span>
              )}
            </DetailRow>

            <DetailRow label="E-mail">
              {email ? (
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`mailto:${email}`}
                    className="min-w-0 break-all font-semibold text-[#0F766E] hover:underline"
                  >
                    {email}
                  </a>
                  <CopyButton value={email} />
                </div>
              ) : (
                <span className="text-muted">Niet bekend</span>
              )}
            </DetailRow>

            <DetailRow label="Adres">
              {adresLines.length > 0 ? (
                <div className="space-y-1">
                  {adresLines.map((line) => (
                    <p key={line} className="font-medium">
                      {line}
                    </p>
                  ))}
                  <CopyButton value={adresRegel(lead!)} />
                </div>
              ) : (
                <span className="text-muted">Niet bekend</span>
              )}
            </DetailRow>

            {!hidePartner ? (
              <DetailRow label="Installateur">
                {partner?.naam || project.monteur ? (
                  <div className="space-y-1">
                    <p className="font-medium">
                      {partner?.naam || "Geen partner"}
                    </p>
                    {project.installatie_partner_id &&
                    isSchouwBarSidebar &&
                    !huidigeMedewerkerId &&
                    !project.monteur ? (
                      <p className="text-sm font-semibold text-[#C45A12]">
                        Schouw-medewerker nog niet gekoppeld — kies bovenaan
                      </p>
                    ) : null}
                    {partner?.telefoon ? (
                      <a
                        href={`tel:${partner.telefoon}`}
                        className="block text-sm text-[#0F766E] hover:underline"
                      >
                        {partner.telefoon}
                      </a>
                    ) : null}
                    {partner?.email ? (
                      <a
                        href={`mailto:${partner.email}`}
                        className="block break-all text-sm text-[#0F766E] hover:underline"
                      >
                        {partner.email}
                      </a>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-muted">Nog geen partner</span>
                )}
              </DetailRow>
            ) : null}

            <DetailRow label="Notitie voor installateur">
              {project.installateur_notitie?.trim() ? (
                <div className="space-y-1">
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {project.installateur_notitie.trim()}
                  </p>
                  {project.installateur_notitie_door?.trim() ? (
                    <p className="text-[11px] text-muted">
                      — {project.installateur_notitie_door.trim()}
                    </p>
                  ) : null}
                </div>
              ) : (
                <span className="text-muted">Geen notitie</span>
              )}
            </DetailRow>

            {!portalMode ? (
              <DetailRow label="Notitie voor backoffice">
                {project.backoffice_notitie?.trim() ? (
                  <div className="space-y-1">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {project.backoffice_notitie.trim()}
                    </p>
                    {project.backoffice_notitie_door?.trim() ? (
                      <p className="text-[11px] text-muted">
                        — {project.backoffice_notitie_door.trim()}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <span className="text-muted">Geen notitie</span>
                )}
              </DetailRow>
            ) : null}

            {showSchouwForm && (allowSchouwUpload || localDoc !== undefined) ? (
              <>
                <DetailRow label="Foto meterkast *">
                  <RequiredDocUploadBlock
                    label="Verplicht · maak een foto van de meterkast"
                    missingLabel="Nog geen foto — verplicht voor schouw voltooid"
                    uploadLabel="Upload foto meterkast"
                    defaultFilename="foto-meterkast.jpg"
                    doc={localMeterkast}
                    allowUpload={allowSchouwUpload}
                    uploading={uploading}
                    uploadOk={uploadOk}
                    uploadError={uploadError}
                    onUpload={(file) =>
                      void uploadRequiredDoc(file, "meterkast")
                    }
                    accept="image/*"
                    capture="environment"
                    noteDraft={noteDraft}
                    onNoteChange={setNoteDraft}
                    noteBusy={noteBusy}
                    noteMsg={null}
                    onSaveNote={null}
                    notePlaceholder=""
                    noteTitle=""
                    fallbackNotities={null}
                  />
                </DetailRow>
                <DetailRow label="Schouwformulier *">
                  <RequiredDocUploadBlock
                    label="Verplicht · digitaal formulier of upload PDF/foto"
                    missingLabel="Nog niet geüpload — verplicht voor schouw voltooid"
                    uploadLabel="Of upload PDF / foto"
                    defaultFilename="schouwformulier.pdf"
                    doc={localDoc}
                    allowUpload={allowSchouwUpload}
                    uploading={uploading}
                    uploadOk={uploadOk}
                    uploadError={uploadError}
                    onUpload={(file) => void uploadRequiredDoc(file, "schouw")}
                    onMaakFormulier={
                      allowSchouwUpload
                        ? () => setSchouwFormOpen(true)
                        : null
                    }
                    noteDraft={noteDraft}
                    onNoteChange={setNoteDraft}
                    noteBusy={noteBusy}
                    noteMsg={noteMsg}
                    onSaveNote={
                      allowSchouwUpload && notesEndpoint
                        ? () =>
                            void saveSidebarNotitie().catch(() => undefined)
                        : null
                    }
                    notePlaceholder="Bijv. meterkast, kabelroute, bijzonderheden…"
                    noteTitle="Notitie bij schouw"
                    fallbackNotities={notities || null}
                  />
                </DetailRow>
              </>
            ) : showOplevering ? (
              <>
                {(schouwVoltooid ||
                  localDoc?.url ||
                  localDoc === undefined) && (
                  <DetailRow label="Schouwformulier">
                    {localDoc === undefined ? (
                      <p className="text-sm text-muted">Laden…</p>
                    ) : localDoc?.url ? (
                      <div className="space-y-1">
                        <a
                          href={localDoc.url}
                          target="_blank"
                          rel="noreferrer"
                          download={
                            localDoc.bestandsnaam || "Schouwformulier.pdf"
                          }
                          className="inline-flex border border-line bg-wash px-3 py-1.5 text-sm font-semibold text-ink hover:bg-white"
                        >
                          Schouwformulier
                          {localDoc.bestandsnaam
                            ? ` · ${localDoc.bestandsnaam}`
                            : ""}
                        </a>
                        {schouwMedewerker ? (
                          <p className="text-[11px] text-muted">
                            Uitgevoerd door {schouwMedewerker}
                          </p>
                        ) : null}
                      </div>
                    ) : schouwVoltooid ? (
                      <p className="text-sm text-[#C45A12]">
                        Schouw is geweest, maar formulier ontbreekt
                      </p>
                    ) : (
                      <p className="text-sm text-muted">
                        Nog geen schouwformulier
                      </p>
                    )}
                  </DetailRow>
                )}
                <DetailRow label="Foto batterij *">
                  <RequiredDocUploadBlock
                    label="Verplicht · maak een foto van de geïnstalleerde batterij"
                    missingLabel="Nog geen foto — verplicht voor oplevering"
                    uploadLabel="Upload foto batterij"
                    defaultFilename="foto-batterij.jpg"
                    doc={localBatterij}
                    allowUpload={allowOpleveringUpload}
                    uploading={uploading}
                    uploadOk={uploadOk}
                    uploadError={uploadError}
                    onUpload={(file) =>
                      void uploadRequiredDoc(file, "batterij")
                    }
                    accept="image/*"
                    capture="environment"
                    noteDraft={noteDraft}
                    onNoteChange={setNoteDraft}
                    noteBusy={noteBusy}
                    noteMsg={null}
                    onSaveNote={null}
                    notePlaceholder=""
                    noteTitle=""
                    fallbackNotities={null}
                  />
                </DetailRow>
                <DetailRow label="Video van installatie *">
                  <RequiredDocUploadBlock
                    label="Verplicht · video van installatie (min. 30 sec, max. 1 min)"
                    missingLabel="Nog geen video — verplicht voor oplevering"
                    uploadLabel="Upload video (30s–1m)"
                    defaultFilename="video-installatie.mp4"
                    doc={localVideo}
                    allowUpload={allowOpleveringUpload}
                    uploading={uploading}
                    uploadOk={uploadOk}
                    uploadError={uploadError}
                    onUpload={(file) =>
                      void uploadRequiredDoc(file, "video")
                    }
                    accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                    noteDraft={noteDraft}
                    onNoteChange={setNoteDraft}
                    noteBusy={noteBusy}
                    noteMsg={null}
                    onSaveNote={null}
                    notePlaceholder=""
                    noteTitle=""
                    fallbackNotities={null}
                    mediaKind="video"
                  />
                </DetailRow>
                <DetailRow label="Opleverformulier *">
                  <RequiredDocUploadBlock
                    label="Verplicht · opleverformulier met checklist + handtekening"
                    missingLabel="Nog niet ingevuld — verplicht voor oplevering"
                    uploadLabel="Of upload PDF / foto"
                    defaultFilename="opleveringsrapport.pdf"
                    doc={localOplevering}
                    allowUpload={allowOpleveringUpload}
                    uploading={uploading}
                    uploadOk={uploadOk}
                    uploadError={uploadError}
                    onUpload={(file) =>
                      void uploadRequiredDoc(file, "oplevering")
                    }
                    onMaakFormulier={
                      allowOpleveringUpload
                        ? () => setOpleverFormOpen(true)
                        : null
                    }
                    noteDraft={noteDraft}
                    onNoteChange={setNoteDraft}
                    noteBusy={noteBusy}
                    noteMsg={noteMsg}
                    onSaveNote={
                      allowOpleveringUpload && notesEndpoint
                        ? () =>
                            void saveSidebarNotitie().catch(() => undefined)
                        : null
                    }
                    notePlaceholder="Bijv. kabels door klant, bijzonderheden oplevering…"
                    noteTitle="Notitie bij installatie"
                    fallbackNotities={notities || null}
                  />
                </DetailRow>
              </>
            ) : showService ? (
              <DetailRow label="Service afronden">
                <div className="space-y-3">
                  {serviceAfgerond ? (
                    <p className="text-sm font-semibold text-[#0D5C32]">
                      Service is afgevinkt
                      {notities ? " · notitie opgeslagen" : ""}.
                    </p>
                  ) : (
                    <p className="text-xs text-muted">
                      Notitie verplicht · foto’s optioneel. Daarna afvinken.
                    </p>
                  )}

                  {serviceVerzoeken.map((v) => {
                    const klant =
                      [v.onderwerp?.trim(), v.omschrijving?.trim()]
                        .filter(Boolean)
                        .join("\n\n") || null;
                    if (!klant) return null;
                    return (
                      <div
                        key={v.id}
                        className="border border-line bg-[#FAFBFA] px-3 py-2.5"
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                          Melding van de klant
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                          {klant}
                        </p>
                      </div>
                    );
                  })}

                  {serviceWerkbon ? (
                    <div className="border border-[#FDBA74]/60 bg-[#FFF7ED] px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#9A4510]">
                        Notitie van backoffice
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                        {serviceWerkbon}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-[#C45A12]">
                      Geen notitie van backoffice op deze afspraak.
                    </p>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="service-note">Notitie bij afronden *</Label>
                    <Textarea
                      id="service-note"
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      rows={3}
                      disabled={serviceAfgerond}
                      placeholder="Wat is gedaan / bevindingen…"
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
                      Foto’s (optioneel)
                    </p>
                    {serviceFotos.length > 0 ? (
                      <ul className="space-y-1.5">
                        {serviceFotos.map((f) => (
                          <li key={f.url}>
                            <a
                              href={f.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sm font-semibold text-[#0F766E] hover:underline"
                            >
                              {f.bestandsnaam || "Servicefoto openen"}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted">Nog geen foto’s.</p>
                    )}
                    {allowServiceComplete && !serviceAfgerond ? (
                      <label
                        className={cn(
                          buttonVariants({ variant: "outline", size: "sm" }),
                          "cursor-pointer"
                        )}
                      >
                        {uploading ? "Uploaden…" : "Foto uploaden"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          disabled={uploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void uploadServiceFoto(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    ) : null}
                  </div>

                  {uploadOk ? (
                    <Alert className="border-green/30 bg-green-soft text-green-dark">
                      <AlertDescription>{uploadOk}</AlertDescription>
                    </Alert>
                  ) : null}
                  {uploadError ? (
                    <Alert variant="destructive">
                      <AlertDescription>{uploadError}</AlertDescription>
                    </Alert>
                  ) : null}
                  {noteMsg ? (
                    <Alert
                      variant={
                        noteMsg.includes("mislukt") ||
                        noteMsg.includes("Fout") ||
                        noteMsg.includes("verplicht")
                          ? "destructive"
                          : "default"
                      }
                      className={
                        noteMsg.includes("mislukt") ||
                        noteMsg.includes("Fout") ||
                        noteMsg.includes("verplicht")
                          ? undefined
                          : "border-green/30 bg-green-soft text-green-dark"
                      }
                    >
                      <AlertDescription>{noteMsg}</AlertDescription>
                    </Alert>
                  ) : null}

                  {allowServiceComplete && !serviceAfgerond ? (
                    <Button
                      type="button"
                      className="w-full bg-[#C45A12] hover:bg-[#9A4510]"
                      size="lg"
                      disabled={noteBusy || !noteDraft.trim()}
                      onClick={() => void afrondService()}
                    >
                      {noteBusy ? "Bezig…" : "Service afvinken"}
                    </Button>
                  ) : null}
                </div>
              </DetailRow>
            ) : notities ? (
              <DetailRow label="Notities">
                <p className="whitespace-pre-wrap text-sm leading-relaxed">
                  {notities}
                </p>
              </DetailRow>
            ) : null}
          </dl>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-4 sm:px-5">
          {tel ? (
            <a
              href={`tel:${tel}`}
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 flex-1 bg-[#0D9488] hover:bg-[#0F766E]"
              )}
            >
              <Phone data-icon="inline-start" />
              Bel klant
            </a>
          ) : null}
          <Link
            href={projectHref(project.id)}
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "h-11 flex-1"
            )}
          >
            Open order
          </Link>
        </div>
      </aside>

      {allowSchouwUpload && showSchouwForm ? (
        <SchouwFormulierModal
          open={schouwFormOpen}
          project={project}
          submitUrl={
            fotosUploadUrl
              ? fotosUploadUrl.replace(/\/fotos\/?$/, "/schouw-formulier")
              : `/api/projecten/${project.id}/schouw-formulier`
          }
          notitie={noteDraft}
          opnemerDefault={medewerkerNaamVanProject(project) || null}
          teamgenoten={formTeamgenoten}
          onClose={() => setSchouwFormOpen(false)}
          onCreated={(result) => {
            const foto = result.foto;
            const nextDoc =
              foto?.url
                ? {
                    url: foto.url,
                    bestandsnaam: foto.bestandsnaam || null,
                  }
                : null;
            if (nextDoc) {
              setLocalDoc(nextDoc);
              onSchouwDocChange?.(project.id, nextDoc);
            }
            if (result.project && typeof result.project === "object") {
              onProjectUpdated?.(result.project as Project);
            }
            const adv = result.status_advance;
            if (adv?.advanced && adv.klaarVoorMateriaal) {
              setUploadOk(
                "Formulier gemaakt · alles betaald → klaar voor materiaalinkoop."
              );
            } else if (adv?.advanced) {
              setUploadOk("Formulier gemaakt · schouw voltooid.");
            } else {
              setUploadOk("Schouwformulier-PDF aangemaakt.");
            }
            setUploadError(null);
          }}
        />
      ) : null}

      {allowOpleveringUpload && showOplevering ? (
        <OpleverFormulierModal
          open={opleverFormOpen}
          project={project}
          submitUrl={
            fotosUploadUrl
              ? fotosUploadUrl.replace(/\/fotos\/?$/, "/oplever-formulier")
              : `/api/projecten/${project.id}/oplever-formulier`
          }
          monteurDefault={medewerkerNaamVanProject(project) || null}
          teamgenoten={formTeamgenoten}
          onClose={() => setOpleverFormOpen(false)}
          onCreated={(result) => {
            const foto = result.foto;
            const nextDoc =
              foto?.url
                ? {
                    url: foto.url,
                    bestandsnaam: foto.bestandsnaam || null,
                  }
                : null;
            if (nextDoc) {
              setLocalOplevering(nextDoc);
              onOpleveringDocChange?.(project.id, nextDoc);
            }
            if (result.project && typeof result.project === "object") {
              onProjectUpdated?.(result.project as Project);
            }
            const adv = result.status_advance;
            if (adv?.advanced) {
              setUploadOk("Opleverformulier opgeslagen · After sale.");
            } else {
              setUploadOk("Opleverformulier-PDF aangemaakt.");
            }
            setUploadError(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TimedDayBlock({
  bar,
  selected,
  onSelect,
  gridHeight,
  col = 0,
  colCount = 1,
}: {
  bar: PlanbordBar;
  selected?: boolean;
  onSelect?: () => void;
  gridHeight: number;
  col?: number;
  colCount?: number;
}) {
  const style = KIND_STYLE[bar.kind];
  const lead = leadOf(bar.project);
  const top = eventTopPx(bar.at);
  const rawH = eventHeightPx(bar.duurMinuten);
  const height = Math.min(rawH, Math.max(HOUR_PX * 0.4, gridHeight - top - 4));
  const compact = height < HOUR_PX * 0.85;
  const past = isBarPast(bar);
  const kindLabel =
    bar.kind === "installatie"
      ? installatieKopTekst(bar)
      : planbordKindLabel(bar.kind, false, bar.project);
  const timeRange = formatTimeRangeNl(bar.at, bar.duurMinuten);
  const naam = klantNaam(bar.project);
  const plaats = klantPlaats(bar.project);
  const tel = lead?.telefoon?.trim() || null;
  const titleCls = "text-ink";
  const mutedCls = "text-muted";
  const cols = Math.max(1, colCount);
  const gapPx = 4;
  const sidePad = 8;
  const widthPct = 100 / cols;
  const leftPct = col * widthPct;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "absolute z-[1] overflow-hidden rounded-md border text-left",
        style.bg,
        style.border,
        past ? "opacity-45 grayscale-[0.35]" : "",
        selected ? "ring-2 ring-[#0D9488]/40" : "hover:shadow-sm",
      ].join(" ")}
      style={{
        top: top + 2,
        height: height - 4,
        left: `calc(${leftPct}% + ${sidePad + (col > 0 ? gapPx / 2 : 0)}px)`,
        width: `calc(${widthPct}% - ${sidePad + gapPx / 2 + (col < cols - 1 ? gapPx / 2 : sidePad)}px)`,
      }}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 ${style.accent}`}
        aria-hidden
      />
      <div
        className={[
          "flex h-full items-start justify-between gap-1.5 pl-2",
          compact ? "px-1.5 py-0.5" : "px-2 py-1",
        ].join(" ")}
      >
        <div className="min-w-0 overflow-hidden">
          <p
            className={[
              "font-bold uppercase tracking-[0.04em]",
              style.text,
              compact ? "text-[9px] leading-tight" : "text-[10px]",
            ].join(" ")}
          >
            {kindLabel}
            {timeRange ? (
              <span
                className={[
                  "ml-1 tabular-nums normal-case tracking-normal",
                  past ? "line-through decoration-2 opacity-80" : "",
                ].join(" ")}
              >
                {timeRange}
              </span>
            ) : null}
            {past && !compact ? (
              <span className="ml-1 text-[9px] font-bold normal-case tracking-wide opacity-70">
                · geweest
              </span>
            ) : null}
          </p>
          <p
            className={[
              "truncate font-semibold",
              titleCls,
              compact ? "text-[11px] leading-tight" : "text-xs",
            ].join(" ")}
            title={naam}
          >
            {naam}
          </p>
          {plaats && !compact ? (
            <p
              className={["truncate font-medium text-[10px] leading-tight", mutedCls].join(
                " "
              )}
            >
              {plaats}
            </p>
          ) : null}
        </div>
        {tel && !compact ? <PhoneCopyIcon telefoon={tel} /> : null}
      </div>
    </button>
  );
}

function monthGridDays(anchor: Date): DayCol[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const start = startOfWeek(startOfMonth(local), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(local), { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map((date) => {
    const dow = date.getDay();
    return {
      key: formatInTimeZone(
        fromZonedTime(
          new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            12,
            0,
            0
          ),
          AMSTERDAM_TZ
        ),
        AMSTERDAM_TZ,
        "yyyy-MM-dd"
      ),
      date,
      weekend: dow === 0 || dow === 6,
    };
  });
}

function isSameMonthKey(dayKey: string, anchor: Date): boolean {
  return dayKey.startsWith(
    formatInTimeZone(anchor, AMSTERDAM_TZ, "yyyy-MM")
  );
}

function barHourAmsterdam(bar: PlanbordBar): number | null {
  if (!bar.at) return null;
  return Number(formatInTimeZone(new Date(bar.at), AMSTERDAM_TZ, "H"));
}

function barInVenster(bar: PlanbordBar, venster: PartnerVenster): boolean {
  const h = barHourAmsterdam(bar);
  if (h == null) return false;
  if (venster === "ochtend") return h >= 8 && h < 12;
  return h >= 13 && h < 17;
}

function projectAdres(p: Project): string | null {
  const lead = leadOf(p);
  if (!lead) return null;
  const a = adresRegel(lead);
  return a && a !== "—" ? a : null;
}

function installPairForDay(bars: PlanbordBar[]): {
  a: PlanbordBar;
  b: PlanbordBar;
} | null {
  const inst = bars
    .filter((b) => b.kind === "installatie" && b.at)
    .sort((x, y) => String(x.at).localeCompare(String(y.at)));
  const ochtend = inst.filter((b) => barInVenster(b, "ochtend"));
  const middag = inst.filter((b) => barInVenster(b, "middag"));
  for (const a of ochtend) {
    const b = middag.find((m) => m.partnerId && m.partnerId === a.partnerId);
    if (b) return { a, b };
  }
  if (ochtend[0] && middag[0]) return { a: ochtend[0], b: middag[0] };
  return null;
}

const INSTALLATIE_OCHTEND_MIN = 240;
const INSTALLATIE_PAUZE_MIN = 60;
const INSTALLATIE_MIDDAG_MIN = 240;

function InstallatieDagKolom({
  bars,
  showPlek,
  travelLabel,
  onPlanVenster,
  onSelectBar,
  selectedKey,
}: {
  bars: PlanbordBar[];
  showPlek?: boolean;
  travelLabel?: string | null;
  onPlanVenster?: (venster: PartnerVenster) => void;
  onSelectBar?: (bar: PlanbordBar) => void;
  selectedKey?: string | null;
}) {
  const ochtend = bars.filter(
    (b) => b.kind === "installatie" && barInVenster(b, "ochtend")
  );
  const middag = bars.filter(
    (b) => b.kind === "installatie" && barInVenster(b, "middag")
  );
  const ochtendBar = ochtend[0] || null;
  const middagBar = middag[0] || null;
  if (!ochtendBar && !middagBar) return null;

  const ochtendFill = ochtendBar
    ? Math.min(INSTALLATIE_OCHTEND_MIN, ochtendBar.duurMinuten)
    : 0;
  const ochtendLead = ochtendBar
    ? Math.max(0, INSTALLATIE_OCHTEND_MIN - ochtendFill)
    : 0;
  const middagFill = middagBar
    ? Math.min(INSTALLATIE_MIDDAG_MIN, middagBar.duurMinuten)
    : 0;
  const middagLead = middagBar
    ? Math.max(0, INSTALLATIE_MIDDAG_MIN - middagFill)
    : 0;

  function slotFill(bar: PlanbordBar) {
    const range = formatTimeRangeNl(bar.at, bar.duurMinuten);
    const naam = klantNaam(bar.project);
    const kop = installatieKopTekst(bar);
    const past = isBarPast(bar);
    return (
      <button
        type="button"
        onClick={() => onSelectBar?.(bar)}
        title={`${range} · ${kop} · ${naam}${past ? " · gedaan" : ""}`}
        className={[
          "flex h-full w-full flex-col justify-start px-1.5 py-1 text-left",
          past ? "bg-[#F3F4F3] text-muted" : "bg-[#ECFDF5] text-[#047857]",
          selectedKey === bar.key
            ? past
              ? "bg-[#E7E8E7]"
              : "bg-[#D1FAE5]"
            : past
              ? "hover:bg-[#ECEDEC]"
              : "hover:bg-[#D1FAE5]/70",
        ].join(" ")}
      >
        <span
          className={[
            "text-[10px] font-bold leading-tight",
            past ? "text-muted line-through decoration-1" : "text-[#047857]",
          ].join(" ")}
        >
          {kop}
        </span>
        <span
          className={[
            "text-[10px] font-bold tabular-nums leading-tight",
            past ? "line-through decoration-1" : "",
          ].join(" ")}
        >
          {range}
        </span>
        <span
          className={[
            "truncate text-[10px] font-medium leading-tight",
            past ? "text-muted line-through decoration-1" : "text-ink",
          ].join(" ")}
        >
          {naam}
        </span>
      </button>
    );
  }

  return (
    <div className="flex min-h-[8.25rem] flex-1 flex-col">
      <div
        className="flex min-h-0 flex-col"
        style={{ flex: INSTALLATIE_OCHTEND_MIN }}
      >
        {ochtendLead > 0 ? (
          <div style={{ flex: ochtendLead }} aria-hidden />
        ) : null}
        {ochtendBar ? (
          <div className="min-h-0" style={{ flex: ochtendFill }}>
            {slotFill(ochtendBar)}
          </div>
        ) : showPlek ? (
          <button
            type="button"
            onClick={() => onPlanVenster?.("ochtend")}
            className="flex flex-1 items-start px-1.5 py-1 text-left text-[10px] text-muted hover:bg-wash hover:text-ink"
          >
            nog 08–12
          </button>
        ) : (
          <div className="flex-1" />
        )}
      </div>
      <div
        className="flex shrink-0 flex-col items-start justify-center border-y border-line/80 px-1.5 py-0.5 leading-tight"
        style={{ flex: INSTALLATIE_PAUZE_MIN }}
      >
        <span className="text-[9px] text-muted">pauze 12–13</span>
        {travelLabel ? (
          <span className="text-[9px] font-medium text-[#0F766E]">
            reistijd {travelLabel}
          </span>
        ) : null}
      </div>
      <div
        className="flex min-h-0 flex-col"
        style={{ flex: INSTALLATIE_MIDDAG_MIN }}
      >
        {middagLead > 0 ? (
          <div style={{ flex: middagLead }} aria-hidden />
        ) : null}
        {middagBar ? (
          <div className="min-h-0" style={{ flex: middagFill }}>
            {slotFill(middagBar)}
          </div>
        ) : showPlek ? (
          <button
            type="button"
            onClick={() => onPlanVenster?.("middag")}
            className="flex flex-1 items-start px-1.5 py-1 text-left text-[10px] text-muted hover:bg-wash hover:text-ink"
          >
            nog 13–17
          </button>
        ) : (
          <div className="flex-1" />
        )}
      </div>
    </div>
  );
}

function AfblokVensterChip({
  venster,
  blocked,
  compact,
  interactive,
  disabled,
  hasWork,
  onToggle,
}: {
  venster: PartnerVenster;
  blocked: boolean;
  compact?: boolean;
  interactive: boolean;
  disabled?: boolean;
  hasWork?: boolean;
  onToggle?: () => void;
}) {
  const label =
    venster === "ochtend"
      ? compact
        ? "Ocht."
        : "Ochtend 08–12"
      : compact
        ? "Mid."
        : "Middag 13–17";
  const status = blocked
    ? compact
      ? "Dicht"
      : "Afgeblokt"
    : hasWork
      ? "Bezet"
      : "Open";

  // Buiten afblok-modus: alleen dicht tonen (anders te druk)
  if (!interactive && !blocked) return null;

  const className = [
    "flex w-full items-center justify-between gap-1 font-bold uppercase tracking-wide disabled:opacity-50",
    compact ? "border px-1 py-0.5 text-[9px]" : "flex-col gap-0.5 border px-2 py-2 text-left text-[11px]",
    blocked
      ? "border-[#B91C1C] bg-[#DC2626] text-white shadow-sm"
      : hasWork
        ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]"
        : "border-dashed border-[#FECACA] bg-white text-[#B91C1C] hover:bg-[#FEF2F2]",
    !interactive ? "cursor-default" : "",
  ].join(" ");

  const body = (
    <>
      <span className={compact ? "flex w-full items-center justify-between gap-1" : "flex w-full items-center justify-between gap-1"}>
        <span>{label}</span>
        <span className="uppercase tracking-wide">{status}</span>
      </span>
      {!compact ? (
        <span className="text-[10px] font-medium opacity-90">
          {venster === "ochtend" ? "Installatie 1" : "Installatie 2"}
        </span>
      ) : null}
    </>
  );

  if (!interactive) {
    return (
      <div className={className} title="Afgeblokt — niet beschikbaar">
        {body}
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className={className}
      title={blocked ? "Klik om weer open te zetten" : "Klik om af te blokken"}
    >
      {body}
    </button>
  );
}

function sortBarsOpTijd(bars: PlanbordBar[]): PlanbordBar[] {
  return [...bars].sort((a, b) => (a.at || "").localeCompare(b.at || ""));
}

function MatrixJobLink({
  bar,
  selected,
  onSelect,
}: {
  bar: PlanbordBar;
  selected?: boolean;
  onSelect?: (bar: PlanbordBar) => void;
}) {
  const past = isBarPast(bar);
  const time = bar.at ? formatTimeNl(bar.at) : "";
  const naam = klantAchternaam(bar.project);
  const style = KIND_STYLE[bar.kind];
  return (
    <button
      type="button"
      onClick={() => onSelect?.(bar)}
      className={cn(
        "flex w-full min-w-0 items-baseline gap-1 truncate rounded-md border px-1.5 py-0.5 text-left leading-tight",
        style.bg,
        style.border,
        past ? "opacity-45" : "",
        selected ? "ring-1 ring-[#0D9488]" : "hover:opacity-90"
      )}
      title={`${time} ${klantNaam(bar.project)}`}
    >
      {time ? (
        <span
          className={cn(
            "shrink-0 text-[11px] font-bold tabular-nums",
            style.text,
            past ? "line-through" : ""
          )}
        >
          {time}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0 truncate text-[11px] font-semibold text-ink",
          past ? "line-through opacity-80" : ""
        )}
      >
        {naam}
      </span>
    </button>
  );
}

type AgendaPersoon = { id: string; naam: string; kanSchouw?: boolean };

function schouwPersoonVanBar(
  bar: PlanbordBar,
  personen: AgendaPersoon[] = []
): AgendaPersoon {
  const id = bar.project.installatie_teamgenoot_id?.trim() || "";
  if (id) {
    const known = personen.find((p) => p.id === id);
    const naam =
      known?.naam ||
      medewerkerNaamVanProject(bar.project).trim() ||
      "Onbekend";
    return { id, naam };
  }
  const naam =
    medewerkerNaamVanProject(bar.project).trim() || "Nog niet gekoppeld";
  const byName = personen.find(
    (p) => p.naam.trim().toLowerCase() === naam.toLowerCase()
  );
  if (byName) return byName;
  return { id: `naam:${naam.toLowerCase()}`, naam };
}

function WeekKoppelMatrix({
  days,
  bars,
  koppels,
  schouwPersonen = [],
  toonLegeSchouwers = false,
  selectedKey,
  readOnly,
  todayKey,
  soortFilter,
  showLegeSlots = true,
  monthPrefix,
  onDayClick,
  onSelectBar,
  onPlanInstallatie,
}: {
  days: DayCol[];
  bars: PlanbordBar[];
  koppels: InstallatiePartnerKoppel[];
  schouwPersonen?: AgendaPersoon[];
  toonLegeSchouwers?: boolean;
  selectedKey?: string | null;
  readOnly?: boolean;
  todayKey: string;
  soortFilter?: "" | "schouw" | "installatie" | "service";
  showLegeSlots?: boolean;
  monthPrefix?: string;
  onDayClick?: (dayKey: string) => void;
  onSelectBar: (bar: PlanbordBar) => void;
  onPlanInstallatie?: (
    dayKey: string,
    partnerId: string | null,
    venster: PartnerVenster
  ) => void;
}) {
  const kolommen = days.filter(
    (d) => !d.weekend || Boolean(feestdagOp(d.key))
  );
  const actieveKoppels = koppels.filter((k) => k.actief !== false);
  const installatieBars = bars.filter((b) => b.kind === "installatie");
  const schouwBars = bars.filter(
    (b) => b.kind === "schouw" || b.kind === "schouwweek"
  );
  const serviceBars = bars.filter((b) => b.kind === "service");
  const losseInstallaties = installatieBars.filter(
    (b) => !installatieKoppelIdVoorBar(b, actieveKoppels)
  );
  const toonInstallatie = !soortFilter || soortFilter === "installatie";
  const toonSchouw = !soortFilter || soortFilter === "schouw";
  const toonService = !soortFilter || soortFilter === "service";
  const colCount = Math.max(1, kolommen.length);

  function buitenMaand(d: DayCol) {
    return Boolean(monthPrefix) && !d.key.startsWith(monthPrefix);
  }

  function jobsOpDag(list: PlanbordBar[], dayKey: string) {
    return sortBarsOpTijd(list.filter((b) => b.dayKeys.includes(dayKey)));
  }

  function legeInstallatieSlots(
    jobs: PlanbordBar[],
    dayKey: string,
    partnerId: string | null,
    dim?: boolean
  ) {
    if (
      dim ||
      feestdagOp(dayKey) ||
      !showLegeSlots ||
      readOnly ||
      !onPlanInstallatie
    ) {
      return null;
    }
    const ochtendBezet = jobs.some((b) => barInVenster(b, "ochtend"));
    const middagBezet = jobs.some((b) => barInVenster(b, "middag"));
    const slots: { label: string; venster: PartnerVenster }[] = [];
    if (!ochtendBezet) {
      slots.push({ label: "+ 1e", venster: "ochtend" });
    }
    if (!middagBezet) {
      slots.push({ label: "+ 2e", venster: "middag" });
    }
    return slots.map((s) => (
      <button
        key={s.venster}
        type="button"
        onClick={() => onPlanInstallatie(dayKey, partnerId, s.venster)}
        className="block w-full rounded-md px-1 py-0.5 text-left text-[11px] font-medium text-muted/70 hover:bg-wash hover:text-ink"
      >
        {s.label}
      </button>
    ));
  }

  function jobLijst(jobs: PlanbordBar[]) {
    return jobs.map((bar) => (
      <MatrixJobLink
        key={bar.key}
        bar={bar}
        selected={selectedKey === bar.key}
        onSelect={onSelectBar}
      />
    ));
  }

  function cellBg(
    d: DayCol,
    opts?: { section?: boolean; sluitFeestdag?: boolean }
  ) {
    if (buitenMaand(d)) return "bg-[#F4F5F4]";
    if (opts?.sluitFeestdag && feestdagOp(d.key)) return "bg-[#FEF2F2]";
    if (d.key === todayKey) return "bg-[#F0FDFA]";
    if (opts?.section) return "bg-[#FAFBFA]";
    return "bg-white";
  }

  function rij(
    key: string,
    label: ReactNode,
    render: (d: DayCol) => ReactNode,
    opts?: { section?: boolean; indent?: boolean; sluitFeestdag?: boolean }
  ) {
    return (
      <tr key={key} className="border-t border-line">
        <th
          scope="row"
          className={cn(
            "w-40 border-r border-line text-left align-top text-ink",
            opts?.section
              ? "bg-[#FAFBFA] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.07em]"
              : "bg-white py-1.5 pr-3 text-[13px] font-semibold",
            opts?.indent ? "pl-7" : "px-3"
          )}
        >
          {label}
        </th>
        {kolommen.map((d) => (
          <td
            key={d.key}
            className={cn(
              "border-l border-line px-1 py-1 align-top",
              cellBg(d, opts)
            )}
          >
            {buitenMaand(d) ? null : (
              <div className="flex flex-col gap-0.5">{render(d)}</div>
            )}
          </td>
        ))}
      </tr>
    );
  }

  const serviceCount = serviceBars.filter((b) =>
    kolommen.some((d) => !buitenMaand(d) && b.dayKeys.includes(d.key))
  ).length;

  const schouwRijen = (() => {
    const map = new Map<string, AgendaPersoon>();
    if (toonLegeSchouwers) {
      for (const p of schouwPersonen) {
        if (p.id && p.kanSchouw) map.set(p.id, p);
      }
    }
    for (const b of schouwBars) {
      const persoon = schouwPersoonVanBar(b, schouwPersonen);
      const known = schouwPersonen.find((p) => p.id === persoon.id);
      map.set(persoon.id, known || persoon);
    }
    return [...map.values()].sort((a, b) =>
      a.naam.localeCompare(b.naam, "nl")
    );
  })();

  return (
    <div className="overflow-hidden border border-line bg-white">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-40" />
          {kolommen.map((d) => (
            <col key={d.key} />
          ))}
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th
              scope="col"
              className="w-40 bg-white px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-muted"
            />
            {kolommen.map((d) => {
              const isToday = d.key === todayKey;
              const dim = buitenMaand(d);
              const feestdag = feestdagOp(d.key);
              const inner = (
                <>
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {format(d.date, "EEE", { locale: nl })}
                  </span>
                  <span
                    className={cn(
                      "mt-0.5 inline-flex h-7 min-w-7 items-center justify-center text-[15px] font-semibold tabular-nums",
                      isToday
                        ? "bg-[#0D9488] px-1.5 text-white"
                        : dim
                          ? "text-muted/45"
                          : "text-ink"
                    )}
                  >
                    {format(d.date, "d")}
                  </span>
                  {feestdag && !dim ? (
                    <span className="mt-1 block text-[10px] font-semibold leading-tight text-[#B91C1C]">
                      {feestdag.naam}
                    </span>
                  ) : null}
                </>
              );
              return (
                <th
                  key={d.key}
                  scope="col"
                  className={cn(
                    "border-l border-line px-2 py-2 text-left",
                    dim
                      ? "bg-[#F4F5F4]"
                      : feestdag
                        ? "bg-[#FEF2F2]"
                        : isToday
                          ? "bg-[#F0FDFA]"
                          : "bg-white"
                  )}
                >
                  {onDayClick && !dim ? (
                    <button
                      type="button"
                      onClick={() => onDayClick(d.key)}
                      className="text-left hover:opacity-80"
                    >
                      {inner}
                    </button>
                  ) : (
                    inner
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {toonInstallatie ? (
            <tr className="border-t border-line">
              <th
                scope="row"
                className="bg-[#FAFBFA] px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.07em] text-ink"
              >
                Installatie
              </th>
              <td
                colSpan={colCount}
                className="border-l border-line bg-[#FAFBFA]"
              />
            </tr>
          ) : null}
          {toonInstallatie &&
            actieveKoppels.map((k) =>
              rij(
                `koppel-${k.id}`,
                koppelRijLabel(k),
                (d) => {
                  const jobs = jobsOpDag(
                    installatieBars.filter(
                      (b) =>
                        installatieKoppelIdVoorBar(b, actieveKoppels) === k.id
                    ),
                    d.key
                  );
                  if (feestdagOp(d.key)) {
                    return jobs.length ? (
                      jobLijst(jobs)
                    ) : (
                      <p className="px-0.5 text-[10px] font-medium text-[#B91C1C]">
                        Gesloten
                      </p>
                    );
                  }
                  return (
                    <>
                      {jobLijst(jobs)}
                      {legeInstallatieSlots(
                        jobs,
                        d.key,
                        k.partner_id || null
                      )}
                    </>
                  );
                },
                { indent: true, sluitFeestdag: true }
              )
            )}
          {toonInstallatie && losseInstallaties.length > 0
            ? rij(
                "zonder-koppel",
                "Zonder koppel",
                (d) =>
                  jobLijst(
                    jobsOpDag(
                      losseInstallaties.filter((b) =>
                        b.dayKeys.includes(d.key)
                      ),
                      d.key
                    )
                  ),
                { indent: true }
              )
            : null}

          {toonSchouw ? (
            <tr className="border-t border-line">
              <th
                scope="row"
                className="bg-[#FAFBFA] px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-[0.07em] text-ink"
              >
                Schouw
              </th>
              <td
                colSpan={colCount}
                className="border-l border-line bg-[#FAFBFA]"
              />
            </tr>
          ) : null}
          {toonSchouw &&
            schouwRijen.map((persoon) =>
              rij(
                `schouw-${persoon.id}`,
                persoon.naam,
                (d) => {
                  const jobs = jobsOpDag(
                    schouwBars.filter((b) => {
                      const p = schouwPersoonVanBar(b, schouwPersonen);
                      return p.id === persoon.id;
                    }),
                    d.key
                  );
                  if (feestdagOp(d.key)) {
                    return jobs.length ? (
                      jobLijst(jobs)
                    ) : (
                      <p className="px-0.5 text-[10px] font-medium text-[#B91C1C]">
                        Gesloten
                      </p>
                    );
                  }
                  return jobLijst(jobs);
                },
                { indent: true, sluitFeestdag: true }
              )
            )}
          {toonSchouw && schouwRijen.length === 0
            ? rij(
                "schouw-leeg",
                "Nog niemand",
                (d) =>
                  feestdagOp(d.key) ? (
                    <p className="px-0.5 text-[10px] font-medium text-[#B91C1C]">
                      Gesloten
                    </p>
                  ) : null,
                { indent: true, sluitFeestdag: true }
              )
            : null}

          {toonService
            ? rij(
                "sectie-service",
                <span className="flex items-baseline justify-between gap-2">
                  <span>Service</span>
                  {serviceCount > 0 ? (
                    <span className="font-semibold normal-case tracking-normal text-muted">
                      {serviceCount}
                    </span>
                  ) : null}
                </span>,
                (d) => jobLijst(jobsOpDag(serviceBars, d.key)),
                { section: true }
              )
            : null}
        </tbody>
      </table>
    </div>
  );
}

function maandWeekBlokken(monthDays: DayCol[]): DayCol[][] {
  const weeks: DayCol[][] = [];
  for (let i = 0; i < monthDays.length; i += 7) {
    const chunk = monthDays.slice(i, i + 7);
    if (chunk.length) weeks.push(chunk);
  }
  return weeks;
}

function MaandKoppelOverzicht({
  monthDays,
  bars,
  koppels,
  schouwPersonen = [],
  toonLegeSchouwers = false,
  selectedKey,
  readOnly,
  todayKey,
  soortFilter,
  monthPrefix,
  onDayClick,
  onSelectBar,
  onPlanInstallatie,
}: {
  monthDays: DayCol[];
  bars: PlanbordBar[];
  koppels: InstallatiePartnerKoppel[];
  schouwPersonen?: AgendaPersoon[];
  toonLegeSchouwers?: boolean;
  selectedKey?: string | null;
  readOnly?: boolean;
  todayKey: string;
  soortFilter?: "" | "schouw" | "installatie" | "service";
  monthPrefix: string;
  onDayClick?: (dayKey: string) => void;
  onSelectBar: (bar: PlanbordBar) => void;
  onPlanInstallatie?: (
    dayKey: string,
    partnerId: string | null,
    venster: PartnerVenster
  ) => void;
}) {
  const weken = maandWeekBlokken(monthDays);
  return (
    <div className="space-y-4">
      {weken.map((week) => {
        const werk = week.filter((d) => !d.weekend);
        const inMaand = werk.filter((d) => d.key.startsWith(monthPrefix));
        if (inMaand.length === 0) return null;
        const info = schouwWeekFromDate(inMaand[0]!.date);
        const van = format(inMaand[0]!.date, "d", { locale: nl });
        const tot = format(inMaand[inMaand.length - 1]!.date, "d MMM", {
          locale: nl,
        });
        const weekKeys = new Set(inMaand.map((d) => d.key));
        const nInst = bars.filter(
          (b) => b.kind === "installatie" && b.dayKeys.some((k) => weekKeys.has(k))
        ).length;
        const nSchouw = bars.filter(
          (b) =>
            (b.kind === "schouw" || b.kind === "schouwweek") &&
            b.dayKeys.some((k) => weekKeys.has(k))
        ).length;
        const nService = bars.filter(
          (b) => b.kind === "service" && b.dayKeys.some((k) => weekKeys.has(k))
        ).length;
        return (
          <section key={week[0]?.key || info.week}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3 px-0.5">
              <p className="text-[13px] font-semibold text-ink">
                Week {info.week}
                <span className="ml-2 font-medium text-muted">
                  {van}–{tot}
                </span>
              </p>
              <p className="text-[11px] font-medium text-muted">
                {nInst} inst. · {nSchouw} schouw
                {nService ? ` · ${nService} service` : ""}
              </p>
            </div>
            <WeekKoppelMatrix
              days={week}
              bars={bars}
              koppels={koppels}
              schouwPersonen={schouwPersonen}
              toonLegeSchouwers={toonLegeSchouwers}
              selectedKey={selectedKey}
              readOnly={readOnly}
              todayKey={todayKey}
              soortFilter={soortFilter}
              showLegeSlots={false}
              monthPrefix={monthPrefix}
              onDayClick={onDayClick}
              onSelectBar={onSelectBar}
              onPlanInstallatie={onPlanInstallatie}
            />
          </section>
        );
      })}
    </div>
  );
}

const VIEW_OPTIONS: { id: AgendaView; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "dag", label: "Dag" },
  { id: "maand", label: "Maand" },
  { id: "lijst", label: "Lijst" },
];

const PLANBORD_VIEW_STORAGE_KEY = "bc_planbord_view";

function parseAgendaView(raw: string | null | undefined): AgendaView | null {
  if (raw === "week" || raw === "dag" || raw === "maand" || raw === "lijst") {
    return raw;
  }
  return null;
}

type AgendaTeamFilter =
  | { kind: "all" }
  | { kind: "person"; id: string }
  | { kind: "koppel"; id: string };

export function Planbord({
  projecten,
  onProjectUpdated,
  variant = "backoffice",
  portalToken,
  title,
  projectHref,
  afblokPartnerId: afblokPartnerIdProp,
  showTeamAgendaFilters = false,
}: {
  projecten: Project[];
  onProjectUpdated?: (project: Project) => void;
  /** portal = installateur (geen inplannen; wel schouwformulier uploaden) */
  variant?: "backoffice" | "portal";
  /** Portaal-token voor foto/notitie API’s */
  portalToken?: string;
  title?: string;
  projectHref?: (projectId: string) => string;
  /** Partner voor afblokmodus (portaal of CRM) */
  afblokPartnerId?: string | null;
  /** Beheerder: filter agenda per monteur / koppel */
  showTeamAgendaFilters?: boolean;
}) {
  const readOnly = variant === "portal";
  const resolveProjectHref =
    projectHref ||
    ((id: string) =>
      readOnly ? `#` : `/projecten/${id}?from=agenda`);
  const portalFotosUrl = (projectId: string) =>
    portalToken
      ? `/api/installatie/${portalToken}/orders/${projectId}/fotos`
      : null;
  const portalNotesUrl = (projectId: string) =>
    portalToken
      ? `/api/installatie/${portalToken}/orders/${projectId}`
      : null;

  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<AgendaView>("week");
  const [afblokMode, setAfblokMode] = useState(false);
  const [afblokPartnerId, setAfblokPartnerId] = useState(
    afblokPartnerIdProp || ""
  );
  const [afblokTeamgenoten, setAfblokTeamgenoten] = useState<
    InstallatiePartnerTeamgenoot[]
  >([]);
  const [afblokTgId, setAfblokTgId] = useState("");
  const [afblokkingen, setAfblokkingen] = useState<Set<string>>(new Set());
  const [blockBusy, setBlockBusy] = useState(false);
  const [afblokPerMonteur, setAfblokPerMonteur] = useState(true);

  useEffect(() => {
    try {
      const stored = parseAgendaView(
        localStorage.getItem(PLANBORD_VIEW_STORAGE_KEY)
      );
      if (stored) setView(stored);
    } catch {
      /* ignore */
    }
  }, []);

  const changeView = useCallback((next: AgendaView) => {
    setView(next);
    try {
      localStorage.setItem(PLANBORD_VIEW_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [selectedBar, setSelectedBar] = useState<PlanbordBar | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planDayKey, setPlanDayKey] = useState<string | null>(null);
  const [planPartnerId, setPlanPartnerId] = useState<string | null>(null);
  const [planSoort, setPlanSoort] = useState<PlanSoort | null>(null);
  const [planVenster, setPlanVenster] = useState<PartnerVenster | null>(null);
  /** Filter: partner + soort op het planbord */
  const [filterPartnerId, setFilterPartnerId] = useState<string>("");
  const [filterSoort, setFilterSoort] = useState<
    "" | "schouw" | "installatie" | "service"
  >("");
  const [agendaTeamFilter, setAgendaTeamFilter] = useState<AgendaTeamFilter>({
    kind: "all",
  });
  const [agendaKoppels, setAgendaKoppels] = useState<InstallatiePartnerKoppel[]>(
    []
  );
  const [agendaSchouwPersonen, setAgendaSchouwPersonen] = useState<
    AgendaPersoon[]
  >([]);
  const [localProjects, setLocalProjects] = useState(projecten);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [reistijden, setReistijden] = useState<Record<string, string>>(
    {}
  );
  const [schouwDocs, setSchouwDocs] = useState<
    Record<string, SchouwDocInfo | null>
  >({});
  const [opleveringDocs, setOpleveringDocs] = useState<
    Record<string, SchouwDocInfo | null>
  >({});
  const [batterijLabels, setBatterijLabels] = useState<Record<string, string>>(
    {}
  );
  const [offerteRegelsById, setOfferteRegelsById] = useState<
    Record<string, OfferteRegelKort[]>
  >({});
  const todayKey = useMemo(() => dayKeyAmsterdam(new Date()), []);

  useEffect(() => {
    setLocalProjects(projecten);
  }, [projecten]);

  useEffect(() => {
    if (readOnly) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/installatie-partners");
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setPartners((data.partners as InstallatiePartner[]) || []);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readOnly]);

  useEffect(() => {
    if (afblokPartnerIdProp) setAfblokPartnerId(afblokPartnerIdProp);
  }, [afblokPartnerIdProp]);

  // CRM: filter-chip partner → ook afblokkingen van die partner tonen
  useEffect(() => {
    if (afblokPartnerIdProp || afblokMode || readOnly) return;
    if (filterPartnerId) setAfblokPartnerId(filterPartnerId);
  }, [filterPartnerId, afblokPartnerIdProp, afblokMode, readOnly]);

  useEffect(() => {
    if (!afblokMode) return;
    if (!afblokPartnerId && partners.length && !readOnly) {
      setAfblokPartnerId(partners.find((p) => p.actief)?.id || partners[0].id);
    }
  }, [afblokMode, afblokPartnerId, partners, readOnly]);

  // Teamgenoten altijd laden als we een partner hebben (ook buiten afblok-modus)
  useEffect(() => {
    if (!afblokPartnerId) {
      setAfblokTeamgenoten([]);
      setAfblokTgId("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const url =
          readOnly && portalToken
            ? `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`
            : `/api/installatie-partners/teamgenoten?partner_id=${encodeURIComponent(afblokPartnerId)}`;
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const list = (
          (data.teamgenoten || []) as InstallatiePartnerTeamgenoot[]
        ).filter((t) => t.actief !== false);
        setAfblokTeamgenoten(list);
        setAfblokTgId((cur) =>
          cur && list.some((t) => t.id === cur) ? cur : list[0]?.id || ""
        );
      } catch {
        if (!cancelled) {
          setAfblokTeamgenoten([]);
          setAfblokTgId("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [afblokPartnerId, readOnly, portalToken]);

  useEffect(() => {
    const crmPartnerId = filterPartnerId || afblokPartnerId || "";
    if (portalToken) {
      let cancelled = false;
      void (async () => {
        try {
          const res = await fetch(
            `/api/installatie/${encodeURIComponent(portalToken)}/koppels`
          );
          const data = await res.json().catch(() => ({}));
          if (cancelled || !res.ok) return;
          setAgendaKoppels(
            ((data.koppels || []) as InstallatiePartnerKoppel[]).filter(
              (k) => k.actief !== false
            )
          );
        } catch {
          if (!cancelled) setAgendaKoppels([]);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    let cancelled = false;
    const qs = crmPartnerId
      ? `?partner_id=${encodeURIComponent(crmPartnerId)}`
      : "";
    void (async () => {
      try {
        const res = await fetch(`/api/installatie-partners/koppels${qs}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setAgendaKoppels(
          ((data.koppels || []) as InstallatiePartnerKoppel[]).filter(
            (k) => k.actief !== false
          )
        );
      } catch {
        if (!cancelled) setAgendaKoppels([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portalToken, filterPartnerId, afblokPartnerId]);

  const schouwPartnerIdsKey = useMemo(() => {
    if (filterPartnerId) return filterPartnerId;
    const ids = new Set<string>();
    if (afblokPartnerId) ids.add(afblokPartnerId);
    for (const k of agendaKoppels) {
      if (k.partner_id) ids.add(k.partner_id);
    }
    return [...ids].sort().join(",");
  }, [filterPartnerId, afblokPartnerId, agendaKoppels]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (readOnly && portalToken) {
          const res = await fetch(
            `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`
          );
          const data = await res.json().catch(() => ({}));
          if (cancelled || !res.ok) return;
          const list = (
            (data.teamgenoten || []) as InstallatiePartnerTeamgenoot[]
          )
            .filter((t) => t.actief !== false && t.id)
            .map((t) => ({
              id: t.id,
              naam: (t.naam || "").trim() || "Onbekend",
              kanSchouw: t.kan_schouw === true,
            }));
          setAgendaSchouwPersonen(list);
          return;
        }
        const ids = schouwPartnerIdsKey
          ? schouwPartnerIdsKey.split(",").filter(Boolean)
          : [];
        if (ids.length === 0) {
          setAgendaSchouwPersonen([]);
          return;
        }
        const lists = await Promise.all(
          ids.map(async (partnerId) => {
            const res = await fetch(
              `/api/installatie-partners/teamgenoten?partner_id=${encodeURIComponent(partnerId)}`
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return [] as InstallatiePartnerTeamgenoot[];
            return (data.teamgenoten || []) as InstallatiePartnerTeamgenoot[];
          })
        );
        if (cancelled) return;
        const byId = new Map<string, AgendaPersoon>();
        for (const t of lists.flat()) {
          if (t.actief === false || !t.id) continue;
          byId.set(t.id, {
            id: t.id,
            naam: (t.naam || "").trim() || "Onbekend",
            kanSchouw: t.kan_schouw === true,
          });
        }
        setAgendaSchouwPersonen([...byId.values()]);
      } catch {
        if (!cancelled) setAgendaSchouwPersonen([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readOnly, portalToken, schouwPartnerIdsKey]);

  const schouwPersonenVoorMatrix = useMemo(() => {
    const list =
      agendaTeamFilter.kind === "person"
        ? agendaSchouwPersonen.filter((p) => p.id === agendaTeamFilter.id)
        : agendaSchouwPersonen;
    return [...list].sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
  }, [agendaSchouwPersonen, agendaTeamFilter]);

  const toonLegeSchouwers =
    Boolean(filterPartnerId) ||
    Boolean(readOnly) ||
    agendaTeamFilter.kind === "person";

  const weekDays = useMemo(() => weekDaysFrom(anchor), [anchor]);
  const monthDays = useMemo(() => monthGridDays(anchor), [anchor]);
  const weekInfo = useMemo(() => schouwWeekFromDate(anchor), [anchor]);
  const weekJumpOptions = useMemo(() => agendaWeekJumpOptions(8, 40), []);
  const dayKey = useMemo(() => dayKeyAmsterdam(anchor), [anchor]);

  const afblokRange = useMemo(() => {
    const days = view === "maand" ? monthDays : weekDays;
    return {
      van: days[0]?.key || "",
      tot: days[days.length - 1]?.key || "",
    };
  }, [view, weekDays, monthDays]);

  const afblokEffectiveTg =
    afblokPerMonteur && afblokTeamgenoten.length > 0
      ? afblokTgId || null
      : null;

  // Afblokkingen altijd laden (ook buiten afblok-modus), zodat DICHT zichtbaar blijft
  useEffect(() => {
    if (!afblokPartnerId || !afblokRange.van || !afblokRange.tot) {
      setAfblokkingen(new Set());
      return;
    }
    if (afblokPerMonteur && afblokTeamgenoten.length > 0 && !afblokTgId) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const tgQs =
          afblokPerMonteur && afblokTgId
            ? `&teamgenoot_id=${encodeURIComponent(afblokTgId)}`
            : "";
        const url =
          readOnly && portalToken
            ? `/api/installatie/${encodeURIComponent(portalToken)}/afblokkingen?van=${afblokRange.van}&tot=${afblokRange.tot}${tgQs}`
            : `/api/installatie-partners/afblokkingen?partner_id=${encodeURIComponent(afblokPartnerId)}&van=${afblokRange.van}&tot=${afblokRange.tot}${tgQs}`;
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        if (typeof data.per_monteur === "boolean") {
          setAfblokPerMonteur(data.per_monteur);
        }
        const next = new Set<string>();
        const tgKey =
          data.per_monteur === false ? null : afblokEffectiveTg;
        for (const item of data.items || []) {
          next.add(
            partnerAfblokKey(
              item.partner_id || afblokPartnerId,
              item.dag,
              item.venster as PartnerVenster,
              item.teamgenoot_id ?? tgKey
            )
          );
        }
        setAfblokkingen(next);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    afblokPartnerId,
    afblokRange.van,
    afblokRange.tot,
    afblokTgId,
    afblokTeamgenoten.length,
    afblokPerMonteur,
    afblokEffectiveTg,
    readOnly,
    portalToken,
  ]);

  function isVensterBlocked(dayKeyStr: string, venster: PartnerVenster) {
    if (!afblokPartnerId) return false;
    return afblokkingen.has(
      partnerAfblokKey(
        afblokPartnerId,
        dayKeyStr,
        venster,
        afblokEffectiveTg
      )
    );
  }

  async function toggleVensterAfblok(
    dayKeyStr: string,
    venster: PartnerVenster
  ) {
    if (!afblokPartnerId || blockBusy) return;
    if (
      afblokPerMonteur &&
      afblokTeamgenoten.length > 0 &&
      !afblokTgId
    ) {
      setOkMsg(null);
      return;
    }
    const key = partnerAfblokKey(
      afblokPartnerId,
      dayKeyStr,
      venster,
      afblokEffectiveTg
    );
    const currently = afblokkingen.has(key);
    const nextBlocked = !currently;
    setBlockBusy(true);
    setAfblokkingen((prev) => {
      const copy = new Set(prev);
      if (nextBlocked) copy.add(key);
      else copy.delete(key);
      return copy;
    });
    try {
      const url =
        readOnly && portalToken
          ? `/api/installatie/${encodeURIComponent(portalToken)}/afblokkingen`
          : "/api/installatie-partners/afblokkingen";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          readOnly
            ? {
                dag: dayKeyStr,
                venster,
                geblokkeerd: nextBlocked,
                teamgenoot_id: afblokEffectiveTg,
              }
            : {
                partner_id: afblokPartnerId,
                dag: dayKeyStr,
                venster,
                geblokkeerd: nextBlocked,
                teamgenoot_id: afblokEffectiveTg,
              }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Afblokken mislukt");
      if (typeof data.per_monteur === "boolean") {
        setAfblokPerMonteur(data.per_monteur);
      }
      setOkMsg(
        nextBlocked
          ? `${venster === "ochtend" ? "Ochtend" : "Middag"} ${dayKeyStr.slice(8)} dicht`
          : `${venster === "ochtend" ? "Ochtend" : "Middag"} ${dayKeyStr.slice(8)} weer open`
      );
    } catch (e) {
      setAfblokkingen((prev) => {
        const copy = new Set(prev);
        if (currently) copy.add(key);
        else copy.delete(key);
        return copy;
      });
      setOkMsg(e instanceof Error ? e.message : "Afblokken mislukt");
    } finally {
      setBlockBusy(false);
    }
  }

  const headingLabel = useMemo(() => {
    if (view === "dag") {
      return formatInTimeZone(anchor, AMSTERDAM_TZ, "EEEE d MMMM yyyy", {
        locale: nl,
      });
    }
    if (view === "maand" || view === "lijst") {
      return formatInTimeZone(anchor, AMSTERDAM_TZ, "MMMM yyyy", {
        locale: nl,
      });
    }
    return `${formatInTimeZone(anchor, AMSTERDAM_TZ, "MMMM yyyy", {
      locale: nl,
    })} · week ${weekInfo.week}`;
  }, [anchor, view, weekInfo.week]);

  const planProjects = useMemo(() => {
    let list = localProjects.filter(isActiefOpPlanbord);
    if (filterPartnerId) {
      list = list.filter(
        (p) =>
          p.installatie_partner_id === filterPartnerId ||
          partnerOf(p)?.id === filterPartnerId
      );
    }
    return list;
  }, [localProjects, filterPartnerId]);

  const setAgendaPersonFilter = useCallback((id: string) => {
    setAgendaTeamFilter({ kind: "person", id });
    setAfblokTgId(id);
  }, []);

  const setAgendaKoppelFilter = useCallback(
    (id: string) => {
      const koppel = agendaKoppels.find((k) => k.id === id);
      const first = koppel?.monteur_1_id || koppel?.monteur_2_id || "";
      if (first) setAfblokTgId(first);
      setAgendaTeamFilter({ kind: "koppel", id });
    },
    [agendaKoppels]
  );

  const installatieVanaf = readOnly ? PORTAL_INSTALLATIES_VANAF : null;

  const installatieOfferteIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const p of planProjects) {
      if (p.installatie_at && p.offerte_id) ids.add(p.offerte_id);
    }
    return [...ids].sort().join(",");
  }, [planProjects]);

  useEffect(() => {
    if (readOnly || !installatieOfferteIdsKey) {
      if (!installatieOfferteIdsKey) setBatterijLabels({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/planbord/offerte-regels?ids=${encodeURIComponent(installatieOfferteIdsKey)}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        const regels = (data.regels || []) as (OfferteRegelKort & {
          offerte_id: string;
        })[];
        const byOfferte = new Map<string, OfferteRegelKort[]>();
        for (const r of regels) {
          const list = byOfferte.get(r.offerte_id) || [];
          list.push(r);
          byOfferte.set(r.offerte_id, list);
        }
        const nextLabels: Record<string, string> = {};
        const nextRegels: Record<string, OfferteRegelKort[]> = {};
        for (const [id, list] of byOfferte) {
          nextRegels[id] = list;
          const label = installatieBatterijKortLabel(list);
          if (label) nextLabels[id] = label;
        }
        if (!cancelled) {
          setOfferteRegelsById(nextRegels);
          setBatterijLabels(nextLabels);
        }
      } catch {
        /* nested regels op het project blijven fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [installatieOfferteIdsKey, readOnly]);

  useEffect(() => {
    setSelectedBar((prev) => {
      if (!prev || prev.kind !== "installatie") return prev;
      const next = batterijKortVoorProject(prev.project, batterijLabels);
      if (next === prev.batterijKort) return prev;
      return { ...prev, batterijKort: next };
    });
  }, [batterijLabels]);

  const weekBars = useMemo(() => {
    const bars = barsForWeek(planProjects, weekDays, { installatieVanaf });
    return stampBatterijOpBars(
      bars.filter((b) =>
        barMatchesAgendaFilter(b, agendaTeamFilter, agendaKoppels)
      ),
      batterijLabels
    );
  }, [
    planProjects,
    weekDays,
    installatieVanaf,
    agendaTeamFilter,
    agendaKoppels,
    batterijLabels,
  ]);

  const monthBars = useMemo(() => {
    const bars = barsForWeek(planProjects, monthDays, { installatieVanaf });
    return stampBatterijOpBars(
      bars.filter((b) =>
        barMatchesAgendaFilter(b, agendaTeamFilter, agendaKoppels)
      ),
      batterijLabels
    );
  }, [
    planProjects,
    monthDays,
    installatieVanaf,
    agendaTeamFilter,
    agendaKoppels,
    batterijLabels,
  ]);

  const timedAll = useMemo(() => {
    const bars = allTimedBars(planProjects, { installatieVanaf });
    return stampBatterijOpBars(
      bars.filter((b) =>
        barMatchesAgendaFilter(b, agendaTeamFilter, agendaKoppels)
      ),
      batterijLabels
    );
  }, [
    planProjects,
    installatieVanaf,
    agendaTeamFilter,
    agendaKoppels,
    batterijLabels,
  ]);

  const reistijdPairs = useMemo(() => {
    const byDay = new Map<string, PlanbordBar[]>();
    for (const b of timedAll) {
      const k = b.dayKeys[0];
      if (!k) continue;
      const list = byDay.get(k) || [];
      list.push(b);
      byDay.set(k, list);
    }
    const pairs: { key: string; from: string; to: string }[] = [];
    for (const [day, list] of byDay) {
      const pair = installPairForDay(list);
      if (!pair) continue;
      const from = projectAdres(pair.a.project);
      const to = projectAdres(pair.b.project);
      if (!from || !to || from === to) continue;
      pairs.push({ key: day, from, to });
    }
    return pairs;
  }, [timedAll]);

  const reistijdPairsKey = reistijdPairs
    .map((p) => `${p.key}|${p.from}|${p.to}`)
    .join(";;");

  useEffect(() => {
    if (reistijdPairs.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const pair of reistijdPairs) {
        try {
          const res = await fetch(
            `/api/travel-time?from=${encodeURIComponent(pair.from)}&to=${encodeURIComponent(pair.to)}`
          );
          const data = await res.json().catch(() => ({}));
          if (cancelled) return;
          const label =
            typeof data.durationText === "string" && data.available !== false
              ? data.durationText
              : null;
          if (label) {
            setReistijden((prev) =>
              prev[pair.key] === label ? prev : { ...prev, [pair.key]: label }
            );
          }
        } catch {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reistijdPairsKey, reistijdPairs]);

  const activeBarsRaw = view === "maand" ? monthBars : weekBars;
  const activeBars = useMemo(() => {
    if (!filterSoort) return activeBarsRaw;
    return activeBarsRaw.filter((b) => {
      if (filterSoort === "schouw") {
        return b.kind === "schouw" || b.kind === "schouwweek";
      }
      return b.kind === filterSoort;
    });
  }, [activeBarsRaw, filterSoort]);

  const planbordFotoIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const bar of [...weekBars, ...monthBars]) {
      if (
        bar.kind === "schouw" ||
        bar.kind === "schouwweek" ||
        bar.kind === "installatie"
      ) {
        ids.add(bar.project.id);
      }
    }
    return [...ids].sort().join(",");
  }, [weekBars, monthBars]);

  useEffect(() => {
    const ids = planbordFotoIdsKey
      ? planbordFotoIdsKey.split(",").filter(Boolean)
      : [];
    if (ids.length === 0) {
      setSchouwDocs({});
      setOpleveringDocs({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = portalToken
          ? null
          : `/api/planbord/fotos?ids=${encodeURIComponent(ids.join(","))}`;
        let fotos: (PlanbordFotoRij & { project_id?: string })[] = [];
        if (url) {
          const res = await fetch(url);
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error("fotos");
          fotos = (data.fotos || []) as (PlanbordFotoRij & {
            project_id?: string;
          })[];
        } else {
          const batches = await Promise.all(
            ids.map(async (id) => {
              try {
                const res = await fetch(
                  portalFotosUrl(id) || `/api/projecten/${id}/fotos`
                );
                const data = await res.json().catch(() => ({}));
                if (!res.ok) return [];
                return ((data.fotos || []) as PlanbordFotoRij[]).map((f) => ({
                  ...f,
                  project_id: id,
                }));
              } catch {
                return [];
              }
            })
          );
          fotos = batches.flat();
        }
        if (cancelled) return;
        const byProject = new Map<string, PlanbordFotoRij[]>();
        for (const id of ids) byProject.set(id, []);
        for (const f of fotos) {
          const pid = (f as { project_id?: string }).project_id;
          if (!pid) continue;
          const list = byProject.get(pid) || [];
          list.push(f);
          byProject.set(pid, list);
        }
        const nextSchouw: Record<string, SchouwDocInfo | null> = {};
        const nextOplever: Record<string, SchouwDocInfo | null> = {};
        for (const [id, list] of byProject) {
          nextSchouw[id] = pickLatestPlanbordDoc(list, (f) =>
            isSchouwFormulierBewijs(
              f.omschrijving,
              f.bestandsnaam,
              f.storage_path
            )
          );
          nextOplever[id] = pickLatestPlanbordDoc(list, (f) =>
            isOpleveringsrapportBewijs(
              f.omschrijving,
              f.bestandsnaam,
              f.storage_path
            )
          );
        }
        setSchouwDocs(nextSchouw);
        setOpleveringDocs(nextOplever);
      } catch {
        if (!cancelled) {
          setSchouwDocs({});
          setOpleveringDocs({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planbordFotoIdsKey, portalToken]);

  const barsByDay = useMemo(() => {
    const map = new Map<string, PlanbordBar[]>();
    for (const bar of activeBars) {
      if (bar.kind === "schouwweek") continue;
      for (const key of bar.dayKeys) {
        const list = map.get(key) || [];
        list.push(bar);
        map.set(key, list);
      }
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
    }
    return map;
  }, [activeBars]);

  const dayBars = useMemo(() => {
    if (view !== "dag") return [];
    return (barsByDay.get(dayKey) || []).filter((b) => b.at);
  }, [barsByDay, dayKey, view]);

  /** Voor dag-view: bars uit alle timed (niet alleen week) zodat maandnavigatie werkt. */
  const dayBarsResolved = useMemo(() => {
    if (view !== "dag") return [];
    return timedAll.filter((b) => {
      if (b.dayKeys[0] !== dayKey) return false;
      if (!filterSoort) return true;
      if (filterSoort === "schouw") {
        return b.kind === "schouw" || b.kind === "schouwweek";
      }
      return b.kind === filterSoort;
    });
  }, [timedAll, dayKey, view, filterSoort]);

  const monthPrefix = useMemo(
    () => formatInTimeZone(anchor, AMSTERDAM_TZ, "yyyy-MM"),
    [anchor]
  );

  const monthStats = useMemo(() => {
    let schouw = 0;
    let installatie = 0;
    let service = 0;
    let levering = 0;
    for (const bar of timedAll) {
      const key = bar.dayKeys[0];
      if (!key?.startsWith(monthPrefix)) continue;
      if (bar.kind === "schouw" || bar.kind === "schouwweek") schouw += 1;
      else if (bar.kind === "installatie") installatie += 1;
      else if (bar.kind === "service") service += 1;
      else if (bar.kind === "levering") levering += 1;
    }
    return {
      schouw,
      installatie,
      service,
      levering,
      total: schouw + installatie + service + levering,
    };
  }, [timedAll, monthPrefix]);

  const listGroups = useMemo(() => {
    const groups: { dayKey: string; label: string; bars: PlanbordBar[] }[] = [];
    let current: (typeof groups)[number] | null = null;
    for (const bar of timedAll) {
      const key = bar.dayKeys[0];
      if (!key || !bar.at || !key.startsWith(monthPrefix)) continue;
      if (!current || current.dayKey !== key) {
        current = {
          dayKey: key,
          label: formatInTimeZone(new Date(bar.at), AMSTERDAM_TZ, "EEEE d MMMM yyyy", {
            locale: nl,
          }),
          bars: [],
        };
        groups.push(current);
      }
      current.bars.push(bar);
    }
    return groups;
  }, [timedAll, monthPrefix]);

  const openPlan = useCallback(
    (
      key: string,
      partnerId?: string | null,
      opts?: { soort?: PlanSoort; venster?: PartnerVenster }
    ) => {
      if (readOnly) return;
      setPlanDayKey(key);
      setPlanPartnerId(partnerId || filterPartnerId || null);
      setPlanSoort(opts?.soort || null);
      setPlanVenster(opts?.venster || null);
      setPlanOpen(true);
      setOkMsg(null);
    },
    [readOnly, filterPartnerId]
  );

  const openBar = useCallback((bar: PlanbordBar) => {
    setSelectedBar(bar);
  }, []);

  const goDay = useCallback(
    (key: string) => {
      // Anker op Amsterdam-middag van die dag — voorkomt TZ-shift bij maand→dag.
      const noonUtc = fromZonedTime(`${key}T12:00:00`, AMSTERDAM_TZ);
      setAnchor(noonUtc);
      changeView("dag");
    },
    [changeView]
  );

  function handleSaved(updated: Project) {
    setLocalProjects((prev) => {
      const idx = prev.findIndex((p) => p.id === updated.id);
      if (idx < 0) return [updated, ...prev];
      const next = [...prev];
      next[idx] = { ...next[idx], ...updated };
      return next;
    });
    onProjectUpdated?.(updated);
    setOkMsg("Project ingepland");
  }

  function navigate(delta: number) {
    if (view === "dag") {
      setAnchor((d) => addDays(d, delta));
    } else if (view === "maand" || view === "lijst") {
      // Altijd via midden van de maand → geen 31-okt → 1-dec shift
      setAnchor((d) => {
        const local = toZonedTime(d, AMSTERDAM_TZ);
        const mid = addMonths(
          new Date(local.getFullYear(), local.getMonth(), 15, 12, 0, 0),
          delta
        );
        return fromZonedTime(mid, AMSTERDAM_TZ);
      });
    } else {
      setAnchor((d) => addWeeks(d, delta));
    }
  }

  const displayDayBars = useMemo(
    () => (dayBarsResolved.length ? dayBarsResolved : dayBars),
    [dayBarsResolved, dayBars]
  );

  const horizonKeys = useMemo(() => {
    const keys: string[] = [];
    for (let i = 0; i < 14; i++) {
      keys.push(dayKeyAmsterdam(addDays(new Date(), i)));
    }
    return keys;
  }, []);

  const partnerBezetting = useMemo(() => {
    const active = partners.filter((p) => p.actief !== false);
    const timed = allTimedBars(localProjects);
    const horizonSet = new Set(horizonKeys);
    return active.map((p) => {
      const start =
        (p.start_adres || "").trim() || "Cabrondom 43 Utrecht";
      const todayBars = timed.filter(
        (b) => b.partnerId === p.id && b.dayKeys.includes(todayKey)
      );
      const weekBarsP = timed.filter(
        (b) =>
          b.partnerId === p.id &&
          b.dayKeys.some((k) => horizonSet.has(k))
      );
      const schouwToday = todayBars.filter(
        (b) => b.kind === "schouw" || b.kind === "schouwweek"
      ).length;
      const installatieToday = todayBars.filter(
        (b) => b.kind === "installatie"
      ).length;
      const freeVenstersToday = Math.max(
        0,
        MAX_INSTALLATIES_PER_DAG - installatieToday
      );
      const schouw2w = weekBarsP.filter(
        (b) => b.kind === "schouw" || b.kind === "schouwweek"
      ).length;
      const installatie2w = weekBarsP.filter(
        (b) => b.kind === "installatie"
      ).length;
      // Ruwe vrije installatiedagen komende 14d (excl. zondag ≈ 12 werkdagen)
      const workDaysApprox = 12;
      const freeVensters2w = Math.max(
        0,
        workDaysApprox * MAX_INSTALLATIES_PER_DAG - installatie2w
      );
      return {
        id: p.id,
        naam: p.naam,
        start,
        schouwToday,
        installatieToday,
        freeVenstersToday,
        schouw2w,
        installatie2w,
        freeVensters2w,
      };
    });
  }, [partners, localProjects, todayKey, horizonKeys]);

  return (
    <div className="flex flex-col gap-3">
      {!readOnly && partnerBezetting.length > 0 ? (
        <div className="border border-line bg-white px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Montagepartners · wie waar · capaciteit vandaag &amp; 2 weken
            </p>
            <div className="flex flex-wrap gap-1.5">
              <select
                value={filterPartnerId}
                onChange={(e) => setFilterPartnerId(e.target.value)}
                className="border border-line bg-white px-2 py-1 text-[11px] font-medium text-ink outline-none focus:border-green"
              >
                <option value="">Alle partners</option>
                {partners
                  .filter((p) => p.actief !== false)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.naam}
                    </option>
                  ))}
              </select>
              <select
                value={filterSoort}
                onChange={(e) =>
                  setFilterSoort(
                    e.target.value as "" | "schouw" | "installatie" | "service"
                  )
                }
                className="border border-line bg-white px-2 py-1 text-[11px] font-medium text-ink outline-none focus:border-green"
              >
                <option value="">Alles</option>
                <option value="schouw">Alleen schouw</option>
                <option value="installatie">Alleen installatie</option>
                <option value="service">Alleen service</option>
              </select>
              {filterPartnerId || filterSoort ? (
                <button
                  type="button"
                  onClick={() => {
                    setFilterPartnerId("");
                    setFilterSoort("");
                  }}
                  className="text-[11px] font-semibold text-green-dark hover:underline"
                >
                  Reset
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {partnerBezetting.map((p) => {
              const selected = filterPartnerId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setFilterPartnerId((cur) => (cur === p.id ? "" : p.id));
                  }}
                  onDoubleClick={() => openPlan(todayKey, p.id)}
                  title="Klik = filter · dubbelklik = inplannen vandaag"
                  className={[
                    "min-w-[12.5rem] shrink-0 border px-3 py-2.5 text-left transition",
                    selected
                      ? "border-green bg-green-soft"
                      : "border-line bg-wash hover:border-green",
                  ].join(" ")}
                >
                  <span className="block truncate text-sm font-semibold text-ink">
                    {p.naam}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted">
                    {p.start}
                  </span>
                  <span className="mt-1.5 block text-[11px] font-medium text-ink">
                    Vandaag: {p.freeVenstersToday}/{MAX_INSTALLATIES_PER_DAG}{" "}
                    vrij
                    {p.schouwToday > 0
                      ? ` · ${p.schouwToday} schouw`
                      : ""}
                    {p.installatieToday > 0
                      ? ` · ${p.installatieToday} inst.`
                      : ""}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted">
                    2 wkn: ~{p.freeVensters2w} installatiedagen vrij ·{" "}
                    {p.schouw2w} schouw · {p.installatie2w} inst.
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">
            {title || (readOnly ? "Agenda" : "Planbord")}
          </h2>
          <p className="mt-1 text-base capitalize text-muted">{headingLabel}</p>
          {view === "maand" && monthStats.total > 0 ? (
            <p className="mt-1 text-xs font-medium text-muted">
              {monthStats.total} gepland
              {monthStats.schouw ? ` · ${monthStats.schouw} schouw` : ""}
              {monthStats.installatie
                ? ` · ${monthStats.installatie} installatie`
                : ""}
              {monthStats.service ? ` · ${monthStats.service} service` : ""}
              {monthStats.levering ? ` · ${monthStats.levering} levering` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Tabs
            value={view}
            onValueChange={(v) => {
              if (
                v === "week" ||
                v === "dag" ||
                v === "maand" ||
                v === "lijst"
              ) {
                changeView(v);
              }
            }}
          >
            <TabsList variant="default" className="h-9">
              {VIEW_OPTIONS.map((opt) => (
                <TabsTrigger
                  key={opt.id}
                  value={opt.id}
                  className="px-3 text-xs font-semibold"
                >
                  {opt.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex h-9 w-9 items-center justify-center border border-line hover:bg-wash"
              aria-label="Vorige"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setAnchor(now);
              }}
              className="border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
            >
              Vandaag
            </button>
            <button
              type="button"
              onClick={() => navigate(1)}
              className="flex h-9 w-9 items-center justify-center border border-line hover:bg-wash"
              aria-label="Volgende"
            >
              ›
            </button>
          </div>
          {view === "week" ? (
            <select
              value={schouwWeekValue(weekInfo.jaar, weekInfo.week)}
              onChange={(e) => {
                const p = parseSchouwWeekValue(e.target.value);
                if (!p) return;
                setAnchor(new Date(schouwWeekToMondayIso(p.jaar, p.week)));
              }}
              className="min-h-9 border border-line bg-white px-2 text-xs font-semibold"
            >
              {weekJumpOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  W{o.week} · {o.jaar}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            disabled={blockBusy}
            onClick={() => {
              setAfblokMode((v) => {
                const next = !v;
                setOkMsg(
                  next
                    ? "Afblok-modus: klik ochtend (08–12) of middag (13–17) om dicht/open te zetten"
                    : null
                );
                return next;
              });
            }}
            className={[
              "shrink-0 border px-3 py-1.5 text-xs font-semibold disabled:opacity-60",
              afblokMode
                ? "border-[#B91C1C] bg-[#FEF2F2] text-[#B91C1C]"
                : "border-line bg-white text-ink hover:bg-wash",
            ].join(" ")}
          >
            {afblokMode ? "Klaar met afblokken" : "Afblokken"}
          </button>
          {!readOnly ? (
            <button
              type="button"
              onClick={() => openPlan(dayKey || todayKey)}
              className="shrink-0 bg-[#0D9488] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#0F766E]"
            >
              + Inplannen
            </button>
          ) : null}
        </div>
      </div>

      {showTeamAgendaFilters &&
      (afblokTeamgenoten.length > 0 || agendaKoppels.length > 0) ? (
        <div className="flex flex-col gap-3 bg-white px-1 py-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
              Agenda van
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold text-ink">
              {agendaTeamFilter.kind === "all"
                ? "Heel team"
                : agendaTeamFilter.kind === "person"
                  ? afblokTeamgenoten.find(
                      (t) => t.id === agendaTeamFilter.id
                    )?.naam || "Monteur"
                  : (() => {
                      const k = agendaKoppels.find(
                        (x) => x.id === agendaTeamFilter.id
                      );
                      if (!k) return "Koppel";
                      const m1 =
                        k.monteur_1?.naam ||
                        afblokTeamgenoten.find((t) => t.id === k.monteur_1_id)
                          ?.naam;
                      const m2 =
                        k.monteur_2?.naam ||
                        afblokTeamgenoten.find((t) => t.id === k.monteur_2_id)
                          ?.naam;
                      const duo = [m1, m2].filter(Boolean).join(" + ");
                      return duo ? `${k.naam} · ${duo}` : k.naam;
                    })()}
            </p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Tabs
              value={
                agendaTeamFilter.kind === "all"
                  ? "all"
                  : agendaTeamFilter.kind === "person"
                    ? "person"
                    : "koppel"
              }
              onValueChange={(v) => {
                if (v === "all") {
                  setAgendaTeamFilter({ kind: "all" });
                  return;
                }
                if (v === "person") {
                  const id =
                    (agendaTeamFilter.kind === "person"
                      ? agendaTeamFilter.id
                      : null) ||
                    afblokTgId ||
                    afblokTeamgenoten[0]?.id ||
                    "";
                  if (id) setAgendaPersonFilter(id);
                  return;
                }
                if (v === "koppel") {
                  const id =
                    (agendaTeamFilter.kind === "koppel"
                      ? agendaTeamFilter.id
                      : null) ||
                    agendaKoppels[0]?.id ||
                    "";
                  if (id) setAgendaKoppelFilter(id);
                }
              }}
            >
              <TabsList variant="default" className="h-9">
                <TabsTrigger
                  value="all"
                  className="gap-1.5 px-3 text-xs font-semibold"
                >
                  <Users className="size-3.5 opacity-70" aria-hidden />
                  Team
                </TabsTrigger>
                {afblokTeamgenoten.length > 0 ? (
                  <TabsTrigger
                    value="person"
                    className="gap-1.5 px-3 text-xs font-semibold"
                  >
                    <UserRound className="size-3.5 opacity-70" aria-hidden />
                    Monteur
                  </TabsTrigger>
                ) : null}
                {agendaKoppels.length > 0 ? (
                  <TabsTrigger
                    value="koppel"
                    className="gap-1.5 px-3 text-xs font-semibold"
                  >
                    <Users className="size-3.5 opacity-70" aria-hidden />
                    Koppel
                  </TabsTrigger>
                ) : null}
              </TabsList>
            </Tabs>

            {agendaTeamFilter.kind === "person" ? (
              <NativeSelect
                size="default"
                aria-label="Monteur kiezen"
                className="min-w-[12rem] flex-1 sm:flex-none"
                value={agendaTeamFilter.id}
                onChange={(e) => setAgendaPersonFilter(e.target.value)}
              >
                {afblokTeamgenoten.map((t) => (
                  <NativeSelectOption key={t.id} value={t.id}>
                    {t.naam}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}

            {agendaTeamFilter.kind === "koppel" ? (
              <NativeSelect
                size="default"
                aria-label="Koppel kiezen"
                className="min-w-[14rem] flex-1 sm:flex-none"
                value={agendaTeamFilter.id}
                onChange={(e) => setAgendaKoppelFilter(e.target.value)}
              >
                {agendaKoppels.map((k) => {
                  const m1 =
                    k.monteur_1?.naam ||
                    afblokTeamgenoten.find((t) => t.id === k.monteur_1_id)
                      ?.naam;
                  const m2 =
                    k.monteur_2?.naam ||
                    afblokTeamgenoten.find((t) => t.id === k.monteur_2_id)
                      ?.naam;
                  const duo = [m1, m2].filter(Boolean).join(" + ");
                  return (
                    <NativeSelectOption key={k.id} value={k.id}>
                      {duo ? `${k.naam} — ${duo}` : k.naam}
                    </NativeSelectOption>
                  );
                })}
              </NativeSelect>
            ) : null}
          </div>
        </div>
      ) : null}

      {afblokMode ? (
        <div className="space-y-2 border border-[#B91C1C]/25 bg-[#FEF2F2] px-4 py-3">
          <p className="text-xs font-medium text-[#B91C1C]">
            Afblok-modus — per dag 2 blokken (ochtend 08–12 / middag 13–17).
            Klik om dicht ↔ open. Max. 1 installatie per dag (ochtend of
            middag).
            {!afblokPerMonteur
              ? " Let op: geldt nu voor heel het team (migratie per monteur nog open)."
              : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {!readOnly && !afblokPartnerIdProp ? (
              <select
                value={afblokPartnerId}
                onChange={(e) => setAfblokPartnerId(e.target.value)}
                className="border border-[#FECACA] bg-white px-2 py-1.5 text-xs font-semibold outline-none"
                aria-label="Partner afblokken"
              >
                <option value="">Partner…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.naam}
                  </option>
                ))}
              </select>
            ) : null}
            {afblokTeamgenoten.length > 0
              ? afblokTeamgenoten.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAfblokTgId(t.id)}
                    className={[
                      "border px-2.5 py-1.5 text-xs font-semibold",
                      afblokTgId === t.id
                        ? "border-[#B91C1C] bg-[#B91C1C] text-white"
                        : "border-[#FECACA] bg-white text-[#B91C1C] hover:bg-[#FFF1F2]",
                    ].join(" ")}
                  >
                    {t.naam}
                  </button>
                ))
              : null}
          </div>
        </div>
      ) : null}

      {okMsg ? (
        <p
          className={[
            "border px-3 py-2 text-xs",
            okMsg.toLowerCase().includes("mislukt") ||
            okMsg.toLowerCase().includes("fout")
              ? "border-[#C45A12]/30 bg-[#FFF0E6] text-[#C45A12]"
              : "border-green/30 bg-green-soft text-green-dark",
          ].join(" ")}
        >
          {okMsg}
        </p>
      ) : null}

      {view === "dag" ? (
        <div className="overflow-hidden border border-line bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                Dagoverzicht
              </p>
              <p className="mt-1 font-display text-xl font-semibold capitalize text-ink">
                {formatInTimeZone(anchor, AMSTERDAM_TZ, "EEEE d MMMM", {
                  locale: nl,
                })}
              </p>
              {feestdagOp(dayKey) ? (
                <p className="mt-1 text-xs font-semibold text-[#B91C1C]">
                  {feestdagOp(dayKey)!.naam} — geen schouw of installatie
                </p>
              ) : null}
            </div>
            <p className="text-sm font-medium text-muted">
              {displayDayBars.length === 0
                ? "Geen afspraken"
                : `${displayDayBars.length} afspraak${displayDayBars.length === 1 ? "" : "en"}`}
              {!readOnly && filterPartnerId
                ? (() => {
                    const inst = displayDayBars.filter(
                      (b) => b.kind === "installatie"
                    ).length;
                    const over = Math.max(
                      0,
                      MAX_INSTALLATIES_PER_DAG - inst
                    );
                    return over > 0
                      ? ` · nog ${over} installatie mogelijk`
                      : " · vol";
                  })()
                : null}
            </p>
          </div>
          {afblokPartnerId &&
          (afblokMode ||
            isVensterBlocked(dayKey, "ochtend") ||
            isVensterBlocked(dayKey, "middag")) ? (
            <div
              className={[
                "flex flex-wrap gap-2 border-b border-line px-4 py-2",
                afblokMode ? "bg-[#FFF7F7]" : "bg-[#FEE2E2]/60",
              ].join(" ")}
            >
              {PARTNER_VENSTERS.map((venster) => (
                <div key={venster} className="min-w-[9rem] flex-1">
                  <AfblokVensterChip
                    venster={venster}
                    blocked={isVensterBlocked(dayKey, venster)}
                    interactive={afblokMode}
                    disabled={blockBusy || !afblokPartnerId}
                    onToggle={() => void toggleVensterAfblok(dayKey, venster)}
                  />
                </div>
              ))}
            </div>
          ) : null}

          <div className="divide-y divide-line">
            {PARTNER_VENSTERS.map((venster) => {
              const items = displayDayBars.filter((b) =>
                barInVenster(b, venster)
              );
              const instDag = displayDayBars.filter(
                (b) => b.kind === "installatie"
              ).length;
              const blocked = Boolean(
                feestdagOp(dayKey) ||
                  (afblokPartnerId && isVensterBlocked(dayKey, venster))
              );
              const vol =
                blocked ||
                (Boolean(filterPartnerId || readOnly) &&
                  instDag >= MAX_INSTALLATIES_PER_DAG);
              const hoursLabel =
                venster === "ochtend" ? "08:00–12:00" : "13:00–17:00";
              return (
                <Fragment key={venster}>
                  {venster === "middag" ? (
                    <div className="border-y border-line bg-[#FAFBFA] px-4 py-2 text-center">
                      <p className="text-xs font-medium text-muted">
                        Pauze 12:00–13:00
                      </p>
                      {reistijden[dayKey] ? (
                        <p className="text-xs font-semibold text-[#0F766E]">
                          Reistijd naar volgende installatie ·{" "}
                          {reistijden[dayKey]}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                <section className="px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-ink">
                        {venster === "ochtend" ? "Ochtend" : "Middag"}{" "}
                        {hoursLabel}
                      </p>
                      <p className="text-xs text-muted">Installatieblok</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={[
                          "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          blocked
                            ? "bg-[#FEE2E2] text-[#991B1B]"
                            : vol
                              ? "bg-[#FFF7ED] text-[#C2410C]"
                              : "bg-[#ECFDF5] text-[#065F46]",
                        ].join(" ")}
                      >
                        {blocked
                          ? feestdagOp(dayKey)
                            ? feestdagOp(dayKey)!.naam
                            : "Dicht"
                          : instDag >= MAX_INSTALLATIES_PER_DAG
                            ? "1/1 bezet"
                            : "vrij"}
                      </span>
                      {!readOnly && !feestdagOp(dayKey) ? (
                        <button
                          type="button"
                          onClick={() =>
                            openPlan(dayKey, null, {
                              soort: "installatie",
                              venster,
                            })
                          }
                          className="border border-line px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                        >
                          Inplannen
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {items.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted">
                      {vol ? "Geen plek" : "Plek vrij"}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {items.map((bar) => (
                        <EventCard
                          key={bar.key}
                          bar={bar}
                          schouwDoc={schouwDocs[bar.project.id]}
                          hidePartner={readOnly}
                          koppels={agendaKoppels}
                          compact
                          selected={selectedBar?.key === bar.key}
                          onSelect={() => openBar(bar)}
                        />
                      ))}
                    </div>
                  )}
                </section>
                </Fragment>
              );
            })}
            {displayDayBars.filter(
              (b) =>
                !barInVenster(b, "ochtend") && !barInVenster(b, "middag")
            ).length > 0 ? (
              <section className="px-4 py-3">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted">
                  Overig
                </p>
                <div className="space-y-1">
                  {displayDayBars
                    .filter(
                      (b) =>
                        !barInVenster(b, "ochtend") &&
                        !barInVenster(b, "middag")
                    )
                    .map((bar) => (
                      <EventCard
                        key={bar.key}
                        bar={bar}
                        schouwDoc={schouwDocs[bar.project.id]}
                        hidePartner={readOnly}
                        koppels={agendaKoppels}
                        compact
                        selected={selectedBar?.key === bar.key}
                        onSelect={() => openBar(bar)}
                      />
                    ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      ) : null}

      {view === "week" ? (
        <WeekKoppelMatrix
          days={weekDays}
          bars={activeBars}
          koppels={
            agendaTeamFilter.kind === "koppel"
              ? agendaKoppels.filter((k) => k.id === agendaTeamFilter.id)
              : agendaTeamFilter.kind === "person"
                ? agendaKoppels.filter((k) =>
                    koppelBevatMonteur(k, agendaTeamFilter.id)
                  )
                : agendaKoppels
          }
          schouwPersonen={schouwPersonenVoorMatrix}
          toonLegeSchouwers={toonLegeSchouwers}
          selectedKey={selectedBar?.key}
          readOnly={readOnly}
          todayKey={todayKey}
          soortFilter={filterSoort}
          showLegeSlots={!readOnly}
          onDayClick={goDay}
          onSelectBar={openBar}
          onPlanInstallatie={
            readOnly
              ? undefined
              : (dayKey, partnerId, venster) =>
                  openPlan(dayKey, partnerId, {
                    soort: "installatie",
                    venster,
                  })
          }
        />
      ) : null}

      {view === "maand" ? (
        <MaandKoppelOverzicht
          monthDays={monthDays}
          bars={activeBars}
          koppels={
            agendaTeamFilter.kind === "koppel"
              ? agendaKoppels.filter((k) => k.id === agendaTeamFilter.id)
              : agendaTeamFilter.kind === "person"
                ? agendaKoppels.filter((k) =>
                    koppelBevatMonteur(k, agendaTeamFilter.id)
                  )
                : agendaKoppels
          }
          schouwPersonen={schouwPersonenVoorMatrix}
          toonLegeSchouwers={toonLegeSchouwers}
          selectedKey={selectedBar?.key}
          readOnly={readOnly}
          todayKey={todayKey}
          soortFilter={filterSoort}
          monthPrefix={formatInTimeZone(anchor, AMSTERDAM_TZ, "yyyy-MM")}
          onDayClick={goDay}
          onSelectBar={openBar}
          onPlanInstallatie={
            readOnly
              ? undefined
              : (dayKey, partnerId, venster) =>
                  openPlan(dayKey, partnerId, {
                    soort: "installatie",
                    venster,
                  })
          }
        />
      ) : null}

      {view === "lijst" ? (
        <div className="overflow-hidden rounded-xl border border-line bg-white shadow-xs">
          {listGroups.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              Geen geplande schouwen of installaties.
            </p>
          ) : (
            <div className="divide-y divide-line">
              {listGroups.map((group) => {
                const groupPast = group.bars.every((b) => isBarPast(b));
                return (
                  <section
                    key={group.dayKey}
                    className={groupPast ? "opacity-70" : ""}
                  >
                    <div className="sticky top-0 z-[1] flex items-center justify-between bg-wash/80 px-4 py-2.5 backdrop-blur-sm">
                      <button
                        type="button"
                        onClick={() => goDay(group.dayKey)}
                        className={[
                          "font-display text-base font-semibold capitalize hover:text-[#0F766E]",
                          groupPast
                            ? "text-muted line-through decoration-1"
                            : "text-ink",
                        ].join(" ")}
                      >
                        {group.label}
                        {groupPast ? (
                          <span className="ml-2 text-xs font-bold no-underline">
                            · geweest
                          </span>
                        ) : null}
                      </button>
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-muted ring-1 ring-line">
                        {group.bars.length}×
                      </span>
                    </div>
                    <div className="space-y-1 p-2.5 sm:p-3">
                      {group.bars.map((bar) => (
                        <EventCard
                          key={bar.key}
                          bar={bar}
                          schouwDoc={schouwDocs[bar.project.id]}
                          hidePartner={readOnly}
                          koppels={agendaKoppels}
                          compact
                          selected={selectedBar?.key === bar.key}
                          onSelect={() => openBar(bar)}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {selectedBar ? (
        <AgendaItemSidebar
          bar={selectedBar}
          schouwDoc={schouwDocs[selectedBar.project.id]}
          opleveringDoc={opleveringDocs[selectedBar.project.id]}
          partners={partners}
          projectHref={resolveProjectHref}
          hidePartner={readOnly}
          portalMode={readOnly}
          allowMedewerkerWijzig={!readOnly || showTeamAgendaFilters}
          koppels={agendaKoppels}
          offerteRegels={
            selectedBar.project.offerte_id
              ? offerteRegelsById[selectedBar.project.offerte_id]
              : undefined
          }
          portalToken={portalToken || null}
          onMedewerkerGewijzigd={(id) => {
            if (id && showTeamAgendaFilters) setAgendaPersonFilter(id);
          }}
          allowSchouwUpload={
            !readOnly ||
            (Boolean(portalToken) &&
              (selectedBar.kind === "schouw" ||
                selectedBar.kind === "schouwweek"))
          }
          allowOpleveringUpload={
            !readOnly ||
            (Boolean(portalToken) && selectedBar.kind === "installatie")
          }
          allowServiceComplete={
            !readOnly && selectedBar.kind === "service"
          }
          fotosUploadUrl={portalFotosUrl(selectedBar.project.id)}
          notesPatchUrl={
            selectedBar.kind === "schouw" ||
            selectedBar.kind === "schouwweek" ||
            selectedBar.kind === "installatie" ||
            selectedBar.kind === "service"
              ? portalNotesUrl(selectedBar.project.id) ||
                (!readOnly
                  ? `/api/projecten/${selectedBar.project.id}`
                  : null)
              : null
          }
          onSchouwDocChange={(projectId, doc) => {
            setSchouwDocs((prev) => ({ ...prev, [projectId]: doc }));
          }}
          onOpleveringDocChange={(projectId, doc) => {
            setOpleveringDocs((prev) => ({ ...prev, [projectId]: doc }));
          }}
          onProjectUpdated={(updated) => {
            setLocalProjects((prev) => {
              const idx = prev.findIndex((p) => p.id === updated.id);
              if (idx < 0) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], ...updated };
              return next;
            });
            setSelectedBar((prev) =>
              prev && prev.project.id === updated.id
                ? { ...prev, project: { ...prev.project, ...updated } }
                : prev
            );
            onProjectUpdated?.(updated);
          }}
          onClose={() => setSelectedBar(null)}
        />
      ) : null}

      {!readOnly ? (
        <PlanInplannenPanel
          open={planOpen}
          dayKey={planDayKey}
          defaultPartnerId={planPartnerId}
          defaultSoort={planSoort}
          defaultVenster={planVenster}
          projects={planProjects}
          partners={partners}
          onClose={() => setPlanOpen(false)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
