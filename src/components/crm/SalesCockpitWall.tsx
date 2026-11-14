"use client";

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Banknote,
  Briefcase,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Handshake,
  Maximize2,
  Minimize2,
  Moon,
  Package,
  Phone,
  PhoneCall,
  Radio,
  Receipt,
  Send,
  Sun,
  TrendingUp,
  UserPlus,
  Wrench,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { formatEuro } from "@/lib/format";
import type {
  DayAdvisorAppt,
  DayAdvisorRow,
} from "@/lib/sales-cockpit/cockpit-metrics";
import type {
  WallActivityEvent,
  WallActivityKind,
  WallboardOverview,
} from "@/lib/sales-cockpit/wallboard";
import { cn } from "@/lib/cn";

/** Schaal t.o.v. kleinste viewport-zijde — leesbaar op laptop én TV. */
const WALL_VARS = {
  "--w-gap": "clamp(0.45rem, 1.1vmin, 0.85rem)",
  "--w-pad": "clamp(0.6rem, 1.25vmin, 1rem)",
  "--w-pad-sm": "clamp(0.45rem, 1vmin, 0.75rem)",
  "--w-label": "clamp(0.625rem, 1.15vmin, 0.78rem)",
  "--w-meta": "clamp(0.72rem, 1.3vmin, 0.88rem)",
  "--w-body": "clamp(0.85rem, 1.55vmin, 1.05rem)",
  "--w-title": "clamp(1.05rem, 2.2vmin, 1.45rem)",
  "--w-hero": "clamp(1.45rem, 3.4vmin, 2.1rem)",
  "--w-kpi": "clamp(1.2rem, 2.85vmin, 1.75rem)",
  "--w-kpi-sm": "clamp(0.95rem, 2.2vmin, 1.3rem)",
  "--w-radius": "clamp(0.65rem, 1.1vmin, 0.95rem)",
  "--w-avatar": "clamp(1.65rem, 2.7vmin, 2.1rem)",
} as CSSProperties;

function initials(naam: string): string {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase();
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", {
      timeZone: "Europe/Amsterdam",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return "—";
  }
}

function formatClock(now: Date): string {
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);
}

/** Compacte euro voor smalle wall-kolommen. */
function formatEuroCompact(amount: number): string {
  const n = Number(amount ?? 0);
  if (Math.abs(n) >= 1000) {
    return `€${(n / 1000).toLocaleString("nl-NL", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    })}k`;
  }
  return formatEuro(n);
}

function soortLabel(soort: string): string {
  if (soort === "nieuw") return "Nieuw";
  if (soort === "vervolg_fysiek") return "Locatie";
  if (soort === "vervolg_tel") return "Telefonisch";
  if (soort === "vervolg_punt") return "Punt";
  return soort || "Afspraak";
}

function activityMeta(kind: WallActivityKind): {
  tone: "teal" | "info" | "positive" | "warn" | "neutral";
  Icon: typeof CalendarPlus;
  label: string;
} {
  if (kind === "lead") {
    return { tone: "info", Icon: UserPlus, label: "Lead" };
  }
  if (kind === "afspraak") {
    return { tone: "teal", Icon: CalendarPlus, label: "Afspraak" };
  }
  if (kind === "offerte") {
    return { tone: "positive", Icon: FileText, label: "Offerte" };
  }
  if (kind === "status") {
    return { tone: "warn", Icon: CheckCircle2, label: "Status" };
  }
  if (kind === "afboek") {
    return { tone: "warn", Icon: ClipboardCheck, label: "Afboek" };
  }
  if (kind === "bel") {
    return { tone: "neutral", Icon: Phone, label: "Bel" };
  }
  if (kind === "backoffice") {
    return { tone: "info", Icon: Briefcase, label: "Backoffice" };
  }
  if (kind === "factuur") {
    return { tone: "warn", Icon: Receipt, label: "Factuur" };
  }
  if (kind === "betaling") {
    return { tone: "positive", Icon: Banknote, label: "Betaling" };
  }
  if (kind === "inkoop") {
    return { tone: "neutral", Icon: Package, label: "Inkoop" };
  }
  if (kind === "schouw") {
    return { tone: "info", Icon: ClipboardCheck, label: "Schouw" };
  }
  if (kind === "installatie") {
    return { tone: "teal", Icon: Wrench, label: "Installatie" };
  }
  if (kind === "service") {
    return { tone: "warn", Icon: Wrench, label: "Service" };
  }
  return { tone: "neutral", Icon: Radio, label: "Log" };
}

function statusMeta(status: DayAdvisorRow["liveStatus"]) {
  if (status === "in_afspraak") {
    return {
      label: "In afspraak",
      badgeTone: "teal" as const,
      shell: "border-teal-200 bg-teal-50/70",
      accent: "bg-teal-500",
      avatar: "bg-teal-100 text-teal-800",
      dot: "bg-teal-500",
      clock: "text-teal-700",
    };
  }
  if (status === "vrij") {
    return {
      label: "Vrij",
      badgeTone: "warn" as const,
      shell: "border-amber-200 bg-amber-50/70",
      accent: "bg-amber-500",
      avatar: "bg-amber-100 text-amber-900",
      dot: "bg-amber-500",
      clock: "text-amber-800",
    };
  }
  if (status === "volgende") {
    return {
      label: "Volgende",
      badgeTone: "info" as const,
      shell: "border-sky-200 bg-sky-50/70",
      accent: "bg-sky-500",
      avatar: "bg-sky-100 text-sky-800",
      dot: "bg-sky-500",
      clock: "text-sky-700",
    };
  }
  return {
    label: "Klaar",
    badgeTone: "neutral" as const,
    shell: "border-zinc-200 bg-zinc-50/80",
    accent: "bg-zinc-300",
    avatar: "bg-zinc-100 text-zinc-600",
    dot: "bg-zinc-400",
    clock: "text-muted",
  };
}

function offerStatusLabel(appt: DayAdvisorAppt | null | undefined): {
  label: string;
  tone: "positive" | "info" | "neutral";
  Icon: typeof Send;
} | null {
  if (!appt) return null;
  const offer = appt.offer;
  // Getekend wint altijd — ook via afboek/sale-settlement.
  if (
    offer?.signed ||
    appt.settledLabel === "Getekend" ||
    (appt.settled && offer?.signed)
  ) {
    return {
      label: "Getekend",
      tone: "positive",
      Icon: CheckCircle2,
    };
  }
  if (offer?.sent) {
    return { label: "Verstuurd", tone: "positive", Icon: Send };
  }
  if (offer?.created) {
    return { label: "Aangemaakt", tone: "info", Icon: FileText };
  }
  return null;
}

/** Offerte-label alleen tijdens een lopende afspraak (huidige lead). */
function advisorOfferStatus(row: DayAdvisorRow): {
  label: string;
  tone: "positive" | "info" | "neutral";
  Icon: typeof Send;
} | null {
  if (row.liveStatus !== "in_afspraak" || !row.current) return null;
  return offerStatusLabel(row.current);
}

/** Max 2 kolommen tot het scherm echt gevuld kan worden met 3+. */
function advisorGridCols(count: number): number {
  if (count <= 1) return 1;
  if (count <= 6) return 2;
  if (count <= 9) return 3;
  return 4;
}

type WallKpiAccent = "teal" | "emerald" | "sky" | "amber" | "orange" | "zinc";

/** Compacte KPI-tegel — vaste interne hoogtes zodat rijen gelijk lopen. */
function WallKpiTile({
  label,
  value,
  hint,
  icon,
  accent = "zinc",
  progress,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  accent?: WallKpiAccent;
  /** 0–100 voor conversie-balken. */
  progress?: number | null;
}) {
  const accents: Record<
    WallKpiAccent,
    { stripe: string; icon: string; value: string; bar: string }
  > = {
    teal: {
      stripe: "border-l-teal-600",
      icon: "bg-teal-50 text-teal-700",
      value: "text-teal-900",
      bar: "bg-teal-600",
    },
    emerald: {
      stripe: "border-l-emerald-500",
      icon: "bg-emerald-50 text-emerald-700",
      value: "text-emerald-900",
      bar: "bg-emerald-600",
    },
    sky: {
      stripe: "border-l-sky-500",
      icon: "bg-sky-50 text-sky-700",
      value: "text-sky-900",
      bar: "bg-sky-500",
    },
    amber: {
      stripe: "border-l-amber-500",
      icon: "bg-amber-50 text-amber-800",
      value: "text-amber-950",
      bar: "bg-amber-500",
    },
    orange: {
      stripe: "border-l-orange-500",
      icon: "bg-orange-50 text-orange",
      value: "text-orange",
      bar: "bg-orange",
    },
    zinc: {
      stripe: "border-l-zinc-300",
      icon: "bg-zinc-100 text-zinc-600",
      value: "text-ink",
      bar: "bg-zinc-700",
    },
  };
  const a = accents[accent];
  const showProgress = progress != null && progress >= 0;

  return (
    <div
      className={cn(
        "flex h-full min-h-[6.75rem] min-w-0 flex-col overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm border-l-4",
        a.stripe
      )}
    >
      <div
        className="flex h-full flex-col gap-1.5"
        style={{ padding: "var(--w-pad-sm)" }}
      >
        <div className="flex h-7 shrink-0 items-start justify-between gap-2">
          <p className="truncate text-[length:var(--w-label)] font-medium text-muted">
            {label}
          </p>
          {icon ? (
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg",
                a.icon
              )}
            >
              {icon}
            </span>
          ) : null}
        </div>
        <p
          className={cn(
            "font-display text-[length:var(--w-kpi)] font-semibold tabular-nums leading-none tracking-tight",
            a.value
          )}
        >
          {value}
        </p>
        <p className="min-h-[1.1em] truncate text-[length:var(--w-label)] text-muted">
          {hint ?? "\u00a0"}
        </p>
        <div className="mt-auto flex h-1.5 shrink-0 items-center">
          {showProgress ? (
            <Progress
              value={Math.min(100, progress!)}
              className="h-1.5 w-full"
              indicatorClassName={a.bar}
            />
          ) : (
            <div className="h-1.5 w-full" aria-hidden />
          )}
        </div>
      </div>
    </div>
  );
}

function AdvisorCard({
  row,
  dense,
}: {
  row: DayAdvisorRow;
  dense?: boolean;
}) {
  const inAppt = row.liveStatus === "in_afspraak";
  const status = statusMeta(row.liveStatus);
  const detail = inAppt ? row.current : row.next;
  const offer = advisorOfferStatus(row);

  return (
    <Card
      className={cn(
        "relative flex h-auto flex-col self-start overflow-hidden border-l-0 shadow-sm",
        status.shell,
        dense ? "gap-1.5" : "gap-2"
      )}
      style={{ borderRadius: "var(--w-radius)" }}
    >
      <span
        className={cn("absolute inset-y-0 left-0 w-1", status.accent)}
        aria-hidden
      />
      <CardContent
        className={cn(
          "flex flex-col pl-[calc(0.35rem+0.25rem)]",
          dense ? "gap-1.5 p-[var(--w-pad-sm)]" : "gap-2 p-[var(--w-pad-sm)]"
        )}
      >
        <div className="flex shrink-0 items-start gap-2.5">
          <div className="relative shrink-0">
            <Avatar className="size-[var(--w-avatar)] ring-2 ring-white/80">
              <AvatarFallback
                className={cn(
                  "text-[length:var(--w-label)] font-semibold",
                  status.avatar
                )}
              >
                {initials(row.naam)}
              </AvatarFallback>
            </Avatar>
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white",
                status.dot,
                inAppt && "animate-pulse"
              )}
              aria-hidden
            />
          </div>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <h3 className="min-w-0 truncate text-[length:var(--w-body)] font-semibold leading-tight text-ink">
              {row.naam}
            </h3>
            <Badge
              tone={status.badgeTone}
              className="shrink-0 rounded-full text-[length:var(--w-label)]"
            >
              <span
                className={cn("size-1.5 rounded-full", status.dot)}
                aria-hidden
              />
              {status.label}
            </Badge>
            {offer ? (
              <Badge
                tone={offer.tone === "positive" ? "positive" : "info"}
                className={cn(
                  "max-w-[7.5rem] shrink-0 rounded-full text-[length:var(--w-label)]",
                  offer.label === "Getekend" &&
                    "bg-emerald-600 text-white ring-emerald-700/30"
                )}
              >
                <offer.Icon className="size-3 shrink-0" aria-hidden />
                <span className="truncate">{offer.label}</span>
              </Badge>
            ) : null}
          </div>

          <div className="shrink-0 text-right leading-none">
            <p
              className={cn(
                "font-display text-[length:var(--w-kpi)] font-semibold tabular-nums",
                row.deals > 0 ? "text-teal-800" : "text-zinc-300"
              )}
            >
              {row.deals}
            </p>
            <p className="mt-0.5 text-[length:var(--w-label)] text-muted">
              getekend
            </p>
          </div>
        </div>

        <div className="min-w-0 shrink-0 rounded-lg bg-white/55 px-2.5 py-2 ring-1 ring-black/[0.03]">
          {detail ? (
            <div className="min-w-0 space-y-1">
              <div className="flex min-w-0 items-center gap-x-2 gap-y-0.5">
                {detail.leadNaam ? (
                  <p className="min-w-0 flex-1 truncate text-[length:var(--w-meta)] font-medium text-ink">
                    {detail.leadNaam}
                  </p>
                ) : null}
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 font-display text-[length:var(--w-body)] font-semibold tabular-nums leading-none",
                    status.clock
                  )}
                >
                  <Clock className="size-[0.9em]" aria-hidden />
                  {formatTime(detail.startAt)}
                  <span className="font-normal text-muted">–</span>
                  {formatTime(detail.endAt)}
                </span>
                <Badge
                  tone="neutral"
                  className="shrink-0 rounded-full text-[length:var(--w-label)]"
                >
                  {soortLabel(detail.soort)}
                </Badge>
              </div>
              {inAppt && offer?.label === "Getekend" ? (
                <p className="truncate text-[length:var(--w-label)] font-semibold text-emerald-700">
                  Offerte getekend
                </p>
              ) : null}
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-[length:var(--w-meta)] text-muted">
                {row.apptTotal > 0
                  ? "Geen openstaande afspraak meer"
                  : "Alleen deals, geen afspraken vandaag"}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function activityIconClass(kind: WallActivityKind): string {
  if (kind === "lead") return "bg-sky-50 text-sky-700 ring-sky-200";
  if (kind === "afspraak") return "bg-teal-50 text-teal-700 ring-teal-200";
  if (kind === "offerte") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (kind === "status") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (kind === "afboek") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (kind === "bel") return "bg-zinc-100 text-zinc-600 ring-zinc-200";
  if (kind === "backoffice") return "bg-sky-50 text-sky-800 ring-sky-200";
  if (kind === "factuur") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (kind === "betaling") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (kind === "inkoop") return "bg-zinc-100 text-zinc-700 ring-zinc-200";
  if (kind === "schouw") return "bg-sky-50 text-sky-700 ring-sky-200";
  if (kind === "installatie") return "bg-teal-50 text-teal-800 ring-teal-200";
  if (kind === "service") return "bg-orange-50 text-orange ring-orange-200";
  return "bg-zinc-100 text-zinc-600 ring-zinc-200";
}

function activityRailClass(kind: WallActivityKind): string {
  if (kind === "lead") return "bg-sky-400";
  if (kind === "afspraak") return "bg-teal-500";
  if (kind === "offerte") return "bg-emerald-500";
  if (kind === "status") return "bg-amber-500";
  if (kind === "afboek") return "bg-amber-500";
  if (kind === "backoffice") return "bg-sky-600";
  if (kind === "factuur") return "bg-amber-500";
  if (kind === "betaling") return "bg-emerald-500";
  if (kind === "schouw") return "bg-sky-500";
  if (kind === "installatie") return "bg-teal-600";
  if (kind === "service") return "bg-orange";
  return "bg-zinc-400";
}

function ActivityTimelineCard({
  event,
  isFirst,
  isLast,
}: {
  event: WallActivityEvent;
  isFirst: boolean;
  isLast: boolean;
}) {
  const meta = activityMeta(event.kind);
  const sub = [
    event.leadNaam,
    event.actorNaam ? `door ${event.actorNaam}` : null,
    !event.actorNaam && event.detail ? event.detail : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="relative flex w-[11.5rem] shrink-0 flex-col sm:w-[12.5rem]">
      <p className="mb-1 text-center font-display text-[length:var(--w-label)] font-semibold tabular-nums tracking-tight text-green-deeper">
        {formatTime(event.at)}
      </p>
      <div className="relative mb-1.5 flex h-6 items-center justify-center">
        <span
          className={cn(
            "absolute inset-y-1/2 left-0 right-1/2 h-px -translate-y-1/2",
            isFirst ? "bg-transparent" : "bg-gradient-to-r from-zinc-200 to-zinc-300"
          )}
          aria-hidden
        />
        <span
          className={cn(
            "absolute inset-y-1/2 left-1/2 right-0 h-px -translate-y-1/2",
            isLast ? "bg-transparent" : "bg-gradient-to-r from-zinc-300 to-zinc-200"
          )}
          aria-hidden
        />
        <span
          className={cn(
            "relative z-[1] flex size-6 items-center justify-center rounded-full ring-2 ring-white shadow-sm",
            activityIconClass(event.kind)
          )}
        >
          <meta.Icon className="size-3" aria-hidden />
        </span>
        <span
          className={cn(
            "absolute bottom-0 left-1/2 size-1 -translate-x-1/2 translate-y-0.5 rounded-full",
            activityRailClass(event.kind)
          )}
          aria-hidden
        />
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-col rounded-lg border border-zinc-200/80 bg-white/95 px-2.5 py-2 shadow-sm",
          isFirst && "ring-1 ring-teal-200/80"
        )}
      >
        <Badge
          tone={meta.tone}
          className="w-fit rounded-full text-[length:var(--w-label)]"
        >
          {meta.label}
        </Badge>
        <p className="mt-1 line-clamp-2 text-[length:var(--w-label)] font-semibold leading-snug text-ink">
          {event.titel}
        </p>
        <p className="mt-1 line-clamp-1 text-[length:var(--w-label)] leading-snug text-muted">
          {sub || "—"}
        </p>
      </div>
    </li>
  );
}

function LiveActivityTimeline({ events }: { events: WallActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <p
        className="flex flex-1 items-center text-[length:var(--w-meta)] text-muted"
        style={{ padding: "var(--w-pad)" }}
      >
        Nog geen gebeurtenissen vandaag
      </p>
    );
  }

  return (
    <div className="relative min-h-0">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-6 bg-gradient-to-r from-white to-transparent"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-8 bg-gradient-to-l from-white to-transparent"
        aria-hidden
      />
      <ol
        className="flex items-start gap-0 overflow-x-auto overflow-y-hidden scroll-smooth [scrollbar-width:thin]"
        style={{
          paddingInline: "var(--w-pad)",
          paddingTop: "0.35rem",
          paddingBottom: "0.45rem",
        }}
      >
        {events.map((ev, i) => (
          <ActivityTimelineCard
            key={ev.id}
            event={ev}
            isFirst={i === 0}
            isLast={i === events.length - 1}
          />
        ))}
      </ol>
    </div>
  );
}

function RailSection({
  title,
  count,
  countTone = "neutral",
  subtitle,
  children,
  empty,
  className,
}: {
  title: string;
  count?: number;
  countTone?: "neutral" | "teal" | "warn";
  subtitle?: string;
  children: ReactNode;
  empty?: boolean;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "flex min-h-0 flex-col overflow-hidden shadow-sm",
        className
      )}
      style={{ borderRadius: "var(--w-radius)" }}
    >
      <div
        className="shrink-0 border-b border-zinc-100"
        style={{
          paddingInline: "var(--w-pad)",
          paddingBlock: "var(--w-pad-sm)",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-[length:var(--w-body)] font-semibold tracking-tight text-ink">
            {title}
          </h3>
          {typeof count === "number" ? (
            <Badge
              tone={countTone}
              className="rounded-full text-[length:var(--w-label)]"
            >
              {count}
            </Badge>
          ) : null}
        </div>
        {subtitle ? (
          <p className="mt-0.5 text-[length:var(--w-label)] text-muted">
            {subtitle}
          </p>
        ) : null}
      </div>
      {empty ? (
        <p
          className="flex flex-1 items-center text-[length:var(--w-meta)] text-muted"
          style={{ padding: "var(--w-pad)" }}
        >
          {children}
        </p>
      ) : (
        children
      )}
    </Card>
  );
}

export function SalesCockpitWall({
  wall,
  liveUpdating,
  fullscreen,
  theme,
  onToggleFullscreen,
  onToggleTheme,
}: {
  wall: WallboardOverview | null | undefined;
  liveUpdating?: boolean;
  fullscreen: boolean;
  theme: "light" | "dark";
  onToggleFullscreen: () => void;
  onToggleTheme: () => void;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const advisorCount = wall?.advisors.length || 0;
  const advisorCols = useMemo(
    () => advisorGridCols(advisorCount),
    [advisorCount]
  );
  /** Weinig adviseurs: 2 kolommen + bredere rail met naast elkaar geplaatste panelen. */
  const fewAdvisors = advisorCount > 0 && advisorCount <= 6;
  const denseAdvisors = advisorCount > 6;

  const openCount = useMemo(
    () =>
      wall?.advisors.filter(
        (a) => a.liveStatus === "volgende" || a.liveStatus === "vrij"
      ).length ?? 0,
    [wall?.advisors]
  );

  if (!wall) {
    return (
      <div className="grid h-full min-h-0 flex-1 grid-cols-3 gap-4">
        <div className="col-span-2 animate-pulse rounded-2xl bg-line/40" />
        <div className="animate-pulse rounded-2xl bg-line/40" />
      </div>
    );
  }

  const week = wall.week;
  const pct = (value: number | null) =>
    value == null
      ? "—"
      : `${value.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--wash)]"
      style={{ ...WALL_VARS, gap: "var(--w-gap)" }}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 -z-10",
          theme === "dark"
            ? "bg-[radial-gradient(ellipse_at_top_left,rgba(62,207,106,0.12),transparent_48%),radial-gradient(ellipse_at_bottom_right,rgba(56,189,248,0.08),transparent_42%)]"
            : "bg-[radial-gradient(ellipse_at_top_left,rgba(26,138,62,0.06),transparent_45%),radial-gradient(ellipse_at_bottom_right,rgba(14,165,233,0.04),transparent_40%)]"
        )}
        aria-hidden
      />

      <header className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <h2 className="font-display text-[length:var(--w-title)] font-semibold leading-none tracking-tight text-green-deeper">
            Sales floor
          </h2>
          <Badge
            tone={liveUpdating ? "teal" : "neutral"}
            className="rounded-full uppercase tracking-[0.12em] text-[length:var(--w-label)]"
          >
            <Radio
              className={cn("size-3", liveUpdating && "animate-pulse")}
              aria-hidden
            />
            Live
          </Badge>
          <p className="text-[length:var(--w-meta)] capitalize text-muted">
            {formatClock(now)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5 rounded-xl px-2.5 text-[length:var(--w-label)] shadow-sm sm:h-9 sm:px-3",
              theme === "dark"
                ? "border-line bg-[var(--white)] text-ink hover:bg-[#1a2822]"
                : "bg-white/90"
            )}
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Lichtmodus" : "Donkere modus"}
          >
            {theme === "dark" ? (
              <Sun className="size-3.5" />
            ) : (
              <Moon className="size-3.5" />
            )}
            <span className="hidden sm:inline">
              {theme === "dark" ? "Light" : "Dark"}
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5 rounded-xl px-2.5 text-[length:var(--w-label)] shadow-sm sm:h-9 sm:px-3",
              theme === "dark"
                ? "border-line bg-[var(--white)] text-ink hover:bg-[#1a2822]"
                : "bg-white/90"
            )}
            onClick={onToggleFullscreen}
            aria-label={
              fullscreen ? "Volledig scherm verlaten" : "Volledig scherm"
            }
          >
            {fullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
            <span className="hidden sm:inline">
              {fullscreen ? "Venster" : "TV-modus"}
            </span>
          </Button>
        </div>
      </header>

      {/* KPI-band — gelijke panel- en tegelhoogte */}
      <div className="grid shrink-0 items-stretch gap-[var(--w-gap)] xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.3fr)]">
        <Card
          className="flex h-full min-h-0 flex-col overflow-hidden shadow-sm"
          style={{ borderRadius: "var(--w-radius)" }}
        >
          <CardHeader
            className="shrink-0 gap-1 border-b border-zinc-100"
            style={{
              paddingInline: "var(--w-pad)",
              paddingTop: "var(--w-pad-sm)",
              paddingBottom: "var(--w-pad-sm)",
            }}
          >
            <div className="flex h-7 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                  <Handshake className="size-3.5" aria-hidden />
                </span>
                <CardTitle className="truncate font-display text-[length:var(--w-body)] text-green-deeper">
                  Resultaat vandaag
                </CardTitle>
              </div>
              <Badge
                tone="teal"
                className="shrink-0 rounded-full text-[length:var(--w-label)]"
              >
                Vandaag
              </Badge>
            </div>
            <CardDescription className="line-clamp-1 min-h-[1.1em] text-[length:var(--w-label)]">
              Deals, instroom en planning tot nu toe
            </CardDescription>
          </CardHeader>
          <CardContent
            className="flex min-h-0 flex-1 flex-col p-0"
            style={{
              paddingInline: "var(--w-pad)",
              paddingTop: "var(--w-pad-sm)",
              paddingBottom: "var(--w-pad)",
            }}
          >
            <div className="mb-2 flex h-6 shrink-0 items-center">
              <Badge
                tone="teal"
                className="rounded-full text-[length:var(--w-label)]"
              >
                Overzicht
              </Badge>
            </div>
            <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-4">
              <WallKpiTile
                label="Deals"
                value={wall.deals}
                hint="getekend"
                accent="teal"
                icon={<CheckCircle2 className="size-3.5" aria-hidden />}
              />
              <WallKpiTile
                label="Orderwaarde"
                value={formatEuroCompact(wall.orderwaardeEx)}
                hint="ex btw"
                accent="emerald"
                icon={<Banknote className="size-3.5" aria-hidden />}
              />
              <WallKpiTile
                label="Leads binnen"
                value={wall.leadsToday}
                hint="nieuw vandaag"
                accent="sky"
                icon={<UserPlus className="size-3.5" aria-hidden />}
              />
              <WallKpiTile
                label="Ingepland"
                value={wall.scheduledToday}
                hint="afspraken"
                accent="amber"
                icon={<CalendarPlus className="size-3.5" aria-hidden />}
              />
            </div>
          </CardContent>
        </Card>

        <Card
          className="flex h-full min-h-0 flex-col overflow-hidden shadow-sm"
          style={{ borderRadius: "var(--w-radius)" }}
        >
          <CardHeader
            className="shrink-0 gap-1 border-b border-zinc-100"
            style={{
              paddingInline: "var(--w-pad)",
              paddingTop: "var(--w-pad-sm)",
              paddingBottom: "var(--w-pad-sm)",
            }}
          >
            <div className="flex h-7 items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                  <TrendingUp className="size-3.5" aria-hidden />
                </span>
                <CardTitle className="truncate font-display text-[length:var(--w-body)] text-green-deeper">
                  Deze week
                </CardTitle>
              </div>
              <Badge
                tone="neutral"
                className="max-w-[12rem] shrink-0 truncate rounded-full text-[length:var(--w-label)]"
              >
                {week.label}
              </Badge>
            </div>
            <CardDescription className="line-clamp-1 min-h-[1.1em] text-[length:var(--w-label)]">
              Salesresultaat en bel-conversie
            </CardDescription>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col p-0">
            <div className="grid min-h-0 flex-1 items-stretch sm:grid-cols-[1.2fr_auto_1fr]">
              <div
                className="flex min-h-0 flex-col"
                style={{
                  paddingInline: "var(--w-pad)",
                  paddingTop: "var(--w-pad-sm)",
                  paddingBottom: "var(--w-pad)",
                }}
              >
                <div className="mb-2 flex h-6 shrink-0 items-center">
                  <Badge
                    tone="teal"
                    className="rounded-full text-[length:var(--w-label)]"
                  >
                    Resultaat
                  </Badge>
                </div>
                <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-3 gap-2">
                  <WallKpiTile
                    label="Sales"
                    value={week.deals}
                    hint={`${formatEuroCompact(week.orderwaardeEx)} ex`}
                    accent="teal"
                    icon={<Handshake className="size-3.5" aria-hidden />}
                  />
                  <WallKpiTile
                    label="Aanbetalingen"
                    value={formatEuroCompact(week.aanbetalingenInc)}
                    hint="ontvangen"
                    accent="emerald"
                    icon={<Banknote className="size-3.5" aria-hidden />}
                  />
                  <WallKpiTile
                    label="Salesconversie"
                    value={pct(week.salesConversiePct)}
                    hint={
                      week.gelopenNieuw > 0
                        ? `${week.salesFromGelopen}/${week.gelopenNieuw} gelopen`
                        : "nieuw → deal"
                    }
                    accent="emerald"
                    progress={week.salesConversiePct}
                    icon={<TrendingUp className="size-3.5" aria-hidden />}
                  />
                </div>
              </div>
              <Separator orientation="vertical" className="hidden sm:block" />
              <Separator className="sm:hidden" />
              <div
                className="flex min-h-0 flex-col"
                style={{
                  paddingInline: "var(--w-pad)",
                  paddingTop: "var(--w-pad-sm)",
                  paddingBottom: "var(--w-pad)",
                }}
              >
                <div className="mb-2 flex h-6 shrink-0 items-center">
                  <Badge
                    tone="warn"
                    className="rounded-full text-[length:var(--w-label)]"
                  >
                    <Phone className="size-3" aria-hidden />
                    Bellen
                  </Badge>
                </div>
                <div className="grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-2">
                  <WallKpiTile
                    label="Lead → afspraak"
                    value={pct(week.belConversiePct)}
                    hint={
                      week.gebeld > 0
                        ? `${week.belIngepland}/${week.gebeld} excl. nieuw`
                        : "bel-conversie"
                    }
                    accent="orange"
                    progress={week.belConversiePct}
                    icon={<PhoneCall className="size-3.5" aria-hidden />}
                  />
                  <WallKpiTile
                    label="Nieuwe afspraken"
                    value={week.nieuwIngepland}
                    hint="eerste huisbezoeken"
                    accent="amber"
                    icon={<CalendarPlus className="size-3.5" aria-hidden />}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1 overflow-hidden",
          fewAdvisors
            ? "xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]"
            : "xl:grid-cols-[minmax(0,1fr)_minmax(18rem,min(34%,24rem))]"
        )}
        style={{ gap: "var(--w-gap)" }}
      >
        <section
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ gap: "var(--w-pad-sm)" }}
        >
          <div className="flex shrink-0 items-center justify-between gap-3">
            <h3 className="font-display text-[length:var(--w-body)] font-semibold tracking-tight text-green-deeper sm:text-[length:var(--w-title)]">
              Adviseurs live
            </h3>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge
                tone="teal"
                className="rounded-full text-[length:var(--w-label)]"
              >
                {wall.advisorsInAppt} bezig
              </Badge>
              <Badge
                tone="neutral"
                className="rounded-full text-[length:var(--w-label)]"
              >
                {openCount} open
              </Badge>
            </div>
          </div>

          {wall.advisors.length === 0 ? (
            <Card
              className="flex shrink-0 items-center justify-center border-dashed bg-white/60 py-6 text-[length:var(--w-meta)] text-muted"
              style={{ borderRadius: "var(--w-radius)" }}
            >
              Geen adviseurs met afspraken of deals vandaag
            </Card>
          ) : (
            <div
              className="grid min-h-0 flex-1 content-start items-start overflow-y-auto"
              style={{
                gridTemplateColumns: `repeat(${advisorCols}, minmax(0, 1fr))`,
                gap: "var(--w-pad-sm)",
                alignContent: "start",
              }}
            >
              {wall.advisors.map((row) => (
                <AdvisorCard
                  key={row.id}
                  row={row}
                  dense={denseAdvisors}
                />
              ))}
            </div>
          )}

          <Card
            className="flex shrink-0 flex-col overflow-hidden shadow-sm"
            style={{ borderRadius: "var(--w-radius)" }}
          >
            <div
              className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-100"
              style={{
                paddingInline: "var(--w-pad)",
                paddingBlock: "0.35rem",
              }}
            >
              <div className="min-w-0">
                <h3 className="font-display text-[length:var(--w-meta)] font-semibold tracking-tight text-ink">
                  Live log
                </h3>
              </div>
              <Badge
                tone="neutral"
                className="shrink-0 rounded-full text-[length:var(--w-label)]"
              >
                {wall.activity.length}
              </Badge>
            </div>
            <LiveActivityTimeline events={wall.activity} />
          </Card>
        </section>

        <aside className="flex min-h-0 flex-col overflow-hidden self-stretch">
          {wall.topAdvisors.length === 0 ? (
            <RailSection
              title="Adviseurs leaderboard"
              subtitle={week.label}
              empty
              className="h-full min-h-0"
            >
              Nog geen weekresultaten
            </RailSection>
          ) : (
            <RailSection
              title="Adviseurs leaderboard"
              subtitle={week.label}
              count={wall.topAdvisors.length}
              countTone="teal"
              className="h-full min-h-0"
            >
              <ol className="min-h-0 flex-1 overflow-auto">
                {wall.topAdvisors.map((a, i) => (
                  <li key={a.id}>
                    {i > 0 ? <Separator /> : null}
                    <div
                      className="flex items-start gap-3"
                      style={{
                        paddingInline: "var(--w-pad)",
                        paddingBlock: "var(--w-pad-sm)",
                      }}
                    >
                      <span
                        className={cn(
                          "mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-[length:var(--w-label)] font-bold tabular-nums",
                          a.rank === 1 && "bg-amber-100 text-amber-800",
                          a.rank === 2 && "bg-zinc-100 text-zinc-700",
                          a.rank === 3 && "bg-orange-100 text-orange-800",
                          a.rank > 3 && "bg-zinc-50 text-zinc-500"
                        )}
                      >
                        {a.rank}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 truncate pt-0.5 text-[length:var(--w-body)] font-semibold text-ink">
                            {a.naam}
                          </p>
                          <div className="shrink-0 text-right leading-none">
                            <p
                              className={cn(
                                "font-display text-[length:var(--w-kpi)] font-semibold tabular-nums",
                                a.deals > 0 ? "text-teal-700" : "text-zinc-300"
                              )}
                            >
                              {a.deals}
                            </p>
                            <p className="mt-0.5 text-[length:var(--w-label)] uppercase tracking-wide text-muted">
                              deals
                            </p>
                          </div>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-zinc-50/80 px-2.5 py-2">
                          <div className="min-w-0">
                            <p className="text-[length:var(--w-label)] text-muted">
                              Conv.
                            </p>
                            <p className="truncate font-semibold tabular-nums text-[length:var(--w-meta)] text-ink">
                              {pct(a.conversionNieuwGelopenSalePct)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[length:var(--w-label)] text-muted">
                              OW
                            </p>
                            <p className="truncate font-semibold tabular-nums text-[length:var(--w-meta)] text-ink">
                              {formatEuroCompact(a.orderwaardeEx)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[length:var(--w-label)] text-muted">
                              Gelopen
                            </p>
                            <p className="truncate font-semibold tabular-nums text-[length:var(--w-meta)] text-ink">
                              {a.gelopen}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </RailSection>
          )}
        </aside>
      </div>
    </div>
  );
}
