"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { addDays, addWeeks, format, startOfWeek } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { Project } from "@/types/database";
import { AMSTERDAM_TZ, adresRegel, formatTimeNl } from "@/lib/format";
import { dayKeyAmsterdam } from "@/lib/planning-window";

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
}: {
  orders: PlanningOrder[];
  linkHref?: (event: PlanningEvent) => string | undefined;
  showPartner?: boolean;
}) {
  const todayKey = useMemo(() => dayKeyAmsterdam(new Date()), []);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [selectedDayKey, setSelectedDayKey] = useState(todayKey);
  const [filter, setFilter] = useState<PlanningFilter>("totaal");

  const allEvents = useMemo(() => eventsFromOrders(orders), [orders]);
  const events = useMemo(
    () =>
      filter === "totaal"
        ? allEvents
        : allEvents.filter((e) => e.kind === filter),
    [allEvents, filter]
  );

  const days = useMemo(() => weekDaysFrom(weekAnchor), [weekAnchor]);

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

  function EventCard({ event }: { event: PlanningEvent }) {
    const lead = leadOf(event.order);
    const style = KIND_STYLE[event.kind];
    const href = linkHref?.(event);
    const inner = (
      <>
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted">
          {KIND_LABEL[event.kind]}
        </span>
        <span
          className={`mt-0.5 block text-[11px] font-bold tabular-nums ${style.text}`}
        >
          {formatTimeNl(event.at)}
        </span>
        <span className="mt-1 block truncate text-[12px] font-semibold text-ink">
          {lead?.naam || event.order.project_nummer}
        </span>
        {showPartner && event.order.installatie_partners?.naam ? (
          <span className="mt-0.5 block truncate text-[10px] text-muted">
            {event.order.installatie_partners.naam}
          </span>
        ) : null}
      </>
    );

    const className = `block rounded-lg border border-transparent border-l-[3px] px-2 py-1.5 hover:shadow-sm ${style.border} ${style.bg}`;

    if (href) {
      return (
        <Link href={href} className={className}>
          {inner}
        </Link>
      );
    }
    return <div className={className}>{inner}</div>;
  }

  return (
    <div className="overflow-hidden border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-3 sm:px-4">
        <div className="flex rounded-full border border-line bg-wash p-0.5 text-xs font-semibold">
          {(
            [
              { id: "totaal", label: "Totaal" },
              { id: "schouw", label: "Schouw" },
              { id: "installatie", label: "Installatie" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={[
                "rounded-full px-3 py-1",
                filter === f.id
                  ? "bg-green text-white"
                  : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekAnchor((d) => addWeeks(d, -1))}
            className="min-h-9 px-2 text-sm font-semibold text-green-dark hover:underline"
          >
            ←
          </button>
          <p className="min-w-0 text-center font-display text-sm font-semibold capitalize text-ink">
            {format(days[0].date, "d MMM", { locale: nl })} –{" "}
            {format(days[6].date, "d MMM yyyy", { locale: nl })}
          </p>
          <button
            type="button"
            onClick={() => setWeekAnchor((d) => addWeeks(d, 1))}
            className="min-h-9 px-2 text-sm font-semibold text-green-dark hover:underline"
          >
            →
          </button>
        </div>
      </div>

      <div className="md:hidden">
        <div className="flex gap-1.5 overflow-x-auto px-3 py-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                  "flex min-w-[3.25rem] flex-col items-center rounded-xl px-2 py-2",
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
        <div className="space-y-2 px-3 pb-4">
          {selectedList.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted">
              Geen afspraken op deze dag
            </p>
          ) : (
            selectedList.map((event) => {
              const lead = leadOf(event.order);
              const href = linkHref?.(event);
              const style = KIND_STYLE[event.kind];
              const content = (
                <>
                  <p className="text-[10px] font-semibold uppercase text-muted">
                    {KIND_LABEL[event.kind]}
                  </p>
                  <p
                    className={`text-sm font-bold tabular-nums ${style.text}`}
                  >
                    {formatTimeNl(event.at)}
                  </p>
                  <p className="mt-0.5 font-semibold text-ink">
                    {lead?.naam || event.order.project_nummer}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {lead ? adresRegel(lead) : "—"}
                  </p>
                </>
              );
              return href ? (
                <Link
                  key={event.key}
                  href={href}
                  className="block border border-line px-3 py-3 hover:border-green/40"
                >
                  {content}
                </Link>
              ) : (
                <div
                  key={event.key}
                  className="border border-line px-3 py-3"
                >
                  {content}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-7 border-b border-line bg-wash/50">
            {days.map((day) => {
              const isToday = day.key === todayKey;
              const count = byDay.get(day.key)?.length ?? 0;
              return (
                <div
                  key={day.key}
                  className={[
                    "border-r border-line px-2 py-3 last:border-r-0",
                    isToday ? "bg-green-soft/50" : "",
                  ].join(" ")}
                >
                  <p
                    className={[
                      "text-[10px] font-semibold uppercase tracking-wide",
                      isToday ? "text-green" : "text-muted",
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
                </div>
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
    </div>
  );
}
