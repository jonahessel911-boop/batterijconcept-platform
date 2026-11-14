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
  isOpleveringsrapport,
  isSchouwFormulier,
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
    setInstallatieFollowUp(null);
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

  const teamgenotenVoorSoort = useMemo(() => {
    return teamgenoten.filter((t) => {
      if (soort === "schouwdag" || soort === "schouwweek") {
        return t.kan_schouw === true;
      }
      if (soort === "installatie" || soort === "service") {
        // Default: installatie mag als kan_installatie niet expliciet false is
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
                        : teamgenotenVoorSoort.length === 0
                          ? soort === "schouwdag" || soort === "schouwweek"
                            ? "Geen monteurs met schouw-ervaring"
                            : "Geen monteurs voor installatie"
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
                              ? defaultDatetimeForDay(dayKey, 9)
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
  const missingSchouw =
    isSchouwBar && schouwDoc !== undefined && !schouwDoc?.url;
  const monteurLabel = hidePartner
    ? bar.project.monteur || null
    : partner?.naam &&
        bar.project.monteur &&
        bar.project.monteur !== partner.naam
      ? `${partner.naam} · ${bar.project.monteur}`
      : partner?.naam || bar.project.monteur || null;
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
  /** Installatiepartner-portaal: andere checklist, geen betaalstatus. */
  portalMode?: boolean;
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

  // Foto’s + documenten voor schouw/installatie sidebar.
  useEffect(() => {
    if (bar.kind !== "installatie" && bar.kind !== "schouw" && bar.kind !== "schouwweek") {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url =
          fotosUploadUrl || `/api/projecten/${project.id}/fotos`;
        const res = await fetch(url);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) {
          if (!cancelled) {
            if (schouwDoc === undefined) setLocalDoc(null);
            setLocalMeterkast(null);
            setLocalBatterij(null);
            setLocalVideo(null);
          }
          return;
        }
        const fotos = (data.fotos || []) as Array<{
          omschrijving: string | null;
          url: string | null;
          bestandsnaam: string | null;
          created_at: string;
        }>;
        const pick = (
          pred: (o: string | null) => boolean
        ): SchouwDocInfo | null => {
          const docs = fotos
            .filter((f) => pred(f.omschrijving) && f.url)
            .sort((a, b) => a.created_at.localeCompare(b.created_at));
          const last = docs[docs.length - 1];
          return last?.url
            ? { url: last.url, bestandsnaam: last.bestandsnaam }
            : null;
        };
        if (!cancelled) {
          if (schouwDoc === undefined) {
            setLocalDoc(pick((o) => isSchouwFormulier(o)));
          }
          setLocalMeterkast(pick((o) => isFotoMeterkast(o)));
          setLocalBatterij(pick((o) => isFotoBatterij(o)));
          setLocalVideo(pick((o) => isVideoInstallatie(o)));
          if (opleveringDoc === undefined && bar.kind === "installatie") {
            setLocalOplevering(pick((o) => isOpleveringsrapport(o)));
          }
        }
      } catch {
        if (!cancelled) {
          if (schouwDoc === undefined) setLocalDoc(null);
          setLocalMeterkast(null);
          setLocalBatterij(null);
          setLocalVideo(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    bar.kind,
    bar.key,
    schouwDoc,
    opleveringDoc,
    fotosUploadUrl,
    project.id,
  ]);

  const partnerIdForTeam =
    partner?.id || project.installatie_partner_id || null;
  useEffect(() => {
    if (!partnerIdForTeam) {
      setFormTeamgenoten([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/installatie-partners/teamgenoten?partner_id=${encodeURIComponent(partnerIdForTeam)}`
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setFormTeamgenoten(
          (data.teamgenoten as InstallatiePartnerTeamgenoot[]) || []
        );
      } catch {
        if (!cancelled) setFormTeamgenoten([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerIdForTeam, bar.key]);

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
    opStatus === "review_gevraagd" ||
    opStatus === "service";
  const serviceAfgerond =
    serviceDoneLocal ||
    (Boolean(project.service_at) &&
      (Boolean(serviceAfrondBestaand) ||
        (Boolean(project.service_notities?.trim()) &&
          opStatus !== "service")));
  const orderVolledigBetaald = orderBetaald === true;
  const batterijBijKlant = batterijPurchasingStatus(
    project.materiaal_checks
  ).geleverd;
  const schouwMedewerker = medewerkerNaamVanProject(project);
  const notesEndpoint =
    notesPatchUrl ||
    (allowSchouwUpload || allowOpleveringUpload || allowServiceComplete
      ? `/api/projecten/${project.id}`
      : null);

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
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <Badge
              variant="secondary"
              className={cn(
                "rounded-full text-[10px] font-semibold uppercase tracking-[0.06em]",
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
              {kindLabel}
              {when
                ? ` · ${formatTimeRangeNl(when, bar.duurMinuten) || formatTimeNl(when)}`
                : ""}
              {duurLabel ? ` · ${duurLabel}` : ""}
              {isBarPast(bar) ? " · geweest" : ""}
            </Badge>
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
            variant="outline"
            size="sm"
            onClick={onClose}
            className="shrink-0"
          >
            Sluiten
          </Button>
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
                      <p className="text-sm font-semibold text-ink">
                        Medewerker: {project.monteur}
                      </p>
                    ) : project.installatie_partner_id &&
                      !project.monteur ? (
                      <p className="text-sm font-semibold text-[#C45A12]">
                        Medewerker nog niet gekoppeld — koppel vóór
                        schouw/oplevering
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
            ) : showOplevering &&
              (allowOpleveringUpload || localOplevering !== undefined) ? (
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

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      title={`${time} ${kindShort} · ${naam}`}
      className={[
        "flex w-full min-w-0 items-baseline gap-1 rounded-md border px-1.5 py-0.5 text-left leading-tight hover:opacity-90",
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
          "min-w-0 truncate text-[11px] font-semibold text-ink",
          past ? "line-through opacity-80" : "",
        ].join(" ")}
      >
        {naam}
      </span>
    </button>
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
        : "Ochtend 09–12"
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
    if (!showTeamAgendaFilters || !portalToken) {
      setAgendaKoppels([]);
      return;
    }
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
  }, [showTeamAgendaFilters, portalToken]);

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
    if (showTeamAgendaFilters && agendaTeamFilter.kind === "person") {
      const id = agendaTeamFilter.id;
      list = list.filter((p) => p.installatie_teamgenoot_id === id);
    } else if (showTeamAgendaFilters && agendaTeamFilter.kind === "koppel") {
      const koppel = agendaKoppels.find((k) => k.id === agendaTeamFilter.id);
      const ids = new Set(
        [koppel?.monteur_1_id, koppel?.monteur_2_id].filter(Boolean) as string[]
      );
      list = list.filter(
        (p) =>
          !!p.installatie_teamgenoot_id && ids.has(p.installatie_teamgenoot_id)
      );
    }
    return list;
  }, [
    localProjects,
    filterPartnerId,
    showTeamAgendaFilters,
    agendaTeamFilter,
    agendaKoppels,
  ]);

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

  const schouwProjectIdsKey = useMemo(() => {
    const ids = new Set<string>();
    for (const bar of [...weekBars, ...monthBars, ...timedAll]) {
      // Ook bij installatie: schouwformulier downloadbaar in de sidebar.
      if (
        bar.kind === "schouw" ||
        bar.kind === "schouwweek" ||
        bar.kind === "installatie"
      ) {
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
            const last = docs[docs.length - 1];
            return [
              id,
              last?.url
                ? { url: last.url, bestandsnaam: last.bestandsnaam }
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
      const freeVenstersToday = Math.max(0, 2 - installatieToday);
      const schouw2w = weekBarsP.filter(
        (b) => b.kind === "schouw" || b.kind === "schouwweek"
      ).length;
      const installatie2w = weekBarsP.filter(
        (b) => b.kind === "installatie"
      ).length;
      // Ruwe vrije installatie-vensters komende 14d (excl. zondag ≈ 12 werkdagen × 2)
      const workDaysApprox = 12;
      const freeVensters2w = Math.max(
        0,
        workDaysApprox * 2 - installatie2w
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
                    Vandaag: {p.freeVenstersToday}/2 vrij
                    {p.schouwToday > 0
                      ? ` · ${p.schouwToday} schouw`
                      : ""}
                    {p.installatieToday > 0
                      ? ` · ${p.installatieToday} inst.`
                      : ""}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-muted">
                    2 wkn: ~{p.freeVensters2w} inst.-vensters vrij ·{" "}
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
        <>
        <div className="divide-y divide-line border border-line bg-white md:hidden">
          {weekDays.map((d) => {
            const list = barsByDay.get(d.key) || [];
            const isToday = d.key === todayKey;
            return (
              <section key={d.key} className={isToday ? "bg-[#F0FDFA]/40" : ""}>
                <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                  <button
                    type="button"
                    onClick={() => goDay(d.key)}
                    className="min-w-0 text-left"
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      {format(d.date, "EEEE", { locale: nl })}
                    </p>
                    <p className="font-display text-lg font-semibold text-ink">
                      {format(d.date, "d MMMM", { locale: nl })}
                      {isToday ? (
                        <span className="ml-2 text-xs font-semibold text-[#0F766E]">
                          vandaag
                        </span>
                      ) : null}
                    </p>
                  </button>
                  {!readOnly ? (
                    <button
                      type="button"
                      onClick={() => openPlan(d.key)}
                      className="shrink-0 border border-line px-2.5 py-1.5 text-xs font-semibold text-ink"
                    >
                      + Inplannen
                    </button>
                  ) : null}
                </div>
                <div className="space-y-1 p-2">
                  {list.length === 0 ? (
                    <p className="px-1 py-1.5 text-[11px] text-muted">
                      Niets gepland
                    </p>
                  ) : (
                    list.map((bar) => (
                      <EventCard
                        key={bar.key}
                        bar={bar}
                        schouwDoc={schouwDocs[bar.project.id]}
                        hidePartner={readOnly}
                        compact
                        selected={selectedBar?.key === bar.key}
                        onSelect={() => openBar(bar)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <div className="hidden overflow-x-auto border border-line bg-white md:block">
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
                const ochtendDicht = Boolean(
                  afblokPartnerId && isVensterBlocked(d.key, "ochtend")
                );
                const middagDicht = Boolean(
                  afblokPartnerId && isVensterBlocked(d.key, "middag")
                );
                const dagAfgeblokt = ochtendDicht && middagDicht;
                return (
                  <div
                    key={d.key}
                    className={[
                      "min-h-[280px] space-y-1 border-r border-line p-1 last:border-r-0",
                      afblokMode
                        ? "bg-[#FFF7F7]/50"
                        : dagAfgeblokt
                          ? "bg-[#FEE2E2]/55"
                          : isToday
                            ? "bg-[#F0FDFA]/35"
                            : d.weekend
                              ? "bg-[#F8FAFC]"
                              : "bg-white",
                    ].join(" ")}
                  >
                    {afblokPartnerId ? (
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
                            <AfblokVensterChip
                              key={venster}
                              venster={venster}
                              blocked={blocked}
                              interactive={afblokMode}
                              disabled={blockBusy || !afblokPartnerId}
                              hasWork={hasWork}
                              onToggle={() =>
                                void toggleVensterAfblok(d.key, venster)
                              }
                            />
                          );
                        })}
                      </div>
                    ) : null}
                    {afblokMode ? (
                      list.length > 0 ? (
                        <div className="space-y-1">
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
                      ) : null
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
                          schouwDoc={schouwDocs[bar.project.id]}
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
        </>
      ) : null}

      {view === "maand" ? (
        <>
        <div className="border border-line bg-white md:hidden">
          <div className="grid grid-cols-7 border-b border-line bg-[#FAFBFA]">
            {["ma", "di", "wo", "do", "vr", "za", "zo"].map((d) => (
              <div
                key={d}
                className="px-0.5 py-1.5 text-center text-[10px] font-bold uppercase text-muted"
              >
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((d) => {
              const inMonth = isSameMonthKey(d.key, anchor);
              const list = timedAll.filter((b) => b.dayKeys[0] === d.key);
              const isToday = d.key === todayKey;
              const visible = list.slice(0, 2);
              const more = list.length - visible.length;
              return (
                <div
                  key={d.key}
                  className={[
                    "flex min-h-[4.25rem] flex-col border-b border-r border-line p-0.5",
                    inMonth
                      ? isToday
                        ? "bg-[#F0FDFA]"
                        : "bg-white"
                      : "bg-[#F4F6F5]",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => goDay(d.key)}
                    className={[
                      "mx-auto inline-flex h-6 min-w-6 items-center justify-center text-xs font-semibold tabular-nums",
                      isToday
                        ? "bg-[#0D9488] text-white"
                        : inMonth
                          ? "text-ink"
                          : "text-muted/55",
                    ].join(" ")}
                  >
                    {format(d.date, "d")}
                  </button>
                  <div className="mt-0.5 flex min-w-0 flex-col gap-0.5">
                    {visible.map((bar) => (
                      <button
                        key={bar.key}
                        type="button"
                        onClick={() => openBar(bar)}
                        className="truncate text-left text-[9px] font-semibold leading-tight text-ink"
                        title={klantNaam(bar.project)}
                      >
                        {bar.at ? formatTimeNl(bar.at) : ""}{" "}
                        {klantNaam(bar.project)}
                      </button>
                    ))}
                    {more > 0 ? (
                      <button
                        type="button"
                        onClick={() => goDay(d.key)}
                        className="text-left text-[9px] font-semibold text-muted"
                      >
                        +{more}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="hidden overflow-x-auto border border-line bg-white md:block">
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
                const dagAfgeblokt =
                  Boolean(afblokPartnerId) &&
                  inMonth &&
                  isVensterBlocked(d.key, "ochtend") &&
                  isVensterBlocked(d.key, "middag");
                return (
                  <div
                    key={d.key}
                    className={[
                      "flex min-h-[7.5rem] flex-col border-b border-r border-line p-1.5 last:border-r-0",
                      inMonth
                        ? dagAfgeblokt
                          ? "bg-[#FEE2E2]/70"
                          : isToday
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
                    {afblokPartnerId && inMonth ? (
                      <div className="mb-1 space-y-0.5">
                        {PARTNER_VENSTERS.map((venster) => (
                          <AfblokVensterChip
                            key={venster}
                            venster={venster}
                            blocked={isVensterBlocked(d.key, venster)}
                            compact
                            interactive={afblokMode}
                            disabled={blockBusy || !afblokPartnerId}
                            onToggle={() =>
                              void toggleVensterAfblok(d.key, venster)
                            }
                          />
                        ))}
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
        </>
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
