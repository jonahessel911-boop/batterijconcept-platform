"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getISOWeek, getISOWeekYear } from "date-fns";
import { toZonedTime } from "date-fns-tz";
import type { InkomendeFactuur } from "@/types/database";
import {
  inkomendBoekDatum,
  inkomendPeriodeKey,
  inkomendPeriodeLabel,
} from "@/lib/inkomende-facturen";
import { AMSTERDAM_TZ, formatDateShort } from "@/lib/format";

function formatEuro(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function totalsOf(items: InkomendeFactuur[]): {
  totalInc: number;
  totalBtw: number;
} {
  let totalInc = 0;
  let totalBtw = 0;
  for (const i of items) {
    totalInc += Number(i.bedrag_inc_btw ?? i.bedrag_ex_btw ?? 0) || 0;
    totalBtw += Number(i.btw_bedrag ?? 0) || 0;
  }
  return { totalInc: round2(totalInc), totalBtw: round2(totalBtw) };
}

function weekKeyFromYmd(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "onbekend";
  const z = toZonedTime(new Date(`${ymd}T12:00:00`), AMSTERDAM_TZ);
  const jaar = getISOWeekYear(z);
  const week = getISOWeek(z);
  return `${jaar}-W${String(week).padStart(2, "0")}`;
}

function weekLabel(key: string): string {
  if (key === "onbekend") return "Onbekende week";
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return key;
  return `W${Number(m[2])} · ${m[1]}`;
}

type LeafGroup = {
  key: string;
  label: string;
  items: InkomendeFactuur[];
  totalInc: number;
  totalBtw: number;
};

type MonthGroup = LeafGroup & { weeks: LeafGroup[] };
type QuarterGroup = LeafGroup & { months: MonthGroup[] };

function needsAiScan(item: InkomendeFactuur): boolean {
  const hasAmount =
    item.bedrag_inc_btw != null || item.bedrag_ex_btw != null;
  const hasFile = (item.bestanden?.length || 0) > 0;
  return hasFile && (!hasAmount || !item.factuurdatum);
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span className="inline-block w-3 shrink-0 text-[10px] text-muted">
      {open ? "▾" : "▸"}
    </span>
  );
}

function MoneyCell({
  inc,
  btw,
  accent,
}: {
  inc: number;
  btw: number;
  accent?: boolean;
}) {
  return (
    <span className="shrink-0 text-right leading-tight">
      <span
        className={[
          "block text-[11px] font-semibold tabular-nums",
          accent ? "text-green-deeper" : "text-ink",
        ].join(" ")}
      >
        {formatEuro(inc)}
      </span>
      <span className="block text-[9px] tabular-nums text-muted">
        btw {formatEuro(btw)}
      </span>
    </span>
  );
}

export function InkomendPanel() {
  const [items, setItems] = useState<InkomendeFactuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [scanningId, setScanningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inkomend?limit=200");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setItems((data.items || []) as InkomendeFactuur[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  async function rescan(id: string) {
    setScanningId(id);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/inkomend/${id}/scan`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          [data.error, data.detail].filter(Boolean).join(" — ") ||
            "AI-scan mislukt"
        );
      }
      const next = data.item as InkomendeFactuur | undefined;
      if (next) {
        setItems((prev) => prev.map((i) => (i.id === id ? next : i)));
      } else {
        await load();
      }
      const extract = data.extract as {
        bedrag_inc_btw?: number | null;
        btw_bedrag?: number | null;
      } | null;
      setOkMsg(
        extract?.bedrag_inc_btw != null
          ? `Uitgelezen: ${formatEuro(extract.bedrag_inc_btw)}${
              extract.btw_bedrag != null
                ? ` (btw ${formatEuro(extract.btw_bedrag)})`
                : ""
            }`
          : "AI-scan klaar"
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI-scan mislukt");
    } finally {
      setScanningId(null);
    }
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const tree = useMemo((): QuarterGroup[] => {
    const byQ = new Map<string, InkomendeFactuur[]>();
    for (const item of items) {
      const ymd = inkomendBoekDatum(item);
      const qKey = inkomendPeriodeKey(ymd, "kwartaal");
      const list = byQ.get(qKey) || [];
      list.push(item);
      byQ.set(qKey, list);
    }

    return [...byQ.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([qKey, qItems]) => {
        const byM = new Map<string, InkomendeFactuur[]>();
        for (const item of qItems) {
          const ymd = inkomendBoekDatum(item);
          const mKey = inkomendPeriodeKey(ymd, "maand");
          const list = byM.get(mKey) || [];
          list.push(item);
          byM.set(mKey, list);
        }

        const months: MonthGroup[] = [...byM.entries()]
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([mKey, mItems]) => {
            const byW = new Map<string, InkomendeFactuur[]>();
            for (const item of mItems) {
              const ymd = inkomendBoekDatum(item);
              const wKey = weekKeyFromYmd(ymd);
              const list = byW.get(wKey) || [];
              list.push(item);
              byW.set(wKey, list);
            }
            const weeks: LeafGroup[] = [...byW.entries()]
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([wKey, wItems]) => {
                const sorted = [...wItems].sort((a, b) =>
                  inkomendBoekDatum(b).localeCompare(inkomendBoekDatum(a))
                );
                const t = totalsOf(sorted);
                return {
                  key: wKey,
                  label: weekLabel(wKey),
                  items: sorted,
                  ...t,
                };
              });
            const t = totalsOf(mItems);
            return {
              key: mKey,
              label: inkomendPeriodeLabel(mKey, "maand"),
              items: mItems,
              weeks,
              ...t,
            };
          });

        const t = totalsOf(qItems);
        return {
          key: qKey,
          label: inkomendPeriodeLabel(qKey, "kwartaal"),
          items: qItems,
          months,
          ...t,
        };
      });
  }, [items]);

  useEffect(() => {
    if (!tree.length) return;
    setOpen((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const q = tree[0];
      const m = q.months[0];
      const w = m?.weeks[0];
      return {
        [`q:${q.key}`]: true,
        ...(m ? { [`m:${m.key}`]: true } : {}),
        ...(w ? { [`w:${m.key}:${w.key}`]: true } : {}),
      };
    });
  }, [tree]);

  function toggle(key: string) {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 border border-line bg-white px-3 py-2">
        <p className="text-[11px] text-muted">
          Kwartaal → maand → week · AI leest bijlagen uit
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="border border-line bg-white px-2 py-1 text-[11px] font-semibold text-muted hover:bg-wash hover:text-ink"
        >
          Vernieuwen
        </button>
      </div>

      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-2 py-1.5 text-[11px] text-[#C45A12]">
          {error}
        </p>
      )}
      {okMsg && (
        <p className="border border-green/30 bg-green-soft/40 px-2 py-1.5 text-[11px] text-green-deeper">
          {okMsg}
        </p>
      )}

      {loading ? (
        <p className="py-8 text-center text-xs text-muted">Laden…</p>
      ) : items.length === 0 ? (
        <div className="border border-line bg-white px-4 py-10 text-center">
          <p className="text-sm font-semibold text-ink">Nog niets binnengekomen</p>
          <p className="mt-0.5 text-[11px] text-muted">
            Facturen via e-mail verschijnen hier.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden border border-line bg-white">
          <ul>
            {tree.map((q) => {
              const qOpen = Boolean(open[`q:${q.key}`]);
              return (
                <li key={q.key} className="border-b border-line last:border-0">
                  <button
                    type="button"
                    onClick={() => toggle(`q:${q.key}`)}
                    className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-wash"
                  >
                    <Chevron open={qOpen} />
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold uppercase tracking-wide text-ink">
                      {q.label}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-muted">
                      {q.items.length}
                    </span>
                    <MoneyCell inc={q.totalInc} btw={q.totalBtw} accent />
                  </button>

                  {qOpen
                    ? q.months.map((m) => {
                        const mOpen = Boolean(open[`m:${m.key}`]);
                        return (
                          <div key={m.key} className="border-t border-line/70">
                            <button
                              type="button"
                              onClick={() => toggle(`m:${m.key}`)}
                              className="flex w-full items-center gap-2 py-1 pl-5 pr-2 text-left hover:bg-wash"
                            >
                              <Chevron open={mOpen} />
                              <span className="min-w-0 flex-1 truncate text-[12px] font-medium capitalize text-ink">
                                {m.label}
                              </span>
                              <span className="shrink-0 text-[10px] tabular-nums text-muted">
                                {m.items.length}
                              </span>
                              <MoneyCell inc={m.totalInc} btw={m.totalBtw} />
                            </button>

                            {mOpen
                              ? m.weeks.map((w) => {
                                  const wKey = `w:${m.key}:${w.key}`;
                                  const wOpen = Boolean(open[wKey]);
                                  return (
                                    <div
                                      key={wKey}
                                      className="border-t border-line/50"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => toggle(wKey)}
                                        className="flex w-full items-center gap-2 py-1 pl-8 pr-2 text-left hover:bg-wash"
                                      >
                                        <Chevron open={wOpen} />
                                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-ink">
                                          {w.label}
                                        </span>
                                        <span className="shrink-0 text-[10px] tabular-nums text-muted">
                                          {w.items.length}
                                        </span>
                                        <MoneyCell
                                          inc={w.totalInc}
                                          btw={w.totalBtw}
                                        />
                                      </button>

                                      {wOpen ? (
                                        <ul className="border-t border-line/40 bg-wash/30">
                                          {w.items.map((item) => {
                                            const firstFile =
                                              item.bestanden?.[0];
                                            const scanNeeded =
                                              needsAiScan(item);
                                            return (
                                              <li
                                                key={item.id}
                                                className="flex items-center gap-1.5 border-b border-line/40 py-1 pl-11 pr-2 last:border-0"
                                              >
                                                <span className="min-w-0 flex-1 truncate text-[11px] text-ink">
                                                  <span className="font-medium">
                                                    {item.leverancier ||
                                                      item.subject ||
                                                      "—"}
                                                  </span>
                                                  <span className="text-muted">
                                                    {" · "}
                                                    {item.factuurdatum
                                                      ? formatDateShort(
                                                          item.factuurdatum
                                                        )
                                                      : "—"}
                                                    {scanNeeded
                                                      ? " · niet uitgelezen"
                                                      : ""}
                                                  </span>
                                                </span>
                                                <span className="flex shrink-0 items-center gap-1.5">
                                                  {firstFile?.url ? (
                                                    <a
                                                      href={firstFile.url}
                                                      target="_blank"
                                                      rel="noreferrer"
                                                      className="text-[10px] font-semibold text-green-dark hover:underline"
                                                    >
                                                      Open
                                                    </a>
                                                  ) : null}
                                                  {item.bestanden?.length ? (
                                                    <button
                                                      type="button"
                                                      disabled={
                                                        scanningId === item.id
                                                      }
                                                      onClick={() =>
                                                        void rescan(item.id)
                                                      }
                                                      className={[
                                                        "text-[10px] font-semibold disabled:opacity-60",
                                                        scanNeeded
                                                          ? "text-[#C45A12] hover:underline"
                                                          : "text-muted hover:text-ink hover:underline",
                                                      ].join(" ")}
                                                    >
                                                      {scanningId === item.id
                                                        ? "…"
                                                        : "Scan"}
                                                    </button>
                                                  ) : null}
                                                  <MoneyCell
                                                    inc={
                                                      Number(
                                                        item.bedrag_inc_btw ??
                                                          item.bedrag_ex_btw ??
                                                          0
                                                      ) || 0
                                                    }
                                                    btw={
                                                      Number(
                                                        item.btw_bedrag ?? 0
                                                      ) || 0
                                                    }
                                                  />
                                                </span>
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      ) : null}
                                    </div>
                                  );
                                })
                              : null}
                          </div>
                        );
                      })
                    : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
