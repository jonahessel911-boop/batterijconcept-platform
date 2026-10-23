"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ, formatDateTimeNl } from "@/lib/format";
import type { PartnerVenster } from "@/lib/partner-slots";

export type PartnerSlotOption = {
  start_at: string;
  end_at: string;
  venster: PartnerVenster;
  beschikbaar: boolean;
  reason?: string;
  reistijd_min?: number | null;
};

type Props = {
  partnerId: string;
  soort: "schouw" | "installatie";
  leadId?: string | null;
  excludeProjectId?: string | null;
  value: string | null;
  onChange: (isoStart: string | null) => void;
  daysAhead?: number;
  disabled?: boolean;
};

function dayLabel(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "EEEE d MMM", {
    locale: nl,
  });
}

function timeLabel(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "HH:mm");
}

export function PartnerSlotPicker({
  partnerId,
  soort,
  leadId,
  excludeProjectId,
  value,
  onChange,
  daysAhead = 28,
  disabled,
}: Props) {
  const [slots, setSlots] = useState<PartnerSlotOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const van = format(new Date(), "yyyy-MM-dd");
    const tot = format(addDays(new Date(), daysAhead), "yyyy-MM-dd");
    return { van, tot };
  }, [daysAhead]);

  const load = useCallback(async () => {
    if (!partnerId) {
      setSlots([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        partner_id: partnerId,
        van: range.van,
        tot: range.tot,
        soort,
      });
      if (leadId) params.set("lead_id", leadId);
      if (excludeProjectId) params.set("exclude_project_id", excludeProjectId);
      const res = await fetch(
        `/api/installatie-partners/slots?${params.toString()}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Slots laden mislukt");
      setSlots((data.beschikbaar || data.slots || []) as PartnerSlotOption[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Slots laden mislukt");
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [partnerId, range.van, range.tot, soort, leadId, excludeProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const available = useMemo(
    () => slots.filter((s) => s.beschikbaar !== false),
    [slots]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, PartnerSlotOption[]>();
    for (const s of available) {
      const key = formatInTimeZone(new Date(s.start_at), AMSTERDAM_TZ, "yyyy-MM-dd");
      const list = map.get(key) || [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [available]);

  if (!partnerId) {
    return (
      <p className="text-sm text-muted">Kies eerst een installatiepartner.</p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {soort === "installatie"
            ? "Beschikbare installatie-slots (4u, middag)"
            : "Beschikbare schouw-slots (30 min)"}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || disabled}
          className="text-xs font-medium text-green-dark hover:underline disabled:opacity-50"
        >
          Vernieuwen
        </button>
      </div>

      {value ? (
        <p className="border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-dark">
          Gekozen: {formatDateTimeNl(value)}{" "}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            className="ml-2 text-xs font-semibold underline"
          >
            Wissen
          </button>
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">Slots laden…</p>
      ) : error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : available.length === 0 ? (
        <p className="text-sm text-muted">
          Geen vrije slots in de komende {daysAhead} dagen. Check afblokkingen
          of kies een andere partner.
        </p>
      ) : (
        <div className="max-h-64 space-y-3 overflow-y-auto border border-line bg-wash/30 p-2">
          {grouped.map(([dayKey, daySlots]) => (
            <div key={dayKey}>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {dayLabel(daySlots[0].start_at)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {daySlots.map((s) => {
                  const selected = value === s.start_at;
                  return (
                    <button
                      key={s.start_at}
                      type="button"
                      disabled={disabled}
                      onClick={() => onChange(s.start_at)}
                      className={[
                        "border px-2.5 py-1.5 text-xs font-medium",
                        selected
                          ? "border-green bg-green text-white"
                          : "border-line bg-white text-ink hover:border-green",
                      ].join(" ")}
                      title={
                        s.reistijd_min != null
                          ? `~${s.reistijd_min} min reistijd`
                          : undefined
                      }
                    >
                      {timeLabel(s.start_at)}
                      {s.venster === "ochtend" ? " · ocht." : " · mid."}
                      {s.reistijd_min != null ? (
                        <span className="opacity-70">
                          {" "}
                          · {s.reistijd_min}m
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
