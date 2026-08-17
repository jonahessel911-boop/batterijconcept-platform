"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  addDays,
  addWeeks,
  format,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { Project } from "@/types/database";
import {
  AMSTERDAM_TZ,
  adresRegel,
  formatTimeNl,
} from "@/lib/format";

type OrderRow = Project & { leads?: Project["leads"] };

type AgendaDay = { key: string; date: Date };

function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function weekDaysFrom(anchor: Date): AgendaDay[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { key: format(date, "yyyy-MM-dd"), date };
  });
}

function leadOf(o: OrderRow) {
  return Array.isArray(o.leads) ? o.leads[0] : o.leads;
}

export function InstallatieSchouwAgenda({
  token,
  orders,
}: {
  token: string;
  orders: OrderRow[];
}) {
  const todayKey = useMemo(() => dayKeyAmsterdam(new Date()), []);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [selectedDayKey, setSelectedDayKey] = useState(todayKey);

  const days = useMemo(() => weekDaysFrom(weekAnchor), [weekAnchor]);

  const byDay = useMemo(() => {
    const map = new Map<string, OrderRow[]>();
    for (const o of orders) {
      if (!o.schouw_at) continue;
      const key = dayKeyAmsterdam(o.schouw_at);
      const list = map.get(key) || [];
      list.push(o);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          new Date(a.schouw_at || 0).getTime() -
          new Date(b.schouw_at || 0).getTime()
      );
    }
    return map;
  }, [orders]);

  const selectedDay =
    days.find((d) => d.key === selectedDayKey) || days[0];
  const selectedList = byDay.get(selectedDay.key) || [];

  return (
    <div className="overflow-hidden border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-3 sm:px-4">
        <button
          type="button"
          onClick={() => setWeekAnchor((d) => addWeeks(d, -1))}
          className="min-h-10 px-3 text-sm font-semibold text-green-dark hover:underline"
        >
          ← Vorige
        </button>
        <p className="min-w-0 text-center font-display text-sm font-semibold capitalize text-ink sm:text-base">
          {format(days[0].date, "d MMM", { locale: nl })} –{" "}
          {format(days[6].date, "d MMM yyyy", { locale: nl })}
        </p>
        <button
          type="button"
          onClick={() => setWeekAnchor((d) => addWeeks(d, 1))}
          className="min-h-10 px-3 text-sm font-semibold text-green-dark hover:underline"
        >
          Volgende →
        </button>
      </div>

      {/* Mobiel: dagstrip + lijst */}
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
              Geen schouw op deze dag
            </p>
          ) : (
            selectedList.map((o) => {
              const lead = leadOf(o);
              return (
                <Link
                  key={o.id}
                  href={`/installatie/${token}/orders/${o.id}`}
                  className="block border border-line px-3 py-3 hover:border-green/40"
                >
                  <p className="text-sm font-bold tabular-nums text-green-dark">
                    {formatTimeNl(o.schouw_at)}
                  </p>
                  <p className="mt-0.5 font-semibold text-ink">
                    {lead?.naam || o.titel || o.project_nummer}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {lead ? adresRegel(lead) : "—"}
                  </p>
                </Link>
              );
            })
          )}
        </div>
      </div>

      {/* Desktop: weekkolommen */}
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
                    list.map((o) => {
                      const lead = leadOf(o);
                      return (
                        <Link
                          key={o.id}
                          href={`/installatie/${token}/orders/${o.id}`}
                          className="block rounded-lg border border-transparent border-l-[3px] border-l-green bg-green-soft/70 px-2 py-1.5 hover:shadow-sm"
                        >
                          <span className="block text-[11px] font-bold tabular-nums text-green-dark">
                            {formatTimeNl(o.schouw_at)}
                          </span>
                          <span className="mt-1 block truncate text-[12px] font-semibold text-ink">
                            {lead?.naam || o.project_nummer}
                          </span>
                        </Link>
                      );
                    })
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
