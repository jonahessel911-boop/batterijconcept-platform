"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ, formatDateTimeNl } from "@/lib/format";
import type { PartnerVenster } from "@/lib/partner-slots";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "cn";
import { ChevronDown } from "lucide-react";

export type PartnerSlotOption = {
  start_at: string;
  end_at: string;
  venster: PartnerVenster;
  beschikbaar: boolean;
  reason?: string;
  bezet?: number;
  capaciteit?: number;
  reistijd_min?: number | null;
  reistijd_vanaf?:
    | "vorige_installatie"
    | "vorige_schouw"
    | "startadres"
    | null;
  reistijd_label?: string | null;
};

export type PartnerDagStopInfo = {
  soort: "schouw" | "installatie";
  start_at: string;
  naam: string | null;
  plaats: string | null;
  adres: string | null;
  project_nummer: string | null;
};

export type BestPartnerSlotOption = {
  slot_id: string;
  start_at: string;
  end_at: string;
  venster: PartnerVenster;
  label_kort: string;
  label_nl?: string;
  partner_id: string;
  partner_naam: string;
  reistijd_min: number | null;
  reistijd_vanaf_startadres: boolean;
  reistijd_vanaf?:
    | "vorige_schouw"
    | "vorige_installatie"
    | "startadres"
    | null;
  reistijd_naar_volgende_min?: number | null;
  start_adres_fallback?: boolean;
  vorige?: PartnerDagStopInfo | null;
  volgende?: PartnerDagStopInfo | null;
};

type Props = {
  partnerId: string;
  soort: "schouw" | "installatie";
  leadId?: string | null;
  /** Voor cross-partner beste momenten (2 weken) */
  projectId?: string | null;
  excludeProjectId?: string | null;
  /** Beperk tot één dag (yyyy-MM-dd), bijv. vanuit planbord-klik */
  dayKey?: string | null;
  value: string | null;
  onChange: (isoStart: string | null, slot?: PartnerSlotOption | null) => void;
  /** Wordt aangeroepen als beste-slot een andere partner kiest */
  onPartnerChange?: (partnerId: string) => void;
  daysAhead?: number;
  disabled?: boolean;
  /** Alleen slots na deze ISO (installatie-opvolg na schouw) */
  afterIso?: string | null;
  /** Toon “Beste momenten” (default: ja als project/lead bekend en geen dayKey) */
  showBest?: boolean;
  /** Beperk beste momenten tot huidige partner (default: false = alle partners) */
  lockBestToPartner?: boolean;
  /** Compacte layout (focusmodus Acties — past in één viewport) */
  compact?: boolean;
  /** Max aantal beste-momenten (default 5) */
  bestLimit?: number;
};

function dayKeyOf(iso: string): string {
  return formatInTimeZone(new Date(iso), AMSTERDAM_TZ, "yyyy-MM-dd");
}

function dayChipLabel(dk: string): string {
  return formatInTimeZone(new Date(`${dk}T12:00:00`), AMSTERDAM_TZ, "EEE d MMM", {
    locale: nl,
  });
}

function dayWeekday(dk: string): string {
  return formatInTimeZone(new Date(`${dk}T12:00:00`), AMSTERDAM_TZ, "EEE", {
    locale: nl,
  });
}

function dayNumber(dk: string): string {
  return formatInTimeZone(new Date(`${dk}T12:00:00`), AMSTERDAM_TZ, "d", {
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

function stopSoortLabel(soort: "schouw" | "installatie"): string {
  return soort === "installatie" ? "installatie" : "schouw";
}

function stopRegel(
  prefix: string,
  stop: PartnerDagStopInfo | null | undefined
): string | null {
  if (!stop) return null;
  const who = [stop.naam, stop.plaats].filter(Boolean).join(" · ");
  const nr = !who && stop.project_nummer ? stop.project_nummer : null;
  const label = who || nr || stop.adres || "andere klus";
  return `${prefix} ${stopSoortLabel(stop.soort)} · ${label} · ${timeLabel(stop.start_at)}`;
}

function reistijdRegel(opts: {
  min: number | null | undefined;
  vanaf?:
    | "vorige_schouw"
    | "vorige_installatie"
    | "startadres"
    | null;
  vanafStart?: boolean;
  vorige?: PartnerDagStopInfo | null;
}): string | null {
  if (opts.min == null) return null;
  if (opts.vorige) {
    const waar = opts.vorige.plaats || opts.vorige.naam || "vorige klus";
    return `~${opts.min} min vanaf vorige ${stopSoortLabel(opts.vorige.soort)} (${waar})`;
  }
  if (opts.vanaf === "startadres" || opts.vanafStart) {
    return `~${opts.min} min vanaf startadres`;
  }
  if (opts.vanaf === "vorige_installatie") {
    return `~${opts.min} min vanaf vorige installatie`;
  }
  if (opts.vanaf === "vorige_schouw") {
    return `~${opts.min} min vanaf vorige schouw`;
  }
  return `~${opts.min} min rijden`;
}

async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function PartnerSlotPicker({
  partnerId,
  soort,
  leadId,
  projectId,
  excludeProjectId,
  dayKey,
  value,
  onChange,
  onPartnerChange,
  daysAhead = 28,
  disabled,
  afterIso = null,
  showBest,
  lockBestToPartner = false,
  compact = false,
  bestLimit,
}: Props) {
  const bestCap = bestLimit ?? 5;
  const [slots, setSlots] = useState<PartnerSlotOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(
    dayKey || null
  );
  const [bestSlots, setBestSlots] = useState<BestPartnerSlotOption[]>([]);
  const [bestLoading, setBestLoading] = useState(
    () => showBest ?? Boolean((projectId || leadId) && !dayKey)
  );
  const [bestNote, setBestNote] = useState<string | null>(null);
  const [kalenderOpen, setKalenderOpen] = useState(Boolean(dayKey));
  const wantBest =
    showBest ?? Boolean((projectId || leadId) && !dayKey);
  const delayKalender = wantBest && !dayKey;

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
    if (delayKalender && !kalenderOpen) {
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
      const data = await readJsonSafe(res);
      if (!res.ok) {
        throw new Error(
          (typeof data.error === "string" && data.error) ||
            "Slots laden mislukt. Probeer opnieuw."
        );
      }
      setSlots(
        ((data.slots || data.beschikbaar || []) as PartnerSlotOption[])
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Slots laden mislukt. Probeer opnieuw."
      );
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [
    partnerId,
    range.van,
    range.tot,
    soort,
    leadId,
    excludeProjectId,
    delayKalender,
    kalenderOpen,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadBest = useCallback(async () => {
    if (!wantBest) {
      setBestSlots([]);
      setBestNote(null);
      return;
    }
    setBestLoading(true);
    try {
      const params = new URLSearchParams({
        soort,
        days: "14",
        limit: String(bestCap),
      });
      if (projectId) params.set("project_id", projectId);
      else if (leadId) params.set("lead_id", leadId);
      if (lockBestToPartner && partnerId) {
        params.set("partner_id", partnerId);
      }
      if (afterIso) params.set("after", afterIso);
      const res = await fetch(`/api/best-partner-slots?${params.toString()}`);
      const data = await readJsonSafe(res);
      if (!res.ok) {
        setBestSlots([]);
        setBestNote(null);
        return;
      }
      setBestSlots((data.slots || []) as BestPartnerSlotOption[]);
      setBestNote(typeof data.note === "string" ? data.note : null);
    } catch {
      setBestSlots([]);
      setBestNote(null);
    } finally {
      setBestLoading(false);
    }
  }, [
    wantBest,
    soort,
    projectId,
    leadId,
    partnerId,
    afterIso,
    lockBestToPartner,
    bestCap,
  ]);

  useEffect(() => {
    void loadBest();
  }, [loadBest]);

  // dayKey van buitenaf (planbord) wint
  useEffect(() => {
    if (dayKey) setSelectedDay(dayKey);
  }, [dayKey]);

  function pickBest(b: BestPartnerSlotOption) {
    if (b.partner_id !== partnerId) {
      onPartnerChange?.(b.partner_id);
    }
    onChange(b.start_at, {
      start_at: b.start_at,
      end_at: b.end_at,
      venster: b.venster,
      beschikbaar: true,
      reistijd_min: b.reistijd_min,
      reistijd_vanaf:
        b.reistijd_vanaf ||
        (b.reistijd_vanaf_startadres ? "startadres" : null),
      reistijd_label: reistijdRegel({
        min: b.reistijd_min,
        vanaf: b.reistijd_vanaf,
        vanafStart: b.reistijd_vanaf_startadres,
        vorige: b.vorige,
      }),
    });
  }

  function pickSlot(s: PartnerSlotOption) {
    if (disabled) return;
    if (s.beschikbaar === false) {
      const reden = s.reason?.trim() || "Bezet of afgeblokt";
      const ok = window.confirm(
        `${reden}.\n\nToch dit slot overschrijven en inplannen?`
      );
      if (!ok) return;
    }
    onChange(s.start_at, s);
  }

  const days = useMemo(() => {
    const map = new Map<string, PartnerSlotOption[]>();
    for (const s of slots) {
      const key = dayKeyOf(s.start_at);
      const list = map.get(key) || [];
      list.push(s);
      map.set(key, list);
    }
    return [...map.entries()].map(([dk, daySlots]) => {
      const sorted = daySlots.sort((a, b) =>
        a.start_at.localeCompare(b.start_at)
      );
      return {
        dayKey: dk,
        slots: sorted,
        freeCount: sorted.filter((s) => s.beschikbaar !== false).length,
      };
    });
  }, [slots]);

  // Zonder vaste dayKey: kies eerste dag met vrije slots, anders eerste dag / value
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
      const firstFree = days.find((d) => d.freeCount > 0);
      return (firstFree || days[0])!.dayKey;
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
    () => slots.find((s) => s.start_at === value) || null,
    [slots, value]
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
  const selectedBest =
    bestSlots.find((b) => b.start_at === value) || null;
  const gekozenReis =
    reistijdRegel({
      min: selectedSlot?.reistijd_min ?? selectedBest?.reistijd_min,
      vanaf: selectedSlot?.reistijd_vanaf ?? selectedBest?.reistijd_vanaf,
      vanafStart: selectedBest?.reistijd_vanaf_startadres,
      vorige: selectedBest?.vorige,
    }) || selectedSlot?.reistijd_label;

  const kalender = loading ? (
    <p className="text-sm text-muted-foreground">Slots laden…</p>
  ) : error ? (
    <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {error}
    </p>
  ) : slots.length === 0 ? (
    <p className="text-sm text-muted-foreground">
      Geen slots
      {dayKey ? " op deze dag" : ` in de komende ${daysAhead} dagen`}.
    </p>
  ) : (
        <div className="space-y-3">
          {!lockedToDay ? (
            <div className="-mx-0.5 overflow-x-auto px-0.5">
              <div className="flex gap-1">
                {days.map((d) => {
                  const active = selectedDay === d.dayKey;
                  const empty = d.freeCount === 0;
                  return (
                    <button
                      key={d.dayKey}
                      type="button"
                      disabled={disabled}
                      onClick={() => pickDay(d.dayKey)}
                      className={cn(
                        "flex w-11 shrink-0 flex-col items-center rounded-lg border py-1.5 transition",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : empty
                            ? "border-border bg-wash/50 text-muted-foreground"
                            : "border-border bg-background text-foreground hover:border-primary"
                      )}
                    >
                      <span className="text-[10px] font-medium capitalize leading-none">
                        {dayWeekday(d.dayKey)}
                      </span>
                      <span className="mt-1 text-sm font-semibold leading-none tabular-nums">
                        {dayNumber(d.dayKey)}
                      </span>
                      <span
                        className={cn(
                          "mt-1.5 size-1.5 rounded-full",
                          active
                            ? "bg-primary-foreground/90"
                            : empty
                              ? "bg-border"
                              : "bg-primary"
                        )}
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : selectedDay ? (
            <p className="text-sm font-medium capitalize text-foreground">
              {dayFullLabel(selectedDay)}
            </p>
          ) : null}

          {selectedDay ? (
            <div>
              {soort === "installatie" ? (
                <div className="grid grid-cols-2 gap-2">
                  {daySlots.map((s) => {
                    const selected = value === s.start_at;
                    const busySlot = s.beschikbaar === false;
                    return (
                      <button
                        key={s.start_at}
                        type="button"
                        disabled={disabled}
                        title={
                          busySlot
                            ? `${s.reason || "Bezet"} — klik om te overschrijven`
                            : undefined
                        }
                        onClick={() => pickSlot(s)}
                        className={cn(
                          "rounded-lg border px-3 py-3 text-left transition",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : busySlot
                              ? "border-destructive/30 bg-destructive/10 text-destructive hover:border-destructive"
                              : "border-border bg-background hover:border-primary"
                        )}
                      >
                        <span className="block text-sm font-semibold">
                          {s.venster === "ochtend" ? "Ochtend" : "Middag"}
                          {busySlot ? " · vol" : ""}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 block text-xs",
                            selected
                              ? "text-primary-foreground/80"
                              : "text-muted-foreground"
                          )}
                        >
                          {s.venster === "ochtend"
                            ? "08:00–12:00"
                            : "13:00–17:00"}
                          {s.capaciteit
                            ? ` · ${s.bezet ?? 0}/${s.capaciteit} bezet`
                            : ""}
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
                        <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
                          {label}
                        </p>
                        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                          {list.map((s) => {
                            const selected = value === s.start_at;
                            const busySlot = s.beschikbaar === false;
                            return (
                              <Button
                                key={s.start_at}
                                type="button"
                                variant={selected ? "default" : "outline"}
                                size="sm"
                                disabled={disabled}
                                title={
                                  busySlot
                                    ? `${s.reason || "Bezet"} — klik om te overschrijven`
                                    : undefined
                                }
                                onClick={() => pickSlot(s)}
                                className={cn(
                                  "tabular-nums",
                                  busySlot &&
                                    !selected &&
                                    "border-destructive/30 bg-destructive/10 text-destructive"
                                )}
                              >
                                {timeLabel(s.start_at)}
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    )
                  )}
                </div>
              )}

              {daySlots.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Geen slots op deze dag.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
  );

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {soort === "installatie"
            ? "Beste momenten"
            : "Beste 5 schouwmomenten"}
        </p>
        <button
          type="button"
          disabled={loading || bestLoading || disabled}
          onClick={() => {
            void load();
            void loadBest();
          }}
          className="shrink-0 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-40"
        >
          {loading || bestLoading ? "Laden…" : "Vernieuwen"}
        </button>
      </div>

      {value ? (
        <div
          className={cn(
            "flex items-start justify-between gap-2 rounded-lg border px-3 py-2.5",
            selectedSlot?.beschikbaar === false
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-primary/25 bg-primary/5 text-foreground"
          )}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {formatDateTimeNl(value)}
              <span className="ml-1.5 font-normal text-muted-foreground">
                {selectedSlot?.venster === "ochtend" ||
                selectedBest?.venster === "ochtend"
                  ? "ochtend"
                  : "middag"}
                {selectedSlot?.beschikbaar === false ? " · overschrijving" : ""}
              </span>
            </p>
            {gekozenReis ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{gekozenReis}</p>
            ) : null}
            {stopRegel("Ervoor:", selectedBest?.vorige) ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stopRegel("Ervoor:", selectedBest?.vorige)}
              </p>
            ) : null}
            {selectedSlot?.beschikbaar === false && selectedSlot.reason ? (
              <p className="mt-0.5 text-xs">{selectedSlot.reason}</p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={disabled}
            onClick={() => onChange(null, null)}
          >
            Wissen
          </Button>
        </div>
      ) : null}

      {wantBest ? (
        <div>
          {bestLoading ? (
            <p className="text-sm text-muted-foreground">
              Beste momenten berekenen (reistijd + dagroute)…
            </p>
          ) : bestSlots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {bestNote || "Geen slimme opties — open andere tijden hieronder."}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {bestSlots.map((b, idx) => {
                const selected = value === b.start_at;
                const reis = reistijdRegel({
                  min: b.reistijd_min,
                  vanaf: b.reistijd_vanaf,
                  vanafStart: b.reistijd_vanaf_startadres,
                  vorige: b.vorige,
                });
                const na = stopRegel("Ervoor:", b.vorige);
                const daarna = stopRegel("Daarna:", b.volgende);
                return (
                  <li key={b.slot_id}>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => pickBest(b)}
                      className={cn(
                        "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition",
                        selected
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background hover:border-primary/50"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold",
                          selected
                            ? "bg-primary text-primary-foreground"
                            : "bg-wash text-muted-foreground"
                        )}
                      >
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-foreground">
                          {b.label_kort || b.label_nl}
                          <span className="ml-1.5 font-normal text-muted-foreground">
                            {b.venster === "ochtend" ? "ochtend" : "middag"}
                          </span>
                        </span>
                        {reis ? (
                          <span className="mt-0.5 block text-[12px] font-medium text-foreground">
                            {reis}
                          </span>
                        ) : null}
                        {na ? (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {na}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            Eerste klus van de dag
                            {b.start_adres_fallback
                              ? " · vanaf startadres"
                              : ""}
                          </span>
                        )}
                        {daarna ? (
                          <span className="block text-[11px] text-muted-foreground">
                            {daarna}
                            {b.reistijd_naar_volgende_min != null
                              ? ` · ~${b.reistijd_naar_volgende_min} min erna`
                              : ""}
                          </span>
                        ) : null}
                        {!lockBestToPartner ? (
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {b.partner_naam}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {lockedToDay ? (
        kalender
      ) : (
        <Collapsible open={kalenderOpen} onOpenChange={setKalenderOpen}>
          <CollapsibleTrigger
            disabled={disabled}
            className="flex w-full items-center justify-between rounded-lg border border-border bg-wash/40 px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-wash"
            onClick={() => {
              if (!kalenderOpen) setLoading(true);
            }}
          >
            Andere tijden
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition",
                kalenderOpen && "rotate-180"
              )}
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            {kalenderOpen ? kalender : null}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
