"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { InkomendeFactuur } from "@/types/database";
import {
  inkomendBoekDatum,
  inkomendPeriodeKey,
  inkomendPeriodeLabel,
} from "@/lib/inkomende-facturen";
import { formatDateShort } from "@/lib/format";

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function formatEuro(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

type PeriodeGroup = {
  key: string;
  label: string;
  items: InkomendeFactuur[];
  totalInc: number;
  totalBtw: number;
};

export function InkomendPanel() {
  const [items, setItems] = useState<InkomendeFactuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/inkomend");
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

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const groups = useMemo((): PeriodeGroup[] => {
    const map = new Map<string, InkomendeFactuur[]>();
    for (const item of items) {
      const ymd = inkomendBoekDatum(item);
      const key = inkomendPeriodeKey(ymd, "maand");
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, groupItems]) => {
        let totalInc = 0;
        let totalBtw = 0;
        for (const i of groupItems) {
          totalInc += Number(i.bedrag_inc_btw ?? i.bedrag_ex_btw ?? 0) || 0;
          totalBtw += Number(i.btw_bedrag ?? 0) || 0;
        }
        return {
          key,
          label: inkomendPeriodeLabel(key, "maand"),
          items: groupItems,
          totalInc,
          totalBtw,
        };
      });
  }, [items]);

  useEffect(() => {
    if (!groups.length) return;
    setOpenFolders((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      return { [groups[0].key]: true };
    });
  }, [groups]);

  function toggleFolder(key: string) {
    setOpenFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3">
        <p className="text-sm text-muted">
          Facturen per maand · binnenkomend mail wordt automatisch verwerkt
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-wash"
        >
          Vernieuwen
        </button>
      </div>

      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : items.length === 0 ? (
        <div className="border border-line bg-white px-6 py-14 text-center">
          <p className="font-display text-lg text-ink">Nog niets binnengekomen</p>
          <p className="mt-1 text-sm text-muted">
            Facturen die binnenkomen via e-mail verschijnen hier per maand.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden border border-line bg-white">
          <div className="border-b border-line bg-wash/40 px-4 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Mappen
            </p>
          </div>
          <ul className="divide-y divide-line">
            {groups.map((group) => {
              const open = Boolean(openFolders[group.key]);
              return (
                <li key={group.key}>
                  <button
                    type="button"
                    onClick={() => toggleFolder(group.key)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-wash"
                  >
                    <span className="text-[#CA8A04]">
                      <FolderIcon />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium capitalize text-ink">
                        {group.label}
                      </span>
                      <span className="text-[11px] text-muted">
                        {group.items.length} factuur
                        {group.items.length === 1 ? "" : "en"}
                        {group.totalBtw > 0
                          ? ` · btw ${formatEuro(group.totalBtw)}`
                          : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-green-deeper">
                      {formatEuro(group.totalInc)}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {open ? "▾" : "▸"}
                    </span>
                  </button>

                  {open ? (
                    <ul className="divide-y divide-line border-t border-line bg-wash/20">
                      {group.items.map((item) => {
                        const firstFile = item.bestanden?.[0];
                        return (
                          <li
                            key={item.id}
                            className="flex items-start gap-3 px-4 py-3 pl-11"
                          >
                            <span className="mt-0.5 shrink-0 text-muted">
                              <FileIcon />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold text-ink">
                                {item.leverancier ||
                                  item.subject ||
                                  "(geen onderwerp)"}
                              </span>
                              <span className="block text-xs text-muted">
                                {item.factuurdatum
                                  ? formatDateShort(item.factuurdatum)
                                  : "—"}
                                {item.bestanden?.length
                                  ? ` · ${item.bestanden.length} bijlage${
                                      item.bestanden.length === 1 ? "" : "n"
                                    }`
                                  : ""}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-sm font-semibold tabular-nums text-ink">
                                {formatEuro(
                                  item.bedrag_inc_btw ?? item.bedrag_ex_btw
                                )}
                              </span>
                              {firstFile?.url ? (
                                <a
                                  href={firstFile.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-block text-xs font-semibold text-green-dark hover:underline"
                                >
                                  Openen
                                </a>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
