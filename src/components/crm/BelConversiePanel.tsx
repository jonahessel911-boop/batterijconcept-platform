"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import Link from "next/link";
import type {
  BelConversieRecenteAfspraak,
  BelConversieSeriesBucket,
  BelConversieSeriesGranularity,
  BelConversieTargets,
} from "@/lib/bel-conversie";
import {
  conversieMonthRangeContaining,
  conversieWeekRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import { formatDateTimeNl } from "@/lib/format";
import { normalizeLeadSource } from "@/lib/lead-conversie";
import {
  agendaWeekJumpOptions,
  formatSchouwWeekLabel,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { useCrmSession } from "@/hooks/useCrmSession";
import { BelSlotsCompactView } from "./BelSlotsCompactView";

type BelConversieBellerOption = {
  id: string;
  naam: string;
  gebeld: number;
};

type BelConversieData = {
  date: string;
  periodLabel?: string;
  periodDays?: number;
  totals: {
    gebeld: number;
    ingepland: number;
    geannuleerd?: number;
    annuleringsPct?: number | null;
    leadToAppt: number | null;
    nonNieuwGebeld?: number;
    nonNieuwIngepland?: number;
    nonNieuwLeadToAppt?: number | null;
  };
  lockBeller?: boolean;
  targets?: BelConversieTargets;
  recenteAfspraken?: BelConversieRecenteAfspraak[];
  series?: BelConversieSeriesBucket[];
  seriesGranularity?: BelConversieSeriesGranularity;
  bellerOptions?: BelConversieBellerOption[];
  bellerId?: string | null;
};

const ANNULERING_COLOR = "#C45A12";

type ViewMode = "week" | "month";

/** Kleuren in de dikke gestapelde balk (hoogte = gebeld + uitval). */
const STACK_SEGMENTS = [
  { key: "ingepland" as const, label: "Ingepland", color: "#1a8a3e" },
  { key: "geenInteresse" as const, label: "Geen interesse", color: "#C62828" },
  { key: "geenContact" as const, label: "Geen contact", color: "#64748b" },
  {
    key: "geannuleerd" as const,
    label: "Annuleringen (uitval)",
    color: ANNULERING_COLOR,
  },
] as const;

const OVERIG_COLOR = "#D5DDD7";

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function monthInputValue(ymd: string): string {
  return ymd.slice(0, 7);
}

function ymdFromMonthInput(ym: string): string {
  const m = /^\d{4}-\d{2}$/.test(ym) ? ym : todayConversieYmd().slice(0, 7);
  return `${m}-01`;
}

function barSegments(b: BelConversieSeriesBucket): {
  key: string;
  label: string;
  color: string;
  value: number;
}[] {
  const geannuleerd = b.geannuleerd || 0;
  const known = b.ingepland + b.geenInteresse + b.geenContact;
  const overig = Math.max(0, b.gebeld - known);
  const parts: {
    key: string;
    label: string;
    color: string;
    value: number;
  }[] = [
    {
      key: "ingepland",
      label: "Ingepland",
      color: STACK_SEGMENTS[0].color,
      value: b.ingepland,
    },
    {
      key: "geenInteresse",
      label: "Geen interesse",
      color: STACK_SEGMENTS[1].color,
      value: b.geenInteresse,
    },
    {
      key: "geenContact",
      label: "Geen contact",
      color: STACK_SEGMENTS[2].color,
      value: b.geenContact,
    },
  ];
  if (overig > 0) {
    parts.push({
      key: "overig",
      label: "Overig gebeld",
      color: OVERIG_COLOR,
      value: overig,
    });
  }
  if (geannuleerd > 0) {
    parts.push({
      key: "geannuleerd",
      label: "Annuleringen",
      color: STACK_SEGMENTS[3].color,
      value: geannuleerd,
    });
  }
  return parts;
}

/** Staafhoogte = gebeld + uitval (annuleringen zijn extra bovenop bel-uitkomsten). */
function barTotal(b: BelConversieSeriesBucket): number {
  return Math.max(0, b.gebeld + (b.geannuleerd || 0));
}

function BelSeriesChart({
  series,
  granularity,
}: {
  series: BelConversieSeriesBucket[];
  granularity: BelConversieSeriesGranularity;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hoverBi, setHoverBi] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);

  const maxTotaal = useMemo(() => {
    let m = 0;
    for (const b of series) {
      m = Math.max(m, barTotal(b), b.doel || 0, b.ingepland);
    }
    return Math.max(1, m);
  }, [series]);

  /** Eén horizontale doellijn als alle buckets hetzelfde doel hebben. */
  const sharedDoel = useMemo(() => {
    const doelen = series.map((b) => b.doel || 0).filter((d) => d > 0);
    if (doelen.length === 0) return null;
    const first = doelen[0];
    return doelen.every((d) => d === first) ? first : null;
  }, [series]);

  const tip = hoverBi != null ? series[hoverBi] ?? null : null;

  function updateTipPos(e: MouseEvent) {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setTipPos({
      x: e.clientX - r.left,
      y: e.clientY - r.top,
    });
  }

  function clearTip() {
    setHoverBi(null);
    setTipPos(null);
  }

  if (series.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted">
        Geen bel-activiteit in deze periode.
      </p>
    );
  }

  // Tooltip iets rechts/onder de cursor; dicht bij rechterrand → links van cursor
  const tipStyle =
    tip && tipPos
      ? (() => {
          const w = wrapRef.current?.clientWidth ?? 400;
          const flipLeft = tipPos.x > w * 0.62;
          return {
            left: tipPos.x,
            top: Math.max(8, tipPos.y - 8),
            transform: flipLeft
              ? "translate(-100%, -100%) translateX(-10px)"
              : "translateY(-100%) translateX(12px)",
          } as const;
        })()
      : null;

  const doelLinePct =
    sharedDoel != null && sharedDoel > 0
      ? (sharedDoel / maxTotaal) * 100
      : null;

  return (
    <div>
      <div ref={wrapRef} className="relative" onMouseLeave={clearTip}>
        {/* L→A % boven de plot */}
        <div className="mb-1 flex justify-around gap-3 px-1 sm:gap-4">
          {series.map((b) => (
            <div
              key={`l2a-${b.key}`}
              className="min-w-[3.75rem] flex-1 text-center sm:min-w-[4.5rem]"
            >
              <p
                className="text-[11px] font-semibold tabular-nums text-green-dark"
                title="Lead to appointment %"
              >
                {b.leadToAppt != null ? `${num(b.leadToAppt, 1)}%` : "—"}
              </p>
            </div>
          ))}
        </div>

        {/* Plot: staven + doellijn delen dezelfde hoogte-schaal */}
        <div className="relative flex h-56 items-end justify-around gap-3 px-1 sm:h-64 sm:gap-4">
          {doelLinePct != null ? (
            <div
              className="pointer-events-none absolute inset-x-0 z-20"
              style={{ bottom: `${doelLinePct}%` }}
            >
              <div className="border-t-2 border-dashed border-[#C45A12]" />
              <span className="absolute -top-5 right-0 rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-[#C45A12] shadow-sm">
                Doel {num(sharedDoel)}
              </span>
            </div>
          ) : null}

          {series.map((b, bi) => {
            const totaal = barTotal(b);
            const barH = Math.max(
              totaal > 0 ? 8 : 0,
              (totaal / maxTotaal) * 100
            );
            const segments = barSegments(b);
            const tickPct =
              sharedDoel == null && (b.doel || 0) > 0
                ? (b.doel / maxTotaal) * 100
                : null;
            return (
              <div
                key={b.key}
                className="relative flex h-full min-w-[3.75rem] flex-1 flex-col items-center justify-end sm:min-w-[4.5rem]"
                onMouseEnter={(e) => {
                  setHoverBi(bi);
                  updateTipPos(e);
                }}
                onMouseMove={(e) => {
                  setHoverBi(bi);
                  updateTipPos(e);
                }}
              >
                {tickPct != null ? (
                  <div
                    className="pointer-events-none absolute left-0 right-0 z-10 border-t-2 border-dashed border-[#C45A12]"
                    style={{ bottom: `${tickPct}%` }}
                  />
                ) : null}
                <div
                  className="relative z-[1] flex w-full max-w-[4.5rem] cursor-pointer flex-col-reverse overflow-hidden rounded-t-lg shadow-sm sm:max-w-[5.5rem]"
                  style={{
                    height: `${barH}%`,
                    minHeight: totaal > 0 ? 8 : 0,
                  }}
                >
                  {segments.map((seg) => {
                    if (seg.value <= 0 || totaal <= 0) return null;
                    return (
                      <div
                        key={seg.key}
                        className="w-full"
                        style={{
                          height: `${(seg.value / totaal) * 100}%`,
                          minHeight: seg.value > 0 ? 4 : 0,
                          background: seg.color,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Totalen + daglabels onder de plot */}
        <div className="mt-1.5 flex justify-around gap-3 px-1 sm:gap-4">
          {series.map((b) => (
            <div
              key={`lbl-${b.key}`}
              className="min-w-[3.75rem] flex-1 text-center sm:min-w-[4.5rem]"
            >
              <p className="text-[11px] font-semibold tabular-nums text-ink">
                {barTotal(b) > 0 ? num(barTotal(b)) : ""}
              </p>
              <p
                className="mt-0.5 w-full truncate text-[10px] font-medium text-muted"
                title={b.label}
              >
                {granularity === "day"
                  ? b.label.replace(/\.$/, "")
                  : b.label.split(" · ")[0] || b.label}
              </p>
            </div>
          ))}
        </div>

        {tip && tipStyle ? (
          <div
            className="pointer-events-none absolute z-30 w-max max-w-[14rem] rounded-xl border border-line bg-white px-3 py-2.5 text-xs shadow-lg"
            style={tipStyle}
          >
            <p className="font-semibold text-ink">{tip.label}</p>
            <ul className="mt-1.5 space-y-1 tabular-nums text-ink">
              <li>
                <span className="text-muted">Gebeld</span>{" "}
                <span className="font-semibold">{num(tip.gebeld)}</span>
              </li>
              <li>
                <span
                  className="inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ background: STACK_SEGMENTS[0].color }}
                />{" "}
                Ingepland{" "}
                <span className="font-semibold">{num(tip.ingepland)}</span>
              </li>
              {(tip.doel || 0) > 0 ? (
                <li>
                  <span className="text-muted">Doel</span>{" "}
                  <span className="font-semibold text-[#C45A12]">
                    {num(tip.doel)}
                  </span>
                </li>
              ) : null}
              <li>
                Lead to appointment{" "}
                <span className="font-semibold text-green-dark">
                  {tip.leadToAppt != null ? `${num(tip.leadToAppt, 1)}%` : "—"}
                </span>
              </li>
              <li>
                <span
                  className="inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ background: STACK_SEGMENTS[1].color }}
                />{" "}
                Geen interesse{" "}
                <span className="font-semibold">{num(tip.geenInteresse)}</span>
              </li>
              <li>
                <span
                  className="inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ background: STACK_SEGMENTS[2].color }}
                />{" "}
                Geen contact{" "}
                <span className="font-semibold">{num(tip.geenContact)}</span>
              </li>
              <li>
                <span
                  className="inline-block h-2 w-2 rounded-sm align-middle"
                  style={{ background: ANNULERING_COLOR }}
                />{" "}
                Annuleringen{" "}
                <span className="font-semibold text-[#C45A12]">
                  {num(tip.geannuleerd)}
                  {tip.annuleringsPct != null
                    ? ` (${num(tip.annuleringsPct, 1)}%)`
                    : ""}
                </span>
              </li>
            </ul>
          </div>
        ) : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-[11px] text-muted">
        {STACK_SEGMENTS.map((m) => (
          <span key={m.key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ background: m.color }}
            />
            {m.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-sm"
            style={{ background: OVERIG_COLOR }}
          />
          Overig gebeld
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-[#C45A12]" />
          Doel (ingepland)
        </span>
      </div>
    </div>
  );
}

export function BelConversiePanel() {
  const { session, rol } = useCrmSession();
  const today = todayConversieYmd();
  const [mode, setMode] = useState<ViewMode>("week");
  const [anchorYmd, setAnchorYmd] = useState(today);
  /** Leeg = alle bellers */
  const [bellerId, setBellerId] = useState("");
  const [bellerOptions, setBellerOptions] = useState<
    BelConversieBellerOption[]
  >([]);
  const [data, setData] = useState<BelConversieData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const lockBeller = Boolean(data?.lockBeller) || rol === "beller";

  const weekOptions = useMemo(() => {
    const base = agendaWeekJumpOptions(26, 4);
    const cur = schouwWeekFromDate(`${anchorYmd}T12:00:00`);
    const key = schouwWeekValue(cur.jaar, cur.week);
    if (key && !base.some((o) => o.value === key)) {
      return [
        {
          value: key,
          label: formatSchouwWeekLabel(cur.jaar, cur.week),
          jaar: cur.jaar,
          week: cur.week,
        },
        ...base,
      ];
    }
    return base;
  }, [anchorYmd]);

  const selectedWeekKey = useMemo(() => {
    const cur = schouwWeekFromDate(`${anchorYmd}T12:00:00`);
    return schouwWeekValue(cur.jaar, cur.week);
  }, [anchorYmd]);

  const range = useMemo(() => {
    return mode === "week"
      ? conversieWeekRangeContaining(anchorYmd)
      : conversieMonthRangeContaining(anchorYmd);
  }, [mode, anchorYmd]);

  const granularity: BelConversieSeriesGranularity =
    mode === "week" ? "day" : "week";

  const load = useCallback(
    async (
      from: string,
      to: string,
      gran: BelConversieSeriesGranularity,
      filterBellerId: string
    ) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          from,
          to,
          granularity: gran,
        });
        if (filterBellerId) qs.set("beller_id", filterBellerId);
        const res = await fetch(`/api/rapportage/bel-conversie?${qs}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error || "Laden mislukt"
          );
        }
        const payload = json as BelConversieData;
        setData(payload);
        if (payload.lockBeller && payload.bellerId) {
          setBellerId(payload.bellerId);
        }
        if (payload.bellerOptions) {
          setBellerOptions(payload.bellerOptions);
          // Alleen beller/backoffice in de lijst — reset filter als selectie wegvalt
          if (
            !payload.lockBeller &&
            filterBellerId &&
            !payload.bellerOptions.some((b) => b.id === filterBellerId)
          ) {
            setBellerId("");
          }
        }
      } catch (e) {
        setData(null);
        setError(e instanceof Error ? e.message : "Fout");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (rol === "beller" && session?.id && !bellerId) {
      setBellerId(session.id);
      return;
    }
    void load(range.startYmd, range.endYmd, granularity, bellerId);
  }, [
    range.startYmd,
    range.endYmd,
    granularity,
    bellerId,
    load,
    rol,
    session?.id,
  ]);

  const totals = data?.totals;
  const series = data?.series || [];
  const afspraken = data?.recenteAfspraken || [];
  const rangeLabel =
    data?.periodLabel ||
    (range.startYmd === range.endYmd
      ? range.startYmd
      : `${range.startYmd} → ${range.endYmd}`);

  const seriesSums = useMemo(() => {
    let geenInteresse = 0;
    let geenContact = 0;
    let ingepland = 0;
    let geannuleerd = 0;
    let doel = 0;
    for (const b of series) {
      geenInteresse += b.geenInteresse;
      geenContact += b.geenContact;
      ingepland += b.ingepland;
      geannuleerd += b.geannuleerd || 0;
      doel += b.doel || 0;
    }
    const uitval =
      geannuleerd + ingepland > 0
        ? Math.round((geannuleerd / (geannuleerd + ingepland)) * 1000) / 10
        : null;
    return { geenInteresse, geenContact, ingepland, geannuleerd, annuleringsPct: uitval, doel };
  }, [series]);

  /**
   * Weekdoel = dagoel × 5 (tempo om 2 weken vol te plannen).
   * Dagoel = vrije slots over horizon ÷ werkdagen (+20% uitval), evt. hoger bij inhaal.
   */
  const weekTarget = useMemo(() => {
    const t = data?.targets;
    const doel = Math.round(t?.doelDezeWeek ?? 0);
    const gepland = Math.round(
      t?.geplandDezeWeek ?? seriesSums.ingepland ?? totals?.ingepland ?? 0
    );
    if (doel <= 0 && gepland <= 0) return null;
    const pct =
      t?.pctDezeWeek != null
        ? t.pctDezeWeek
        : doel > 0
          ? Math.min(100, Math.round((gepland / doel) * 100))
          : gepland > 0
            ? 100
            : 0;
    const gehaald =
      t?.finishDezeWeek != null
        ? t.finishDezeWeek
        : doel > 0
          ? gepland >= doel
          : false;
    return { doel, gepland, pct, gehaald };
  }, [data?.targets, seriesSums.ingepland, totals?.ingepland]);

  const dayTarget = useMemo(() => {
    const t = data?.targets;
    if (!t) return null;
    const doel = Math.round(t.doelVandaag ?? 0);
    const gepland = Math.round(t.geplandVandaag ?? 0);
    if (doel <= 0 && gepland <= 0) return null;
    return {
      doel,
      gepland,
      pct: t.pctVandaag ?? 0,
      gehaald: Boolean(t.finishVandaag),
      resterendeDagen: t.resterendeWerkdagenWeek ?? 0,
      nogDezeWeek: t.nogDezeWeek ?? 0,
    };
  }, [data?.targets]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            Bel conversie
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Één staaf per {mode === "week" ? "dag" : "week"}
            {lockBeller
              ? ` · ${session?.naam || "jouw belpogingen"}`
              : bellerId
                ? ` · ${bellerOptions.find((b) => b.id === bellerId)?.naam || "beller"}`
                : " · alle bellers"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            {(
              [
                ["week", "Week (per dag)"],
                ["month", "Maand (per week)"],
              ] as const
            ).map(([id, label]) => {
              const active = mode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={[
                    "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                    active
                      ? "bg-[#0a4727] text-white"
                      : "border border-line bg-white text-muted hover:bg-wash hover:text-ink",
                  ].join(" ")}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2">
            {!lockBeller ? (
              <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Beller
                <select
                  value={bellerId}
                  onChange={(e) => setBellerId(e.target.value)}
                  className="min-w-[10rem] border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
                >
                  <option value="">Alle</option>
                  {bellerOptions.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.naam}
                      {b.gebeld > 0 ? ` (${b.gebeld})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {mode === "week" ? (
              <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Week
                <select
                  value={selectedWeekKey}
                  onChange={(e) => {
                    const parsed = parseSchouwWeekValue(e.target.value);
                    if (!parsed) return;
                    const monday = String(
                      schouwWeekToMondayIso(parsed.jaar, parsed.week)
                    ).slice(0, 10);
                    setAnchorYmd(monday || today);
                  }}
                  className="min-w-[14rem] border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
                >
                  {weekOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Maand
                <input
                  type="month"
                  value={monthInputValue(anchorYmd)}
                  onChange={(e) =>
                    setAnchorYmd(ymdFromMonthInput(e.target.value))
                  }
                  className="border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
                />
              </label>
            )}
          </div>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}{" "}
          <button
            type="button"
            onClick={() =>
              void load(range.startYmd, range.endYmd, granularity, bellerId)
            }
            className="font-semibold underline"
          >
            Opnieuw
          </button>
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : data ? (
        <>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-8">
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Totaal
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
                {num(totals?.gebeld)}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Ingepland
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
                {num(totals?.ingepland)}
              </p>
            </div>
            <div
              className={[
                "rounded-2xl border bg-white p-4",
                weekTarget?.gehaald
                  ? "border-green/40"
                  : "border-line",
              ].join(" ")}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                {mode === "week" ? "Weekdoel" : "Periodedoel"}
              </p>
              <p
                className={[
                  "mt-1 font-display text-3xl font-semibold tabular-nums",
                  weekTarget?.gehaald ? "text-green-dark" : "text-ink",
                ].join(" ")}
              >
                {weekTarget
                  ? `${num(weekTarget.gepland)}/${num(weekTarget.doel)}`
                  : "—"}
              </p>
              <p
                className={[
                  "mt-1 text-xs font-semibold",
                  weekTarget == null
                    ? "text-muted"
                    : weekTarget.gehaald
                      ? "text-green-dark"
                      : "text-[#C45A12]",
                ].join(" ")}
              >
                {weekTarget == null
                  ? "—"
                  : weekTarget.gehaald
                    ? `Gehaald · ${num(weekTarget.pct)}%`
                    : `Nog niet · ${num(weekTarget.pct)}%`}
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                Tempo 2 weken vol · dagoel × 5
              </p>
            </div>
            <div
              className={[
                "rounded-2xl border bg-white p-4",
                dayTarget?.gehaald ? "border-green/40" : "border-line",
              ].join(" ")}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Dagoel
              </p>
              <p
                className={[
                  "mt-1 font-display text-3xl font-semibold tabular-nums",
                  dayTarget?.gehaald ? "text-green-dark" : "text-ink",
                ].join(" ")}
              >
                {dayTarget
                  ? `${num(dayTarget.gepland)}/${num(dayTarget.doel)}`
                  : "—"}
              </p>
              <p
                className={[
                  "mt-1 text-xs font-semibold",
                  dayTarget == null
                    ? "text-muted"
                    : dayTarget.gehaald
                      ? "text-green-dark"
                      : "text-[#C45A12]",
                ].join(" ")}
              >
                {dayTarget == null
                  ? "—"
                  : dayTarget.gehaald
                    ? `Gehaald · ${num(dayTarget.pct)}%`
                    : `Nog niet · ${num(dayTarget.pct)}%`}
              </p>
              <p className="mt-0.5 text-[10px] text-muted">
                {data?.targets?.horizonNog != null && data.targets.horizonNog > 0
                  ? `${num(data.targets.horizonNog)} vrij t/m +2 wkn · +20% uitval`
                  : dayTarget && dayTarget.resterendeDagen > 0
                    ? `Restant week ÷ ${dayTarget.resterendeDagen} dag${dayTarget.resterendeDagen === 1 ? "" : "en"}`
                    : "Tempo om horizon vol te plannen"}
              </p>
            </div>
            <div className="rounded-2xl border border-green/30 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Lead to appointment
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-green-dark">
                {totals?.nonNieuwLeadToAppt != null
                  ? `${num(totals.nonNieuwLeadToAppt, 1)}%`
                  : "—"}
              </p>
            </div>
            <div className="rounded-2xl border border-[#C45A12]/25 bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Uitval
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-[#C45A12]">
                {(totals?.geannuleerd ?? seriesSums.geannuleerd) > 0
                  ? num(totals?.geannuleerd ?? seriesSums.geannuleerd)
                  : "—"}
              </p>
              <p className="mt-1 text-xs font-semibold text-muted">
                {(totals?.annuleringsPct ?? seriesSums.annuleringsPct) != null
                  ? `${num(
                      totals?.annuleringsPct ?? seriesSums.annuleringsPct,
                      1
                    )}% van geplaatst`
                  : "Geen annuleringen"}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Geen interesse
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
                {num(seriesSums.geenInteresse)}
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Geen contact
              </p>
              <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-ink">
                {num(seriesSums.geenContact)}
              </p>
            </div>
          </div>

          <BelSlotsCompactView days={14} />

          <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {mode === "week" ? "Per dag" : "Per week"}
                </p>
              </div>
              {loading ? (
                <span className="text-xs text-muted">Vernieuwen…</span>
              ) : null}
            </div>
            <BelSeriesChart series={series} granularity={granularity} />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Detail per {mode === "week" ? "dag" : "week"}
              </p>
            </div>
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-semibold">Periode</th>
                  <th className="px-3 py-2.5 font-semibold tabular-nums">
                    Totaal
                  </th>
                  <th className="px-3 py-2.5 font-semibold tabular-nums">
                    Ingepland
                  </th>
                  <th className="px-3 py-2.5 font-semibold tabular-nums">
                    Doel
                  </th>
                  <th className="px-3 py-2.5 font-semibold tabular-nums">
                    L→A %
                  </th>
                  <th
                    className="px-3 py-2.5 font-semibold tabular-nums"
                    title="Geannuleerde huisbezoeken / uitval %"
                  >
                    Uitval
                  </th>
                  <th className="px-3 py-2.5 font-semibold tabular-nums">
                    Geen interesse
                  </th>
                  <th className="px-4 py-2.5 font-semibold tabular-nums">
                    Geen contact
                  </th>
                </tr>
              </thead>
              <tbody>
                {series.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-8 text-center text-sm text-muted"
                    >
                      Geen data in deze periode.
                    </td>
                  </tr>
                ) : (
                  series.map((b) => (
                    <tr
                      key={b.key}
                      className="border-b border-line/70 last:border-0 hover:bg-wash/50"
                    >
                      <td className="px-4 py-2.5 font-medium text-ink">
                        {b.label}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">
                        {num(b.gebeld)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">
                        {num(b.ingepland)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-[#C45A12]">
                        {(b.doel || 0) > 0 ? num(b.doel) : "—"}
                      </td>
                      <td className="px-3 py-2.5 font-semibold tabular-nums text-green-dark">
                        {b.leadToAppt != null
                          ? `${num(b.leadToAppt, 1)}%`
                          : "—"}
                      </td>
                      <td
                        className={`px-3 py-2.5 tabular-nums ${
                          (b.geannuleerd || 0) > 0
                            ? "font-semibold text-[#C45A12]"
                            : "text-ink"
                        }`}
                      >
                        {(b.geannuleerd || 0) > 0 ? (
                          <>
                            {num(b.geannuleerd)}
                            <span className="ml-1 text-[11px] font-normal text-muted">
                              (
                              {b.annuleringsPct != null
                                ? `${num(b.annuleringsPct, 1)}%`
                                : "—"}
                              )
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">
                        {num(b.geenInteresse)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink">
                        {num(b.geenContact)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Ingeplande huisbezoeken · {rangeLabel}
              </p>
            </div>
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-semibold">Lead</th>
                  <th className="px-3 py-2.5 font-semibold">Source</th>
                  <th className="px-3 py-2.5 font-semibold">Ingepland door</th>
                  <th className="px-3 py-2.5 font-semibold">Adviseur</th>
                  <th className="px-3 py-2.5 font-semibold tabular-nums">
                    Ingepland op
                  </th>
                  <th className="px-4 py-2.5 font-semibold tabular-nums">
                    Afspraak op
                  </th>
                </tr>
              </thead>
              <tbody>
                {afspraken.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-sm text-muted"
                    >
                      Nog geen huisbezoeken ingepland in deze periode.
                    </td>
                  </tr>
                ) : (
                  afspraken.map((a) => {
                    const source = normalizeLeadSource({
                      bron: a.bron,
                      utm_source: a.utmSource,
                      lander: a.lander,
                    });
                    const muted = a.geannuleerd
                      ? "line-through text-muted"
                      : "text-ink";
                    return (
                      <tr
                        key={a.id}
                        className={[
                          "border-b border-line/70 last:border-0",
                          a.geannuleerd
                            ? "bg-[#FAFAFA] text-muted"
                            : "hover:bg-wash/50",
                        ].join(" ")}
                      >
                        <td
                          className={[
                            "px-4 py-2.5",
                            a.geannuleerd ? "line-through" : "text-ink",
                          ].join(" ")}
                        >
                          {a.leadId ? (
                            <Link
                              href={`/leads/${a.leadId}?afspraak=${a.id}`}
                              className="font-medium text-ink hover:text-green-dark hover:underline"
                            >
                              {a.leadNaam}
                            </Link>
                          ) : (
                            <span className="font-medium">{a.leadNaam}</span>
                          )}
                          {a.geannuleerd ? (
                            <span className="ml-2 inline-block no-underline text-[10px] font-bold uppercase tracking-wide text-[#C45A12]">
                              Geannuleerd
                            </span>
                          ) : null}
                        </td>
                        <td
                          className={`max-w-[8rem] truncate px-3 py-2.5 text-xs ${muted}`}
                        >
                          {source}
                        </td>
                        <td className={`px-3 py-2.5 ${muted}`}>
                          {a.bellerNaam || "—"}
                        </td>
                        <td className={`px-3 py-2.5 ${muted}`}>
                          {a.adviseurNaam || "—"}
                        </td>
                        <td className={`px-3 py-2.5 tabular-nums ${muted}`}>
                          {formatDateTimeNl(a.ingeplandAt)}
                        </td>
                        <td className={`px-4 py-2.5 tabular-nums ${muted}`}>
                          {formatDateTimeNl(a.afspraakAt)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
