"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AandachtBar,
  AandachtspuntenResult,
} from "@/lib/aandachtspunten";

type Props = {
  rangeMode: "weeks" | "month";
  rangeWeekKey: string;
  rangeMonthYm: string;
};

type DetailKind = "leads" | "afspraken" | null;

function pct(actual: number, target: number): number {
  if (target <= 0) return actual > 0 ? 100 : 0;
  return Math.min(100, Math.round((actual / target) * 100));
}

function num(n: number): string {
  return n.toLocaleString("nl-NL");
}

function TargetBar({
  bar,
  clickable,
  expanded,
  onToggle,
}: {
  bar: AandachtBar;
  clickable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const fill = pct(bar.actual, bar.target);
  const ok = bar.onTrack;

  const inner = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted">
            {bar.unitLabel}
            {clickable ? (
              <span className="ml-1 font-normal normal-case tracking-normal">
                {expanded ? "· sluit" : "· klik voor detail"}
              </span>
            ) : null}
          </p>
          <p className="truncate font-display text-sm font-semibold text-ink">
            {bar.label}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-ink">
            {num(bar.actual)}
            <span className="font-normal text-muted"> / {num(bar.target)}</span>
          </p>
          <p
            className={[
              "text-[10px] font-semibold uppercase tracking-wide",
              ok ? "text-green-dark" : "text-[#C45A12]",
            ].join(" ")}
          >
            {ok
              ? "Op schema"
              : `Nog ${Math.max(0, bar.target - bar.actual).toLocaleString("nl-NL")}`}
          </p>
        </div>
      </div>

      <div className="relative mt-2 h-3 w-full bg-[#E8ECEA]">
        <div
          className={[
            "absolute inset-y-0 left-0 transition-all",
            ok ? "bg-[#0a4727]" : "bg-[#C45A12]",
          ].join(" ")}
          style={{ width: `${fill}%` }}
        />
      </div>
    </>
  );

  if (clickable && onToggle) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={[
          "min-w-0 flex-1 rounded-lg text-left transition",
          expanded ? "ring-1 ring-[#0a4727]/30" : "hover:bg-[#FAFBFA]",
        ].join(" ")}
      >
        {inner}
      </button>
    );
  }

  return <div className="min-w-0 flex-1">{inner}</div>;
}

export function AandachtspuntenStrip({
  rangeMode,
  rangeWeekKey,
  rangeMonthYm,
}: Props) {
  const [data, setData] = useState<AandachtspuntenResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailKind>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const mode = rangeMode === "month" ? "month" : "week";
      const qs = new URLSearchParams({ mode });
      if (mode === "month") qs.set("month", rangeMonthYm);
      else qs.set("week", rangeWeekKey);

      const res = await fetch(`/api/rapportage/aandachtspunten?${qs}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Laden mislukt");
      setData(json as AandachtspuntenResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [rangeMode, rangeWeekKey, rangeMonthYm]);

  useEffect(() => {
    void load();
  }, [load]);

  const meta = data?.leadsMeta;
  const leadRows = data?.leadsPerAdviseur ?? [];
  const apptRows = data?.afsprakenPerAdviseur ?? [];

  function toggleDetail(kind: "leads" | "afspraken") {
    setDetail((cur) => (cur === kind ? null : kind));
  }

  return (
    <section className="border border-line bg-white px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-display text-base font-semibold text-ink">
            Aandachtspunten
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Leads = 14d gen. / nodig
            {meta
              ? ` (L→A ${meta.l2aPct.toLocaleString("nl-NL", {
                  maximumFractionDigits: 1,
                })}%)`
              : ""}
            {" · "}
            Afspraken = ingepland / nodig (
            {data?.afsprakenMeta?.fillTargetPct ?? 80}% blokken)
            {data?.afsprakenMeta
              ? ` · ${num(data.afsprakenMeta.slotsVrij)} vrij van ${num(data.afsprakenMeta.slotsOpen)}`
              : ""}
            {data?.periodLabel ? ` · ${data.periodLabel}` : ""}
          </p>
        </div>
        {loading ? (
          <p className="text-xs text-muted">Laden…</p>
        ) : error ? (
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs font-semibold text-[#C45A12] underline"
          >
            {error} — opnieuw
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-5 sm:grid-cols-3 sm:gap-6">
        {(data?.bars ?? [
          {
            id: "leads" as const,
            label: "Leads",
            unitLabel: "14d gen. / nodig",
            actual: 0,
            target: 0,
            paceTarget: 0,
            onTrack: true,
          },
          {
            id: "afspraken" as const,
            label: "Geplande afspraken",
            unitLabel: "Ingepland / nodig",
            actual: 0,
            target: 0,
            paceTarget: 0,
            onTrack: true,
          },
          {
            id: "sales" as const,
            label: "Sales",
            unitLabel: "Sales",
            actual: 0,
            target: 0,
            paceTarget: 0,
            onTrack: true,
          },
        ]).map((bar) => {
          const clickable = bar.id === "leads" || bar.id === "afspraken";
          return (
            <TargetBar
              key={bar.id}
              bar={bar}
              clickable={clickable}
              expanded={detail === bar.id}
              onToggle={
                clickable
                  ? () => toggleDetail(bar.id as "leads" | "afspraken")
                  : undefined
              }
            />
          );
        })}
      </div>

      {detail === "leads" ? (
        <div className="mt-4 overflow-x-auto border border-line">
          <p className="border-b border-line bg-[#F3F5F4] px-3 py-2 text-[11px] text-muted">
            Team-totaal (onderaan) is leidend. Per adviseur: nodig = hun open
            slots; gegenereerd = leads die al aan hen hangen. “Nog niet op een
            adviseur” = nieuwe leads zonder toegewezen adviseur (tellen wel mee
            in het teamtotaal).
            {meta
              ? ` L→A ${meta.l2aPct.toLocaleString("nl-NL", {
                  maximumFractionDigits: 1,
                })}% · ${num(meta.slotsOpen)} slots × 80% = ${num(meta.targetAppts)} afspraken nodig.`
              : ""}
          </p>
          {leadRows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              Geen adviseur-data.
            </p>
          ) : (
            <table className="w-full min-w-[420px] border-collapse text-[12px]">
              <thead>
                <tr className="bg-[#FAFBFA] text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="border-b border-line px-3 py-2 text-left">
                    Adviseur
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Nodig 14d
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Gegenereerd 14d
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Saldo
                  </th>
                </tr>
              </thead>
              <tbody>
                {leadRows.map((r) => {
                  const saldo = r.leadsGegenereerd - r.leadsNodig;
                  return (
                    <tr key={r.adviseurId} className="hover:bg-[#FAFBFA]">
                      <td className="border-b border-line px-3 py-2 font-medium text-ink">
                        {r.naam}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums text-ink">
                        {num(r.leadsNodig)}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums text-ink">
                        {num(r.leadsGegenereerd)}
                      </td>
                      <td
                        className={[
                          "border-b border-line px-3 py-2 text-right font-semibold tabular-nums",
                          saldo >= 0 ? "text-green-dark" : "text-[#C45A12]",
                        ].join(" ")}
                      >
                        {saldo > 0 ? "+" : ""}
                        {num(saldo)}
                      </td>
                    </tr>
                  );
                })}
                {data ? (
                  <tr className="bg-[#EEF3F0] font-semibold">
                    <td className="border-b border-line px-3 py-2.5 text-ink">
                      Team (zelfde als balk)
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums text-ink">
                      {num(
                        data.bars.find((b) => b.id === "leads")?.target ?? 0
                      )}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums text-ink">
                      {num(
                        data.bars.find((b) => b.id === "leads")?.actual ?? 0
                      )}
                    </td>
                    <td
                      className={[
                        "border-b border-line px-3 py-2.5 text-right tabular-nums",
                        (data.bars.find((b) => b.id === "leads")?.actual ??
                          0) -
                          (data.bars.find((b) => b.id === "leads")?.target ??
                            0) >=
                        0
                          ? "text-green-dark"
                          : "text-[#C45A12]",
                      ].join(" ")}
                    >
                      {(() => {
                        const leadsBar = data.bars.find((b) => b.id === "leads");
                        const s =
                          (leadsBar?.actual ?? 0) - (leadsBar?.target ?? 0);
                        return `${s > 0 ? "+" : ""}${num(s)}`;
                      })()}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      {detail === "afspraken" ? (
        <div className="mt-4 overflow-x-auto border border-line">
          <p className="border-b border-line bg-[#F3F5F4] px-3 py-2 text-[11px] text-muted">
            Per adviseur: ingepland vs nodig ({data?.afsprakenMeta?.fillTargetPct ?? 80}%
            van hun beschikbare blokken). “Nog” = wat er nog bij moet om op
            schema te zitten.
            {data?.afsprakenMeta
              ? ` Team: ${num(data.afsprakenMeta.slotsGepland)} ingepland · ${num(data.afsprakenMeta.slotsVrij)} vrij · ${num(data.afsprakenMeta.slotsOpen)} blokken.`
              : ""}
          </p>
          {apptRows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted">
              Geen agenda-data.
            </p>
          ) : (
            <table className="w-full min-w-[480px] border-collapse text-[12px]">
              <thead>
                <tr className="bg-[#FAFBFA] text-[10px] font-semibold uppercase tracking-wide text-muted">
                  <th className="border-b border-line px-3 py-2 text-left">
                    Adviseur
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Ingepland
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Nodig
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Nog
                  </th>
                  <th className="border-b border-line px-3 py-2 text-right">
                    Blokken
                  </th>
                </tr>
              </thead>
              <tbody>
                {apptRows.map((r) => {
                  const nog = Math.max(0, r.nodig - r.ingepland);
                  return (
                    <tr key={r.adviseurId} className="hover:bg-[#FAFBFA]">
                      <td className="border-b border-line px-3 py-2 font-medium text-ink">
                        {r.naam}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums text-ink">
                        {num(r.ingepland)}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums text-ink">
                        {num(r.nodig)}
                      </td>
                      <td
                        className={[
                          "border-b border-line px-3 py-2 text-right font-semibold tabular-nums",
                          nog === 0 ? "text-green-dark" : "text-[#C45A12]",
                        ].join(" ")}
                      >
                        {nog === 0 ? "—" : num(nog)}
                      </td>
                      <td className="border-b border-line px-3 py-2 text-right tabular-nums text-muted">
                        {num(r.slotsOpen)}
                      </td>
                    </tr>
                  );
                })}
                {data ? (
                  <tr className="bg-[#EEF3F0] font-semibold">
                    <td className="border-b border-line px-3 py-2.5 text-ink">
                      Team (zelfde als balk)
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums text-ink">
                      {num(
                        data.bars.find((b) => b.id === "afspraken")?.actual ?? 0
                      )}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums text-ink">
                      {num(
                        data.bars.find((b) => b.id === "afspraken")?.target ?? 0
                      )}
                    </td>
                    <td
                      className={[
                        "border-b border-line px-3 py-2.5 text-right tabular-nums",
                        (data.bars.find((b) => b.id === "afspraken")
                          ?.onTrack ?? false)
                          ? "text-green-dark"
                          : "text-[#C45A12]",
                      ].join(" ")}
                    >
                      {(() => {
                        const b = data.bars.find((x) => x.id === "afspraken");
                        const nog = Math.max(
                          0,
                          (b?.target ?? 0) - (b?.actual ?? 0)
                        );
                        return nog === 0 ? "—" : num(nog);
                      })()}
                    </td>
                    <td className="border-b border-line px-3 py-2.5 text-right tabular-nums text-muted">
                      {num(data.afsprakenMeta?.slotsOpen ?? 0)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}
