"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  InkomendeFactuur,
  InkomendeFactuurStatus,
} from "@/types/database";
import {
  INKOMENDE_FACTUUR_STATUSES,
  INKOMENDE_FACTUUR_STATUS_LABEL,
  inkomendBoekDatum,
  inkomendPeriodeKey,
  inkomendPeriodeLabel,
  type InkomendPeriodeMode,
} from "@/lib/inkomende-facturen";
import { formatDateShort, formatDateTimeNl } from "@/lib/format";

function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatEuro(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
  }).format(n);
}

const STATUS_TONE: Record<InkomendeFactuurStatus, string> = {
  nieuw: "bg-[#E8F0F6] text-[#1A4A6E]",
  in_behandeling: "bg-[#FEF7E6] text-[#854D0E]",
  geboekt: "bg-[#E8F6EC] text-[#0D5C32]",
  afgewezen: "bg-[#FCEAEA] text-[#9B2C2C]",
  archief: "bg-[#F3F4F6] text-[#4B5563]",
};

type PeriodeGroup = {
  key: string;
  label: string;
  items: InkomendeFactuur[];
  totalInc: number;
};

export function InkomendPanel() {
  const [items, setItems] = useState<InkomendeFactuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [periodeMode, setPeriodeMode] =
    useState<InkomendPeriodeMode>("maand");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);

  const selected = items.find((i) => i.id === selectedId) || null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = statusFilter
        ? `?status=${encodeURIComponent(statusFilter)}`
        : "";
      const res = await fetch(`/api/inkomend${q}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setItems((data.items || []) as InkomendeFactuur[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(frame);
  }, [load]);

  const groups = useMemo((): PeriodeGroup[] => {
    const map = new Map<string, InkomendeFactuur[]>();
    for (const item of items) {
      const ymd = inkomendBoekDatum(item);
      const key = inkomendPeriodeKey(ymd, periodeMode);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()]
      .map(([key, list]) => {
        const sorted = [...list].sort((a, b) =>
          inkomendBoekDatum(b).localeCompare(inkomendBoekDatum(a))
        );
        const totalInc = sorted.reduce(
          (sum, i) => sum + (i.bedrag_inc_btw ?? i.bedrag_ex_btw ?? 0),
          0
        );
        return {
          key,
          label: inkomendPeriodeLabel(key, periodeMode),
          items: sorted,
          totalInc,
        };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [items, periodeMode]);

  async function setStatus(id: string, status: InkomendeFactuurStatus) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch("/api/inkomend", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      const updated = data.item as InkomendeFactuur;
      setItems((prev) =>
        prev.map((i) =>
          i.id === id ? { ...i, ...updated, bestanden: i.bestanden } : i
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Opslaan mislukt");
    } finally {
      setBusyId(null);
    }
  }

  async function scanItem(id: string) {
    setScanningId(id);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch(`/api/inkomend/${id}/scan`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.error || "AI-scan mislukt");
      }
      const updated = data.item as InkomendeFactuur;
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, ...updated } : i))
      );
      setInfo(
        data.booked
          ? `Gescand en geboekt op ${updated.factuurdatum || "periode"}.`
          : `Gescand — controleer de gegevens${
              updated.factuurdatum ? ` (${updated.factuurdatum})` : ""
            }.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI-scan mislukt");
    } finally {
      setScanningId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3">
        <div>
          <p className="text-sm text-muted">
            Facturen/bonnetjes via Postmark · AI leest PDF/foto uit en boekt op
            factuurdatum.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-line p-0.5">
            {(
              [
                ["maand", "Maand"],
                ["kwartaal", "Kwartaal"],
                ["jaar", "Jaar"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPeriodeMode(id)}
                className={[
                  "px-3 py-1.5 text-sm font-medium transition",
                  periodeMode === id
                    ? "bg-green text-white"
                    : "bg-white text-ink hover:bg-wash",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            aria-label="Filter op status"
          >
            <option value="">Alle statussen</option>
            {INKOMENDE_FACTUUR_STATUSES.map((s) => (
              <option key={s} value={s}>
                {INKOMENDE_FACTUUR_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="border border-line bg-white px-3 py-2 text-sm font-medium text-ink hover:bg-wash"
          >
            Vernieuwen
          </button>
        </div>
      </div>

      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}
      {info && (
        <p className="border border-green/30 bg-[#E8F6EC] px-3 py-2 text-xs text-green-deeper">
          {info}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : items.length === 0 ? (
        <div className="border border-line bg-white px-6 py-14 text-center">
          <p className="font-display text-lg text-ink">Nog niets binnengekomen</p>
          <p className="mt-1 text-sm text-muted">
            Stuur een factuur of bonnetje naar je Postmark inbound-adres.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <details
                key={group.key}
                open={group.key === groups[0]?.key}
                className="group border border-line bg-white"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none hover:bg-wash/50 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-ink group-open:hidden">▶</span>
                    <span className="hidden text-ink group-open:inline">▼</span>
                    <div className="min-w-0">
                      <p className="font-display text-sm font-semibold capitalize text-ink">
                        {group.label}
                      </p>
                      <p className="text-xs text-muted">
                        {group.items.length} stuk
                        {group.items.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums text-green-deeper">
                    {formatEuro(group.totalInc)}
                  </p>
                </summary>

                <ul className="divide-y divide-line border-t border-line">
                  {group.items.map((item) => {
                    const active = item.id === selectedId;
                    const nFiles = item.bestanden?.length || 0;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          className={[
                            "flex w-full flex-col gap-1 px-4 py-3 text-left transition sm:px-5",
                            active ? "bg-green-soft/60" : "hover:bg-wash/60",
                          ].join(" ")}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={[
                                "px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                                STATUS_TONE[item.status],
                              ].join(" ")}
                            >
                              {INKOMENDE_FACTUUR_STATUS_LABEL[item.status]}
                            </span>
                            <span className="text-xs tabular-nums text-muted">
                              {item.factuurdatum
                                ? formatDateShort(item.factuurdatum)
                                : formatDateTimeNl(
                                    item.received_at || item.created_at
                                  )}
                            </span>
                            {nFiles > 0 ? (
                              <span className="text-xs text-muted">
                                {nFiles} bijlage{nFiles === 1 ? "" : "n"}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-ink">
                                {item.leverancier ||
                                  item.subject ||
                                  "(geen onderwerp)"}
                              </p>
                              <p className="truncate text-xs text-muted">
                                {item.leverancier && item.subject
                                  ? item.subject
                                  : item.from_email || item.from_name || ""}
                              </p>
                            </div>
                            <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">
                              {formatEuro(
                                item.bedrag_inc_btw ?? item.bedrag_ex_btw
                              )}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </details>
            ))}
          </div>

          <div className="border border-line bg-white lg:sticky lg:top-4 lg:self-start">
            {!selected ? (
              <p className="px-5 py-12 text-center text-sm text-muted">
                Selecteer een post links.
              </p>
            ) : (
              <div className="flex flex-col gap-4 p-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Leverancier / onderwerp
                  </p>
                  <h2 className="mt-1 font-display text-lg font-semibold text-ink">
                    {selected.leverancier ||
                      selected.subject ||
                      "(geen onderwerp)"}
                  </h2>
                  {selected.leverancier && selected.subject ? (
                    <p className="mt-0.5 text-sm text-muted">{selected.subject}</p>
                  ) : null}
                  <p className="mt-1 text-sm text-muted">
                    Van{" "}
                    <span className="text-ink">
                      {selected.from_name || selected.from_email || "—"}
                    </span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="border border-line bg-wash/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Factuurdatum
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                      {selected.factuurdatum
                        ? formatDateShort(selected.factuurdatum)
                        : "—"}
                    </p>
                  </div>
                  <div className="border border-line bg-wash/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Totaal incl.
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                      {formatEuro(selected.bedrag_inc_btw)}
                    </p>
                  </div>
                  <div className="border border-line bg-wash/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Excl. btw
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                      {formatEuro(selected.bedrag_ex_btw)}
                    </p>
                  </div>
                  <div className="border border-line bg-wash/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Btw
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                      {formatEuro(selected.btw_bedrag)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={
                      scanningId === selected.id ||
                      !(selected.bestanden || []).length
                    }
                    onClick={() => void scanItem(selected.id)}
                    className="bg-green px-4 py-2 text-sm font-semibold text-white hover:bg-green-deeper disabled:opacity-50"
                  >
                    {scanningId === selected.id
                      ? "AI scant…"
                      : selected.factuurdatum
                        ? "Opnieuw scannen"
                        : "AI scannen & boeken"}
                  </button>
                </div>

                <div>
                  <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Status
                  </label>
                  <select
                    value={selected.status}
                    disabled={busyId === selected.id}
                    onChange={(e) =>
                      void setStatus(
                        selected.id,
                        e.target.value as InkomendeFactuurStatus
                      )
                    }
                    className="w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
                  >
                    {INKOMENDE_FACTUUR_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {INKOMENDE_FACTUUR_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Bijlagen
                  </p>
                  {(selected.bestanden || []).length === 0 ? (
                    <p className="text-sm text-muted">Geen bijlagen</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {(selected.bestanden || []).map((b) => (
                        <li
                          key={b.id}
                          className="flex items-center justify-between gap-3 border border-line px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">
                              {b.bestandsnaam || "bijlage"}
                            </p>
                            <p className="text-xs text-muted">
                              {[b.mime_type, formatBytes(b.grootte_bytes)]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                          {b.url ? (
                            <a
                              href={b.url}
                              target="_blank"
                              rel="noreferrer"
                              className="shrink-0 border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                            >
                              Openen
                            </a>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {selected.notitie ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      Notitie / AI
                    </p>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap border border-line bg-wash/50 px-3 py-2.5 text-xs leading-relaxed text-ink">
                      {selected.notitie}
                    </pre>
                  </div>
                ) : null}

                {selected.body_text ? (
                  <div>
                    <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                      E-mail
                    </p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap border border-line bg-wash/50 px-3 py-2.5 text-xs leading-relaxed text-ink">
                      {selected.body_text}
                    </pre>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
