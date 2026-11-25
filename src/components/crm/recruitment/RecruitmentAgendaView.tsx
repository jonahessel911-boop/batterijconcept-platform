"use client";

import { useEffect, useMemo, useState } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Phone, MapPin, X } from "lucide-react";
import type { Adviseur, Sollicitatie, SollicitatieAfspraak } from "@/types/database";
import { AMSTERDAM_TZ, formatTimeNl } from "@/lib/format";
import {
  amsterdamYmd,
  GESPREK_DAG_LAATSTE_START_HOUR,
  GESPREK_DAG_START_HOUR,
  GESPREK_DUUR_MIN,
} from "@/lib/recruitment-gesprek-slots";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SLOT_MINS: number[] = (() => {
  const out: number[] = [];
  for (
    let m = GESPREK_DAG_START_HOUR * 60;
    m <= GESPREK_DAG_LAATSTE_START_HOUR * 60;
    m += GESPREK_DUUR_MIN
  ) {
    out.push(m);
  }
  return out;
})();

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  return amsterdamYmd(new Date(noon.getTime() + days * 86_400_000));
}

function mondayOfWeek(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  const dow = Number(formatInTimeZone(noon, AMSTERDAM_TZ, "i"));
  return addDaysYmd(ymd, 1 - dow);
}

function dayHeader(ymd: string): { weekday: string; date: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  return {
    weekday: formatInTimeZone(noon, AMSTERDAM_TZ, "EEE", { locale: nl }),
    date: formatInTimeZone(noon, AMSTERDAM_TZ, "d MMM", { locale: nl }),
  };
}

function weekLabel(monday: string): string {
  const friday = addDaysYmd(monday, 4);
  const [y1, m1, d1] = monday.split("-").map(Number);
  const [y2, m2, d2] = friday.split("-").map(Number);
  const a = fromZonedTime(new Date(y1, m1 - 1, d1, 12, 0, 0, 0), AMSTERDAM_TZ);
  const b = fromZonedTime(new Date(y2, m2 - 1, d2, 12, 0, 0, 0), AMSTERDAM_TZ);
  const left = formatInTimeZone(a, AMSTERDAM_TZ, "d MMM", { locale: nl });
  const right = formatInTimeZone(b, AMSTERDAM_TZ, "d MMM yyyy", { locale: nl });
  return `${left} – ${right}`;
}

function ymdOf(iso: string): string {
  return formatInTimeZone(iso, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function minutesOf(iso: string): number {
  const h = Number(formatInTimeZone(iso, AMSTERDAM_TZ, "H"));
  const min = Number(formatInTimeZone(iso, AMSTERDAM_TZ, "m"));
  return h * 60 + min;
}

function slotLabel(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function kandidaatNaam(
  a: SollicitatieAfspraak,
  byId: Map<string, Sollicitatie>
): string {
  return (
    a.sollicitaties?.naam ||
    byId.get(a.sollicitatie_id)?.naam ||
    "Onbekende kandidaat"
  );
}

function kandidaatFunctie(
  a: SollicitatieAfspraak,
  byId: Map<string, Sollicitatie>
): string {
  return (
    a.sollicitaties?.functie ||
    byId.get(a.sollicitatie_id)?.functie ||
    ""
  );
}

function interviewerNaam(
  a: SollicitatieAfspraak,
  adviseurs: Adviseur[]
): string {
  const nested = a.interviewer || a.adviseurs;
  if (nested?.naam) return nested.naam.trim().split(/\s+/)[0] || nested.naam;
  if (!a.interviewer_id) return "";
  const found = adviseurs.find((x) => x.id === a.interviewer_id);
  if (!found?.naam) return "";
  return found.naam.trim().split(/\s+/)[0] || found.naam;
}

export function RecruitmentAgendaView({
  afspraken,
  kandidaten = [],
  onOpenKandidaat,
  onRemoveAfspraak,
  onRefresh,
}: {
  afspraken: SollicitatieAfspraak[];
  kandidaten?: Sollicitatie[];
  onOpenKandidaat?: (id: string) => void;
  /** Alleen dit gesprek uit de agenda. De sollicitant blijft staan. */
  onRemoveAfspraak?: (afspraak: SollicitatieAfspraak) => void;
  onRefresh?: () => void;
}) {
  const today = amsterdamYmd();
  const [weekStart, setWeekStart] = useState(() => mondayOfWeek(today));
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);

  useEffect(() => {
    onRefresh?.();
  }, [onRefresh]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/adviseurs?include_inactive=1", {
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const list = ((data.adviseurs || []) as Adviseur[]).filter(
          (a) => a.actief !== false && !isAdminAdviseur(a)
        );
        setAdviseurs(list);
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(
    () => Array.from({ length: 5 }, (_, i) => addDaysYmd(weekStart, i)),
    [weekStart]
  );

  const byId = useMemo(() => {
    const map = new Map<string, Sollicitatie>();
    for (const s of kandidaten) map.set(s.id, s);
    return map;
  }, [kandidaten]);

  const weekAfspraken = useMemo(() => {
    const start = days[0]!;
    const endExclusive = addDaysYmd(days[4]!, 1);
    return afspraken
      .filter((a) => {
        const ymd = ymdOf(a.start_at);
        return ymd >= start && ymd < endExclusive;
      })
      .slice()
      .sort(
        (a, b) =>
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      );
  }, [afspraken, days]);

  const byDaySlot = useMemo(() => {
    const map = new Map<string, SollicitatieAfspraak[]>();
    for (const a of weekAfspraken) {
      const ymd = ymdOf(a.start_at);
      const mins = minutesOf(a.start_at);
      const snapped = Math.round(mins / GESPREK_DUUR_MIN) * GESPREK_DUUR_MIN;
      const key = `${ymd}|${snapped}`;
      const list = map.get(key) || [];
      list.push(a);
      map.set(key, list);
    }
    return map;
  }, [weekAfspraken]);

  const countsByDay = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of weekAfspraken) {
      const ymd = ymdOf(a.start_at);
      map.set(ymd, (map.get(ymd) || 0) + 1);
    }
    return map;
  }, [weekAfspraken]);

  function renderCard(a: SollicitatieAfspraak, compact: boolean) {
    const naam = kandidaatNaam(a, byId);
    const functie = kandidaatFunctie(a, byId);
    const wie = interviewerNaam(a, adviseurs);
    const fysiek = a.soort === "fysiek";
    return (
      <div
        key={a.id}
        className={cn(
          "relative rounded-md border transition hover:border-green",
          fysiek
            ? "border-green/30 bg-green-soft/60"
            : "border-line bg-white"
        )}
      >
        <button
          type="button"
          onClick={() => onOpenKandidaat?.(a.sollicitatie_id)}
          className="w-full px-2 py-1.5 pr-7 text-left"
        >
          <p className="truncate text-[12px] font-semibold text-ink">{naam}</p>
          {!compact && functie ? (
            <p className="truncate text-[11px] text-muted">{functie}</p>
          ) : null}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] font-medium text-muted">
            <span className="tabular-nums">{formatTimeNl(a.start_at)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-0.5">
              {fysiek ? (
                <MapPin className="size-2.5" aria-hidden />
              ) : (
                <Phone className="size-2.5" aria-hidden />
              )}
              {fysiek ? "Fysiek" : "Tel"}
            </span>
            {wie ? (
              <>
                <span aria-hidden>·</span>
                <span>{wie}</span>
              </>
            ) : null}
          </p>
        </button>
        {onRemoveAfspraak ? (
          <button
            type="button"
            title="Alleen deze afspraak uit de agenda"
            aria-label={`Afspraak van ${naam} uit de agenda halen`}
            onClick={() => onRemoveAfspraak(a)}
            className="absolute right-0.5 top-0.5 inline-flex size-6 items-center justify-center rounded text-muted hover:bg-white hover:text-red-600"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5 sm:px-4">
        <div>
          <p className="text-sm font-semibold text-ink">Gespreksagenda</p>
          <p className="text-[12px] text-muted">
            {weekAfspraken.length === 1
              ? "1 gesprek deze week"
              : `${weekAfspraken.length} gesprekken deze week`}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setWeekStart((w) => addDaysYmd(w, -7))}
            aria-label="Vorige week"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <button
            type="button"
            onClick={() => setWeekStart(mondayOfWeek(today))}
            className="min-w-[11rem] rounded-md px-2 py-1.5 text-center text-[12px] font-semibold text-ink hover:bg-wash"
          >
            {weekLabel(weekStart)}
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setWeekStart((w) => addDaysYmd(w, 7))}
            aria-label="Volgende week"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <div className="min-w-[720px] px-3 py-3 sm:px-4">
          <div
            className="grid border-b border-line pb-2"
            style={{ gridTemplateColumns: "3.5rem repeat(5, minmax(0, 1fr))" }}
          >
            <div />
            {days.map((ymd) => {
              const h = dayHeader(ymd);
              const isToday = ymd === today;
              const n = countsByDay.get(ymd) || 0;
              return (
                <div
                  key={ymd}
                  className={cn(
                    "px-1 text-center",
                    isToday && "rounded-md bg-green-soft/80 py-1"
                  )}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                    {h.weekday}
                  </p>
                  <p
                    className={cn(
                      "text-[13px] font-semibold",
                      isToday ? "text-green-dark" : "text-ink"
                    )}
                  >
                    {h.date}
                  </p>
                  <p className="text-[10px] tabular-nums text-muted">
                    {n === 1 ? "1 gesprek" : `${n} gesprekken`}
                  </p>
                </div>
              );
            })}
          </div>

          {SLOT_MINS.map((mins) => (
            <div
              key={mins}
              className="grid border-b border-line/70"
              style={{
                gridTemplateColumns: "3.5rem repeat(5, minmax(0, 1fr))",
                minHeight: "3.25rem",
              }}
            >
              <div className="pr-2 pt-1 text-right text-[10px] tabular-nums text-muted">
                {slotLabel(mins)}
              </div>
              {days.map((ymd) => {
                const items = byDaySlot.get(`${ymd}|${mins}`) || [];
                return (
                  <div
                    key={`${ymd}-${mins}`}
                    className="flex flex-col gap-1 border-l border-line/70 p-1"
                  >
                    {items.map((a) => renderCard(a, items.length > 1))}
                  </div>
                );
              })}
            </div>
          ))}

          {weekAfspraken.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <CalendarDays className="size-8 text-muted" aria-hidden />
              <p className="mt-3 text-sm font-medium text-ink">
                Geen gesprekken deze week
              </p>
              <p className="mt-1 max-w-sm text-[12px] text-muted">
                Plan een gesprek bij een kandidaat — die verschijnt hier op
                dag en tijd.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
