"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  BelConversieRecenteAfspraak,
  BelConversieTargets,
} from "@/lib/bel-conversie";
import { formatDateTimeNl, formatEuro } from "@/lib/format";

/** Netto (niet-geannuleerde) huisbezoeken × dit bedrag. */
const EURO_PER_NETTO_AFSPRAAK = 10;

type BelConversieData = {
  date: string;
  periodLabel?: string;
  periodDays?: number;
  totals: {
    gebeld: number;
    ingepland: number;
    leadToAppt: number | null;
  };
  targets?: BelConversieTargets;
  recenteAfspraken?: BelConversieRecenteAfspraak[];
};

type TeamRow = {
  naam: string;
  afspraken: number;
  verdiensten: number;
};

const TEAM_COLORS = [
  "#1a8a3e",
  "#C45A12",
  "#1A4A6E",
  "#0F766E",
  "#8A6D00",
  "#6B21A8",
];

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function TargetCard({
  label,
  gepland,
  doel,
  subtitle,
}: {
  label: string;
  gepland: number;
  doel: number;
  subtitle: string;
}) {
  const nog = Math.max(0, doel - gepland);
  const pct =
    doel > 0
      ? Math.min(100, Math.round((gepland / doel) * 100))
      : gepland > 0
        ? 100
        : 0;
  const finish = doel > 0 ? gepland >= doel : false;

  return (
    <div
      className={`rounded-2xl border p-5 sm:p-6 ${
        finish ? "border-green/40 bg-green-soft/50" : "border-line bg-white"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {label}
      </p>
      <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-ink sm:text-4xl">
        {num(gepland)}
        <span className="text-xl font-medium text-muted sm:text-2xl">
          {" "}
          / {doel > 0 ? num(doel) : "—"}
        </span>
        {finish ? (
          <span className="ml-2 text-xl text-green-deeper">Finish 🏁</span>
        ) : (
          <span className="ml-2 text-lg font-medium text-[#C45A12]">
            · nog {num(nog)}
          </span>
        )}
      </p>
      <div className="mt-4">
        <div className="relative h-3.5 overflow-hidden rounded-full bg-wash">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              finish ? "bg-green" : "bg-[#C45A12]"
            }`}
            style={{ width: `${Math.max(pct, gepland > 0 ? 4 : 0)}%` }}
          />
        </div>
      </div>
      <p className="mt-2 text-sm text-muted">
        {pct}% · {subtitle}
      </p>
    </div>
  );
}

function TeamDonut({
  rows,
  total,
  centerLabel,
}: {
  rows: TeamRow[];
  total: number;
  centerLabel: string;
}) {
  const size = 148;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#E8EDE9"
          strokeWidth={stroke}
        />
        {rows.map((row, i) => {
          const frac = total > 0 ? row.afspraken / total : 0;
          const dash = frac * c;
          const gap = c - dash;
          const el = (
            <circle
              key={row.naam}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={TEAM_COLORS[i % TEAM_COLORS.length]}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="font-display text-2xl font-semibold tabular-nums text-ink">
          {num(total)}
        </p>
        <p className="text-[10px] text-muted">{centerLabel}</p>
      </div>
    </div>
  );
}

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function BelConversiePanel() {
  const [fromYmd, setFromYmd] = useState(todayYmdLocal);
  const [toYmd, setToYmd] = useState(todayYmdLocal);
  const [data, setData] = useState<BelConversieData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true);
    setError(null);
    try {
      const start = from <= to ? from : to;
      const end = from <= to ? to : from;
      const qs = new URLSearchParams({ from: start, to: end });
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
  }, []);

  useEffect(() => {
    void load(fromYmd, toYmd);
  }, [fromYmd, toYmd, load]);

  const t = data?.targets;
  const afspraken = data?.recenteAfspraken || [];
  const isTodayOnly =
    fromYmd === toYmd &&
    (data?.periodLabel === "Vandaag" ||
      fromYmd === todayYmdLocal());
  const rangeLabel =
    data?.periodLabel ||
    (fromYmd === toYmd ? fromYmd : `${fromYmd} → ${toYmd}`);

  // Dag target = altijd vandaag (API), ongeacht filter
  const geplandDag = t?.geplandVandaag ?? 0;
  const doelDag = t?.doelVandaag ?? 0;
  // Week/periode target volgt het filter
  const geplandWeek = t?.geplandDezeWeek ?? 0;
  const doelWeek = t?.doelDezeWeek ?? 0;

  const team = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of afspraken) {
      if (a.geannuleerd) continue;
      const naam = (a.bellerNaam || "").trim() || "Onbekend";
      map.set(naam, (map.get(naam) || 0) + 1);
    }
    return [...map.entries()]
      .map(
        ([naam, n]): TeamRow => ({
          naam,
          afspraken: n,
          verdiensten: n * EURO_PER_NETTO_AFSPRAAK,
        })
      )
      .sort(
        (a, b) =>
          b.afspraken - a.afspraken || a.naam.localeCompare(b.naam, "nl")
      );
  }, [afspraken]);

  const nettoTotaal = team.reduce((s, r) => s + r.afspraken, 0);
  const verdienstenTotaal = nettoTotaal * EURO_PER_NETTO_AFSPRAAK;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            Bel conversie
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Alleen nieuwe huisbezoeken · dagtarget = vandaag · verdiensten €
            {EURO_PER_NETTO_AFSPRAAK}/netto
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Van
            <input
              type="date"
              value={fromYmd}
              max={toYmd}
              onChange={(e) => setFromYmd(e.target.value)}
              className="border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
            Tot
            <input
              type="date"
              value={toYmd}
              min={fromYmd}
              onChange={(e) => setToYmd(e.target.value)}
              className="border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
            />
          </label>
          {!isTodayOnly ? (
            <button
              type="button"
              onClick={() => {
                const t0 = todayYmdLocal();
                setFromYmd(t0);
                setToYmd(t0);
              }}
              className="border border-line bg-white px-3 py-2 text-xs font-semibold text-muted hover:bg-wash"
            >
              Vandaag
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}{" "}
          <button
            type="button"
            onClick={() => void load(fromYmd, toYmd)}
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
          <div className="grid gap-3 lg:grid-cols-2">
            <TargetCard
              label="Dag target"
              gepland={geplandDag}
              doel={doelDag}
              subtitle={`altijd vandaag · tempo ~2 weken vooruit${
                t?.horizonLabel ? ` · ${t.horizonLabel}` : ""
              }`}
            />
            <TargetCard
              label={isTodayOnly ? "Week target" : "Periode target"}
              gepland={geplandWeek}
              doel={doelWeek}
              subtitle={
                isTodayOnly
                  ? "huisbezoeken gezet deze week · weekdoel = dagoel × 5"
                  : `ingepland in ${rangeLabel} · doel = dagoel × bel-werkdagen`
              }
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                {isTodayOnly ? "Team · vandaag" : "Team"}
              </p>
              <p className="mt-1 text-xs text-muted">
                Wie heeft hoeveel netto huisbezoeken gezet (niet geannuleerd)
              </p>
              <div className="mt-4">
                <TeamDonut
                  rows={team}
                  total={nettoTotaal}
                  centerLabel={isTodayOnly ? "netto vandaag" : "netto"}
                />
              </div>
              <div className="mt-4 space-y-2">
                {team.length === 0 ? (
                  <p className="text-sm text-muted">
                    Nog niemand in deze periode.
                  </p>
                ) : (
                  team.map((r, i) => (
                    <div
                      key={r.naam}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{
                            background:
                              TEAM_COLORS[i % TEAM_COLORS.length],
                          }}
                        />
                        <span className="truncate font-medium text-ink">
                          {r.naam}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-muted">
                        {num(r.afspraken)} · {formatEuro(r.verdiensten)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-line bg-white p-5 sm:p-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
                Verdiensten{isTodayOnly ? " vandaag" : ` · ${rangeLabel}`}
              </p>
              <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-ink">
                {formatEuro(verdienstenTotaal)}
              </p>
              <p className="mt-2 text-sm text-muted">
                {num(nettoTotaal)} netto afspraak
                {nettoTotaal === 1 ? "" : "en"} ×{" "}
                {formatEuro(EURO_PER_NETTO_AFSPRAAK)}
              </p>
              <p className="mt-1 text-xs text-muted">
                Geannuleerde afspraken tellen niet mee
              </p>
              {team.length > 0 ? (
                <div className="mt-5 overflow-hidden border border-line">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-line bg-wash/50 text-[10px] uppercase tracking-wide text-muted">
                        <th className="px-3 py-2 font-semibold">Beller</th>
                        <th className="px-3 py-2 font-semibold tabular-nums">
                          Netto
                        </th>
                        <th className="px-3 py-2 font-semibold tabular-nums">
                          Verdiensten
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {team.map((r) => (
                        <tr
                          key={r.naam}
                          className="border-b border-line/60 last:border-0"
                        >
                          <td className="px-3 py-2 font-medium text-ink">
                            {r.naam}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-ink">
                            {num(r.afspraken)}
                          </td>
                          <td className="px-3 py-2 font-semibold tabular-nums text-ink">
                            {formatEuro(r.verdiensten)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Ingeplande afspraken
                {isTodayOnly ? " vandaag" : ` · ${rangeLabel}`}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Alleen nieuwe huisbezoeken (1e per lead) · geannuleerd =
                doorstreept
              </p>
            </div>
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-semibold">Lead</th>
                  <th className="px-3 py-2.5 font-semibold">Ingepland door</th>
                  <th className="px-3 py-2.5 font-semibold">Provincie</th>
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
                  afspraken.map((a) => (
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
                        {a.leadNumber ? (
                          <span className="mt-0.5 block text-xs text-muted no-underline">
                            {a.leadNumber}
                          </span>
                        ) : null}
                      </td>
                      <td
                        className={[
                          "px-3 py-2.5",
                          a.geannuleerd
                            ? "line-through text-muted"
                            : "text-ink",
                        ].join(" ")}
                      >
                        {a.bellerNaam || "—"}
                      </td>
                      <td
                        className={[
                          "px-3 py-2.5",
                          a.geannuleerd
                            ? "line-through text-muted"
                            : "text-ink",
                        ].join(" ")}
                      >
                        {a.provincie || "—"}
                      </td>
                      <td
                        className={[
                          "px-3 py-2.5",
                          a.geannuleerd
                            ? "line-through text-muted"
                            : "text-ink",
                        ].join(" ")}
                      >
                        {a.adviseurNaam || "—"}
                      </td>
                      <td
                        className={[
                          "px-3 py-2.5 tabular-nums",
                          a.geannuleerd
                            ? "line-through text-muted"
                            : "text-ink",
                        ].join(" ")}
                      >
                        {formatDateTimeNl(a.ingeplandAt)}
                      </td>
                      <td
                        className={[
                          "px-4 py-2.5 tabular-nums",
                          a.geannuleerd
                            ? "line-through text-muted"
                            : "text-ink",
                        ].join(" ")}
                      >
                        {formatDateTimeNl(a.afspraakAt)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
