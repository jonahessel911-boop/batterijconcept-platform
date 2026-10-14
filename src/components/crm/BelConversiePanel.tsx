"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  BelConversieBellerRow,
  BelConversieCpa,
  BelConversieRecenteAfspraak,
  BelConversieRedenen,
  BelConversieTargets,
} from "@/lib/bel-conversie";
import {
  CONVERSIE_PERIOD_LABELS,
  CONVERSIE_PERIODS,
  type ConversiePeriod,
} from "@/lib/conversie-period";
import { formatDateTimeNl, formatEuro } from "@/lib/format";
import { leadStatusLabel } from "@/lib/labels";
import type { LeadStatus } from "@/types/database";

type CpaDays = 7 | 14 | 30;

type BelConversieData = {
  date: string;
  period?: string;
  periodLabel?: string;
  periodDays?: number;
  totals: {
    gebeld: number;
    ingepland: number;
    leadToAppt: number | null;
  };
  targets?: BelConversieTargets;
  byBeller: BelConversieBellerRow[];
  recenteAfspraken?: BelConversieRecenteAfspraak[];
  cpa?: BelConversieCpa;
};

function redenLabel(key: string): string {
  if (key === "afspraak_ingepland") return "Afspraak ingepland";
  if (key === "onbekend") return "Onbekend";
  return leadStatusLabel[key as LeadStatus] || key;
}

function redenRows(redenen: BelConversieRedenen | undefined): {
  key: string;
  label: string;
  count: number;
}[] {
  const entries = Object.entries(redenen || {}).filter(([, n]) => n > 0);
  entries.sort(
    (a, b) => b[1] - a[1] || redenLabel(a[0]).localeCompare(redenLabel(b[0]), "nl")
  );
  return entries.map(([key, count]) => ({
    key,
    label: redenLabel(key),
    count,
  }));
}

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

const DONUT_TRACK = "#E8EDE9";
const DONUT_FILL = "#C45A12";
const DONUT_OK = "#1a8a3e";

/**
 * Rondje zoals rapportage-donuts.
 * - remaining: center = nog over, ring = al gedaan / totaal
 * - progress: center = gehaald, ring = gehaald / doel
 */
function BelStatDonut({
  title,
  value,
  total,
  mode = "remaining",
}: {
  title: string;
  value: number;
  total: number;
  mode?: "remaining" | "progress";
}) {
  const safeTotal = Math.max(0, total);
  const safeValue = Math.max(0, value);
  const pctRaw =
    safeTotal > 0
      ? mode === "progress"
        ? (safeValue / safeTotal) * 100
        : ((safeTotal - safeValue) / safeTotal) * 100
      : 0;
  const pct = Math.min(100, Math.max(0, pctRaw));
  const onTrack =
    mode === "progress"
      ? safeTotal > 0 && safeValue >= safeTotal
      : safeTotal > 0 && safeValue <= 0;
  const size = 132;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <div className="flex h-full w-full flex-col rounded-2xl border border-line bg-white p-5">
      <p className="font-display text-base font-semibold text-ink">{title}</p>
      <div className="mt-3 flex flex-1 flex-col items-center justify-center">
        <div className="relative" style={{ width: size, height: size }}>
          <svg width={size} height={size} className="-rotate-90">
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={DONUT_TRACK}
              strokeWidth={stroke}
            />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={onTrack ? DONUT_OK : DONUT_FILL}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${c - dash}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <p className="font-display text-2xl font-semibold tabular-nums text-ink">
              {num(safeValue)}
            </p>
            <p className="text-[11px] text-muted">van {num(safeTotal)}</p>
          </div>
        </div>
        <p
          className={[
            "mt-3 text-sm font-semibold tabular-nums",
            onTrack ? "text-[#1a8a3e]" : "text-ink",
          ].join(" ")}
        >
          {Math.round(pct)}%
        </p>
      </div>
    </div>
  );
}

export function BelConversiePanel() {
  const [period, setPeriod] = useState<ConversiePeriod>("today");
  const [cpaDays, setCpaDays] = useState<CpaDays>(7);
  const [data, setData] = useState<BelConversieData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [adminOpen, setAdminOpen] = useState(false);
  const [weekOpen, setWeekOpen] = useState(false);

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const load = useCallback(async (p: ConversiePeriod, days: CpaDays) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        period: p,
        cpaDays: String(days),
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
  }, []);

  useEffect(() => {
    void load(period, cpaDays);
  }, [period, cpaDays, load]);

  const t = data?.targets;
  const rows = (data?.byBeller || []).filter((r) => r.gebeld > 0);
  const periodIngepland = data?.totals.ingepland ?? 0;
  // Eendaagse periode (Vandaag/Gisteren): dag target = zelfde telling als de tabel
  const gepland =
    data?.periodDays === 1
      ? periodIngepland
      : (t?.geplandVandaag ?? periodIngepland);
  const doel = t?.doelVandaag ?? 0;
  const nog = Math.max(0, doel - gepland);
  const pct =
    doel > 0
      ? Math.min(100, Math.round((gepland / doel) * 100))
      : gepland > 0
        ? 100
        : 0;
  const finish = doel > 0 ? gepland >= doel : false;
  const geplandWeek = t?.geplandDezeWeek ?? 0;
  const doelWeek = t?.doelDezeWeek ?? 0;
  const nogWeek = Math.max(0, doelWeek - geplandWeek);
  const pctWeek =
    doelWeek > 0
      ? Math.min(100, Math.round((geplandWeek / doelWeek) * 100))
      : geplandWeek > 0
        ? 100
        : 0;
  const finishWeek = doelWeek > 0 ? geplandWeek >= doelWeek : false;
  const horizonNog = t?.horizonNog ?? 0;
  const weekLabels = ["Deze week", "Volgende week", "Week daarna"];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">
            Bel conversie dashboard
          </p>
          <p className="mt-0.5 max-w-xl text-xs text-muted">
            {data?.periodLabel || CONVERSIE_PERIOD_LABELS[period]}
            {" · "}
            Ingepland = huisbezoeken gezet in de periode. Dagoel = tempo
            vooruit.
          </p>
        </div>
        <label className="flex flex-col gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          Periode
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as ConversiePeriod)}
            className="border border-line bg-white px-2.5 py-2 text-sm font-semibold text-ink outline-none focus:border-green"
          >
            {CONVERSIE_PERIODS.map((p) => (
              <option key={p} value={p}>
                {CONVERSIE_PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : data ? (
        <>
          {/* Donuts bovenaan */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <BelStatDonut
              title="Nog te bellen"
              value={t?.leadsBelbaarVandaag ?? 0}
              total={t?.leadsBelbaarTotaal ?? 0}
              mode="remaining"
            />
            <BelStatDonut
              title="Nog inplanbaar"
              value={t?.afsprakenNogMogelijkVandaag ?? 0}
              total={Math.max(
                t?.afsprakenNogMogelijk ?? 0,
                t?.afsprakenNogMogelijkVandaag ?? 0
              )}
              mode="remaining"
            />
            <BelStatDonut
              title="Dagoel"
              value={gepland}
              total={doel}
              mode="progress"
            />
            <div className="flex h-full w-full flex-col rounded-2xl border border-line bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-display text-base font-semibold text-ink">
                  Cost per appointment
                </p>
                <div className="flex rounded-lg border border-line p-0.5 text-[10px] font-semibold">
                  {([7, 14, 30] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setCpaDays(d)}
                      className={[
                        "rounded-md px-2 py-1 tabular-nums",
                        cpaDays === d
                          ? "bg-green text-white"
                          : "text-muted hover:text-ink",
                      ].join(" ")}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-1 flex-col justify-center">
                <p className="font-display text-3xl font-semibold tabular-nums text-ink">
                  {data.cpa?.costPerAppointment != null
                    ? formatEuro(data.cpa.costPerAppointment)
                    : "—"}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {data.cpa
                    ? `${formatEuro(data.cpa.adSpend)} spend · ${num(data.cpa.afsprakenGepland)} afspraken`
                    : "Geen data"}
                </p>
                <p className="mt-1 text-[10px] text-muted">
                  Ad spend ÷ huisbezoeken ingepland (laatste {cpaDays} dagen t/m
                  gekozen datum)
                </p>
              </div>
            </div>
          </div>

          {/* Dag target — hoofdfinishlijn */}
          <div
            className={`rounded-2xl border p-5 sm:p-7 ${
              finish
                ? "border-green/40 bg-green-soft/50"
                : "border-line bg-white"
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              Dag target
            </p>
            <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-ink sm:text-5xl">
              {num(gepland)}
              <span className="text-2xl font-medium text-muted sm:text-3xl">
                {" "}
                / {doel > 0 ? num(doel) : "—"}
              </span>
              {finish ? (
                <span className="ml-3 text-2xl text-green-deeper">
                  Finish 🏁
                </span>
              ) : (
                <span className="ml-3 text-xl font-medium text-[#C45A12]">
                  · nog {num(nog)}
                </span>
              )}
            </p>
            <p className="mt-2 text-sm text-muted">
              Restant weekdoel ÷{" "}
              {t?.resterendeWerkdagenWeek != null &&
              t.resterendeWerkdagenWeek > 0
                ? `${num(t.resterendeWerkdagenWeek)} resterende werkdag${
                    t.resterendeWerkdagenWeek === 1 ? "" : "en"
                  }`
                : "resterende werkdagen"}
              {" · L→A "}
              {data.totals.leadToAppt != null
                ? `${num(data.totals.leadToAppt, 1)}%`
                : "—"}
              {" · "}
              {num(data.totals.gebeld)} gebeld
            </p>
            <div className="mt-5">
              <div className="relative h-4 overflow-hidden rounded-full bg-wash">
                <div
                  className={`h-full rounded-full transition-[width] duration-500 ${
                    finish ? "bg-green" : "bg-[#C45A12]"
                  }`}
                  style={{ width: `${Math.max(pct, gepland > 0 ? 4 : 0)}%` }}
                />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-muted">
                Over {num(t?.horizonWerkdagen ?? 0)} bel-werkdagen + 20% uitval
                {t?.horizonLabel ? ` · ${t.horizonLabel}` : ""}
              </p>
              <button
                type="button"
                onClick={() => setAdminOpen((v) => !v)}
                className="border border-line bg-wash/60 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
              >
                {adminOpen ? "▾" : "▸"} Total target admin
              </button>
            </div>

            {adminOpen ? (
              <div className="mt-4 overflow-x-auto border border-line/70 bg-wash/30">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                      <th className="px-3 py-2 font-semibold">Horizon</th>
                      <th className="px-3 py-2 font-semibold tabular-nums">
                        Open slots
                      </th>
                      <th className="px-3 py-2 font-semibold tabular-nums">
                        Gepland
                      </th>
                      <th className="px-3 py-2 font-semibold tabular-nums">
                        Nog te plannen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(t?.horizonWeeks || []).map((w, i) => (
                      <tr
                        key={`admin-${w.jaar}-W${w.week}`}
                        className="border-b border-line/50"
                      >
                        <td className="px-3 py-2.5 text-ink">
                          <span className="font-medium">
                            {weekLabels[i] || `Week ${w.week}`}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted">
                            Week {w.week} · {w.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-ink">
                          {num(w.slotsOpen)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-ink">
                          {num(w.slotsGepland)}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                          {num(w.slotsVrij)}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="px-3 py-2.5 text-ink">
                        <span className="font-medium">Totaal</span>
                        <span className="mt-0.5 block text-xs text-muted">
                          Belbaar {num(t?.leadsBelbaarTotaal ?? 0)} leads → ≈{" "}
                          {num(t?.afsprakenNogMogelijk ?? 0)} afspraken bij L→A{" "}
                          {t?.leadToApptActueel != null
                            ? `${num(t.leadToApptActueel, 1)}%`
                            : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">
                        {num(t?.horizonOpen ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">
                        {num(t?.horizonGepland ?? 0)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums font-semibold text-ink">
                        {num(horizonNog)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>

          {/* Week target — standaard ingeklapt */}
          <div
            className={`rounded-2xl border ${
              finishWeek
                ? "border-green/40 bg-green-soft/50"
                : "border-line bg-white"
            }`}
          >
            <button
              type="button"
              onClick={() => setWeekOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
            >
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                  Week target
                </p>
                {!weekOpen ? (
                  <p className="mt-0.5 text-sm text-muted">
                    Openklappen voor weekvoortgang
                  </p>
                ) : null}
              </div>
              <span className="text-sm font-semibold text-ink">
                {weekOpen ? "▾" : "▸"}
              </span>
            </button>
            {weekOpen ? (
              <div className="border-t border-line/60 px-5 pb-5 pt-4 sm:px-6 sm:pb-6">
                <p className="font-display text-3xl font-semibold tabular-nums text-ink">
                  {num(geplandWeek)}
                  <span className="text-xl font-medium text-muted">
                    {" "}
                    / {doelWeek > 0 ? num(doelWeek) : "—"}
                  </span>
                  {finishWeek ? (
                    <span className="ml-2 text-xl text-green-deeper">
                      Finish 🏁
                    </span>
                  ) : (
                    <span className="ml-2 text-lg font-medium text-[#C45A12]">
                      · nog {num(nogWeek)}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Weekdoel obv open slots (tempo × 5) · huisbezoeken gezet deze
                  week · achterstand wordt over resterende dagen verdeeld
                </p>
                <div className="mt-4">
                  <div className="relative h-3 overflow-hidden rounded-full bg-wash">
                    <div
                      className={`h-full rounded-full transition-[width] duration-500 ${
                        finishWeek ? "bg-green" : "bg-[#C45A12]"
                      }`}
                      style={{
                        width: `${Math.max(pctWeek, geplandWeek > 0 ? 4 : 0)}%`,
                      }}
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11px] tabular-nums text-muted">
                  {pctWeek}%
                </p>
              </div>
            ) : null}
          </div>

          {/* Per beller — afboekredenen openklappen */}
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="w-8 px-3 py-3 font-semibold" />
                  <th className="px-2 py-3 font-semibold">Beller</th>
                  <th className="px-3 py-3 font-semibold tabular-nums">Gebeld</th>
                  <th className="px-3 py-3 font-semibold tabular-nums">
                    Ingepland
                  </th>
                  <th className="px-4 py-3 font-semibold tabular-nums">L→A</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-sm text-muted"
                    >
                      Nog geen afboekingen in deze periode.
                    </td>
                  </tr>
                ) : (
                  rows.map((r: BelConversieBellerRow) => {
                    const id = r.bellerId || "onbekend";
                    const open = openIds.has(id);
                    return (
                      <BellerRow
                        key={id}
                        row={r}
                        open={open}
                        onToggle={() => toggleOpen(id)}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Recente afspraken in periode */}
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Ingeplande afspraken
              </p>
              <p className="mt-0.5 text-xs text-muted">
                Alleen huisbezoeken die in de periode zijn ingepland en nog
                niet gelopen · Ingepland door = wie de afspraak zette · Adviseur
                = wie het huisbezoek doet
              </p>
            </div>
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-semibold">Lead</th>
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
                {(data.recenteAfspraken || []).length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-sm text-muted"
                    >
                      Geen huisbezoeken ingepland in deze periode.
                    </td>
                  </tr>
                ) : (
                  (data.recenteAfspraken || []).map((a) => (
                    <tr
                      key={a.id}
                      className="border-b border-line/70 last:border-0 hover:bg-wash/50"
                    >
                      <td className="px-4 py-2.5 text-ink">
                        <span className="font-medium">{a.leadNaam}</span>
                        {a.leadNumber ? (
                          <span className="mt-0.5 block text-xs text-muted">
                            {a.leadNumber}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-ink">
                        {a.bellerNaam || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-ink">
                        {a.adviseurNaam || "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-ink">
                        {formatDateTimeNl(a.ingeplandAt)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-ink">
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

function RedenenTable({ redenen }: { redenen: BelConversieRedenen }) {
  const rows = redenRows(redenen);
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
          <th className="py-1.5 pr-3 font-semibold">Afboekreden</th>
          <th className="py-1.5 pl-3 text-right font-semibold tabular-nums">
            Aantal
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={2} className="py-2 text-muted">
              Geen afboekredenen.
            </td>
          </tr>
        ) : (
          rows.map((r) => (
            <tr key={r.key} className="border-b border-line/50 last:border-0">
              <td className="py-1.5 pr-3 text-ink">{r.label}</td>
              <td className="py-1.5 pl-3 text-right font-semibold tabular-nums text-ink">
                {num(r.count)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function BellerRow({
  row,
  open,
  onToggle,
}: {
  row: BelConversieBellerRow;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-line/70 hover:bg-wash/50"
        onClick={onToggle}
      >
        <td className="px-3 py-2.5 text-muted">
          <span
            className="inline-block text-xs transition-transform"
            style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
            aria-hidden
          >
            ▸
          </span>
        </td>
        <td className="px-2 py-2.5 font-medium text-ink">{row.bellerNaam}</td>
        <td className="px-3 py-2.5 tabular-nums text-ink">{num(row.gebeld)}</td>
        <td className="px-3 py-2.5 tabular-nums text-ink">
          {num(row.ingepland)}
        </td>
        <td className="px-4 py-2.5 tabular-nums font-semibold text-ink">
          {row.leadToAppt != null ? `${num(row.leadToAppt, 1)}%` : "—"}
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-line/70 bg-wash/30 last:border-0">
          <td colSpan={5} className="px-4 py-3">
            <RedenenTable redenen={row.redenen} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
