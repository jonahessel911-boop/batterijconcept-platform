"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEuro, formatTimeNl } from "@/lib/format";
import { leadStatusLabel } from "@/lib/labels";
import type { DashboardV2Vandaag } from "@/lib/dashboard-v2";
import type { LeadStatus } from "@/types/database";

/** Pipeline-statussen zijn geen afboekreden. */
const GEEN_AFBOEK_STATUS = new Set([
  "nieuw",
  "afspraak",
  "na_afspraak",
  "deal",
]);

function afboekRedenLabel(status: string | null | undefined): string | null {
  if (!status || GEEN_AFBOEK_STATUS.has(status)) return null;
  return leadStatusLabel[status as LeadStatus] || status;
}

function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("nl-NL", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) {
    return `€${(n / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 1 })}k`;
  }
  return formatEuro(n);
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

const BUCKET_LABEL = {
  te_lopen: "Nog te lopen",
  gelopen: "Gelopen",
  niet_afgeboekt: "Niet afgeboekt",
} as const;

const BUCKET_CLS = {
  te_lopen: "bg-wash text-ink ring-1 ring-line",
  gelopen: "bg-green-soft text-green-dark",
  niet_afgeboekt: "bg-[#FFF0E6] text-[#C45A12]",
} as const;

const BUCKET_DOT = {
  te_lopen: "bg-[#9aa39c]",
  gelopen: "bg-green",
  niet_afgeboekt: "bg-[#C45A12]",
} as const;

function KpiTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "green" | "orange" | "ink";
}) {
  const valueCls =
    accent === "green"
      ? "text-green-dark"
      : accent === "orange"
        ? "text-[#C45A12]"
        : "text-ink";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-white px-4 py-4 shadow-[0_1px_0_rgba(26,31,28,0.04)]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-green/0 via-green/50 to-green/0"
        aria-hidden
      />
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p
        className={[
          "mt-2 font-display text-[1.75rem] font-semibold leading-none tabular-nums tracking-tight",
          valueCls,
        ].join(" ")}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1.5 text-[11px] text-muted">{hint}</p>
      ) : (
        <p className="mt-1.5 text-[11px] text-transparent">.</p>
      )}
    </div>
  );
}

export function TodayPanel() {
  const [data, setData] = useState<DashboardV2Vandaag | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        "/api/dashboard-v2?period=last_7_days&scope=team",
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData((json.vandaag as DashboardV2Vandaag) || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Fout");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  const maxOmzet = useMemo(() => {
    if (!data?.verkopers.length) return 0;
    return Math.max(...data.verkopers.map((v) => v.omzet), 1);
  }, [data]);

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-2xl bg-white/70" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl bg-white/70"
            />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="h-72 animate-pulse rounded-2xl bg-white/70 lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-2xl bg-white/70 lg:col-span-3" />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <p className="rounded-2xl border border-[#C45A12]/30 bg-[#FFF0E6] px-4 py-3 text-sm text-[#C45A12]">
        {error}
      </p>
    );
  }

  if (!data) {
    return <p className="text-sm text-muted">Geen data.</p>;
  }

  const afsprakenTotaal =
    data.afsprakenGelopen +
    data.afsprakenTeLopen +
    data.afsprakenNietAfgeboekt;

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-green/20 bg-[#0a4727] px-5 py-5 text-white sm:px-7 sm:py-6">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-green/30 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-[#f37021]/20 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/55">
              Live dagstand
            </p>
            <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {data.dateLabel.replace(/^./, (c) => c.toUpperCase())}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {num(data.orders)} order{data.orders === 1 ? "" : "s"} ·{" "}
              {money(data.orderwaarde)} omzet · {num(afsprakenTotaal)} afspraak
              {afsprakenTotaal === 1 ? "" : "en"} op de planning
            </p>
          </div>
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void load({ silent: true })}
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-semibold text-white ring-1 ring-white/20 backdrop-blur hover:bg-white/15 disabled:opacity-60"
          >
            <span
              className={[
                "h-1.5 w-1.5 rounded-full bg-[#7ddea0]",
                refreshing ? "animate-pulse" : "",
              ].join(" ")}
            />
            {refreshing ? "Bezig…" : "Vernieuwen"}
          </button>
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {/* KPI groups */}
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Sales vandaag
          </p>
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <KpiTile
              label="Offertes verstuurd"
              value={num(data.offertesVerstuurd)}
            />
            <KpiTile
              label="Orders"
              value={num(data.orders)}
              accent="green"
            />
            <KpiTile
              label="Orderwaarde"
              value={money(data.orderwaarde)}
              hint="excl. btw"
              accent="green"
            />
          </div>
        </div>
        <div className="space-y-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Instroom
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <KpiTile label="Leads" value={num(data.leads)} />
            <KpiTile
              label="Leads ingepland"
              value={num(data.leadsIngepland)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Agenda
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <KpiTile
              label="Nog te lopen"
              value={num(data.afsprakenTeLopen)}
            />
            <KpiTile
              label="Niet afgeboekt"
              value={num(data.afsprakenNietAfgeboekt)}
              hint={`${num(data.afsprakenGelopen)} afgeboekt`}
              accent={
                data.afsprakenNietAfgeboekt > 0 ? "orange" : "ink"
              }
            />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="grid gap-4 lg:grid-cols-5">
        <section className="overflow-hidden rounded-2xl border border-line bg-white lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
            <div>
              <h3 className="font-display text-base font-semibold text-ink">
                Verkopers
              </h3>
              <p className="text-[11px] text-muted">
                Sales & omzet vandaag
              </p>
            </div>
            <span className="rounded-full bg-wash px-2.5 py-1 text-[10px] font-semibold tabular-nums text-muted">
              {data.verkopers.length}
            </span>
          </div>
          {data.verkopers.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Nog geen sales of afspraken vandaag.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {data.verkopers.map((v, i) => {
                const bar = Math.round((v.omzet / maxOmzet) * 100);
                return (
                  <li key={v.id} className="px-4 py-3.5 sm:px-5">
                    <div className="flex items-start gap-3">
                      <span
                        className={[
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center text-[11px] font-bold tracking-wide",
                          i === 0
                            ? "bg-green text-white"
                            : "bg-green-soft text-green-dark",
                        ].join(" ")}
                        aria-hidden
                      >
                        {initials(v.naam) || "?"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate font-semibold text-ink">
                            {v.naam}
                          </p>
                          <p className="shrink-0 font-display text-sm font-semibold tabular-nums text-green-dark">
                            {money(v.omzet)}
                          </p>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wash">
                          <div
                            className="h-full rounded-full bg-green transition-[width] duration-500"
                            style={{ width: `${bar}%` }}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                          <span>
                            <strong className="tabular-nums text-ink">
                              {num(v.sales)}
                            </strong>{" "}
                            sales
                          </span>
                          <span>
                            <strong className="tabular-nums text-ink">
                              {num(v.afsprakenTeLopen)}
                            </strong>{" "}
                            te lopen
                          </span>
                          <span>
                            <strong className="tabular-nums text-ink">
                              {num(v.afsprakenGelopen)}
                            </strong>{" "}
                            gelopen
                          </span>
                          {v.afsprakenNietAfgeboekt > 0 ? (
                            <span className="font-semibold text-[#C45A12]">
                              {num(v.afsprakenNietAfgeboekt)} open
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-line bg-white lg:col-span-3">
          <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
            <div>
              <h3 className="font-display text-base font-semibold text-ink">
                Afspraken
              </h3>
              <p className="text-[11px] text-muted">
                Tijdlijn van vandaag
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-wash px-2 py-0.5 text-[10px] font-semibold text-muted">
                {num(data.afsprakenTeLopen)} te lopen
              </span>
              <span className="rounded-full bg-green-soft px-2 py-0.5 text-[10px] font-semibold text-green-dark">
                {num(data.afsprakenGelopen)} gelopen
              </span>
              {data.afsprakenNietAfgeboekt > 0 ? (
                <span className="rounded-full bg-[#FFF0E6] px-2 py-0.5 text-[10px] font-semibold text-[#C45A12]">
                  {num(data.afsprakenNietAfgeboekt)} open
                </span>
              ) : null}
            </div>
          </div>
          {data.afspraken.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Geen huisbezoeken gepland vandaag.
            </p>
          ) : (
            <ul className="max-h-[32rem] overflow-y-auto">
              {data.afspraken.map((a, idx) => {
                const reden = afboekRedenLabel(a.lead_status);
                return (
                  <li
                    key={a.id}
                    className="grid grid-cols-[4.5rem_1fr_auto] items-start gap-3 border-b border-line px-4 py-3.5 last:border-b-0 sm:px-5"
                  >
                    <div className="relative pt-0.5 text-right">
                      {idx < data.afspraken.length - 1 ? (
                        <span
                          className="absolute right-[0.55rem] top-6 h-[calc(100%+0.5rem)] w-px bg-line"
                          aria-hidden
                        />
                      ) : null}
                      <span className="relative inline-flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-ink">
                        <span
                          className={[
                            "h-2 w-2 shrink-0 rounded-full",
                            BUCKET_DOT[a.bucket],
                          ].join(" ")}
                          aria-hidden
                        />
                        {formatTimeNl(a.start_at)}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink">
                        {a.lead_naam || a.lead_number || "Lead"}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] text-muted">
                        {a.adviseur_naam}
                        {a.lead_plaats ? ` · ${a.lead_plaats}` : ""}
                      </p>
                      {reden ? (
                        <p
                          className={[
                            "mt-1 truncate text-[11px] font-medium",
                            a.bucket === "gelopen"
                              ? "text-green-dark"
                              : "text-ink",
                          ].join(" ")}
                        >
                          {reden}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={[
                        "mt-0.5 shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide",
                        BUCKET_CLS[a.bucket],
                      ].join(" ")}
                    >
                      {BUCKET_LABEL[a.bucket]}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
