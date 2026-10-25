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
} from "@/lib/bel-conversie";
import {
  conversieMonthRangeContaining,
  conversieWeekRangeContaining,
  todayConversieYmd,
} from "@/lib/conversie-period";
import { formatDateTimeNl } from "@/lib/format";
import { normalizeLeadSource } from "@/lib/lead-conversie";

type BelConversieData = {
  date: string;
  periodLabel?: string;
  periodDays?: number;
  totals: {
    gebeld: number;
    ingepland: number;
    leadToAppt: number | null;
    nonNieuwGebeld?: number;
    nonNieuwIngepland?: number;
    nonNieuwLeadToAppt?: number | null;
  };
  recenteAfspraken?: BelConversieRecenteAfspraak[];
  series?: BelConversieSeriesBucket[];
  seriesGranularity?: BelConversieSeriesGranularity;
};

type ViewMode = "week" | "month";

/** Kleuren in de dikke gestapelde balk (hoogte = totaal gebeld). */
const STACK_SEGMENTS = [
  { key: "ingepland" as const, label: "Ingepland", color: "#1a8a3e" },
  { key: "geenInteresse" as const, label: "Geen interesse", color: "#C62828" },
  { key: "geenContact" as const, label: "Geen contact", color: "#64748b" },
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
  const known = b.ingepland + b.geenInteresse + b.geenContact;
  const overig = Math.max(0, b.gebeld - known);
  const parts = [
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
  return parts;
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
    for (const b of series) m = Math.max(m, b.gebeld);
    return Math.max(1, m);
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

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative flex h-72 items-end justify-around gap-3 overflow-visible px-1 pb-1 sm:gap-4"
        onMouseLeave={clearTip}
      >
        {series.map((b, bi) => {
          const totaal = b.gebeld;
          const barH = Math.max(
            totaal > 0 ? 12 : 0,
            (totaal / maxTotaal) * 100
          );
          const segments = barSegments(b);
          return (
            <div
              key={b.key}
              className="flex h-full min-w-[3.75rem] flex-1 flex-col items-center justify-end sm:min-w-[4.5rem]"
              onMouseEnter={(e) => {
                setHoverBi(bi);
                updateTipPos(e);
              }}
              onMouseMove={(e) => {
                setHoverBi(bi);
                updateTipPos(e);
              }}
            >
              <p
                className="mb-1.5 text-[11px] font-semibold tabular-nums text-green-dark"
                title="Lead to appointment %"
              >
                {b.leadToAppt != null ? `${num(b.leadToAppt, 1)}%` : "—"}
              </p>
              <div
                className="flex w-full max-w-[4.5rem] cursor-pointer flex-col-reverse overflow-hidden rounded-t-lg shadow-sm sm:max-w-[5.5rem]"
                style={{
                  height: `${barH}%`,
                  minHeight: totaal > 0 ? 12 : 0,
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
              <p className="mt-1.5 text-[11px] font-semibold tabular-nums text-ink">
                {totaal > 0 ? num(totaal) : ""}
              </p>
              <p
                className="mt-0.5 w-full truncate text-center text-[10px] font-medium text-muted"
                title={b.label}
              >
                {granularity === "day"
                  ? b.label.replace(/\.$/, "")
                  : b.label.split(" · ")[0] || b.label}
              </p>
            </div>
          );
        })}
        {tip && tipStyle ? (
          <div
            className="pointer-events-none absolute z-30 w-max max-w-[14rem] rounded-xl border border-line bg-white px-3 py-2.5 text-xs shadow-lg"
            style={tipStyle}
          >
            <p className="font-semibold text-ink">{tip.label}</p>
            <ul className="mt-1.5 space-y-1 tabular-nums text-ink">
              <li>
                <span className="text-muted">Totaal</span>{" "}
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
      </div>
    </div>
  );
}

export function BelConversiePanel() {
  const today = todayConversieYmd();
  const [mode, setMode] = useState<ViewMode>("week");
  const [anchorYmd, setAnchorYmd] = useState(today);
  const [data, setData] = useState<BelConversieData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    return mode === "week"
      ? conversieWeekRangeContaining(anchorYmd)
      : conversieMonthRangeContaining(anchorYmd);
  }, [mode, anchorYmd]);

  const granularity: BelConversieSeriesGranularity =
    mode === "week" ? "day" : "week";

  const load = useCallback(
    async (from: string, to: string, gran: BelConversieSeriesGranularity) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({
          from,
          to,
          granularity: gran,
        });
        const res = await fetch(`/api/rapportage/bel-conversie?${qs}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (json as { error?: string }).error || "Laden mislukt"
          );
        }
        setData(json as BelConversieData);
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
    void load(range.startYmd, range.endYmd, granularity);
  }, [range.startYmd, range.endYmd, granularity, load]);

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
    for (const b of series) {
      geenInteresse += b.geenInteresse;
      geenContact += b.geenContact;
    }
    return { geenInteresse, geenContact };
  }, [series]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            Bel conversie
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Één staaf per {mode === "week" ? "dag" : "week"} · hover voor
            details
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
          {mode === "week" ? (
            <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Week van
              <input
                type="date"
                value={anchorYmd}
                onChange={(e) => setAnchorYmd(e.target.value || today)}
                className="border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
              />
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

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}{" "}
          <button
            type="button"
            onClick={() => void load(range.startYmd, range.endYmd, granularity)}
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
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
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

          <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                  {mode === "week" ? "Per dag" : "Per week"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  Balkhoogte = totaal gebeld · kleuren = ingepland / geen
                  interesse / geen contact · hover voor cijfers
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
                    L→A %
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
                      colSpan={6}
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
                      <td className="px-3 py-2.5 font-semibold tabular-nums text-green-dark">
                        {b.leadToAppt != null
                          ? `${num(b.leadToAppt, 1)}%`
                          : "—"}
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
