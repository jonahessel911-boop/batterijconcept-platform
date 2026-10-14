"use client";

import { useCallback, useEffect, useState } from "react";
import { formatEuro, formatTimeNl } from "@/lib/format";
import type {
  SalesManagerDetail as Detail,
  SalesManagerMapPin,
  SalesManagerMonthConversie,
  SalesManagerTimelineEvent,
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

/** Dunne conversiebalk met finish-icoon op 100% (= doel). */
function ConversieFinishBar({
  pct,
  doel,
  size = "md",
}: {
  pct: number | null;
  doel: number | null;
  size?: "sm" | "md";
}) {
  const progress =
    pct != null && doel != null && doel > 0
      ? Math.min(100, Math.round((pct / doel) * 100))
      : pct != null
        ? Math.min(100, Math.round(pct))
        : 0;
  const onTarget = pct != null && doel != null && pct >= doel;
  const h = size === "sm" ? "h-1.5" : "h-2";

  return (
    <div className="w-full">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs tabular-nums">
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
          {doel != null ? (
            <span className="ml-1 font-normal text-muted">
              / {doel.toLocaleString("nl-NL")}% doel
            </span>
          ) : (
            <span className="ml-1 font-normal text-muted">geen doel</span>
          )}
        </span>
        {doel != null && pct != null ? (
          <span className="text-[10px] text-muted">
            {onTarget
              ? "Doel gehaald"
              : `${Math.max(0, Math.round((doel - pct) * 10) / 10)}% te gaan`}
          </span>
        ) : null}
      </div>
      <div className={`relative ${h} overflow-visible rounded-full bg-[#eef1ef]`}>
        <div
          className={[
            "absolute inset-y-0 left-0 rounded-full transition-[width]",
            onTarget ? "bg-green" : "bg-[#C45A12]",
          ].join(" ")}
          style={{ width: `${progress}%` }}
        />
        {/* Finish op einde van de baan (= 100% van doel) */}
        <span
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 select-none text-sm leading-none drop-shadow-sm"
          style={{ left: "100%" }}
          title={doel != null ? `Finish · doel ${doel}%` : "Finish"}
          aria-hidden
        >
          🏁
        </span>
      </div>
    </div>
  );
}

function MonthConversieChart({
  months,
  activeMonth,
  onSelectMonth,
  draftDoel,
  onDraftChange,
  onSaveDoel,
  saving,
}: {
  months: SalesManagerMonthConversie[];
  activeMonth: string;
  onSelectMonth: (mk: string) => void;
  draftDoel: string;
  onDraftChange: (v: string) => void;
  onSaveDoel: () => void;
  saving: boolean;
}) {
  const maxPct = Math.max(
    40,
    ...months.map((m) => m.conversie_pct ?? 0),
    ...months.map((m) => m.conversie_doel_pct ?? 0)
  );

  return (
    <div className="space-y-3">
      <div className="flex h-36 items-end gap-1.5 sm:gap-2">
        {months.map((m) => {
          const h =
            m.conversie_pct != null
              ? Math.max(4, Math.round((m.conversie_pct / maxPct) * 100))
              : 4;
          const doelH =
            m.conversie_doel_pct != null
              ? Math.round((m.conversie_doel_pct / maxPct) * 100)
              : null;
          const active = m.monthKey === activeMonth;
          const short = m.label.split(" ")[0]?.slice(0, 3) || m.monthKey;
          return (
            <button
              key={m.monthKey}
              type="button"
              onClick={() => onSelectMonth(m.monthKey)}
              className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              title={`${m.label}: ${m.conversie_pct ?? "—"}% (${m.deals}/${m.gelopen})`}
            >
              {doelH != null ? (
                <span
                  className="absolute left-0 right-0 border-t border-dashed border-green/50"
                  style={{ bottom: `${doelH}%` }}
                  aria-hidden
                />
              ) : null}
              <span
                className={[
                  "w-full max-w-[36px] rounded-t-md transition",
                  active ? "bg-green" : "bg-green/35 group-hover:bg-green/55",
                  m.conversie_pct == null ? "opacity-30" : "",
                ].join(" ")}
                style={{ height: `${h}%` }}
              />
              <span
                className={[
                  "mt-1.5 text-[9px] font-semibold uppercase tracking-wide",
                  active ? "text-green-dark" : "text-muted",
                ].join(" ")}
              >
                {short}
              </span>
            </button>
          );
        })}
      </div>

      {(() => {
        const cur =
          months.find((m) => m.monthKey === activeMonth) ||
          months[months.length - 1];
        if (!cur) return null;
        return (
          <div className="rounded-xl border border-line bg-wash/50 px-3 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {cur.label}
                </p>
                <p className="mt-0.5 text-sm text-ink">
                  <span className="font-semibold tabular-nums">
                    {cur.deals}/{cur.gelopen}
                  </span>{" "}
                  <span className="text-muted">deals / gelopen</span>
                  {cur.omzet_inc > 0 ? (
                    <span className="ml-2 text-muted">
                      · {formatEuro(cur.omzet_inc)}
                    </span>
                  ) : null}
                </p>
              </div>
              <label className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Doel %
                <span className="mt-0.5 flex items-center gap-1">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    inputMode="decimal"
                    value={draftDoel}
                    onChange={(e) => onDraftChange(e.target.value)}
                    onBlur={onSaveDoel}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    disabled={saving}
                    placeholder="—"
                    className="w-16 rounded-lg border border-line bg-white px-2 py-1.5 text-sm font-semibold tabular-nums text-green-dark outline-none focus:border-green disabled:opacity-50"
                  />
                  <span className="text-green-dark">%</span>
                </span>
              </label>
            </div>
            <div className="mt-3">
              <ConversieFinishBar
                pct={cur.conversie_pct}
                doel={cur.conversie_doel_pct}
              />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export function SalesManagerDetailView({
  adviseurId,
  month,
  onBack,
  onDoelSaved,
}: {
  adviseurId: string;
  month: string;
  onBack: () => void;
  onDoelSaved?: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<SalesManagerMapPin | null>(null);
  const [chartMonth, setChartMonth] = useState(month);
  const [draftDoel, setDraftDoel] = useState("");
  const [savingDoel, setSavingDoel] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const qs = new URLSearchParams({
        month,
        adviseur_id: adviseurId,
      });
      const res = await fetch(`/api/sales-manager?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Laden mislukt"
        );
      }
      const d = ((data as { detail?: Detail }).detail ||
        null) as Detail | null;
      setDetail(d);
      setChartMonth(month);
      const cur = d?.conversie_maanden?.find((m) => m.monthKey === month);
      setDraftDoel(
        cur?.conversie_doel_pct != null
          ? String(cur.conversie_doel_pct)
          : d?.row.conversie_doel_pct != null
            ? String(d.row.conversie_doel_pct)
            : ""
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [adviseurId, month]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    const cur = detail.conversie_maanden.find(
      (m) => m.monthKey === chartMonth
    );
    setDraftDoel(
      cur?.conversie_doel_pct != null ? String(cur.conversie_doel_pct) : ""
    );
  }, [chartMonth, detail]);

  async function saveDoel() {
    if (!detail) return;
    const cur = detail.conversie_maanden.find(
      (m) => m.monthKey === chartMonth
    );
    const raw = draftDoel.trim().replace(",", ".");
    const doelPct = raw === "" ? null : Number(raw);
    if (raw !== "" && (!Number.isFinite(doelPct) || (doelPct as number) < 0)) {
      setError("Doel moet een percentage zijn (0–100)");
      return;
    }
    const prev = cur?.conversie_doel_pct;
    const prevStr = prev != null ? String(prev) : "";
    if ((doelPct == null ? "" : String(doelPct)) === prevStr) return;

    setSavingDoel(true);
    setError(null);
    try {
      const res = await fetch("/api/sales-manager", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month: chartMonth,
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
      await load();
      onDoelSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setSavingDoel(false);
    }
  }

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
  const chartCur =
    detail.conversie_maanden.find((m) => m.monthKey === chartMonth) ||
    detail.conversie_maanden[detail.conversie_maanden.length - 1];

  return (
    <div className="space-y-4">
      {/* Hero */}
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
        <div className="relative mt-4">
          <ConversieFinishBar
            pct={row.conversie_pct}
            doel={row.conversie_doel_pct}
          />
          <p className="mt-2 text-[11px] text-white/55">
            Conversie deze maand · balk tot finish (doel)
          </p>
        </div>
      </section>

      {error ? (
        <p className="rounded-xl border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label="Afspraak → sale"
          value={
            detail.afspraak_sale_ratio != null
              ? `${detail.afspraak_sale_ratio.toLocaleString("nl-NL")}%`
              : "—"
          }
          sub={
            row.gelopen > 0
              ? `${row.deals}/${row.gelopen} gelopen`
              : "Nog geen gelopen"
          }
        />
        <Kpi
          label="Gelopen afspraken"
          value={String(row.gelopen)}
          sub={`${row.deals} deal${row.deals === 1 ? "" : "s"} deze maand`}
        />
        <Kpi
          label="Avg order value"
          value={
            detail.avg_order_value != null
              ? formatEuro(detail.avg_order_value)
              : "—"
          }
          sub="Gem. ondertekende offerte"
        />
        <Kpi
          label="Omzet maand"
          value={row.omzet_inc > 0 ? formatEuro(row.omzet_inc) : "—"}
          sub={
            row.heeft_afspraak_vandaag
              ? `${row.afspraken_vandaag} vandaag · ${row.afspraken_2w} in 2w`
              : `${row.afspraken_2w} afspr. komende 2w`
          }
          tone={row.niet_afgeboekt > 0 ? "warn" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Conversie over tijd */}
        <section className="overflow-hidden rounded-2xl border border-line bg-white">
          <header className="border-b border-line px-4 py-3">
            <p className="font-display text-sm font-semibold text-ink">
              Conversie per maand
            </p>
            <p className="text-[11px] text-muted">
              Stippelijn = doel · klik maand om target te zetten
            </p>
          </header>
          <div className="px-4 py-3">
            <MonthConversieChart
              months={detail.conversie_maanden}
              activeMonth={chartMonth}
              onSelectMonth={setChartMonth}
              draftDoel={draftDoel}
              onDraftChange={setDraftDoel}
              onSaveDoel={() => void saveDoel()}
              saving={savingDoel}
            />
            {chartCur ? (
              <p className="mt-2 text-[10px] text-muted">
                Geselecteerd: {chartCur.label}
                {chartCur.conversie_pct != null
                  ? ` · ${chartCur.conversie_pct}%`
                  : ""}
              </p>
            ) : null}
          </div>
        </section>

        {/* Tijdlijn */}
        <section className="overflow-hidden rounded-2xl border border-line bg-white">
          <header className="border-b border-line px-4 py-3">
            <p className="font-display text-sm font-semibold text-ink">
              Activiteiten-tijdlijn
            </p>
            <p className="text-[11px] text-muted">
              Sollicitatie · contract · eerste afspraak · deals
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

      {/* Kaart */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <header className="border-b border-line px-4 py-3">
          <p className="font-display text-sm font-semibold text-ink">
            Kaart · startadres &amp; afspraken
          </p>
          <p className="text-[11px] text-muted">
            Huis = startadres · blauw = afspraak · hover = notitie · klik = lead
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
                {selected.lead_telefoon || selected.lead_email ? (
                  <p className="mt-0.5 text-muted">
                    {[selected.lead_telefoon, selected.lead_email]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
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
            Hover over een afspraak-pin voor de notitie. Klik voor leadgegevens.
          </p>
        )}
      </section>
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
