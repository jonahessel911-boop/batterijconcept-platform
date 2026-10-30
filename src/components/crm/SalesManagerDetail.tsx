"use client";

import { useCallback, useEffect, useState } from "react";
import { formatTimeNl } from "@/lib/format";
import type {
  SalesManagerDetail as Detail,
  SalesManagerMapPin,
  SalesManagerPeriod,
  SalesManagerTimelineEvent,
  SalesManagerWeekPoint,
} from "@/lib/sales-manager";
import { SalesManagerMap } from "./SalesManagerMap";

function formatDay(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function kindLabel(kind: SalesManagerTimelineEvent["kind"]): string {
  switch (kind) {
    case "sollicitatie":
      return "Sollicitatie";
    case "contract":
      return "Contract";
    case "eerste_afspraak":
      return "1e afspraak";
    case "startdatum":
      return "Start";
    case "deal":
      return "Deal";
    default:
      return kind;
  }
}

function kindTone(kind: SalesManagerTimelineEvent["kind"]): string {
  switch (kind) {
    case "sollicitatie":
      return "bg-[#E8F0F6] text-[#1A4A6E]";
    case "contract":
      return "bg-[#E8F6EC] text-[#0D5C32]";
    case "eerste_afspraak":
      return "bg-[#FFF8D6] text-[#7A5C00]";
    case "startdatum":
      return "bg-wash text-ink";
    case "deal":
      return "bg-[#0D5C32] text-white";
    default:
      return "bg-wash text-muted";
  }
}

function initials(naam: string): string {
  return naam
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n.toLocaleString("nl-NL", { maximumFractionDigits: 1 })}%`;
}

function WeekTrendChart({ weeks }: { weeks: SalesManagerWeekPoint[] }) {
  const maxVol = Math.max(
    1,
    ...weeks.map((w) => Math.max(w.ingepland, w.sales))
  );
  const w = 560;
  const h = 180;
  const padL = 28;
  const padR = 12;
  const padT = 16;
  const padB = 28;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const n = Math.max(1, weeks.length);
  const step = innerW / n;

  const convPts = weeks.map((wk, i) => {
    const pct = wk.conversie_ingepland_sale_pct;
    const x = padL + step * (i + 0.5);
    const y =
      pct == null
        ? null
        : padT + innerH * (1 - Math.min(100, Math.max(0, pct)) / 100);
    return { x, y, pct };
  });
  const lineD = convPts
    .filter((p): p is { x: number; y: number; pct: number } => p.y != null)
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-48 w-full"
        role="img"
        aria-label="Trend per week"
      >
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = padT + innerH * (1 - tick / 100);
          return (
            <g key={tick}>
              <line
                x1={padL}
                x2={w - padR}
                y1={y}
                y2={y}
                stroke="#E6EBE8"
                strokeWidth={1}
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted"
                fontSize={9}
              >
                {tick}%
              </text>
            </g>
          );
        })}
        {weeks.map((wk, i) => {
          const cx = padL + step * (i + 0.5);
          const barW = Math.max(4, step * 0.22);
          const hIng = (wk.ingepland / maxVol) * (innerH * 0.85);
          const hSales = (wk.sales / maxVol) * (innerH * 0.85);
          const base = padT + innerH;
          const short = wk.label.split(" ")[0] || wk.weekKey;
          return (
            <g key={wk.weekKey}>
              <title>
                {`${wk.label}: ${wk.ingepland} ingepland · ${wk.gelopen} gelopen · ${wk.niet_afgeboekt} niet afgeboekt · ${wk.sales} sales · ${fmtPct(wk.conversie_ingepland_sale_pct)} gelopen→sale`}
              </title>
              <rect
                x={cx - barW}
                y={base - hIng}
                width={barW}
                height={Math.max(1, hIng)}
                fill="#A8D5B5"
              />
              <rect
                x={cx}
                y={base - hSales}
                width={barW}
                height={Math.max(1, hSales)}
                fill="#0a4727"
              />
              <text
                x={cx}
                y={h - 8}
                textAnchor="middle"
                className="fill-muted"
                fontSize={9}
                fontWeight={600}
              >
                {short}
              </text>
            </g>
          );
        })}
        {lineD ? (
          <path
            d={lineD}
            fill="none"
            stroke="#C45A12"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {convPts.map((p, i) =>
          p.y == null ? null : (
            <circle
              key={`c-${weeks[i].weekKey}`}
              cx={p.x}
              cy={p.y}
              r={3}
              fill="#C45A12"
            />
          )
        )}
      </svg>
      <div className="flex flex-wrap gap-3 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#A8D5B5]" />{" "}
          Ingepland
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#0a4727]" /> Sales
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-3 bg-[#C45A12]" /> Gelopen→sale
          %
        </span>
      </div>
    </div>
  );
}

export function SalesManagerDetailView({
  adviseurId,
  period,
  customFrom,
  customTo,
  onBack,
}: {
  adviseurId: string;
  period: SalesManagerPeriod;
  customFrom?: string | null;
  customTo?: string | null;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SalesManagerMapPin | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const qs = new URLSearchParams({
        period,
        adviseur_id: adviseurId,
      });
      if (period === "custom" && customFrom && customTo) {
        qs.set("from", customFrom);
        qs.set("to", customTo);
      }
      const res = await fetch(`/api/sales-manager?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Laden mislukt"
        );
      }
      setDetail(
        ((data as { detail?: Detail }).detail || null) as Detail | null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [adviseurId, period, customFrom, customTo]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !detail) {
    return (
      <div className="rounded-2xl border border-line bg-white px-4 py-10 text-center text-sm text-muted">
        Dashboard laden…
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="space-y-2 rounded-2xl border border-line bg-white px-4 py-4">
        <button
          type="button"
          onClick={onBack}
          className="text-xs font-semibold text-green-dark hover:underline"
        >
          ← Terug
        </button>
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      </div>
    );
  }

  if (!detail) return null;

  const row = detail.row;
  const milestones = detail.timeline.filter((e) => e.kind !== "deal");
  const deals = detail.timeline.filter((e) => e.kind === "deal");

  return (
    <div className="space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-green/20 bg-[#0a4727] px-5 py-5 text-white sm:px-6">
        <div
          className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-green/30 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="text-[11px] font-semibold text-white/70 hover:text-white"
            >
              ← Alle adviseurs
            </button>
            <div className="mt-2 flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/15 text-sm font-bold ring-1 ring-white/20">
                {initials(detail.naam)}
              </span>
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-tight">
                  {detail.naam}
                </h2>
                <p className="text-xs text-white/65">
                  {[detail.email, detail.start_adres]
                    .filter(Boolean)
                    .join(" · ") || "Sales detail"}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl bg-white/10 px-3 py-1.5 text-xs font-semibold text-white ring-1 ring-white/20 hover:bg-white/15 disabled:opacity-50"
          >
            {loading ? "Laden…" : "Vernieuwen"}
          </button>
        </div>
        <div className="relative mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat
            label="Ingepland→gelopen"
            value={fmtPct(row.conversie_ingepland_gelopen_pct)}
          />
          <MiniStat
            label="Gelopen→sale"
            value={fmtPct(row.conversie_ingepland_sale_pct)}
          />
          <MiniStat label="Sales" value={String(row.sales)} />
          <MiniStat
            label="Aank. week"
            value={`${row.afspraken_aankomende_week} hb · ${row.blokken_aankomende_week ?? 0} vrij`}
          />
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <Kpi label="Ingepland" value={String(row.ingepland)} />
        <Kpi
          label="Niet afgeboekt"
          value={String(row.niet_afgeboekt)}
          tone={row.niet_afgeboekt > 0 ? "warn" : undefined}
        />
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <header className="border-b border-line px-4 py-3">
          <p className="font-display text-sm font-semibold text-ink">
            Trend &amp; rapportage
          </p>
          <p className="text-[11px] text-muted">
            Vanaf week van eerste ingeplande huisbezoek t/m nu · staven =
            volume · lijn = gelopen→sale %
          </p>
        </header>
        <div className="px-4 py-3">
          <WeekTrendChart weeks={detail.week_trend} />
        </div>
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[520px] text-left text-xs">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2 font-semibold">Week</th>
                <th className="px-3 py-2 font-semibold tabular-nums">
                  Ingepland
                </th>
                <th className="px-3 py-2 font-semibold tabular-nums">
                  Niet afgeboekt
                </th>
                <th className="px-3 py-2 font-semibold tabular-nums">Sales</th>
                <th className="px-4 py-2 font-semibold tabular-nums">
                  Gelopen→sale
                </th>
              </tr>
            </thead>
            <tbody>
              {[...detail.week_trend].reverse().map((wk) => (
                <tr
                  key={wk.weekKey}
                  className="border-b border-line/70 last:border-0"
                >
                  <td className="px-4 py-1.5 font-medium text-ink">
                    {wk.label}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{wk.ingepland}</td>
                  <td
                    className={[
                      "px-3 py-1.5 tabular-nums",
                      wk.niet_afgeboekt > 0 ? "text-[#C45A12]" : "",
                    ].join(" ")}
                  >
                    {wk.niet_afgeboekt}
                  </td>
                  <td className="px-3 py-1.5 font-semibold tabular-nums">
                    {wk.sales}
                  </td>
                  <td className="px-4 py-1.5 font-semibold tabular-nums text-green-dark">
                    {fmtPct(wk.conversie_ingepland_sale_pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-line bg-white">
          <header className="border-b border-line px-4 py-3">
            <p className="font-display text-sm font-semibold text-ink">
              Activiteiten-tijdlijn
            </p>
            <p className="text-[11px] text-muted">
              Sollicitatie · contract · deals
            </p>
          </header>
          <div className="max-h-[380px] overflow-y-auto px-4 py-3">
            {milestones.length === 0 && deals.length === 0 ? (
              <p className="py-4 text-xs text-muted">Nog geen milestones.</p>
            ) : (
              <ol className="relative space-y-0 border-l border-line pl-3">
                {[...milestones, ...deals]
                  .sort(
                    (a, b) =>
                      new Date(a.at).getTime() - new Date(b.at).getTime()
                  )
                  .map((ev, i) => (
                    <li
                      key={`${ev.kind}-${ev.at}-${i}`}
                      className="relative pb-3"
                    >
                      <span className="absolute -left-[19px] top-1.5 h-2 w-2 rounded-full bg-green" />
                      <div className="flex flex-wrap items-baseline gap-1.5">
                        <span
                          className={[
                            "inline-flex rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                            kindTone(ev.kind),
                          ].join(" ")}
                        >
                          {kindLabel(ev.kind)}
                        </span>
                        <span className="text-[10px] tabular-nums text-muted">
                          {formatDay(ev.at)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm font-semibold text-ink">
                        {ev.titel}
                      </p>
                      {ev.detail ? (
                        <p className="text-xs text-muted">{ev.detail}</p>
                      ) : null}
                      {ev.lead_id ? (
                        <a
                          href={`/leads/${ev.lead_id}`}
                          className="mt-0.5 inline-block text-[10px] font-semibold text-green-dark hover:underline"
                        >
                          Open lead →
                        </a>
                      ) : null}
                    </li>
                  ))}
              </ol>
            )}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <header className="border-b border-line px-4 py-3">
          <p className="font-display text-sm font-semibold text-ink">
            Kaart · startadres &amp; afspraken
          </p>
          <p className="text-[11px] text-muted">
            Huis = startadres · blauw = afspraak · klik = lead
          </p>
        </header>
        <SalesManagerMap pins={detail.map_pins} onSelect={setSelected} />
        {selected && selected.kind === "afspraak" ? (
          <div className="border-t border-line bg-[#FAFAF8] px-4 py-3 text-xs">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {selected.lead_naam || selected.label}
                </p>
                <p className="text-muted">
                  {[
                    selected.start_at
                      ? `${formatDay(selected.start_at)} ${formatTimeNl(selected.start_at)}`
                      : null,
                    selected.status,
                    selected.adres,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {selected.notitie ? (
                  <p className="mt-1.5 border-l-2 border-green pl-2 italic text-ink">
                    {selected.notitie}
                  </p>
                ) : (
                  <p className="mt-1 text-muted">Geen afspraaknotitie.</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                {selected.lead_id ? (
                  <a
                    href={`/leads/${selected.lead_id}`}
                    className="rounded-lg bg-green px-2.5 py-1 text-[11px] font-semibold text-white hover:opacity-90"
                  >
                    Lead openen
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="text-[10px] text-muted hover:text-ink"
                >
                  Sluiten
                </button>
              </div>
            </div>
          </div>
        ) : (
          <p className="border-t border-line px-4 py-2 text-[10px] text-muted">
            Klik een afspraak-pin voor leadgegevens.
          </p>
        )}
      </section>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">
        {label}
      </p>
      <p className="mt-0.5 font-display text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "warn";
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-white px-3 py-3 shadow-[0_1px_0_rgba(26,31,28,0.04)]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-green/0 via-green/40 to-green/0"
        aria-hidden
      />
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p
        className={[
          "mt-1 font-display text-xl font-semibold tabular-nums tracking-tight",
          tone === "warn" ? "text-[#C45A12]" : "text-ink",
        ].join(" ")}
      >
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-[10px] text-muted">{sub}</p> : null}
    </div>
  );
}
