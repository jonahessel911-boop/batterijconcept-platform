"use client";

import { useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { Adviseur, Afspraak, Factuur, Lead, Project } from "@/types/database";
import {
  actiesVoorActiesTab,
  openBackofficeActies,
  type BackofficeActie,
} from "@/lib/backoffice-acties";
import { AMSTERDAM_TZ, formatDateTimeNl } from "@/lib/format";
import {
  ACTIE_KANBAN_LANES,
  actieKanbanCardsFromActies,
  actieKanbanMatchesDay,
  shiftDayKey,
  ymdAmsterdam,
  type ActieKanbanLaneId,
} from "@/lib/actie-kanban";

function formatDayLabel(dayKey: string): string {
  const today = ymdAmsterdam(new Date());
  if (dayKey === today) return "Vandaag";
  if (dayKey === shiftDayKey(today, 1)) return "Morgen";
  if (dayKey === shiftDayKey(today, -1)) return "Gisteren";
  try {
    return formatInTimeZone(
      new Date(`${dayKey}T12:00:00`),
      AMSTERDAM_TZ,
      "EEEE d MMMM",
      { locale: nl }
    );
  } catch {
    return dayKey;
  }
}

export function BackofficeActiesKanban({
  projecten,
  facturen = [],
  leads = [],
  afspraken = [],
  adviseurs = [],
  onSelectActie,
}: {
  projecten: Project[];
  facturen?: Factuur[];
  leads?: Lead[];
  afspraken?: Afspraak[];
  adviseurs?: Adviseur[];
  onSelectActie?: (actie: BackofficeActie) => void;
}) {
  const [dayKey, setDayKey] = useState<string | null>(() =>
    ymdAmsterdam(new Date())
  );
  const [search, setSearch] = useState("");

  const cards = useMemo(() => {
    const acties = actiesVoorActiesTab(
      openBackofficeActies(projecten, facturen, new Date(), {
        leads,
        afspraken,
        adviseurs,
      })
    );
    return actieKanbanCardsFromActies(acties);
  }, [projecten, facturen, leads, afspraken, adviseurs]);

  const q = search.trim().toLowerCase();

  const visible = useMemo(() => {
    return cards.filter((c) => {
      if (!actieKanbanMatchesDay(c.actie, dayKey)) return false;
      if (!q) return true;
      const hay = [
        c.titel,
        c.actie.leadNaam,
        c.actie.detail,
        c.actie.projectNummer,
        c.actie.plaats,
        c.actie.telefoon,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [cards, dayKey, q]);

  const byLane = useMemo(() => {
    const map = new Map<ActieKanbanLaneId, typeof visible>();
    for (const lane of ACTIE_KANBAN_LANES) map.set(lane.id, []);
    for (const c of visible) {
      (map.get(c.lane) || map.get("volgende")!).push(c);
    }
    return map;
  }, [visible]);

  const todayKey = ymdAmsterdam(new Date());

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-col gap-3 border-b border-line px-5 pb-3 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setDayKey((prev) => shiftDayKey(prev || todayKey, -1))
            }
            className="h-9 border border-line px-2.5 text-sm font-semibold text-ink hover:bg-wash"
          >
            Vorige
          </button>
          <input
            type="date"
            value={dayKey || todayKey}
            onChange={(e) => setDayKey(e.target.value || todayKey)}
            className="h-9 border border-line bg-white px-2.5 text-sm text-ink outline-none focus:border-green"
            aria-label="Datum"
          />
          <button
            type="button"
            onClick={() =>
              setDayKey((prev) => shiftDayKey(prev || todayKey, 1))
            }
            className="h-9 border border-line px-2.5 text-sm font-semibold text-ink hover:bg-wash"
          >
            Volgende
          </button>
          <button
            type="button"
            onClick={() => setDayKey(todayKey)}
            className={[
              "h-9 px-2.5 text-sm font-semibold",
              dayKey === todayKey
                ? "bg-green text-white"
                : "border border-line text-ink hover:bg-wash",
            ].join(" ")}
          >
            Vandaag
          </button>
          <button
            type="button"
            onClick={() => setDayKey(null)}
            className={[
              "h-9 px-2.5 text-sm font-semibold",
              dayKey === null
                ? "bg-green text-white"
                : "border border-line text-ink hover:bg-wash",
            ].join(" ")}
          >
            Alle dagen
          </button>
          <p className="ml-auto text-sm text-muted">
            {dayKey ? formatDayLabel(dayKey) : "Alle openstaande acties"} ·{" "}
            <span className="font-semibold tabular-nums text-ink">
              {visible.length}
            </span>
          </p>
        </div>
        <div className="relative w-full sm:max-w-lg">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted/50">
            ⌕
          </span>
          <input
            type="search"
            placeholder="Zoek naam, projectnr, plaats…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-line bg-white py-2.5 pl-8 pr-3 text-sm outline-none placeholder:text-muted/60 focus:border-green"
            aria-label="Zoek in acties"
          />
        </div>
      </div>

      <div className="space-y-2 px-5">
        {ACTIE_KANBAN_LANES.map((lane) => {
          const items = byLane.get(lane.id) || [];
          return (
            <div
              key={lane.id}
              className="grid grid-cols-1 border border-line bg-white md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]"
            >
              <div
                className="flex items-center justify-between gap-2.5 border-b border-line px-3 py-2 md:border-b-0 md:border-r"
                style={{ borderLeft: `4px solid ${lane.accent}` }}
              >
                <p className="truncate text-[14px] font-semibold leading-snug text-ink">
                  {lane.label}
                </p>
                <span
                  className="inline-flex min-w-[1.5rem] shrink-0 items-center justify-center px-1.5 py-0.5 text-[12px] font-bold tabular-nums text-white"
                  style={{ background: lane.accent }}
                >
                  {items.length}
                </span>
              </div>
              <div className="flex min-h-12 items-center gap-0 overflow-x-auto px-2 py-1.5">
                {items.length === 0 ? (
                  <p className="px-1.5 text-[13px] text-muted">—</p>
                ) : (
                  items.map((card, i) => {
                    const a = card.actie;
                    return (
                      <article
                        key={card.id}
                        className={[
                          "relative w-[14.5rem] shrink-0",
                          card.rest ? "h-14" : "h-12",
                        ].join(" ")}
                      >
                        <div className="absolute inset-y-0 left-0 right-2.5 border border-line bg-[#FAFBFA]" />
                        {i < items.length - 1 ? (
                          <>
                            <span
                              aria-hidden
                              className="pointer-events-none absolute top-1/2 right-0 z-[1] -translate-y-1/2"
                              style={{
                                width: 0,
                                height: 0,
                                borderTop: "24px solid transparent",
                                borderBottom: "24px solid transparent",
                                borderLeft: "12px solid #E5E8E5",
                              }}
                            />
                            <span
                              aria-hidden
                              className="pointer-events-none absolute top-1/2 right-[1px] z-[1] -translate-y-1/2"
                              style={{
                                width: 0,
                                height: 0,
                                borderTop: "22px solid transparent",
                                borderBottom: "22px solid transparent",
                                borderLeft: "11px solid #FAFBFA",
                              }}
                            />
                          </>
                        ) : null}
                        <button
                          type="button"
                          className="relative z-[2] flex h-full w-[calc(100%-0.65rem)] flex-col justify-center px-2.5 text-left"
                          onClick={() => onSelectActie?.(a)}
                        >
                          <p className="truncate text-[13px] font-semibold leading-tight text-ink">
                            {a.leadNaam}
                          </p>
                          <p className="truncate text-[11px] leading-tight text-muted">
                            {card.rest || card.titel}
                            {a.projectNummer ? ` · ${a.projectNummer}` : ""}
                            {a.overdue ? " · te laat" : ""}
                          </p>
                        </button>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
