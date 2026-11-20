"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type {
  WfAdviseurSlot,
  WfAdviseurSlotDag,
} from "@/lib/api-v1/wf-adviseur-slots";
import { WF_ADVISEUR_SLOT_HOURS } from "@/lib/wf-adviseur-slots";

type Payload = {
  adviseur: { id: string; naam: string };
  start_label: string;
  days: WfAdviseurSlotDag[];
};

function dayChipLabel(dk: string): string {
  return formatInTimeZone(new Date(`${dk}T12:00:00`), AMSTERDAM_TZ, "EEE d MMM", {
    locale: nl,
  });
}

function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}.00`;
}

export function WfAdviseurSlotPicker({
  leadId,
  projectId,
  disabled,
  compact,
  onPlanned,
}: {
  leadId?: string | null;
  projectId?: string | null;
  disabled?: boolean;
  compact?: boolean;
  onPlanned?: (iso: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Payload | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<WfAdviseurSlot | null>(null);

  const load = useCallback(async () => {
    if (!leadId && !projectId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("project_id", projectId);
      if (leadId) params.set("lead_id", leadId);
      const res = await fetch(`/api/wf-adviseur-slots?${params.toString()}`);
      const json = (await res.json().catch(() => ({}))) as Payload & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || "Slots laden mislukt");
      }
      setData(json);
      const firstOpen = (json.days || []).find((d) =>
        d.slots.some((s) => !s.busy)
      );
      setDayKey((prev) =>
        prev && (json.days || []).some((d) => d.day_key === prev)
          ? prev
          : firstOpen?.day_key || json.days?.[0]?.day_key || null
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Slots laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [leadId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const day = useMemo(
    () => data?.days.find((d) => d.day_key === dayKey) || null,
    [data, dayKey]
  );

  const slotByHour = useMemo(() => {
    const map = new Map<number, WfAdviseurSlot>();
    for (const s of day?.slots || []) map.set(s.hour, s);
    return map;
  }, [day]);

  async function planGekozen() {
    if (!selected || !leadId || !data?.adviseur.id) return;
    setPlanning(true);
    setError(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          adviseur_id: data.adviseur.id,
          start_at: selected.start_at,
          soort: "warmtefonds_aanvraag",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error || "Inplannen mislukt");
      }
      onPlanned?.(selected.start_at);
      setSelected(null);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inplannen mislukt");
    } finally {
      setPlanning(false);
    }
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Agenda {data?.adviseur.naam || "WF-adviseur"}
        </p>
        <p className="mt-0.5 text-[12px] text-muted">
          Slots vanaf {data?.start_label || "Bunschoten-Spakenburg"}:{" "}
          {WF_ADVISEUR_SLOT_HOURS.map(hourLabel).join(" · ")}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Slots laden…</p>
      ) : error ? (
        <p className="text-sm text-[#C45A12]">{error}</p>
      ) : null}

      {data && data.days.length > 0 ? (
        <>
          <div className="-mx-0.5 overflow-x-auto px-0.5">
            <div className="flex gap-1">
              {data.days.map((d) => {
                const free = d.slots.filter((s) => !s.busy).length;
                const active = d.day_key === dayKey;
                return (
                  <button
                    key={d.day_key}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      setDayKey(d.day_key);
                      setSelected(null);
                    }}
                    className={[
                      "flex w-14 shrink-0 flex-col items-center rounded-lg border py-1.5 text-[11px] transition",
                      active
                        ? "border-green bg-green-soft font-semibold text-ink"
                        : free === 0
                          ? "border-line bg-wash/50 text-muted"
                          : "border-line bg-white text-ink hover:border-green",
                    ].join(" ")}
                  >
                    {dayChipLabel(d.day_key)}
                    <span
                      className={[
                        "mt-1 size-1.5 rounded-full",
                        free > 0 ? "bg-green" : "bg-[#D1D5D3]",
                      ].join(" ")}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {WF_ADVISEUR_SLOT_HOURS.map((hour) => {
              const slot = slotByHour.get(hour);
              const busy = !slot || slot.busy;
              const active = selected?.start_at === slot?.start_at;
              return (
                <button
                  key={hour}
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => slot && !slot.busy && setSelected(slot)}
                  className={[
                    "rounded-lg border px-2 py-2 text-center text-xs font-semibold transition",
                    busy
                      ? "cursor-not-allowed border-line bg-wash text-muted line-through"
                      : active
                        ? "border-green bg-green-soft text-ink"
                        : "border-line bg-white text-ink hover:border-green",
                  ].join(" ")}
                >
                  {hourLabel(hour)}
                  {!busy && slot?.reistijd_min != null ? (
                    <span className="mt-0.5 block text-[10px] font-normal text-muted">
                      {slot.reistijd_vanaf === "vorige_afspraak"
                        ? `~${slot.reistijd_min} min erna`
                        : `~${slot.reistijd_min} min`}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {selected ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-green/30 bg-green-soft/60 px-3 py-2">
              <p className="text-sm text-ink">
                <span className="font-semibold">
                  {formatInTimeZone(
                    new Date(selected.start_at),
                    AMSTERDAM_TZ,
                    "EEEE d MMMM HH:mm",
                    { locale: nl }
                  )}
                </span>
                {selected.reistijd_min != null ? (
                  <span className="mt-0.5 block text-[12px] text-muted">
                    {selected.reistijd_vanaf === "vorige_afspraak"
                      ? `Reistijd vanaf vorige afspraak: ~${selected.reistijd_min} min`
                      : `Reistijd vanaf ${data.start_label}: ~${selected.reistijd_min} min`}
                  </span>
                ) : null}
              </p>
              <Button
                type="button"
                size="sm"
                disabled={disabled || planning || !leadId}
                onClick={() => void planGekozen()}
              >
                {planning ? "Bezig…" : "Inplannen in agenda"}
              </Button>
            </div>
          ) : (
            <p className="text-[12px] text-muted">
              Kies een vrije tijd — alleen deze uren, niet de sales-slots.
            </p>
          )}
        </>
      ) : !loading ? (
        <p className="text-sm text-muted">Geen WF-slots geladen.</p>
      ) : null}
    </div>
  );
}
