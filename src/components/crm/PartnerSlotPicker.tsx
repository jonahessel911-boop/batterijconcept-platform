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
  reistijd_vanaf?:
    | "vorige_installatie"
    | "vorige_schouw"
    | "startadres"
    | null;
  reistijd_label?: string | null;
};

type Props = {
  partnerId: string;
  soort: "schouw" | "installatie";
  leadId?: string | null;
  excludeProjectId?: string | null;
  /** Beperk tot één dag (yyyy-MM-dd), bijv. vanuit planbord-klik */
  dayKey?: string | null;
  value: string | null;
  onChange: (isoStart: string | null, slot?: PartnerSlotOption | null) => void;
  daysAhead?: number;
  disabled?: boolean;
};

function dayKeyOf(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
}

function dayChipLabel(dk: string): string {
  return formatInTimeZone(new Date(`${dk}T12:00:00`), AMSTERDAM_TZ, "EEE d MMM", {
    locale: nl,
  });
}

function dayFullLabel(dk: string): string {
  return formatInTimeZone(
    new Date(`${dk}T12:00:00`),
    AMSTERDAM_TZ,
    "EEEE d MMMM",
    { locale: nl }
  );
}

function timeLabel(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "HH:mm");
}

function reistijdHint(s: PartnerSlotOption): string | null {
  if (s.reistijd_min == null) return null;
  if (s.reistijd_vanaf === "vorige_installatie") {
    return `~${s.reistijd_min} min vanaf vorige installatie`;
  }
  if (s.reistijd_vanaf === "vorige_schouw") {
    return `~${s.reistijd_min} min vanaf vorige schouw`;
  }
  if (s.reistijd_vanaf === "startadres") {
    return `~${s.reistijd_min} min vanaf startadres`;
  }
  return `~${s.reistijd_min} min reistijd`;
}

export function PartnerSlotPicker({
  partnerId,
  soort,
  leadId,
  excludeProjectId,
  dayKey,
  value,
  onChange,
  daysAhead = 28,
  disabled,
}: Props) {
  const [slots, setSlots] = useState<PartnerSlotOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(
    dayKey || null
  );

  const range = useMemo(() => {
    if (dayKey) return { van: dayKey, tot: dayKey };
    const van = format(new Date(), "yyyy-MM-dd");
    const tot = format(addDays(new Date(), daysAhead), "yyyy-MM-dd");
    return { van, tot };
  }, [daysAhead, dayKey]);

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

  // dayKey van buitenaf (planbord) wint
  useEffect(() => {
    if (dayKey) setSelectedDay(dayKey);
  }, [dayKey]);

  const available = useMemo(
    () => slots.filter((s) => s.beschikbaar !== false),
    [slots]
  );

  const days = useMemo(() => {
    const map = new Map<string, PartnerSlotOption[]>();
    for (const s of available) {
      const key = dayKeyOf(s.start_at);
      const list = map.get(key) || [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()].map(([dk, daySlots]) => ({
      dayKey: dk,
      slots: daySlots.sort((a, b) => a.start_at.localeCompare(b.start_at)),
    }));
  }, [available]);

  // Zonder vaste dayKey: kies eerste beschikbare dag (of dag van huidige value)
  useEffect(() => {
    if (dayKey) return;
    if (days.length === 0) {
      setSelectedDay(null);
      return;
    }
    setSelectedDay((prev) => {
      if (value) {
        const fromValue = dayKeyOf(value);
        if (days.some((d) => d.dayKey === fromValue)) return fromValue;
      }
      if (prev && days.some((d) => d.dayKey === prev)) return prev;
      return days[0]!.dayKey;
    });
  }, [days, dayKey, value]);

  const daySlots = useMemo(() => {
    if (!selectedDay) return [];
    return days.find((d) => d.dayKey === selectedDay)?.slots || [];
  }, [days, selectedDay]);

  const ochtendSlots = useMemo(
    () => daySlots.filter((s) => s.venster === "ochtend"),
    [daySlots]
  );
  const middagSlots = useMemo(
    () => daySlots.filter((s) => s.venster === "middag"),
    [daySlots]
  );

  const selectedSlot = useMemo(
    () => available.find((s) => s.start_at === value) || null,
    [available, value]
  );

  function pickDay(dk: string) {
    setSelectedDay(dk);
    // Wissel van dag → wis tijdkeuze als die op een andere dag zat
    if (value && dayKeyOf(value) !== dk) {
      onChange(null, null);
    }
  }

  if (!partnerId) {
    return (
      <p className="text-sm text-muted">Kies eerst een installatiepartner.</p>
    );
  }

  const lockedToDay = Boolean(dayKey);
  const hasSelection = Boolean(value);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {hasSelection
              ? "Gekozen slot"
              : lockedToDay
                ? "Kies een tijd"
                : selectedDay
                  ? "Kies een dag · daarna een tijd"
                  : soort === "installatie"
                    ? "Installatie inplannen"
                    : "Schouw inplannen"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">
            {soort === "installatie"
              ? "Max. 1 ochtend + 1 middag per dag"
              : "Slots van 30 min · open vensters"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || disabled}
          className="text-xs font-medium text-green-dark hover:underline disabled:opacity-50"
        >
          Vernieuwen
        </button>
      </div>

      {value && selectedSlot ? (
        <div className="border border-green/30 bg-green-soft px-3 py-2.5 text-sm text-green-dark">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">
                {formatDateTimeNl(value)}
                <span className="ml-1.5 font-normal text-green-dark/80">
                  · {selectedSlot.venster === "ochtend" ? "ochtend" : "middag"}
                </span>
              </p>
              {reistijdHint(selectedSlot) ? (
                <p className="mt-1 text-xs font-medium">
                  {reistijdHint(selectedSlot)}
                  {selectedSlot.reistijd_label
                    ? ` · ${selectedSlot.reistijd_label}`
                    : ""}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(null, null)}
              className="text-xs font-semibold underline"
            >
              Wissen
            </button>
          </div>
        </div>
      ) : value ? (
        <p className="border border-green/30 bg-green-soft px-3 py-2 text-sm text-green-dark">
          Gekozen: {formatDateTimeNl(value)}{" "}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null, null)}
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
          Geen vrije slots
          {dayKey ? " op deze dag" : ` in de komende ${daysAhead} dagen`}. Check
          afblokkingen of kies een andere partner.
        </p>
      ) : (
        <div className="space-y-3">
          {/* Stap 1: dag */}
          {!lockedToDay ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                1. Dag
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {days.map((d) => {
                  const active = selectedDay === d.dayKey;
                  return (
                    <button
                      key={d.dayKey}
                      type="button"
                      disabled={disabled}
                      onClick={() => pickDay(d.dayKey)}
                      className={[
                        "shrink-0 border px-2.5 py-2 text-left transition",
                        active
                          ? "border-green bg-green text-white"
                          : "border-line bg-white text-ink hover:border-green",
                      ].join(" ")}
                    >
                      <span className="block text-xs font-semibold capitalize">
                        {dayChipLabel(d.dayKey)}
                      </span>
                      <span
                        className={[
                          "mt-0.5 block text-[10px] font-medium",
                          active ? "text-white/85" : "text-muted",
                        ].join(" ")}
                      >
                        {d.slots.length}{" "}
                        {d.slots.length === 1 ? "slot" : "slots"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : selectedDay ? (
            <p className="text-xs font-medium text-ink capitalize">
              {dayFullLabel(selectedDay)}
            </p>
          ) : null}

          {/* Stap 2: tijd */}
          {selectedDay ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                {lockedToDay ? "Tijd" : "2. Tijd"}
                <span className="ml-1.5 font-normal normal-case tracking-normal text-muted">
                  {dayChipLabel(selectedDay)}
                </span>
              </p>

              {soort === "installatie" ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {daySlots.map((s) => {
                    const selected = value === s.start_at;
                    return (
                      <button
                        key={s.start_at}
                        type="button"
                        disabled={disabled}
                        onClick={() => onChange(s.start_at, s)}
                        className={[
                          "border px-3 py-3 text-left transition",
                          selected
                            ? "border-green bg-green text-white"
                            : "border-line bg-white text-ink hover:border-green",
                        ].join(" ")}
                      >
                        <span className="block text-sm font-semibold">
                          {s.venster === "ochtend" ? "Ochtend" : "Middag"}
                        </span>
                        <span
                          className={[
                            "mt-0.5 block text-xs font-medium",
                            selected ? "text-white/85" : "text-muted",
                          ].join(" ")}
                        >
                          Start {timeLabel(s.start_at)}
                          {s.venster === "ochtend"
                            ? " · tot 12:00"
                            : " · tot 17:00"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-3">
                  {(
                    [
                      ["ochtend", "Ochtend", ochtendSlots],
                      ["middag", "Middag", middagSlots],
                    ] as const
                  ).map(([id, label, list]) =>
                    list.length === 0 ? null : (
                      <div key={id}>
                        <p className="mb-1.5 text-[11px] font-semibold text-muted">
                          {label}
                        </p>
                        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                          {list.map((s) => {
                            const selected = value === s.start_at;
                            return (
                              <button
                                key={s.start_at}
                                type="button"
                                disabled={disabled}
                                onClick={() => onChange(s.start_at, s)}
                                className={[
                                  "border px-2 py-2 text-center text-sm font-semibold tabular-nums transition",
                                  selected
                                    ? "border-green bg-green text-white"
                                    : "border-line bg-white text-ink hover:border-green",
                                ].join(" ")}
                              >
                                {timeLabel(s.start_at)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              {daySlots.length === 0 ? (
                <p className="text-sm text-muted">
                  Geen open slots op deze dag.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
