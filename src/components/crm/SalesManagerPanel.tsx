"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatEuro } from "@/lib/format";
import {
  monthKeyAmsterdam,
  type SalesManagerActiepunt,
  type SalesManagerRow,
  type SalesManagerTotals,
} from "@/lib/sales-manager";
import { SalesManagerDetailView } from "./SalesManagerDetail";

function monthOptions(around = new Date()): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const y = around.getFullYear();
  const m = around.getMonth();
  for (let i = -2; i <= 3; i++) {
    const d = new Date(y, m + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("nl-NL", {
      month: "long",
      year: "numeric",
    });
    out.push({
      value,
      label: label.charAt(0).toUpperCase() + label.slice(1),
    });
  }
  return out;
}

function moneyShort(n: number): string {
  if (!n) return "—";
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
          "mt-2 font-display text-[1.6rem] font-semibold leading-none tabular-nums tracking-tight",
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

/** Groen = vandaag afspraak(en); grijs = geen. */
function AgendaDayIcon({ active, count }: { active: boolean; count: number }) {
  return (
    <span
      title={
        active
          ? `${count} afspraak${count === 1 ? "" : "en"} vandaag`
          : "Geen afspraak vandaag"
      }
      className={[
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
        active
          ? "bg-green-soft text-green-dark ring-1 ring-green/30"
          : "bg-wash text-[#9aa39c] ring-1 ring-line",
      ].join(" ")}
      aria-label={active ? "Heeft afspraak vandaag" : "Geen afspraak vandaag"}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        {active ? <path d="M9 14h6M9 18h4" /> : null}
      </svg>
    </span>
  );
}

function ConversieBar({
  pct,
  doel,
}: {
  pct: number | null;
  doel: number | null;
}) {
  if (pct == null && doel == null) {
    return <span className="text-muted">—</span>;
  }
  const progress =
    pct != null && doel != null && doel > 0
      ? Math.min(100, Math.round((pct / doel) * 100))
      : pct != null
        ? Math.min(100, Math.round(pct))
        : 0;
  const onTarget = pct != null && doel != null && pct >= doel;

  return (
    <div className="min-w-[110px]">
      <div className="flex items-baseline justify-between gap-1 text-[11px] tabular-nums">
        <span
          className={
            pct == null
              ? "text-muted"
              : onTarget
                ? "font-semibold text-green-dark"
                : doel != null
                  ? "font-semibold text-[#C62828]"
                  : "font-semibold text-ink"
          }
        >
          {pct == null ? "—" : `${pct.toLocaleString("nl-NL")}%`}
        </span>
        {doel != null ? (
          <span className="text-[10px] text-muted">
            / {doel.toLocaleString("nl-NL")}%
          </span>
        ) : null}
      </div>
      <div className="relative mt-1 h-1.5 overflow-visible rounded-full bg-[#eef1ef]">
        <div
          className={[
            "absolute inset-y-0 left-0 rounded-full",
            onTarget ? "bg-green" : "bg-[#C45A12]",
          ].join(" ")}
          style={{ width: `${progress}%` }}
        />
        {doel != null ? (
          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] leading-none"
            style={{ left: "100%" }}
            title={`Doel ${doel}%`}
            aria-hidden
          >
            🏁
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function SalesManagerPanel() {
  const [month, setMonth] = useState(() => monthKeyAmsterdam());
  const [rows, setRows] = useState<SalesManagerRow[]>([]);
  const [totals, setTotals] = useState<SalesManagerTotals | null>(null);
  const [actiepunten, setActiepunten] = useState<SalesManagerActiepunt[]>(
    []
  );
  const [monthLabel, setMonthLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [draftDoel, setDraftDoel] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const months = useMemo(() => monthOptions(), []);

  const load = useCallback(async (mk: string, opts?: { silent?: boolean }) => {
    if (opts?.silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sales-manager?month=${encodeURIComponent(mk)}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Laden mislukt"
        );
      }
      const list = ((data as { rows?: SalesManagerRow[] }).rows ||
        []) as SalesManagerRow[];
      setRows(list);
      setTotals(
        ((data as { totals?: SalesManagerTotals }).totals ||
          null) as SalesManagerTotals | null
      );
      setActiepunten(
        ((data as { actiepunten?: SalesManagerActiepunt[] }).actiepunten ||
          []) as SalesManagerActiepunt[]
      );
      setMonthLabel((data as { monthLabel?: string }).monthLabel || mk);
      const drafts: Record<string, string> = {};
      for (const r of list) {
        drafts[r.adviseur_id] =
          r.conversie_doel_pct != null ? String(r.conversie_doel_pct) : "";
      }
      setDraftDoel(drafts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setRows([]);
      setTotals(null);
      setActiepunten([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(month);
  }, [month, load]);

  async function saveDoel(adviseurId: string) {
    const raw = (draftDoel[adviseurId] ?? "").trim().replace(",", ".");
    const doelPct = raw === "" ? null : Number(raw);
    if (raw !== "" && (!Number.isFinite(doelPct) || (doelPct as number) < 0)) {
      setError("Doel moet een percentage zijn (0–100)");
      return;
    }
    setSavingId(adviseurId);
    setError(null);
    try {
      const res = await fetch("/api/sales-manager", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          adviseur_id: adviseurId,
          conversie_doel_pct: doelPct,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Opslaan mislukt"
        );
      }
      const list = ((data as { rows?: SalesManagerRow[] }).rows ||
        []) as SalesManagerRow[];
      setRows(list);
      setTotals(
        ((data as { totals?: SalesManagerTotals }).totals ||
          null) as SalesManagerTotals | null
      );
      setActiepunten(
        ((data as { actiepunten?: SalesManagerActiepunt[] }).actiepunten ||
          []) as SalesManagerActiepunt[]
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSavingId(null);
    }
  }

  const legeAgenda = useMemo(
    () => actiepunten.filter((a) => a.reden === "lege_agenda"),
    [actiepunten]
  );
  const nietAfgeboekt = useMemo(
    () => actiepunten.filter((a) => a.reden === "niet_afgeboekt"),
    [actiepunten]
  );
  const onderDoel = useMemo(
    () => actiepunten.filter((a) => a.reden === "onder_doel"),
    [actiepunten]
  );

  if (selectedId) {
    return (
      <div className="space-y-4 px-4 py-4 sm:px-5 sm:py-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-xl border border-line bg-white px-2.5 py-1.5 text-sm font-semibold text-ink outline-none focus:border-green"
          >
            {months.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <SalesManagerDetailView
          adviseurId={selectedId}
          month={month}
          onBack={() => {
            setSelectedId(null);
            void load(month, { silent: true });
          }}
          onDoelSaved={() => void load(month, { silent: true })}
        />
      </div>
    );
  }

  const t = totals;

  return (
    <div className="space-y-5 px-4 py-4 sm:px-5 sm:py-5">
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
              Sales dashboard
            </p>
            <h2 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {monthLabel || month}
            </h2>
            <p className="mt-2 max-w-xl text-sm text-white/70">
              {t
                ? `${t.deals} deal${t.deals === 1 ? "" : "s"} · ${moneyShort(t.omzet_inc)} omzet · ${t.met_afspraak_vandaag}/${t.adviseurs} vandaag op pad`
                : "Conversie, omzet en agenda per adviseur"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white ring-1 ring-white/20 outline-none backdrop-blur"
            >
              {months.map((m) => (
                <option key={m.value} value={m.value} className="text-ink">
                  {m.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={refreshing || loading}
              onClick={() => void load(month, { silent: true })}
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
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {/* KPIs */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <KpiTile
          label="Afspraak → sale"
          value={
            t?.conversie_pct != null
              ? `${t.conversie_pct.toLocaleString("nl-NL")}%`
              : "—"
          }
          hint={t ? `${t.deals}/${t.gelopen} gelopen` : undefined}
          accent="green"
        />
        <KpiTile
          label="Omzet"
          value={t ? moneyShort(t.omzet_inc) : "—"}
          hint={monthLabel || undefined}
          accent="green"
        />
        <KpiTile
          label="Afspraken 2w"
          value={t ? String(t.afspraken_2w) : "—"}
          hint="Komende 14 dagen"
        />
        <KpiTile
          label="Vandaag op pad"
          value={t ? `${t.met_afspraak_vandaag}/${t.adviseurs}` : "—"}
          hint="Adviseurs met afspraak vandaag"
        />
        <KpiTile
          label="Niet afgeboekt"
          value={t ? String(t.niet_afgeboekt) : "—"}
          accent={t && t.niet_afgeboekt > 0 ? "orange" : "ink"}
        />
      </div>

      {/* Actiepunten */}
      {(legeAgenda.length > 0 ||
        nietAfgeboekt.length > 0 ||
        onderDoel.length > 0) && (
        <section className="rounded-2xl border border-line bg-white px-4 py-3.5 sm:px-5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Actiepunten
          </p>
          <div className="mt-2 flex flex-col gap-1.5 text-xs">
            {legeAgenda.length > 0 ? (
              <p>
                <span className="font-semibold text-[#C45A12]">
                  Lege agenda:
                </span>{" "}
                {legeAgenda.map((a, i) => (
                  <span key={a.adviseur_id}>
                    {i > 0 ? ", " : ""}
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.adviseur_id)}
                      className="font-semibold text-ink hover:underline"
                    >
                      {a.naam}
                    </button>
                  </span>
                ))}
              </p>
            ) : null}
            {nietAfgeboekt.length > 0 ? (
              <p>
                <span className="font-semibold text-[#C45A12]">
                  Niet afgeboekt:
                </span>{" "}
                {nietAfgeboekt.map((a, i) => (
                  <span key={a.adviseur_id}>
                    {i > 0 ? ", " : ""}
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.adviseur_id)}
                      className="font-semibold text-ink hover:underline"
                    >
                      {a.naam}
                    </button>
                    <span className="text-muted"> ({a.detail})</span>
                  </span>
                ))}
              </p>
            ) : null}
            {onderDoel.length > 0 ? (
              <p>
                <span className="font-semibold text-[#C62828]">
                  Onder conversiedoel:
                </span>{" "}
                {onderDoel.map((a, i) => (
                  <span key={a.adviseur_id}>
                    {i > 0 ? ", " : ""}
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.adviseur_id)}
                      className="font-semibold text-ink hover:underline"
                    >
                      {a.naam}
                    </button>
                    <span className="text-muted"> ({a.detail})</span>
                  </span>
                ))}
              </p>
            ) : null}
          </div>
        </section>
      )}

      {/* Adviseur table */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5 sm:px-5">
          <div>
            <h3 className="font-display text-base font-semibold text-ink">
              Adviseurs
            </h3>
            <p className="text-[11px] text-muted">
              Groen = afspraak vandaag · klik voor detail
            </p>
          </div>
          <span className="rounded-full bg-wash px-2.5 py-1 text-[10px] font-semibold tabular-nums text-muted">
            {rows.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line bg-wash/60 text-left text-[9px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-semibold sm:px-5">Adviseur</th>
                <th className="px-2 py-2.5 font-semibold text-center">Vandaag</th>
                <th className="px-2 py-2.5 font-semibold text-right">Afspr. 2w</th>
                <th className="px-2 py-2.5 font-semibold text-right">
                  Niet afgeboekt
                </th>
                <th className="px-2 py-2.5 font-semibold">
                  Afspraak→sale
                  <span className="ml-1 font-normal normal-case text-muted">
                    ({monthLabel || month})
                  </span>
                </th>
                <th className="px-2 py-2.5 font-semibold text-right">Doel %</th>
                <th className="px-2 py-2.5 font-semibold text-right">AOV</th>
                <th className="px-4 py-2.5 font-semibold text-right sm:px-5">
                  Omzet
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    Laden…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted">
                    Geen actieve adviseurs.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={r.adviseur_id}
                    className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-wash/50"
                    onClick={(e) => {
                      const t = e.target as HTMLElement;
                      if (t.closest("input,button,a")) return;
                      setSelectedId(r.adviseur_id);
                    }}
                  >
                    <td className="px-4 py-2.5 sm:px-5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0a4727] text-[10px] font-bold text-white">
                          {initials(r.naam)}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedId(r.adviseur_id)}
                          className="text-left font-semibold text-ink hover:underline"
                        >
                          {r.naam}
                        </button>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-center">
                      <AgendaDayIcon
                        active={r.heeft_afspraak_vandaag}
                        count={r.afspraken_vandaag}
                      />
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-ink">
                      {r.afspraken_2w}
                    </td>
                    <td
                      className={[
                        "px-2 py-2.5 text-right tabular-nums",
                        r.niet_afgeboekt > 0
                          ? "font-semibold text-[#C45A12]"
                          : "text-muted",
                      ].join(" ")}
                    >
                      {r.niet_afgeboekt}
                    </td>
                    <td className="px-2 py-2.5">
                      <ConversieBar
                        pct={r.conversie_pct}
                        doel={r.conversie_doel_pct}
                      />
                      {r.gelopen > 0 ? (
                        <p className="mt-0.5 text-[10px] text-muted">
                          {r.deals}/{r.gelopen} gelopen
                        </p>
                      ) : null}
                    </td>
                    <td
                      className="px-2 py-2.5 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="inline-flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.1}
                          inputMode="decimal"
                          value={draftDoel[r.adviseur_id] ?? ""}
                          onChange={(e) =>
                            setDraftDoel((d) => ({
                              ...d,
                              [r.adviseur_id]: e.target.value,
                            }))
                          }
                          onBlur={() => {
                            const cur = String(r.conversie_doel_pct ?? "");
                            const next = (
                              draftDoel[r.adviseur_id] ?? ""
                            ).trim();
                            if (next === cur) return;
                            void saveDoel(r.adviseur_id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          placeholder="—"
                          disabled={savingId === r.adviseur_id}
                          className="w-12 rounded-lg border border-line bg-white px-1 py-1 text-right text-[11px] tabular-nums text-green-dark outline-none focus:border-green disabled:opacity-50"
                          title="Conversiedoel % — Enter of blur om op te slaan"
                        />
                        <span className="text-[9px] text-green-dark">%</span>
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-ink whitespace-nowrap">
                      {r.avg_order_value != null
                        ? formatEuro(r.avg_order_value)
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-ink whitespace-nowrap sm:px-5">
                      {r.omzet_inc > 0 ? formatEuro(r.omzet_inc) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
