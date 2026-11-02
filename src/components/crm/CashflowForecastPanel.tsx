"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { CashflowForecast, CashflowOrder } from "@/lib/cashflow-forecast";
import { formatEuro } from "@/lib/format";

function euro(n: number): string {
  return formatEuro(n);
}

function datum(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
  });
}

export function CashflowForecastPanel() {
  const [data, setData] = useState<CashflowForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/dashboard-v2/cashflow", { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          forecast?: CashflowForecast;
        };
        if (!res.ok) throw new Error(json.error || "Laden mislukt");
        if (!cancelled) setData(json.forecast || null);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Laden mislukt");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="rounded-2xl border border-line bg-white">
      <div className="border-b border-line px-4 py-4 sm:px-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Forecast kasstroom
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-ink">
          Warmtefonds ongeveer 5 weken na ondertekening binnen. Installatie
          ongeveer 6 weken na ondertekening, of op de geplande datum: die week
          gaan salescommissie, installatie en inkoop eruit. Hold en
          annuleringen tellen niet mee.
        </p>
      </div>

      {loading ? (
        <p className="px-5 py-6 text-sm text-muted">Kasforecast laden…</p>
      ) : error ? (
        <p className="px-5 py-6 text-sm text-[#C62828]">{error}</p>
      ) : !data || data.orders.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted">
          Geen open orders met verwachte kasstroom.
        </p>
      ) : (
        <div className="space-y-6 px-4 py-4 sm:px-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Total label="Inkomend" value={data.totaalIn} tone="in" />
            <Total label="Uitgaand" value={data.totaalUit} tone="out" />
            <Total label="Netto" value={data.totaalNetto} tone="net" />
          </div>
          {data.holdAantal > 0 || data.annuleringAantal > 0 ? (
            <p className="text-xs text-muted">
              Niet meegenomen: {data.holdAantal} hold (
              {euro(data.holdOmzet)}) · {data.annuleringAantal} annuleringen (
              {euro(data.annuleringOmzet)}).
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3 font-semibold">Week</th>
                  <th className="py-2 pr-3 text-right font-semibold">In</th>
                  <th className="py-2 pr-3 text-right font-semibold">Commissie</th>
                  <th className="py-2 pr-3 text-right font-semibold">Installatie</th>
                  <th className="py-2 pr-3 text-right font-semibold">Inkoop</th>
                  <th className="py-2 pr-3 text-right font-semibold">Uit</th>
                  <th className="py-2 text-right font-semibold">Netto</th>
                </tr>
              </thead>
              <tbody>
                {data.weeks.map((week) => (
                  <tr key={week.weekKey} className="border-b border-line/70">
                    <td className="py-2 pr-3 font-medium text-ink">{week.label}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[#0D5C32]">
                      {week.inkomend ? euro(week.inkomend) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">
                      {week.commissie ? euro(week.commissie) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">
                      {week.installatie ? euro(week.installatie) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted">
                      {week.inkoop ? euro(week.inkoop) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-[#C62828]">
                      {week.uitgaand ? euro(week.uitgaand) : "—"}
                    </td>
                    <td
                      className={[
                        "py-2 text-right font-semibold tabular-nums",
                        week.netto >= 0 ? "text-ink" : "text-[#C62828]",
                      ].join(" ")}
                    >
                      {euro(week.netto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Per order
            </p>
            <div className="max-h-[28rem] overflow-auto">
              <table className="w-full min-w-[960px] text-left text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-line text-[11px] uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3 font-semibold">Klant</th>
                    <th className="py-2 pr-3 text-right font-semibold">Omzet ex</th>
                    <th className="py-2 pr-3 font-semibold">Binnen</th>
                    <th className="py-2 pr-3 text-right font-semibold">Inkomend</th>
                    <th className="py-2 pr-3 font-semibold">Uit</th>
                    <th className="py-2 pr-3 text-right font-semibold">Commissie</th>
                    <th className="py-2 pr-3 text-right font-semibold">Installatie</th>
                    <th className="py-2 pr-3 text-right font-semibold">Inkoop</th>
                    <th className="py-2 text-right font-semibold">Netto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders.map((order) => (
                    <OrderRow key={order.offerteId} order={order} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Total({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "in" | "out" | "net";
}) {
  const color =
    tone === "in"
      ? "text-[#0D5C32]"
      : tone === "out"
        ? "text-[#C62828]"
        : value >= 0
          ? "text-ink"
          : "text-[#C62828]";
  return (
    <div className="rounded-xl border border-line bg-wash/50 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>
        {euro(value)}
      </p>
    </div>
  );
}

function OrderRow({ order }: { order: CashflowOrder }) {
  const name = order.projectId ? (
    <Link href={`/projecten/${order.projectId}`} className="font-semibold text-ink hover:underline">
      {order.klant}
    </Link>
  ) : (
    <span className="font-semibold text-ink">{order.klant}</span>
  );
  return (
    <tr className="border-b border-line/70 align-top">
      <td className="py-2 pr-3">
        {name}
        <span className="mt-0.5 block text-[11px] text-muted">
          {order.vorm === "wf" ? "Warmtefonds" : "Eigen middelen"}
          {order.uitsluiting === "hold"
            ? " · hold"
            : order.uitsluiting === "annulering"
              ? " · geannuleerd"
              : ""}
        </span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-ink">
        {euro(order.omzetEx)}
      </td>
      <td className="py-2 pr-3 text-ink">
        <span className="block">{datum(order.inDatum)}</span>
        <span className="block text-[11px] text-muted">{order.inLabel}</span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-[#0D5C32]">
        {order.inkomend ? euro(order.inkomend) : "—"}
      </td>
      <td className="py-2 pr-3 text-ink">
        <span className="block">{datum(order.uitDatum)}</span>
        <span className="block text-[11px] text-muted">{order.uitLabel}</span>
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-muted">
        {order.commissie ? euro(order.commissie) : "—"}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-muted">
        {order.installatie ? euro(order.installatie) : "—"}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums text-muted">
        {order.inkoop ? euro(order.inkoop) : "—"}
      </td>
      <td
        className={[
          "py-2 text-right font-semibold tabular-nums",
          order.netto >= 0 ? "text-ink" : "text-[#C62828]",
        ].join(" ")}
      >
        {euro(order.netto)}
      </td>
    </tr>
  );
}
