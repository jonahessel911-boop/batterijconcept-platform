"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatDateTimeNl } from "@/lib/format";
import {
  LIVE_DAY_OPTIONS,
  isLiveGeenContactStatus,
  type LiveAttributionBucket,
  type LiveDays,
  type LiveRapportageResult,
} from "@/lib/live-rapportage";
import { leadStatusLabel } from "@/lib/labels";
import { normalizeLeadSource } from "@/lib/lead-conversie";

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function pct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${num(n, 1)}%`;
}

function daysLabel(days: LiveDays): string {
  if (days === 1) return "Vandaag";
  return `Afgelopen ${days} dagen`;
}

function urenLabel(h: number | null | undefined): string {
  if (h == null || Number.isNaN(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${num(h, 1)} u`;
  return `${num(h / 24, 1)} d`;
}

export function LiveRapportagePanel() {
  const [days, setDays] = useState<LiveDays>(3);
  const [data, setData] = useState<LiveRapportageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [popupOpen, setPopupOpen] = useState(false);

  const load = useCallback(async (d: LiveDays) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/rapportage/live?days=${encodeURIComponent(String(d))}`
      );
      const json = (await res.json()) as LiveRapportageResult & {
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  useEffect(() => {
    if (!popupOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopupOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popupOpen]);

  if (loading && !data) {
    return <p className="text-sm text-muted">Laden…</p>;
  }

  if (error && !data) {
    return (
      <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
        {error}{" "}
        <button
          type="button"
          onClick={() => void load(days)}
          className="font-semibold underline"
        >
          Opnieuw
        </button>
      </p>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg font-semibold text-ink">Live</p>
          <p className="mt-0.5 max-w-2xl text-xs text-muted">
            Alleen leads die in dit venster binnenkwamen · L→A op díe cohort ·
            niet oude leads die nu pas worden ingepland
          </p>
        </div>
        <div className="flex flex-wrap gap-1 border border-line p-0.5">
          {LIVE_DAY_OPTIONS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={[
                "px-3 py-1.5 text-xs font-semibold transition",
                days === d
                  ? "bg-green text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              {d === 1 ? "Vandaag" : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
          {error}
        </p>
      ) : null}

      <div className="rounded-2xl border border-line bg-white p-5 sm:p-7">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          {daysLabel(days)} · lead → appointment
        </p>
        <p className="mt-2 font-display text-4xl font-semibold tabular-nums text-ink sm:text-5xl">
          {pct(data.leadToAppt)}
        </p>
        <p className="mt-2 text-sm text-muted">
          {num(data.ingepland)} van {num(data.leads)} leads ingepland
          {data.open > 0 ? (
            <span className="text-[#C45A12]"> · nog {num(data.open)} open</span>
          ) : null}
          {data.geenContact > 0 ? (
            <span>
              {" "}
              · {num(data.geenContact)} geen contact
            </span>
          ) : null}
          {data.nieuwOpen > 0 ? (
            <span>
              {" "}
              · {num(data.nieuwOpen)} nog nieuw
            </span>
          ) : null}
          {data.avgUrenTotIngepland != null ? (
            <span>
              {" "}
              · gem. {urenLabel(data.avgUrenTotIngepland)} tot inplannen
            </span>
          ) : null}
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <div className="rounded-xl border border-line bg-wash/50 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Binnen
            </p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
              {num(data.leads)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-wash/50 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Ingepland
            </p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
              {num(data.ingepland)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-wash/50 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Open
            </p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
              {num(data.open)}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-wash/50 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Geen contact
            </p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
              {num(data.geenContact)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted">van open</p>
          </div>
          <div className="rounded-xl border border-line bg-wash/50 px-3 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Nog nieuw
            </p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
              {num(data.nieuwOpen)}
            </p>
            <p className="mt-0.5 text-[10px] text-muted">van open</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setPopupOpen(true)}
          className="mt-5 w-full rounded-xl border border-line bg-wash px-4 py-3 text-sm font-semibold text-ink transition hover:bg-white sm:w-auto"
        >
          Afgelopen dagen · leads + wanneer ingepland
        </button>
      </div>

      {/* Compact per-dag preview */}
      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="border-b border-line px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Per dag · cohort binnenkomst
          </p>
        </div>
        <div className="divide-y divide-line">
          {[...data.byDay].reverse().map((d) => (
            <div
              key={d.ymd}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
            >
              <div>
                <p className="text-sm font-semibold text-ink">{d.label}</p>
                <p className="text-xs text-muted">{d.ymd}</p>
              </div>
              <div className="flex flex-wrap items-baseline gap-4 text-sm tabular-nums">
                <span>
                  <span className="font-semibold text-ink">{num(d.leads)}</span>
                  <span className="text-muted"> leads</span>
                </span>
                <span>
                  <span className="font-semibold text-ink">
                    {num(d.ingepland)}
                  </span>
                  <span className="text-muted"> ingepland</span>
                </span>
                <span>
                  <span className="font-semibold text-ink">
                    {num(d.geenContact)}
                  </span>
                  <span className="text-muted"> geen contact</span>
                </span>
                <span className="font-semibold text-ink">{pct(d.leadToAppt)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <AttributionTable
          title="Per source"
          hint="bron · anders utm_source"
          rows={data.bySource || []}
        />
        <AttributionTable
          title="Per landingspagina"
          hint="lander"
          rows={data.byLander || []}
        />
        <AttributionTable
          title="Per campagne"
          hint="campaign_name"
          rows={data.byCampaign || []}
        />
        <AttributionTable
          title="Per ad"
          hint="ad_name"
          rows={data.byAd || []}
        />
      </div>

      {popupOpen ? (
        <LiveDaysOverlay
          data={data}
          days={days}
          onClose={() => setPopupOpen(false)}
        />
      ) : null}
    </div>
  );
}

function AttributionTable({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: LiveAttributionBucket[];
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          {title}
        </p>
        <p className="mt-0.5 text-xs text-muted">{hint}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">Geen data</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-sm">
            <thead className="border-b border-line bg-wash/60 text-[10px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Naam</th>
                <th className="px-3 py-2 font-semibold tabular-nums">Leads</th>
                <th className="px-3 py-2 font-semibold tabular-nums">Ingepland</th>
                <th className="px-3 py-2 font-semibold tabular-nums">Open</th>
                <th className="px-4 py-2 font-semibold tabular-nums">L→A</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-wash/40">
                  <td className="max-w-[14rem] truncate px-4 py-2 font-medium text-ink">
                    {r.label}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {num(r.leads)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink">
                    {num(r.ingepland)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted">
                    {num(r.open)}
                  </td>
                  <td className="px-4 py-2 font-semibold tabular-nums text-ink">
                    {pct(r.leadToAppt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LiveDaysOverlay({
  data,
  days,
  onClose,
}: {
  data: LiveRapportageResult;
  days: LiveDays;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<
    "all" | "ingepland" | "open" | "geen_contact" | "nieuw"
  >("all");

  const rows = data.rows.filter((r) => {
    if (filter === "ingepland") return Boolean(r.ingepland_at);
    if (filter === "open") return !r.ingepland_at;
    if (filter === "geen_contact") {
      return !r.ingepland_at && isLiveGeenContactStatus(r.status);
    }
    if (filter === "nieuw") {
      return !r.ingepland_at && r.status === "nieuw";
    }
    return true;
  });

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-wash">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-line bg-white px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Live · {daysLabel(days)}
          </p>
          <h2 className="mt-0.5 font-display text-2xl font-semibold text-ink">
            Afgelopen dagen
          </h2>
          <p className="mt-1 text-sm text-muted">
            <span className="font-semibold tabular-nums text-ink">
              {pct(data.leadToAppt)}
            </span>
            {" L→A · "}
            {num(data.ingepland)} van {num(data.leads)} leads ingepland
            {" · "}
            {data.rangeStartYmd} → {data.rangeEndYmd}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl border border-line bg-white px-4 py-2 text-sm font-semibold text-ink hover:bg-wash"
        >
          Sluiten
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <section className="overflow-hidden rounded-2xl border border-line bg-white">
            <div className="border-b border-line px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Per dag · leads die die dag binnenkwamen
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="border-b border-line bg-wash/60 text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Dag</th>
                    <th className="px-4 py-2 font-semibold">Leads</th>
                    <th className="px-4 py-2 font-semibold">Ingepland</th>
                    <th className="px-4 py-2 font-semibold">Geen contact</th>
                    <th className="px-4 py-2 font-semibold">Nog nieuw</th>
                    <th className="px-4 py-2 font-semibold">L→A</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...data.byDay].reverse().map((d) => (
                    <tr key={d.ymd}>
                      <td className="px-4 py-2.5">
                        <span className="font-semibold text-ink">{d.label}</span>
                        <span className="ml-2 text-xs text-muted">{d.ymd}</span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{num(d.leads)}</td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {num(d.ingepland)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {num(d.geenContact)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">
                        {num(d.nieuwOpen)}
                      </td>
                      <td className="px-4 py-2.5 font-semibold tabular-nums text-ink">
                        {pct(d.leadToAppt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-line bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Leads · binnenkomst + wanneer ingepland
              </p>
              <div className="flex gap-1 border border-line p-0.5">
                {(
                  [
                    ["all", `Alle (${num(data.leads)})`],
                    ["ingepland", `Ingepland (${num(data.ingepland)})`],
                    ["open", `Open (${num(data.open)})`],
                    [
                      "geen_contact",
                      `Geen contact (${num(data.geenContact)})`,
                    ],
                    ["nieuw", `Nog nieuw (${num(data.nieuwOpen)})`],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFilter(id)}
                    className={[
                      "px-2.5 py-1 text-xs font-semibold transition",
                      filter === id
                        ? "bg-green text-white"
                        : "bg-white text-muted hover:bg-wash",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="border-b border-line bg-wash/60 text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-semibold">Lead</th>
                    <th className="px-3 py-2 font-semibold">Source</th>
                    <th className="px-3 py-2 font-semibold">Lander</th>
                    <th className="px-3 py-2 font-semibold">Campagne</th>
                    <th className="px-3 py-2 font-semibold">Ad</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Binnen</th>
                    <th className="px-3 py-2 font-semibold">Ingepland</th>
                    <th className="px-3 py-2 font-semibold">Snelheid</th>
                    <th className="px-4 py-2 font-semibold">Afspraak</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-4 py-8 text-center text-muted"
                      >
                        Geen leads in dit filter
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => {
                      const source = normalizeLeadSource({
                        bron: r.bron,
                        utm_source: r.utm_source,
                        lander: r.lander,
                      });
                      return (
                        <tr key={r.id} className="hover:bg-wash/40">
                          <td className="px-4 py-2.5">
                            <Link
                              href={`/?tab=leads&lead=${r.id}`}
                              className="font-semibold text-ink hover:underline"
                            >
                              {r.naam}
                            </Link>
                            <p className="text-xs text-muted">
                              {r.plaats || "—"}
                            </p>
                          </td>
                          <td className="max-w-[8rem] truncate px-3 py-2.5 text-xs text-ink">
                            {source}
                          </td>
                          <td
                            className="max-w-[8rem] truncate px-3 py-2.5 text-xs text-muted"
                            title={r.lander || undefined}
                          >
                            {r.lander || "—"}
                          </td>
                          <td
                            className="max-w-[9rem] truncate px-3 py-2.5 text-xs text-muted"
                            title={r.campaign_name || undefined}
                          >
                            {r.campaign_name || "—"}
                          </td>
                          <td
                            className="max-w-[9rem] truncate px-3 py-2.5 text-xs text-muted"
                            title={r.ad_name || undefined}
                          >
                            {r.ad_name || "—"}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-muted">
                            {r.status
                              ? leadStatusLabel[
                                  r.status as keyof typeof leadStatusLabel
                                ] || r.status
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-xs tabular-nums text-muted">
                            {formatDateTimeNl(r.created_at)}
                          </td>
                          <td className="px-3 py-2.5 text-xs tabular-nums">
                            {r.ingepland_at ? (
                              <span className="font-medium text-ink">
                                {formatDateTimeNl(r.ingepland_at)}
                              </span>
                            ) : (
                              <span className="text-[#C45A12]">Nog open</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-muted">
                            {urenLabel(r.uren_tot_ingepland)}
                          </td>
                          <td className="px-4 py-2.5 text-xs tabular-nums text-muted">
                            {r.afspraak_start_at
                              ? formatDateTimeNl(r.afspraak_start_at)
                              : "—"}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
