"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";

type CompactSlot = {
  adviseur_id: string;
  adviseur_naam: string;
  initials: string;
  start_at: string;
  end_at: string;
  day: string;
  time_label: string;
  busy: boolean;
};

type CompactPayload = {
  daysAhead: number;
  vrij: number;
  bezet: number;
  days: { ymd: string; label: string }[];
  adviseurs: { id: string; naam: string; initials: string }[];
  slots: CompactSlot[];
  error?: string;
};

/** Compacte agenda-heatmap voor Bellen-rapportage: groen=vrij, rood=bezet. */
export function BelSlotsCompactView({
  days = 14,
}: {
  days?: number;
}) {
  const [data, setData] = useState<CompactPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ days: String(days) });
      const res = await fetch(`/api/bel/slots-compact?${qs}`);
      const json = (await res.json().catch(() => ({}))) as CompactPayload;
      if (!res.ok) {
        throw new Error(json.error || "Compact overzicht laden mislukt");
      }
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, CompactSlot[]>();
    for (const s of data?.slots || []) {
      const list = map.get(s.day) || [];
      list.push(s);
      map.set(s.day, list);
    }
    return map;
  }, [data?.slots]);

  return (
    <div className="rounded-2xl border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            Compact view · agenda
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">
            {loading
              ? "Laden…"
              : data
                ? `${data.vrij} vrij · ${data.bezet} bezet · ${days} dagen`
                : "Open slots"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            Groen = vrij · rood = bezet · 2 letters = adviseur
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted">
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-4 py-3">
          {loading ? (
            <p className="text-sm text-muted">Agenda laden…</p>
          ) : error ? (
            <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              {error}{" "}
              <button
                type="button"
                onClick={() => void load()}
                className="font-semibold underline"
              >
                Opnieuw
              </button>
            </p>
          ) : !data || data.slots.length === 0 ? (
            <p className="text-sm text-muted">Geen open slots in {days} dagen.</p>
          ) : (
            <div className="space-y-3">
              {data.adviseurs.length > 0 ? (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
                  {data.adviseurs.map((a) => (
                    <span key={a.id}>
                      <strong className="text-ink">{a.initials}</strong>{" "}
                      {a.naam}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="max-h-[32rem] space-y-2.5 overflow-y-auto pr-0.5">
                {(data.days || []).map((day) => {
                  const daySlots = byDay.get(day.ymd) || [];
                  if (!daySlots.length) return null;
                  const sample = daySlots[0]!;
                  const dayLabel = formatInTimeZone(
                    sample.start_at,
                    AMSTERDAM_TZ,
                    "EEE d MMM",
                    { locale: nl }
                  );
                  const vrijCount = daySlots.filter((s) => !s.busy).length;
                  return (
                    <div key={day.ymd}>
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                        {dayLabel}
                        <span className="ml-1.5 font-normal normal-case tracking-normal">
                          {vrijCount} vrij / {daySlots.length}
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {daySlots.map((s) => {
                          const title = `${s.adviseur_naam} · ${s.time_label}${
                            s.busy ? " · bezet" : " · vrij"
                          }`;
                          return (
                            <span
                              key={`${s.adviseur_id}-${s.start_at}`}
                              title={title}
                              className={[
                                "inline-flex h-6 min-w-[1.75rem] items-center justify-center border px-1 text-[10px] font-bold uppercase tabular-nums tracking-tight",
                                s.busy
                                  ? "border-[#C62828]/35 bg-[#FDECEA] text-[#C62828]"
                                  : "border-green/40 bg-green-soft text-green-dark",
                              ].join(" ")}
                            >
                              {s.initials}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
