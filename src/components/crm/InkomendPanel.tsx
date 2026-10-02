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

function waarvoorVan(item: InkomendeFactuur): string | null {
  const n = item.notitie?.trim();
  if (!n) return null;
  const line = n
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith("waarvoor:"));
  if (line) return line.replace(/^waarvoor:\s*/i, "").trim() || null;
  // Fallback: eerste regel zonder meta-prefix
  const first = n.split("\n")[0]?.trim();
  if (
    first &&
    !/^factuurnr:/i.test(first) &&
    !/^boekperiode:/i.test(first) &&
    !/^btw:/i.test(first)
  ) {
    return first;
  }
  return null;
}

function boekperiodeLabel(item: InkomendeFactuur): string {
  const ymd = inkomendBoekDatum(item);
  const key = inkomendPeriodeKey(ymd, "maand");
  return inkomendPeriodeLabel(key, "maand");
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
  totalBtw: number;
};

export function InkomendPanel() {
  const [items, setItems] = useState<InkomendeFactuur[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [periodeMode, setPeriodeMode] =
    useState<InkomendPeriodeMode>("maand");
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [scanAllBusy, setScanAllBusy] = useState(false);

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
        const totalBtw = sorted.reduce(
          (sum, i) => sum + (i.btw_bedrag ?? 0),
          0
        );
        return {
          key,
          label: inkomendPeriodeLabel(key, periodeMode),
          items: sorted,
          totalInc,
          totalBtw,
        };
      })
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [items, periodeMode]);

  // Open nieuwste map standaard
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
      const extract = data.extract as
        | { boekperiode?: string; omschrijving?: string }
        | undefined;
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, ...updated } : i))
      );
      const periode =
        extract?.boekperiode ||
        (updated.factuurdatum
          ? updated.factuurdatum.slice(0, 7)
          : null);
      setInfo(
        data.booked
          ? `Gescand en geboekt${periode ? ` op ${periode}` : ""}${
              extract?.omschrijving ? ` · ${extract.omschrijving}` : ""
            }.`
          : `Gescand — controleer de gegevens${
              periode ? ` (periode ${periode})` : ""
            }.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI-scan mislukt");
    } finally {
      setScanningId(null);
    }
  }

  async function scanUnscanned() {
    const todo = items.filter(
      (i) =>
        !i.factuurdatum &&
        (i.bestanden?.length || 0) > 0 &&
        (i.status === "nieuw" || i.status === "in_behandeling")
    );
    if (!todo.length) {
      setInfo("Geen openstaande posten zonder factuurdatum om te scannen.");
      return;
    }
    setScanAllBusy(true);
    setError(null);
    setInfo(null);
    let ok = 0;
    let fail = 0;
    for (const item of todo.slice(0, 15)) {
      try {
        const res = await fetch(`/api/inkomend/${item.id}/scan`, {
          method: "POST",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          fail += 1;
          continue;
        }
        const updated = data.item as InkomendeFactuur;
        setItems((prev) =>
          prev.map((i) => (i.id === item.id ? { ...i, ...updated } : i))
        );
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setScanAllBusy(false);
    setInfo(
      `AI-scan klaar: ${ok} gelukt${fail ? `, ${fail} mislukt` : ""}.`
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border border-line bg-white px-4 py-3">
        <div>
          <p className="text-sm text-muted">
            AI leest foto/PDF uit (btw, totaal, waarvoor) en boekt in de juiste
            maandmap.
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
                onClick={() => {
                  setPeriodeMode(id);
                  setOpenFolders({});
                }}
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
            disabled={scanAllBusy || loading}
            onClick={() => void scanUnscanned()}
            className="border border-green bg-green-soft px-3 py-2 text-sm font-semibold text-green-deeper hover:bg-green hover:text-white disabled:opacity-50"
          >
            {scanAllBusy ? "Scannen…" : "Scan openstaand"}
          </button>
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
          <div className="overflow-hidden border border-line bg-white">
            <div className="border-b border-line bg-wash/40 px-4 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
                Mappen · {periodeMode}
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
                          Map · {group.items.length} stuk
                          {group.items.length === 1 ? "" : "s"}
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
                          const active = item.id === selectedId;
                          const nFiles = item.bestanden?.length || 0;
                          const waarvoor = waarvoorVan(item);
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => setSelectedId(item.id)}
                                className={[
                                  "flex w-full items-start gap-3 px-4 py-3 pl-11 text-left transition",
                                  active
                                    ? "bg-green-soft/70"
                                    : "hover:bg-wash/70",
                                ].join(" ")}
                              >
                                <span className="mt-0.5 shrink-0 text-muted">
                                  <FileIcon />
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex flex-wrap items-center gap-2">
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
                                        {nFiles} bijlage
                                        {nFiles === 1 ? "" : "n"}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="mt-0.5 block truncate text-sm font-semibold text-ink">
                                    {item.leverancier ||
                                      item.subject ||
                                      "(geen onderwerp)"}
                                  </span>
                                  <span className="block truncate text-xs text-muted">
                                    {waarvoor ||
                                      (item.leverancier && item.subject
                                        ? item.subject
                                        : item.from_email ||
                                          item.from_name ||
                                          "")}
                                  </span>
                                </span>
                                <span className="shrink-0 text-right">
                                  <span className="block text-sm font-semibold tabular-nums text-ink">
                                    {formatEuro(
                                      item.bedrag_inc_btw ?? item.bedrag_ex_btw
                                    )}
                                  </span>
                                  {item.btw_bedrag != null ? (
                                    <span className="block text-[11px] tabular-nums text-muted">
                                      btw {formatEuro(item.btw_bedrag)}
                                    </span>
                                  ) : null}
                                </span>
                              </button>
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

          <div className="border border-line bg-white lg:sticky lg:top-4 lg:self-start">
            {!selected ? (
              <p className="px-5 py-12 text-center text-sm text-muted">
                Open een map en selecteer een factuur.
              </p>
            ) : (
              <div className="flex flex-col gap-4 p-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    Leverancier
                  </p>
                  <h2 className="mt-1 font-display text-lg font-semibold text-ink">
                    {selected.leverancier ||
                      selected.subject ||
                      "(geen onderwerp)"}
                  </h2>
                  {waarvoorVan(selected) ? (
                    <p className="mt-1 text-sm text-ink">
                      <span className="text-muted">Waarvoor · </span>
                      {waarvoorVan(selected)}
                    </p>
                  ) : selected.leverancier && selected.subject ? (
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
                      Boekperiode
                    </p>
                    <p className="mt-0.5 text-sm font-semibold capitalize text-ink">
                      {boekperiodeLabel(selected)}
                    </p>
                  </div>
                  <div className="border border-line bg-wash/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Totaal incl. btw
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                      {formatEuro(selected.bedrag_inc_btw)}
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
                  <div className="col-span-2 border border-line bg-wash/40 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                      Excl. btw
                    </p>
                    <p className="mt-0.5 text-sm font-semibold tabular-nums text-ink">
                      {formatEuro(selected.bedrag_ex_btw)}
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
                      ? "AI scant foto…"
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
