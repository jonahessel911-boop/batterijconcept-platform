"use client";

import {
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
  resolveProjectStatusLabel,
} from "@/lib/labels";
import { isOrderVolledigBetaald } from "@/lib/aanbetaling";
import {
  isOpleveringsrapport,
  isSchouwFormulier,
  isServiceFoto,
  OPLEVERINGSRAPPORT_OMSCHRIJVING,
  SERVICE_FOTO_OMSCHRIJVING,
  SCHOUW_FORMULIER_OMSCHRIJVING,
} from "@/lib/project-documenten";
import { toOperationalStatus } from "@/lib/project-status-config";
import {
  duurMinutenVoorKind,
  formatDuurLabel,
} from "@/lib/planning-duur";
import { resolveMateriaalLeverdatum } from "@/lib/materiaal-leverdatum";
import { OpleverFormulierModal } from "@/components/crm/OpleverFormulierModal";
import { PartnerSlotPicker } from "@/components/crm/PartnerSlotPicker";
import { SchouwFormulierModal } from "@/components/crm/SchouwFormulierModal";
import {
  agendaWeekJumpOptions,
  isSchouwdagDefinitief,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import {
  PARTNER_VENSTERS,
  partnerAfblokKey,
  type PartnerVenster,
} from "@/lib/partner-slots";

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

/** Alleen definitieve schouwdagen / installaties — geen schouwweken. */
function barsForWeek(projects: Project[], days: DayCol[]): PlanbordBar[] {
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

    if (p.installatie_at) {
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
          duurMinuten: duurMinutenVoorKind("installatie"),
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
function allTimedBars(projects: Project[]): PlanbordBar[] {
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
    if (p.installatie_at) {
      bars.push({
        key: `${p.id}-installatie`,
        project: p,
        kind: "installatie",
        dayKeys: [dayKeyAmsterdam(p.installatie_at)],
        label: `Installatie · ${formatTimeNl(p.installatie_at)} · ${title}`,
        whenLabel: formatDateTimeNl(p.installatie_at),
        at: p.installatie_at,
        duurMinuten: duurMinutenVoorKind("installatie"),
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
  /** Installatie = donkergroen */
  installatie: {
    bg: "bg-[#047857]",
    text: "text-white",
    border: "border-[#065F46]",
    accent: "bg-[#022C22]",
    muted: "text-white/85",
  },
  /** Service = terracotta */
  service: {
    bg: "bg-[#C45A12]",
    text: "text-white",
    border: "border-[#9A4510]",
    accent: "bg-[#7C3A0D]",
    muted: "text-white/85",
  },
  /** Levering inkoop = oranje */
  levering: {
    bg: "bg-[#EA580C]",
    text: "text-white",
    border: "border-[#C2410C]",
    accent: "bg-[#9A3412]",
    muted: "text-white/85",
  },
};

function planbordKindLabel(
  kind: PlanbordBar["kind"],
  short = false
): string {
  switch (kind) {
    case "installatie":
      return short ? "Inst." : "Installatie";
    case "service":
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

/** Max chips per maand-cel (rest via “+N meer”). */
const MONTH_CHIPS_VISIBLE = 5;

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
    <button
      type="button"
      title={copied ? "Gekopieerd" : `Kopieer ${telefoon}`}
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
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center border border-line bg-white text-ink hover:bg-wash"
      aria-label="Telefoonnummer kopiëren"
    >
      {copied ? (
        <span className="text-xs font-bold text-[#0D9488]">✓</span>
      ) : (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden>
          <path
            d="M8 4h3.5L13 8l-2 1.5a11 11 0 005.5 5.5L18 13l4 1.5V18a2 2 0 01-2 2A16 16 0 016 6a2 2 0 012-2z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
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
  projects,
  partners,
  onClose,
  onSaved,
}: {
  open: boolean;
  dayKey: string | null;
  defaultPartnerId: string | null;
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

  useEffect(() => {
    if (!open || !dayKey) return;
    setQuery("");
    setSelectedId(null);
    setSoort("schouwdag");
    setPartnerId(defaultPartnerId || "");
    setTeamgenootId("");
    setDatetimeLocal(defaultDatetimeForDay(dayKey, 9));
    setSlotIso(null);
    const w = schouwWeekFromDate(dayKey + "T12:00:00");
    setSchouwWeek(schouwWeekValue(w.jaar, w.week));
    setNotities("");
    setError(null);
    setPickerOpen(true);
  }, [open, dayKey, defaultPartnerId]);

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
            throw new Error("Kies een open schouw-slot");
          }
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
        onSaved((data as { project: Project }).project);
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
              ? "Kies een open installatie-slot"
              : "Kies een open schouw-slot"
        );
      }
      if (soort === "service") {
        if (!notities.trim()) {
          throw new Error(
            "Notitie is verplicht bij inplannen van een service-afspraak"
          );
        }
        const res = await fetch(`/api/projecten/${selected.id}/service`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            service_at: parsed.toISOString(),
            installatie_partner_id: partnerId,
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
          installatie_teamgenoot_id: teamgenootId || null,
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
              Project inplannen
            </h2>
            {dayKey ? (
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
                            ? "border-[#065F46] bg-[#047857] text-white"
                            : id === "service"
                              ? "border-[#9A4510] bg-[#C45A12] text-white"
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
                      dayKey ? defaultDatetimeForDay(dayKey, 9) : ""
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

              {partnerId ? (
                <label className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                  Medewerker
                  <select
                    value={teamgenootId}
                    disabled={teamgenotenLoading}
                    onChange={(e) => setTeamgenootId(e.target.value)}
                    className="mt-1.5 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green disabled:opacity-60"
                  >
                    <option value="">
                      {teamgenotenLoading
                        ? "Laden…"
                        : teamgenoten.length === 0
                          ? "Geen medewerkers — partner voegt toe in Team"
                          : "Nog niet gekoppeld…"}
                    </option>
                    {teamgenoten.map((t) => (
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
                      excludeProjectId={selected?.id || null}
                      dayKey={dayKey}
                      value={slotIso}
                      onChange={(iso) => {
                        setSlotIso(iso);
                        if (!iso) {
                          setDatetimeLocal(
                            dayKey ? defaultDatetimeForDay(dayKey, 9) : ""
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
            <button
              type="button"
              onClick={onClose}
              className="border border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-wash"
            >
              Annuleren
            </button>
            <button
              type="submit"
              disabled={
                busy ||
                !selected ||
                (soort === "service" && !notities.trim())
              }
              className="bg-green px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50"
            >
              {busy ? "Bezig…" : "Opslaan"}
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
  onSelect,
}: {
  bar: PlanbordBar;
  schouwDoc?: SchouwDocInfo | null;
  compact?: boolean;
  selected?: boolean;
  hidePartner?: boolean;
  onSelect?: () => void;
}) {
  const style = KIND_STYLE[bar.kind];
  const lead = leadOf(bar.project);
  const partner = hidePartner ? null : partnerOf(bar.project);
  const isSchouwBar = bar.kind === "schouw" || bar.kind === "schouwweek";
  const past = isBarPast(bar);
  const kindLabel = planbordKindLabel(bar.kind);
  const timeRange = formatTimeRangeNl(bar.at, bar.duurMinuten);
  const naam = klantNaam(bar.project);
  const plaats = klantPlaats(bar.project);
  const adresLines = leadAdresLines(lead);
  const tel = lead?.telefoon?.trim() || null;
  const duurLabel =
    bar.duurMinuten > 0 ? formatDuurLabel(bar.duurMinuten) : null;
  const isSolid =
    bar.kind === "installatie" ||
    bar.kind === "service" ||
    bar.kind === "levering";
  const titleCls = isSolid ? "text-white" : "text-ink";
  const mutedCls = isSolid ? "text-white/85" : "text-muted";

  const hasIcons =
    Boolean(tel) ||
    (isSchouwBar && schouwDoc !== undefined && !schouwDoc?.url);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={[
        "group relative w-full overflow-hidden border text-left transition-shadow",
        style.bg,
        style.border,
        compact ? "px-2 py-1.5 pr-9" : "px-3 py-2.5",
        past ? "opacity-45 grayscale-[0.35]" : "",
        selected ? "ring-2 ring-[#0D9488]/40" : "hover:shadow-sm",
      ].join(" ")}
    >
      <span
        className={`absolute inset-y-0 left-0 w-1 ${style.accent}`}
        aria-hidden
      />
      <div className={["min-w-0 pl-2", hasIcons && compact ? "pr-0" : ""].join(" ")}>
        <p
          className={[
            "text-[10px] font-bold uppercase tracking-[0.04em]",
            style.text,
          ].join(" ")}
        >
          {kindLabel}
          {timeRange ? (
            <span
              className={[
                "ml-1.5 text-xs font-bold tabular-nums normal-case tracking-normal",
                past ? "line-through decoration-2 opacity-80" : "",
              ].join(" ")}
            >
              {compact && bar.at ? formatTimeNl(bar.at) : timeRange}
              {!compact && duurLabel ? (
                <span className="ml-1.5 font-semibold opacity-80">
                  · {duurLabel}
                </span>
              ) : null}
            </span>
          ) : null}
          {past ? (
            <span
              className={[
                "ml-1.5 rounded-sm px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide normal-case",
                isSolid ? "bg-white/20 text-white/90" : "bg-black/10 text-ink/70",
              ].join(" ")}
            >
              Geweest
            </span>
          ) : null}
        </p>
        <p
          className={[
            "mt-0.5 truncate font-semibold leading-snug",
            titleCls,
            compact ? "text-[13px]" : "text-base",
            past ? "opacity-80" : "",
          ].join(" ")}
          title={naam}
        >
          {naam}
        </p>
        {plaats ? (
          <p
            className={[
              "mt-0.5 truncate font-medium leading-snug",
              mutedCls,
              compact ? "text-[11px]" : "text-sm",
            ].join(" ")}
          >
            {plaats}
          </p>
        ) : null}
        {!compact && adresLines.length > 0 ? (
          <div className="mt-1 space-y-0.5">
            {adresLines
              .filter((line) => !plaats || !line.includes(plaats))
              .map((line) => (
                <p key={line} className={`truncate text-sm ${mutedCls}`}>
                  {line}
                </p>
              ))}
          </div>
        ) : null}
        {!compact && (partner?.naam || project.monteur) ? (
          <p className={`mt-1 truncate text-sm ${mutedCls}`}>
            {partner?.naam &&
            project.monteur &&
            project.monteur !== partner.naam
              ? `${partner.naam} · ${project.monteur}`
              : partner?.naam || project.monteur}
          </p>
        ) : null}
      </div>
      {hasIcons ? (
        <div className="absolute right-1 top-1 flex flex-col items-end gap-0.5">
          {tel ? <PhoneCopyIcon telefoon={tel} /> : null}
          {isSchouwBar && schouwDoc !== undefined && !schouwDoc?.url ? (
            <span
              className="inline-flex h-6 w-6 items-center justify-center border border-[#FDBA74] bg-[#FFF7ED] text-[10px] font-bold text-[#C45A12]"
              title="Schouwformulier ontbreekt"
            >
              !
            </span>
          ) : null}
        </div>
      ) : null}
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
    <div className="border-b border-line/70 py-3 last:border-b-0">
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 text-base text-ink">{children}</dd>
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
    <div className="flex items-center gap-2 text-sm">
      {loading ? (
        <span
          className="inline-flex h-5 w-5 items-center justify-center text-xs text-muted"
          aria-hidden
        >
          …
        </span>
      ) : ok ? (
        <span
          className="inline-flex h-5 w-5 items-center justify-center bg-[#0D9488] text-xs font-bold text-white"
          title="Ja"
          aria-label="Ja"
        >
          ✓
        </span>
      ) : (
        <span className="text-[15px] leading-none" title="Nee" aria-label="Nee">
          ❌
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
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* ignore */
        }
      }}
      className="shrink-0 border border-line px-2 py-0.5 text-xs font-semibold text-muted hover:bg-wash hover:text-ink"
    >
      {copied ? "Gekopieerd" : "Kopieer"}
    </button>
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
  noteDraft,
  onNoteChange,
  noteBusy,
  noteMsg,
  onSaveNote,
  notePlaceholder,
  noteTitle,
  fallbackNotities,
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
  noteDraft: string;
  onNoteChange: (v: string) => void;
  noteBusy: boolean;
  noteMsg: string | null;
  onSaveNote: (() => void) | null;
  notePlaceholder: string;
  noteTitle: string;
  fallbackNotities: string | null;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{label}</p>
      {doc?.url ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={doc.url}
            target="_blank"
            rel="noreferrer"
            download={doc.bestandsnaam || defaultFilename}
            className="inline-flex border border-line bg-wash px-3 py-1.5 text-sm font-semibold text-ink hover:bg-white"
          >
            {doc.bestandsnaam || "Openen / downloaden"}
          </a>
          {allowUpload ? (
            <label className="cursor-pointer border border-line px-3 py-1.5 text-sm font-semibold text-[#0F766E] hover:bg-wash">
              {uploading ? "Uploaden…" : "Vervangen"}
              <input
                type="file"
                accept="image/*,application/pdf,.pdf"
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
            <button
              type="button"
              disabled={uploading}
              onClick={onMaakFormulier}
              className="border border-[#0D5C32] px-3 py-1.5 text-sm font-semibold text-[#0D5C32] hover:bg-wash disabled:opacity-50"
            >
              Nieuw formulier
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="font-medium text-[#C45A12]">{missingLabel}</p>
          {allowUpload ? (
            <div className="flex flex-col gap-2">
              {onMaakFormulier ? (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={onMaakFormulier}
                  className="w-full bg-[#0D5C32] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#0A4A28] disabled:opacity-50"
                >
                  Maak formulier
                </button>
              ) : null}
              <label className="inline-flex w-full cursor-pointer justify-center border border-line bg-white px-3 py-2.5 text-sm font-semibold text-ink hover:bg-wash">
                {uploading ? "Uploaden…" : uploadLabel}
                <input
                  type="file"
                  accept="image/*,application/pdf,.pdf"
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
        <p className="text-sm text-green-dark">{uploadOk}</p>
      ) : null}
      {uploadError ? (
        <p className="text-sm text-[#C45A12]">{uploadError}</p>
      ) : null}

      {onSaveNote ? (
        <div className="space-y-2 border-t border-line pt-3">
          <label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
            {noteTitle} *
            <textarea
              value={noteDraft}
              onChange={(e) => onNoteChange(e.target.value)}
              rows={3}
              required
              placeholder={notePlaceholder}
              className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-[#0D9488]"
            />
          </label>
          <p className="text-[11px] text-muted">
            Notitie is verplicht bij afronden.
          </p>
          <button
            type="button"
            disabled={noteBusy || !noteDraft.trim()}
            onClick={onSaveNote}
            className="border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            {noteBusy ? "Opslaan…" : "Notitie opslaan"}
          </button>
          {noteMsg ? (
            <p
              className={[
                "text-sm",
                noteMsg.includes("mislukt") ||
                noteMsg.includes("Fout") ||
                noteMsg.includes("verplicht")
                  ? "text-[#C45A12]"
                  : "text-green-dark",
              ].join(" ")}
            >
              {noteMsg}
            </p>
          ) : null}
        </div>
      ) : fallbackNotities ? (
        <div className="border-t border-line pt-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
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
  allowSchouwUpload = false,
  allowOpleveringUpload = false,
  allowServiceComplete = false,
  fotosUploadUrl,
  notesPatchUrl,
  onSchouwDocChange,
  onOpleveringDocChange,
  onProjectUpdated,
  onClose,
}: {
  bar: PlanbordBar;
  schouwDoc?: SchouwDocInfo | null;
  opleveringDoc?: SchouwDocInfo | null;
  partners: InstallatiePartner[];
  projectHref: (projectId: string) => string;
  hidePartner?: boolean;
  allowSchouwUpload?: boolean;
  allowOpleveringUpload?: boolean;
  /** Service afvinken + optionele foto’s. */
  allowServiceComplete?: boolean;
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
  onClose: () => void;
}) {
  const project = bar.project;
  const lead = leadOf(project);
  const partnerJoined = partnerOf(project);
  const partner =
    partners.find((p) => p.id === (bar.partnerId || project.installatie_partner_id)) ||
    partnerJoined ||
    null;
  const kindLabel = planbordKindLabel(bar.kind);
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
  const [serviceVerzoeken, setServiceVerzoeken] = useState<
    Pick<
      ServiceVerzoek,
      "id" | "onderwerp" | "omschrijving" | "interne_notitie" | "status"
    >[]
  >([]);

  useEffect(() => {
    setLocalDoc(schouwDoc);
  }, [schouwDoc, bar.key]);

  useEffect(() => {
    setLocalOplevering(opleveringDoc);
  }, [opleveringDoc, bar.key]);

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
  }, [project]);

  const opStatus = toOperationalStatus(status);
  const schouwVoltooid =
    Boolean(localDoc?.url) || SCHOUW_DONE_STATUSES.has(opStatus);
  const opleveringOk =
    Boolean(localOplevering?.url) ||
    opStatus === "installatie_voltooid" ||
    opStatus === "review_gevraagd" ||
    opStatus === "service";
  const serviceAfgerond =
    serviceDoneLocal ||
    (Boolean(project.service_at) &&
      (Boolean(serviceAfrondBestaand) ||
        (Boolean(project.service_notities?.trim()) &&
          opStatus !== "service")));
  const orderVolledigBetaald = orderBetaald === true;
  const notesEndpoint =
    notesPatchUrl ||
    (allowSchouwUpload || allowOpleveringUpload || allowServiceComplete
      ? `/api/projecten/${project.id}`
      : null);

  async function uploadRequiredDoc(
    file: File,
    kind: "schouw" | "oplevering"
  ) {
    if (!noteDraft.trim()) {
      setUploadError("Notitie is verplicht bij afronden.");
      setNoteMsg("Notitie is verplicht bij afronden.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    setUploadOk(null);
    try {
      if (notesEndpoint) {
        await saveSidebarNotitie(false);
      }
      const form = new FormData();
      form.append("file", file);
      form.append(
        "omschrijving",
        kind === "schouw"
          ? SCHOUW_FORMULIER_OMSCHRIJVING
          : OPLEVERINGSRAPPORT_OMSCHRIJVING
      );
      form.append("allow_pdf", "1");
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
      } else {
        setLocalOplevering(nextDoc);
        onOpleveringDocChange?.(project.id, nextDoc);
      }
      const adv = data.status_advance as
        | { advanced?: boolean; klaarVoorMateriaal?: boolean; to?: string }
        | undefined;
      if (data.project && typeof data.project === "object") {
        onProjectUpdated?.(data.project as Project);
      }
      if (kind === "oplevering") {
        setUploadOk(
          adv?.advanced
            ? "Opleveringsrapport geüpload · installatie voltooid."
            : "Opleveringsrapport geüpload."
        );
      } else if (adv?.advanced && adv.klaarVoorMateriaal) {
        setUploadOk(
          "Geüpload · alles betaald → klaar voor materiaalinkoop."
        );
      } else if (adv?.advanced) {
        setUploadOk("Geüpload · schouw voltooid.");
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
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Sluiten"
        onClick={onClose}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-line bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p
              className={[
                "text-xs font-semibold uppercase tracking-[0.08em]",
                bar.kind === "installatie"
                  ? "text-[#047857]"
                  : bar.kind === "levering"
                    ? "text-[#EA580C]"
                    : bar.kind === "service"
                      ? "text-[#C45A12]"
                      : "text-[#854D0E]",
              ].join(" ")}
            >
              {kindLabel}
              {when
                ? ` · ${formatTimeRangeNl(when, bar.duurMinuten) || formatTimeNl(when)}`
                : null}
              {duurLabel ? ` · ${duurLabel}` : null}
              {isBarPast(bar) ? " · geweest" : null}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-ink">
              {lead?.naam || projectTitle(project)}
            </h2>
            {project.project_nummer ? (
              <p className="mt-0.5 font-mono text-sm text-muted">
                {project.project_nummer}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 border border-line px-2.5 py-1.5 text-sm text-muted hover:bg-wash"
          >
            Sluiten
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-2">
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
                <p>{resolveProjectStatusLabel(status, project) || status}</p>
                <div className="space-y-1.5 border border-line bg-[#FAFBFA] px-3 py-2.5">
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
                      loading={localOplevering === undefined && !opleveringOk}
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
                </div>
              </div>
            </DetailRow>

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
                    {project.monteur &&
                    project.monteur !== partner?.naam ? (
                      <p className="text-sm text-ink">
                        Medewerker: {project.monteur}
                      </p>
                    ) : project.installatie_partner_id &&
                      !project.monteur ? (
                      <p className="text-sm text-muted">
                        Medewerker nog niet gekoppeld
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

            {showSchouwForm && (allowSchouwUpload || localDoc !== undefined) ? (
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
                      ? () => void saveSidebarNotitie().catch(() => undefined)
                      : null
                  }
                  notePlaceholder="Bijv. meterkast, kabelroute, bijzonderheden…"
                  noteTitle="Notitie bij schouw"
                  fallbackNotities={notities || null}
                />
              </DetailRow>
            ) : showOplevering &&
              (allowOpleveringUpload || localOplevering !== undefined) ? (
              <DetailRow label="Opleveringsrapport">
                <RequiredDocUploadBlock
                  label="Optioneel · opleverformulier met checklist + handtekening installateur"
                  missingLabel="Nog niet ingevuld"
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
                      ? () => void saveSidebarNotitie().catch(() => undefined)
                      : null
                  }
                  notePlaceholder="Bijv. kabels door klant, bijzonderheden oplevering…"
                  noteTitle="Notitie bij installatie"
                  fallbackNotities={notities || null}
                />
              </DetailRow>
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

                  <label className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                    Notitie bij afronden *
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      rows={3}
                      disabled={serviceAfgerond}
                      placeholder="Wat is gedaan / bevindingen…"
                      className="mt-1.5 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-[#0D9488] disabled:bg-wash"
                    />
                  </label>

                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
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
                      <label className="inline-flex cursor-pointer border border-line px-3 py-2 text-sm font-semibold text-[#0F766E] hover:bg-wash">
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
                    <p className="text-sm text-green-dark">{uploadOk}</p>
                  ) : null}
                  {uploadError ? (
                    <p className="text-sm text-[#C45A12]">{uploadError}</p>
                  ) : null}
                  {noteMsg ? (
                    <p
                      className={[
                        "text-sm",
                        noteMsg.includes("mislukt") ||
                        noteMsg.includes("Fout") ||
                        noteMsg.includes("verplicht")
                          ? "text-[#C45A12]"
                          : "text-green-dark",
                      ].join(" ")}
                    >
                      {noteMsg}
                    </p>
                  ) : null}

                  {allowServiceComplete && !serviceAfgerond ? (
                    <button
                      type="button"
                      disabled={noteBusy || !noteDraft.trim()}
                      onClick={() => void afrondService()}
                      className="w-full bg-[#C45A12] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#9A4510] disabled:opacity-50"
                    >
                      {noteBusy ? "Bezig…" : "Service afvinken"}
                    </button>
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

        <div className="flex flex-wrap gap-2 border-t border-line px-5 py-4">
          {tel ? (
            <a
              href={`tel:${tel}`}
              className="flex-1 bg-[#0D9488] px-3 py-2.5 text-center text-sm font-semibold text-white hover:bg-[#0F766E]"
            >
              Bel klant
            </a>
          ) : null}
          <Link
            href={projectHref(project.id)}
            className="flex-1 border border-line px-3 py-2.5 text-center text-sm font-semibold text-ink hover:bg-wash"
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
          opnemerDefault={project.monteur || partner?.naam || null}
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
          monteurDefault={project.monteur || partner?.naam || null}
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
              setUploadOk("Opleverformulier opgeslagen · installatie voltooid.");
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
  const kindLabel = planbordKindLabel(bar.kind);
  const timeRange = formatTimeRangeNl(bar.at, bar.duurMinuten);
  const naam = klantNaam(bar.project);
  const plaats = klantPlaats(bar.project);
  const tel = lead?.telefoon?.trim() || null;
  const isSolid =
    bar.kind === "installatie" ||
    bar.kind === "service" ||
    bar.kind === "levering";
  const titleCls = isSolid ? "text-white" : "text-ink";
  const mutedCls = isSolid ? "text-white/85" : "text-muted";
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
        "absolute z-[1] overflow-hidden border text-left",
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
          "flex h-full items-start justify-between gap-2 pl-2.5",
          compact ? "px-2 py-1" : "px-2.5 py-1.5",
        ].join(" ")}
      >
        <div className="min-w-0 overflow-hidden">
          <p
            className={[
              "font-bold uppercase tracking-[0.04em]",
              style.text,
              compact ? "text-[10px] leading-tight" : "text-xs",
            ].join(" ")}
          >
            {kindLabel}
            {timeRange ? (
              <span
                className={[
                  "ml-1.5 tabular-nums normal-case tracking-normal",
                  past ? "line-through decoration-2 opacity-80" : "",
                ].join(" ")}
              >
                {timeRange}
              </span>
            ) : null}
            {past && !compact ? (
              <span className="ml-1.5 text-[10px] font-bold normal-case tracking-wide opacity-70">
                · geweest
              </span>
            ) : null}
          </p>
          <p
            className={[
              "truncate font-semibold",
              titleCls,
              compact ? "text-xs leading-tight" : "mt-0.5 text-sm",
            ].join(" ")}
            title={naam}
          >
            {naam}
          </p>
          {plaats ? (
            <p
              className={[
                "truncate font-medium",
                mutedCls,
                compact ? "text-[10px] leading-tight" : "mt-0.5 text-xs",
              ].join(" ")}
            >
              {plaats}
            </p>
          ) : null}
        </div>
        {tel ? <PhoneCopyIcon telefoon={tel} /> : null}
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

function MonthEventChip({
  bar,
  selected,
  onSelect,
}: {
  bar: PlanbordBar;
  selected: boolean;
  onSelect: () => void;
}) {
  const s = KIND_STYLE[bar.kind];
  const past = isBarPast(bar);
  const time = bar.at ? formatTimeNl(bar.at) : "";
  const kindShort = planbordKindLabel(bar.kind, true);
  const naam = klantNaam(bar.project);
  const isSolid =
    bar.kind === "installatie" ||
    bar.kind === "service" ||
    bar.kind === "levering";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={`${time} ${kindShort} · ${naam}`}
      className={[
        "flex w-full min-w-0 items-baseline gap-1 border px-1.5 py-0.5 text-left leading-tight hover:opacity-90",
        s.bg,
        s.border,
        s.text,
        past ? "opacity-45 grayscale-[0.35]" : "",
        selected ? "ring-1 ring-[#0D9488]" : "",
      ].join(" ")}
    >
      <span
        className={[
          "shrink-0 text-[10px] font-bold tabular-nums",
          past ? "line-through" : "",
        ].join(" ")}
      >
        {time}
      </span>
      <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide">
        {kindShort}
      </span>
      <span
        className={[
          "min-w-0 truncate text-[11px] font-semibold",
          isSolid ? "text-white" : "text-ink",
          past ? "line-through opacity-80" : "",
        ].join(" ")}
      >
        {naam}
      </span>
    </button>
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

export function Planbord({
  projecten,
  onProjectUpdated,
  variant = "backoffice",
  portalToken,
  title,
  projectHref,
  afblokPartnerId: afblokPartnerIdProp,
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
  const [localProjects, setLocalProjects] = useState(projecten);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [schouwDocs, setSchouwDocs] = useState<
    Record<string, SchouwDocInfo | null>
  >({});
  const [opleveringDocs, setOpleveringDocs] = useState<
    Record<string, SchouwDocInfo | null>
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

  useEffect(() => {
    if (!afblokMode) return;
    if (!afblokPartnerId && partners.length && !readOnly) {
      setAfblokPartnerId(partners.find((p) => p.actief)?.id || partners[0].id);
    }
  }, [afblokMode, afblokPartnerId, partners, readOnly]);

  useEffect(() => {
    if (!afblokMode || !afblokPartnerId) {
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
  }, [afblokMode, afblokPartnerId, readOnly, portalToken]);

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

  useEffect(() => {
    if (!afblokMode || !afblokPartnerId || !afblokRange.van || !afblokRange.tot) {
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
    afblokMode,
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

  const planProjects = useMemo(
    () => localProjects.filter(isActiefOpPlanbord),
    [localProjects]
  );

  const weekBars = useMemo(
    () => barsForWeek(planProjects, weekDays),
    [planProjects, weekDays]
  );

  const monthBars = useMemo(
    () => barsForWeek(planProjects, monthDays),
    [planProjects, monthDays]
  );

  const timedAll = useMemo(
    () => allTimedBars(planProjects),
    [planProjects]
  );

  const activeBars = view === "maand" ? monthBars : weekBars;

  const schouwProjectIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const bar of [...weekBars, ...monthBars, ...timedAll]) {
      if (bar.kind === "schouw" || bar.kind === "schouwweek") {
        ids.add(bar.project.id);
      }
    }
    return [...ids].sort().join(",");
  }, [weekBars, monthBars, timedAll]);

  const installatieProjectIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const bar of [...weekBars, ...monthBars, ...timedAll]) {
      if (bar.kind === "installatie") ids.add(bar.project.id);
    }
    return [...ids].sort().join(",");
  }, [weekBars, monthBars, timedAll]);

  useEffect(() => {
    const schouwProjectIds = schouwProjectIdsKey
      ? schouwProjectIdsKey.split(",")
      : [];
    if (schouwProjectIds.length === 0) {
      setSchouwDocs({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        schouwProjectIds.map(async (id) => {
          try {
            const url =
              portalFotosUrl(id) || `/api/projecten/${id}/fotos`;
            const res = await fetch(url);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return [id, null] as const;
            const fotos = (data.fotos || []) as Array<{
              omschrijving: string | null;
              url: string | null;
              bestandsnaam: string | null;
              created_at: string;
            }>;
            const docs = fotos
              .filter((f) => isSchouwFormulier(f.omschrijving) && f.url)
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
            const first = docs[0];
            return [
              id,
              first?.url
                ? { url: first.url, bestandsnaam: first.bestandsnaam }
                : null,
            ] as const;
          } catch {
            return [id, null] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, SchouwDocInfo | null> = {};
      for (const [id, doc] of entries) next[id] = doc;
      setSchouwDocs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [schouwProjectIdsKey, portalToken]);

  useEffect(() => {
    const installatieIds = installatieProjectIdsKey
      ? installatieProjectIdsKey.split(",")
      : [];
    if (installatieIds.length === 0) {
      setOpleveringDocs({});
      return;
    }
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        installatieIds.map(async (id) => {
          try {
            const url =
              portalFotosUrl(id) || `/api/projecten/${id}/fotos`;
            const res = await fetch(url);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) return [id, null] as const;
            const fotos = (data.fotos || []) as Array<{
              omschrijving: string | null;
              url: string | null;
              bestandsnaam: string | null;
              created_at: string;
            }>;
            const docs = fotos
              .filter((f) => isOpleveringsrapport(f.omschrijving) && f.url)
              .sort((a, b) => a.created_at.localeCompare(b.created_at));
            const first = docs[0];
            return [
              id,
              first?.url
                ? { url: first.url, bestandsnaam: first.bestandsnaam }
                : null,
            ] as const;
          } catch {
            return [id, null] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, SchouwDocInfo | null> = {};
      for (const [id, doc] of entries) next[id] = doc;
      setOpleveringDocs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [installatieProjectIdsKey, portalToken]);

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
    return timedAll.filter((b) => b.dayKeys[0] === dayKey);
  }, [timedAll, dayKey, view]);

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
    (key: string, partnerId?: string | null) => {
      if (readOnly) return;
      setPlanDayKey(key);
      setPlanPartnerId(partnerId || null);
      setPlanOpen(true);
      setOkMsg(null);
    },
    [readOnly]
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

  const hours = useMemo(() => hourLabels(), []);
  const dayGridHeight = (DAY_END_HOUR - DAY_START_HOUR) * HOUR_PX;
  const displayDayBars = useMemo(
    () => (dayBarsResolved.length ? dayBarsResolved : dayBars),
    [dayBarsResolved, dayBars]
  );
  const laidOutDayBars = useMemo(
    () => layoutDayBars(displayDayBars),
    [displayDayBars]
  );

  return (
    <div className="flex flex-col gap-3">
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
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5 text-[#854D0E]">
              <span className="h-2.5 w-2.5 bg-[#FACC15]" aria-hidden />
              Schouw
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#047857]">
              <span className="h-2.5 w-2.5 bg-[#047857]" aria-hidden />
              Installatie
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#C45A12]">
              <span className="h-2.5 w-2.5 bg-[#C45A12]" aria-hidden />
              Service
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#EA580C]">
              <span className="h-2.5 w-2.5 bg-[#EA580C]" aria-hidden />
              Levering
            </span>
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="h-2.5 w-2.5 bg-line opacity-60" aria-hidden />
              Geweest = grijs / doorgestreept
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-line">
            {VIEW_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => changeView(opt.id)}
                className={[
                  "px-3 py-1.5 text-xs font-semibold",
                  view === opt.id
                    ? "bg-[#0D9488] text-white"
                    : "bg-white text-ink hover:bg-wash",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
                    ? "Afblok-modus: klik ochtend (09–12) of middag (13–17) om dicht/open te zetten"
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

      {afblokMode ? (
        <div className="space-y-2 border border-[#B91C1C]/25 bg-[#FEF2F2] px-4 py-3">
          <p className="text-xs font-medium text-[#B91C1C]">
            Afblok-modus — per dag 2 blokken (zoals adviseurs 4, maar hier
            halve dagen): ochtend = installatie 1, middag = installatie 2. Klik
            om dicht ↔ open. Alles open → max 2 installaties die dag inplannen.
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
            </div>
            <p className="text-sm font-medium text-muted">
              {displayDayBars.length === 0
                ? "Geen afspraken"
                : `${displayDayBars.length} afspraak${displayDayBars.length === 1 ? "" : "en"}`}
            </p>
          </div>

          <div className="flex overflow-x-auto">
            <div
              className="sticky left-0 z-[1] w-[4.5rem] shrink-0 border-r border-line bg-[#FAFBFA]"
              style={{ height: dayGridHeight + 16 }}
            >
              {hours.map((h) => (
                <div
                  key={h}
                  className="relative border-b border-line/60"
                  style={{ height: HOUR_PX }}
                >
                  <span className="absolute -top-2.5 right-2.5 text-sm font-bold tabular-nums text-ink">
                    {String(h).padStart(2, "0")}:00
                  </span>
                </div>
              ))}
            </div>

            <div className="relative min-w-0 flex-1">
              <div className="relative" style={{ height: dayGridHeight }}>
                {hours.map((h, i) => (
                  <div
                    key={h}
                    className={[
                      "absolute inset-x-0 border-b border-line/50",
                      i % 2 === 0 ? "bg-white" : "bg-[#FAFBFA]/80",
                    ].join(" ")}
                    style={{ top: i * HOUR_PX, height: HOUR_PX }}
                  />
                ))}

                {!readOnly ? (
                  <button
                    type="button"
                    onClick={() => openPlan(dayKey)}
                    className="absolute inset-0 z-0"
                    aria-label="Inplannen op deze dag"
                  />
                ) : null}

                {laidOutDayBars.map(({ bar, col, colCount }) => (
                  <TimedDayBlock
                    key={bar.key}
                    bar={bar}
                    col={col}
                    colCount={colCount}
                    selected={selectedBar?.key === bar.key}
                    onSelect={() => openBar(bar)}
                    gridHeight={dayGridHeight}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {view === "week" ? (
        <div className="overflow-x-auto border border-line bg-white">
          <div className="min-w-[64rem]">
            <div className="grid grid-cols-7 border-b border-line">
              {weekDays.map((d) => {
                const count = barsByDay.get(d.key)?.length ?? 0;
                const isToday = d.key === todayKey;
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => goDay(d.key)}
                    className={[
                      "border-r border-line px-2.5 py-3 text-left last:border-r-0 transition-colors",
                      isToday
                        ? "bg-[#F0FDFA] hover:bg-[#CCFBF1]"
                        : d.weekend
                          ? "bg-[#F8FAFC] hover:bg-wash"
                          : "bg-white hover:bg-wash",
                    ].join(" ")}
                    title="Open dagoverzicht"
                  >
                    <p
                      className={[
                        "text-xs font-semibold uppercase tracking-[0.06em]",
                        isToday ? "text-[#0F766E]" : "text-muted",
                      ].join(" ")}
                    >
                      {format(d.date, "EEE", { locale: nl })}
                    </p>
                    <p
                      className={[
                        "mt-1.5 font-display text-2xl font-semibold tabular-nums leading-none",
                        isToday
                          ? "inline-flex h-9 min-w-9 items-center justify-center bg-[#0D9488] px-2 text-lg text-white"
                          : "text-ink",
                      ].join(" ")}
                    >
                      {format(d.date, "d")}
                    </p>
                    <p className="mt-2 text-xs font-medium text-muted">
                      {count > 0 ? `${count}×` : "Leeg · klik"}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="grid min-h-[280px] grid-cols-7">
              {weekDays.map((d) => {
                const list = barsByDay.get(d.key) || [];
                const isToday = d.key === todayKey;
                return (
                  <div
                    key={d.key}
                    className={[
                      "min-h-[280px] space-y-1.5 border-r border-line p-1.5 last:border-r-0",
                      afblokMode
                        ? "bg-[#FFF7F7]/50"
                        : isToday
                          ? "bg-[#F0FDFA]/35"
                          : d.weekend
                            ? "bg-[#F8FAFC]"
                            : "bg-white",
                    ].join(" ")}
                  >
                    {afblokMode ? (
                      <div className="space-y-1">
                        {PARTNER_VENSTERS.map((venster) => {
                          const blocked = isVensterBlocked(d.key, venster);
                          const hasWork = list.some((b) => {
                            if (!b.at) return false;
                            const h = Number(
                              formatInTimeZone(
                                new Date(b.at),
                                AMSTERDAM_TZ,
                                "H"
                              )
                            );
                            if (venster === "ochtend") return h >= 9 && h < 12;
                            return h >= 13 && h < 17;
                          });
                          return (
                            <button
                              key={venster}
                              type="button"
                              disabled={blockBusy || !afblokPartnerId}
                              onClick={() =>
                                void toggleVensterAfblok(d.key, venster)
                              }
                              className={[
                                "flex w-full flex-col gap-0.5 border px-2 py-2 text-left text-[11px] font-semibold disabled:opacity-50",
                                blocked
                                  ? "border-[#FECACA] bg-[#FEE2E2] text-[#991B1B]"
                                  : hasWork
                                    ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46]"
                                    : "border-dashed border-[#FECACA] bg-white text-[#B91C1C] hover:bg-[#FEF2F2]",
                              ].join(" ")}
                            >
                              <span className="flex items-center justify-between gap-1">
                                <span>
                                  {venster === "ochtend"
                                    ? "Ochtend 09–12"
                                    : "Middag 13–17"}
                                </span>
                                <span className="uppercase tracking-wide">
                                  {blocked
                                    ? "Dicht"
                                    : hasWork
                                      ? "Bezet"
                                      : "Open"}
                                </span>
                              </span>
                              <span className="text-[10px] font-medium opacity-80">
                                {venster === "ochtend"
                                  ? "Installatie 1"
                                  : "Installatie 2"}
                              </span>
                            </button>
                          );
                        })}
                        {list.length > 0 ? (
                          <div className="space-y-1 pt-1">
                            {list.map((bar) => (
                              <EventCard
                                key={bar.key}
                                bar={bar}
                                schouwDoc={schouwDocs[bar.project.id]}
                                hidePartner={readOnly}
                                compact
                                selected={selectedBar?.key === bar.key}
                                onSelect={() => openBar(bar)}
                              />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : list.length === 0 ? (
                      !readOnly ? (
                        <button
                          type="button"
                          onClick={() => openPlan(d.key)}
                          className="flex h-16 w-full items-center justify-center text-[11px] text-muted/60 hover:bg-wash hover:text-ink"
                        >
                          +
                        </button>
                      ) : (
                        <div className="flex h-16 items-center justify-center text-[11px] text-muted/50">
                          —
                        </div>
                      )
                    ) : (
                      list.map((bar) => (
                        <EventCard
                          key={bar.key}
                          bar={bar}
                          schouwDoc={
                            schouwDocs[bar.project.id]
                          }
                          hidePartner={readOnly}
                          compact
                          selected={selectedBar?.key === bar.key}
                          onSelect={() => openBar(bar)}
                        />
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {view === "maand" ? (
        <div className="overflow-x-auto border border-line bg-white">
          <div className="min-w-[56rem]">
            <div className="grid grid-cols-7 border-b border-line bg-[#FAFBFA]">
              {["ma", "di", "wo", "do", "vr", "za", "zo"].map((d) => (
                <div
                  key={d}
                  className="border-r border-line px-2 py-2 text-center text-[11px] font-bold uppercase tracking-[0.06em] text-muted last:border-r-0"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 auto-rows-fr">
              {monthDays.map((d) => {
                const inMonth = isSameMonthKey(d.key, anchor);
                const list = timedAll.filter((b) => b.dayKeys[0] === d.key);
                const isToday = d.key === todayKey;
                const visible = list.slice(0, MONTH_CHIPS_VISIBLE);
                const more = list.length - visible.length;
                return (
                  <div
                    key={d.key}
                    className={[
                      "flex min-h-[7.5rem] flex-col border-b border-r border-line p-1.5 last:border-r-0",
                      inMonth
                        ? isToday
                          ? "bg-[#F0FDFA]"
                          : "bg-white"
                        : "bg-[#F4F6F5]",
                    ].join(" ")}
                  >
                    <div className="mb-1 flex items-center justify-between gap-1">
                      <button
                        type="button"
                        onClick={() => goDay(d.key)}
                        className={[
                          "inline-flex h-7 min-w-7 items-center justify-center font-display text-sm font-semibold tabular-nums leading-none hover:opacity-80",
                          isToday
                            ? "bg-[#0D9488] px-1.5 text-white"
                            : inMonth
                              ? "text-ink"
                              : "text-muted/55",
                        ].join(" ")}
                        title="Open dagoverzicht"
                      >
                        {format(d.date, "d")}
                      </button>
                      {list.length > 0 ? (
                        <span
                          className={[
                            "text-[10px] font-semibold tabular-nums",
                            inMonth ? "text-muted" : "text-muted/50",
                          ].join(" ")}
                        >
                          {list.length}×
                        </span>
                      ) : null}
                    </div>
                    {afblokMode && inMonth ? (
                      <div className="mb-1 space-y-0.5">
                        {PARTNER_VENSTERS.map((venster) => {
                          const blocked = isVensterBlocked(d.key, venster);
                          return (
                            <button
                              key={venster}
                              type="button"
                              disabled={blockBusy || !afblokPartnerId}
                              onClick={() =>
                                void toggleVensterAfblok(d.key, venster)
                              }
                              className={[
                                "flex w-full items-center justify-between border px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide disabled:opacity-50",
                                blocked
                                  ? "border-[#FECACA] bg-[#FEE2E2] text-[#991B1B]"
                                  : "border-dashed border-[#FECACA] bg-white text-[#B91C1C]",
                              ].join(" ")}
                            >
                              <span>
                                {venster === "ochtend" ? "Ocht." : "Mid."}
                              </span>
                              <span>{blocked ? "Dicht" : "Open"}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    <div className="flex min-h-0 flex-1 flex-col gap-0.5">
                      {visible.map((bar) => (
                        <MonthEventChip
                          key={bar.key}
                          bar={bar}
                          selected={selectedBar?.key === bar.key}
                          onSelect={() => openBar(bar)}
                        />
                      ))}
                      {more > 0 ? (
                        <button
                          type="button"
                          onClick={() => goDay(d.key)}
                          className={[
                            "px-0.5 text-left text-[10px] font-semibold hover:underline",
                            inMonth ? "text-muted hover:text-ink" : "text-muted/60",
                          ].join(" ")}
                        >
                          +{more} meer
                        </button>
                      ) : null}
                      {list.length === 0 && inMonth && !readOnly && !afblokMode ? (
                        <button
                          type="button"
                          onClick={() => openPlan(d.key)}
                          className="mt-auto flex h-6 w-full items-center justify-center text-[10px] text-muted/40 hover:bg-wash hover:text-muted"
                          title="Inplannen"
                        >
                          +
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {view === "lijst" ? (
        <div className="border border-line bg-white">
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
                  <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-line bg-[#FAFBFA] px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => goDay(group.dayKey)}
                      className={[
                        "font-display text-base font-semibold capitalize hover:text-[#0F766E]",
                        groupPast ? "text-muted line-through decoration-1" : "text-ink",
                      ].join(" ")}
                    >
                      {group.label}
                      {groupPast ? (
                        <span className="ml-2 text-xs font-bold no-underline">
                          · geweest
                        </span>
                      ) : null}
                    </button>
                    <span className="text-xs font-medium text-muted">
                      {group.bars.length}×
                    </span>
                  </div>
                  <div className="space-y-2 p-3">
                    {group.bars.map((bar) => (
                      <EventCard
                        key={bar.key}
                        bar={bar}
                        schouwDoc={schouwDocs[bar.project.id]}
                        hidePartner={readOnly}
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
          projects={planProjects}
          partners={partners}
          onClose={() => setPlanOpen(false)}
          onSaved={handleSaved}
        />
      ) : null}
    </div>
  );
}
