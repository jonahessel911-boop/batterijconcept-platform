"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addDays, addWeeks, format, startOfWeek } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { Project } from "@/types/database";
import { AMSTERDAM_TZ, adresRegel, formatTimeNl } from "@/lib/format";
import { dayKeyAmsterdam } from "@/lib/planning-window";
import {
  agendaWeekJumpOptions,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";

export type PlanningOrder = Project & {
  leads?: Project["leads"];
  installatie_partners?: Project["installatie_partners"];
};

export type PlanningKind = "schouw" | "installatie";
export type PlanningFilter = "totaal" | PlanningKind;

export type PlanningEvent = {
  key: string;
  kind: PlanningKind;
  at: string;
  order: PlanningOrder;
};

type AgendaDay = { key: string; date: Date };

function weekDaysFrom(anchor: Date): AgendaDay[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { key: format(date, "yyyy-MM-dd"), date };
  });
}

function leadOf(o: PlanningOrder) {
  return Array.isArray(o.leads) ? o.leads[0] : o.leads;
}

export function eventsFromOrders(orders: PlanningOrder[]): PlanningEvent[] {
  const events: PlanningEvent[] = [];
  for (const o of orders) {
    if (o.schouw_at) {
      events.push({
        key: `${o.id}-schouw`,
        kind: "schouw",
        at: o.schouw_at,
        order: o,
      });
    }
    if (o.installatie_at) {
      events.push({
        key: `${o.id}-installatie`,
        kind: "installatie",
        at: o.installatie_at,
        order: o,
      });
    }
  }
  return events;
}

const KIND_LABEL: Record<PlanningKind, string> = {
  schouw: "Schouw",
  installatie: "Installatie",
};

const KIND_STYLE: Record<
  PlanningKind,
  { border: string; bg: string; text: string }
> = {
  schouw: {
    border: "border-l-green",
    bg: "bg-green-soft/70",
    text: "text-green-dark",
  },
  installatie: {
    border: "border-l-orange",
    bg: "bg-[#FFF0E6]",
    text: "text-[#C45A12]",
  },
};

export function PlanningAgenda({
  orders,
  linkHref,
  showPartner = false,
  initialWeekAnchor,
  onOrderUpdated,
  allowDeleteSchouw = true,
}: {
  orders: PlanningOrder[];
  linkHref?: (event: PlanningEvent) => string | undefined;
  showPartner?: boolean;
  /** Startweek (bijv. schouwweek van dit project). */
  initialWeekAnchor?: Date | string | null;
  /** Na verwijderen/bijwerken van een order (bijv. schouw gewist). */
  onOrderUpdated?: (order: PlanningOrder) => void;
  /** Schouw uit agenda kunnen verwijderen (geen klantmail). */
  allowDeleteSchouw?: boolean;
}) {
  const todayKey = useMemo(() => dayKeyAmsterdam(new Date()), []);
  const [weekAnchor, setWeekAnchor] = useState(() =>
    initialWeekAnchor ? new Date(initialWeekAnchor) : new Date()
  );
  const [selectedDayKey, setSelectedDayKey] = useState(() =>
    initialWeekAnchor
      ? dayKeyAmsterdam(new Date(initialWeekAnchor))
      : todayKey
  );
  const [filter, setFilter] = useState<PlanningFilter>("totaal");
  const [calendarView, setCalendarView] = useState<"dag" | "week">("week");
  const [selectedEvent, setSelectedEvent] = useState<PlanningEvent | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionOk, setActionOk] = useState<string | null>(null);
  useEffect(() => {
    try {
      const v = localStorage.getItem("bc_planning_agenda_view");
      if (v === "dag" || v === "week") setCalendarView(v);
    } catch {
      /* ignore */
    }
  }, []);

  function changeCalendarView(next: "dag" | "week") {
    setCalendarView(next);
    try {
      localStorage.setItem("bc_planning_agenda_view", next);
    } catch {
      /* ignore */
    }
  }

  const allEvents = useMemo(() => eventsFromOrders(orders), [orders]);
  const events = useMemo(
    () =>
      filter === "totaal"
        ? allEvents
        : allEvents.filter((e) => e.kind === filter),
    [allEvents, filter]
  );

  useEffect(() => {
    if (!selectedEvent) return;
    if (!allEvents.some((e) => e.key === selectedEvent.key)) {
      setSelectedEvent(null);
    }
  }, [allEvents, selectedEvent]);

  const days = useMemo(() => weekDaysFrom(weekAnchor), [weekAnchor]);

  const currentWeekValue = useMemo(() => {
    const w = schouwWeekFromDate(weekAnchor);
    return schouwWeekValue(w.jaar, w.week);
  }, [weekAnchor]);

  const weekJumpOptions = useMemo(() => {
    const base = agendaWeekJumpOptions(8, 52);
    // Zorg dat weken met events ook in de lijst staan
    const seen = new Set(base.map((o) => o.value));
    for (const e of allEvents) {
      const w = schouwWeekFromDate(e.at);
      const v = schouwWeekValue(w.jaar, w.week);
      if (!seen.has(v)) {
        seen.add(v);
        base.push({
          value: v,
          label: `Week ${w.week} · ${w.jaar}`,
          jaar: w.jaar,
          week: w.week,
        });
      }
    }
    return base.sort((a, b) =>
      a.jaar === b.jaar ? a.week - b.week : a.jaar - b.jaar
    );
  }, [allEvents]);

  const weeksWithEvents = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) {
      const w = schouwWeekFromDate(e.at);
      s.add(schouwWeekValue(w.jaar, w.week));
    }
    return s;
  }, [events]);

  const byDay = useMemo(() => {
    const map = new Map<string, PlanningEvent[]>();
    for (const e of events) {
      const key = dayKeyAmsterdam(e.at);
      const list = map.get(key) || [];
      list.push(e);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
      );
    }
    return map;
  }, [events]);

  const selectedDay =
    days.find((d) => d.key === selectedDayKey) || days[0];
  const selectedList = byDay.get(selectedDay.key) || [];

  function goToday() {
    const now = new Date();
    setWeekAnchor(now);
    setSelectedDayKey(dayKeyAmsterdam(now));
  }

  function goPrev() {
    if (calendarView === "dag") {
      const prev = addDays(selectedDay.date, -1);
      setSelectedDayKey(dayKeyAmsterdam(prev));
      setWeekAnchor(prev);
      return;
    }
    setWeekAnchor((d) => addWeeks(d, -1));
  }

  function goNext() {
    if (calendarView === "dag") {
      const next = addDays(selectedDay.date, 1);
      setSelectedDayKey(dayKeyAmsterdam(next));
      setWeekAnchor(next);
      return;
    }
    setWeekAnchor((d) => addWeeks(d, 1));
  }

  function goToWeek(value: string) {
    const parsed = parseSchouwWeekValue(value);
    if (!parsed) return;
    try {
      const monday = new Date(schouwWeekToMondayIso(parsed.jaar, parsed.week));
      setWeekAnchor(monday);
      setSelectedDayKey(dayKeyAmsterdam(monday));
      setCalendarView("week");
      try {
        localStorage.setItem("bc_planning_agenda_view", "week");
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  }

  async function deleteSchouw(event: PlanningEvent) {
    if (event.kind !== "schouw") return;
    const ok = window.confirm(
      "Schouw uit de agenda verwijderen? De klant krijgt geen mail."
    );
    if (!ok) return;
    setDeleting(true);
    setActionError(null);
    setActionOk(null);
    try {
      const res = await fetch(`/api/projecten/${event.order.id}/schouw`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Verwijderen mislukt"
        );
      }
      const updated = (data as { project?: PlanningOrder }).project;
      if (updated) onOrderUpdated?.(updated);
      setSelectedEvent(null);
      setActionOk("Schouw verwijderd uit de agenda. Geen mail verstuurd.");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Verwijderen mislukt");
    } finally {
      setDeleting(false);
    }
  }

  function openEvent(event: PlanningEvent) {
    setSelectedEvent(event);
    setActionError(null);
    setActionOk(null);
  }

  function EventCard({ event }: { event: PlanningEvent }) {
    const lead = leadOf(event.order);
    const style = KIND_STYLE[event.kind];
    const selected = selectedEvent?.key === event.key;
    return (
      <button
        type="button"
        onClick={() => openEvent(event)}
        className={`block w-full rounded-lg border border-transparent border-l-[3px] px-2 py-1.5 text-left hover:shadow-sm ${style.border} ${style.bg} ${
          selected ? "ring-2 ring-green/40" : ""
        }`}
      >
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
          {KIND_LABEL[event.kind]}
        </span>
        <span
          className={`mt-0.5 block text-[11px] font-bold tabular-nums ${style.text}`}
        >
          {event.kind === "schouw"
            ? `W${
                event.order.schouw_week ??
                schouwWeekFromDate(event.at).week
              }`
            : formatTimeNl(event.at)}
        </span>
        <span className="mt-1 block truncate text-[12px] font-semibold text-ink">
          {lead?.naam || event.order.project_nummer}
        </span>
        {showPartner && event.order.installatie_partners?.naam ? (
          <span className="mt-0.5 block truncate text-[10px] text-muted">
            {event.order.installatie_partners.naam}
          </span>
        ) : null}
      </button>
    );
  }

  function DayList() {
    if (selectedList.length === 0) {
      return (
        <p className="px-2 py-8 text-center text-sm text-muted">
          Geen afspraken op deze dag
        </p>
      );
    }
    return (
      <div className="space-y-2">
        {selectedList.map((event) => {
          const lead = leadOf(event.order);
          const style = KIND_STYLE[event.kind];
          const selected = selectedEvent?.key === event.key;
          return (
            <button
              key={event.key}
              type="button"
              onClick={() => openEvent(event)}
              className={[
                "block w-full border px-3 py-3 text-left hover:border-green/40",
                selected ? "border-green bg-green-soft/30" : "border-line",
              ].join(" ")}
            >
              <p className="text-[10px] font-semibold uppercase text-muted">
                {KIND_LABEL[event.kind]}
              </p>
              <p className={`text-sm font-bold tabular-nums ${style.text}`}>
                {formatTimeNl(event.at)}
              </p>
              <p className="mt-0.5 font-semibold text-ink">
                {lead?.naam || event.order.project_nummer}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {lead ? adresRegel(lead) : "—"}
              </p>
            </button>
          );
        })}
      </div>
    );
  }

  const detailLead = selectedEvent
    ? leadOf(selectedEvent.order)
    : null;
  const detailHref = selectedEvent
    ? linkHref?.(selectedEvent)
    : undefined;

  return (
    <div className="overflow-hidden border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-muted">
            <span className="sr-only">Filter</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as PlanningFilter)}
              className="min-h-8 cursor-pointer border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-ink outline-none focus:border-green"
              aria-label="Filter agenda"
            >
              <option value="totaal">Alles</option>
              <option value="schouw">Alleen schouw</option>
              <option value="installatie">Alleen installatie</option>
            </select>
          </label>
          <div className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => changeCalendarView("dag")}
              className={[
                "rounded-md px-2.5 py-1",
                calendarView === "dag"
                  ? "bg-green text-white"
                  : "text-muted hover:text-ink",
              ].join(" ")}
            >
              Dag
            </button>
            <button
              type="button"
              onClick={() => changeCalendarView("week")}
              className={[
                "rounded-md px-2.5 py-1",
                calendarView === "week"
                  ? "bg-green text-white"
                  : "text-muted hover:text-ink",
              ].join(" ")}
            >
              Week
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            className="min-h-9 px-2 text-sm font-semibold text-green-dark hover:underline"
            aria-label={calendarView === "dag" ? "Vorige dag" : "Vorige week"}
          >
            ←
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-wash"
          >
            Vandaag
          </button>
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Week
            </span>
            <select
              value={currentWeekValue}
              onChange={(e) => goToWeek(e.target.value)}
              className="min-h-8 max-w-[11rem] cursor-pointer border border-line bg-white px-2 py-1 text-xs font-semibold tabular-nums text-ink outline-none focus:border-green sm:max-w-[16rem]"
              aria-label="Ga naar weeknummer"
            >
              {weekJumpOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {weeksWithEvents.has(o.value) ? "● " : ""}
                  W{o.week} · {o.jaar}
                  {o.value === currentWeekValue ? " (nu)" : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="min-w-0 text-center font-display text-sm font-semibold capitalize text-ink">
            {calendarView === "dag"
              ? format(selectedDay.date, "EEEE d MMMM yyyy", { locale: nl })
              : `${format(days[0].date, "d MMM", { locale: nl })} – ${format(days[6].date, "d MMM yyyy", { locale: nl })}`}
          </p>
          <button
            type="button"
            onClick={goNext}
            className="min-h-9 px-2 text-sm font-semibold text-green-dark hover:underline"
            aria-label={calendarView === "dag" ? "Volgende dag" : "Volgende week"}
          >
            →
          </button>
        </div>
      </div>

      {(actionOk || actionError) && (
        <div
          className={[
            "border-b px-3 py-2.5 text-sm sm:px-4",
            actionError
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-green/30 bg-green-soft text-green-dark",
          ].join(" ")}
        >
          {actionError || actionOk}
        </div>
      )}

      {selectedEvent && (
        <div className="border-b border-line bg-wash/40 px-3 py-3 sm:px-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {KIND_LABEL[selectedEvent.kind]}
              </p>
              <p className="mt-0.5 font-semibold text-ink">
                {detailLead?.naam || selectedEvent.order.project_nummer}
              </p>
              <p className="mt-0.5 text-xs text-muted">
                {formatInTimeZone(
                  selectedEvent.at,
                  AMSTERDAM_TZ,
                  "EEEE d MMMM yyyy · HH:mm",
                  { locale: nl }
                )}
                {showPartner && selectedEvent.order.installatie_partners?.naam
                  ? ` · ${selectedEvent.order.installatie_partners.naam}`
                  : ""}
              </p>
              {detailLead ? (
                <p className="mt-0.5 text-xs text-muted">
                  {adresRegel(detailLead)}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {detailHref ? (
                <Link
                  href={detailHref}
                  className="border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                >
                  Open project
                </Link>
              ) : null}
              {allowDeleteSchouw && selectedEvent.kind === "schouw" ? (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void deleteSchouw(selectedEvent)}
                  className="border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? "Bezig…" : "Verwijderen"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSelectedEvent(null)}
                className="px-2 py-1.5 text-xs font-semibold text-muted hover:text-ink"
              >
                Sluiten
              </button>
            </div>
          </div>
          {allowDeleteSchouw && selectedEvent.kind === "schouw" ? (
            <p className="mt-2 text-[11px] text-muted">
              Verwijderen haalt de schouw uit de agenda. De klant krijgt geen
              mail.
            </p>
          ) : null}
        </div>
      )}

      {/* Dag-strip: in dagweergave altijd; in week alleen mobiel (desktop heeft kolomkoppen) */}
      <div
        className={[
          "flex gap-1.5 overflow-x-auto px-3 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          calendarView === "week" ? "md:hidden" : "",
        ].join(" ")}
      >
        {days.map((day) => {
          const count = byDay.get(day.key)?.length ?? 0;
          const isToday = day.key === todayKey;
          const selected = day.key === selectedDayKey;
          return (
            <button
              key={day.key}
              type="button"
              onClick={() => setSelectedDayKey(day.key)}
              className={[
                "flex min-w-[3.25rem] flex-1 flex-col items-center rounded-xl px-2 py-2 sm:min-w-0",
                selected
                  ? "bg-green text-white"
                  : isToday
                    ? "bg-green-soft text-green-dark"
                    : "bg-wash text-ink",
              ].join(" ")}
            >
              <span className="text-[10px] font-semibold uppercase">
                {format(day.date, "EEE", { locale: nl })}
              </span>
              <span className="mt-0.5 text-lg font-semibold tabular-nums leading-none">
                {format(day.date, "d")}
              </span>
              <span
                className={[
                  "mt-1 h-1 w-1 rounded-full",
                  count > 0
                    ? selected
                      ? "bg-white"
                      : "bg-green"
                    : "bg-transparent",
                ].join(" ")}
              />
            </button>
          );
        })}
      </div>

      {calendarView === "dag" ? (
        <div className="px-3 pb-4">
          <DayList />
        </div>
      ) : (
        <>
          <div className="md:hidden">
            <div className="space-y-2 px-3 pb-4">
              <DayList />
            </div>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <div className="min-w-[720px]">
              <div className="grid grid-cols-7 border-b border-line bg-wash/50">
                {days.map((day) => {
                  const isToday = day.key === todayKey;
                  const count = byDay.get(day.key)?.length ?? 0;
                  const selected = day.key === selectedDayKey;
                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => setSelectedDayKey(day.key)}
                      className={[
                        "border-r border-line px-2 py-3 text-left last:border-r-0",
                        selected
                          ? "bg-green-soft"
                          : isToday
                            ? "bg-green-soft/50"
                            : "hover:bg-wash",
                      ].join(" ")}
                    >
                      <p
                        className={[
                          "text-[10px] font-semibold uppercase tracking-wide",
                          isToday || selected ? "text-green" : "text-muted",
                        ].join(" ")}
                      >
                        {format(day.date, "EEE", { locale: nl })}
                      </p>
                      <p
                        className={[
                          "mt-0.5 font-display text-xl font-semibold tabular-nums leading-none",
                          isToday
                            ? "inline-flex h-8 w-8 items-center justify-center rounded-full bg-green text-base text-white"
                            : "text-ink",
                        ].join(" ")}
                      >
                        {format(day.date, "d")}
                      </p>
                      <p className="mt-1 text-[10px] text-muted">
                        {count > 0 ? `${count}×` : "—"}
                      </p>
                    </button>
                  );
                })}
              </div>
              <div className="grid min-h-[280px] grid-cols-7">
                {days.map((day) => {
                  const list = byDay.get(day.key) || [];
                  const isToday = day.key === todayKey;
                  return (
                    <div
                      key={day.key}
                      className={[
                        "min-h-[280px] space-y-1.5 border-r border-line p-1.5 last:border-r-0 sm:p-2",
                        isToday ? "bg-green-soft/20" : "bg-white",
                      ].join(" ")}
                    >
                      {list.length === 0 ? (
                        <p className="px-1 py-6 text-center text-[11px] text-muted/70">
                          —
                        </p>
                      ) : (
                        list.map((event) => (
                          <EventCard key={event.key} event={event} />
                        ))
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
