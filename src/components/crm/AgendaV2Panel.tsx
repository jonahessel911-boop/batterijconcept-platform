"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addWeeks,
  format,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type {
  Adviseur,
  Afspraak,
  AfspraakSoort,
  Lead,
  LeadStatus,
} from "@/types/database";
import { AMSTERDAM_TZ, formatTimeNl } from "@/lib/format";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import { isPlanbareAdviseur } from "@/lib/rollen";
import {
  afspraakZichtbaarInAgenda,
  normalizeAfspraakSoort,
} from "@/lib/afspraak-soort";
import {
  agendaWeekJumpOptions,
  parseSchouwWeekValue,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
  schouwWeekValue,
} from "@/lib/schouw-week";
import { ADVISEUR_SLOT_HOURS } from "@/lib/slots";
import { afblokKey } from "@/lib/adviseur-beschikbaarheid";
import { LeadZoekVeld } from "./LeadZoekVeld";
import { AfspraakDetail } from "./AgendaPanel";
import { LeadsTable } from "./LeadsTable";

/** Vaste afspraakblokken: 10:00, 13:00, 16:00, 19:00 */
const SLOT_ROWS: { label: string; hour: number; minute: number }[] =
  ADVISEUR_SLOT_HOURS.map((hour) => ({
    label: `${String(hour).padStart(2, "0")}:00`,
    hour,
    minute: 0,
  }));

type LegendItem = { color: string; label: string };

const LEGEND: LegendItem[] = [
  { color: "#94A3B8", label: "Afspraak ingepland" },
  { color: "#F37021", label: "Afspraak verplaatst" },
  { color: "#16A34A", label: "Doorgegaan" },
  { color: "#B91C1C", label: "Afgezegd" },
  { color: "#1E3A8A", label: "Deur niet open" },
  { color: "#7C3AED", label: "Verplaatsen" },
  { color: "#0F766E", label: "Doorgegaan + Vervolg" },
  { color: "#DB2777", label: "Doorgegaan + Sale" },
  { color: "#DC2626", label: "Niet goed gekwalificeerd" },
  { color: "#CA8A04", label: "Doorgegaan niet tijdig afgeboekt" },
  { color: "#6B7280", label: "Doorgegaan + Negatief" },
];

function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function weekDaysFrom(anchor: Date) {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    return { key: format(date, "yyyy-MM-dd"), date };
  });
}

function appointmentHourLocal(startAt: string): number {
  const h = Number(formatInTimeZone(new Date(startAt), AMSTERDAM_TZ, "H"));
  const m = Number(formatInTimeZone(new Date(startAt), AMSTERDAM_TZ, "m"));
  return h + m / 60;
}

function nearestSlotIndex(startAt: string): number {
  const t = appointmentHourLocal(startAt);
  let best = 0;
  let bestDist = Infinity;
  SLOT_ROWS.forEach((row, i) => {
    const rowT = row.hour + row.minute / 60;
    const d = Math.abs(rowT - t);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

function isoForDaySlot(dayKey: string, hour: number, minute: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return fromZonedTime(
    new Date(y, m - 1, d, hour, minute, 0, 0),
    AMSTERDAM_TZ
  ).toISOString();
}

type StickerMeta = {
  badge: string;
  badgeClass: string;
  statusLabel: string;
  statusColor: string;
  tint: string;
  border: string;
};

function stickerMeta(
  a: Afspraak,
  leadStatus: string | null,
  vervolgIndex: number
): StickerMeta {
  const soort = normalizeAfspraakSoort(a.soort);
  let badge = "Nieuw";
  let badgeClass = "bg-[#DBEAFE] text-[#1D4ED8]";
  if (soort === "vervolg_fysiek" || soort === "vervolg_tel" || soort === "vervolg_punt") {
    const n = Math.max(1, vervolgIndex);
    badge = n === 1 ? "1e Vervolg" : n === 2 ? "2e Vervolg" : `${n}e Vervolg`;
    badgeClass =
      n === 1
        ? "bg-[#EDE9FE] text-[#6D28D9]"
        : "bg-[#E0F2FE] text-[#0369A1]";
  } else if (soort === "bel" || soort === "warme_bel") {
    badge = "Bel";
    badgeClass = "bg-[#FEF3C7] text-[#B45309]";
  }

  // Default planned
  let statusLabel = "Afspraak ingepland";
  let statusColor = "#94A3B8";
  let tint = "#F8FAFC";
  let border = "#CBD5E1";

  if (a.status === "verzet") {
    statusLabel = "Afspraak verplaatst";
    statusColor = "#F37021";
    tint = "#FFF7ED";
    border = "#FDBA74";
  } else if (a.status === "geannuleerd") {
    statusLabel = "Afgezegd";
    statusColor = "#B91C1C";
    tint = "#FEF2F2";
    border = "#FECACA";
  } else if (a.status === "voltooid" || leadStatus) {
    const ls = leadStatus || "";
    if (ls === "sale_financiering" || ls === "sale_eigen_middelen" || ls === "deal") {
      statusLabel = "Doorgegaan + Sale";
      statusColor = "#DB2777";
      tint = "#FDF2F8";
      border = "#F9A8D4";
    } else if (ls === "vervolg_fysiek" || ls === "vervolg_tel") {
      statusLabel = "Doorgegaan + Vervolg";
      statusColor = "#0F766E";
      tint = "#F0FDFA";
      border = "#99F6E4";
    } else if (ls === "deur_niet_open") {
      statusLabel = "Deur niet open";
      statusColor = "#1E3A8A";
      tint = "#EFF6FF";
      border = "#93C5FD";
    } else if (ls === "niet_gekwalificeerd") {
      statusLabel = "Niet goed gekwalificeerd";
      statusColor = "#DC2626";
      tint = "#FEF2F2";
      border = "#FECACA";
    } else if (
      ls === "geen_interesse" ||
      ls === "offerte_afgewezen" ||
      ls === "vervolg_geen_contact"
    ) {
      statusLabel = "Doorgegaan + Negatief";
      statusColor = "#6B7280";
      tint = "#F3F4F6";
      border = "#D1D5DB";
    } else if (ls === "afspraak_afgezegd_klant") {
      statusLabel = "Afgezegd";
      statusColor = "#B91C1C";
      tint = "#FEF2F2";
      border = "#FECACA";
    } else if (a.status === "voltooid") {
      statusLabel = "Doorgegaan";
      statusColor = "#16A34A";
      tint = "#F0FDF4";
      border = "#86EFAC";
    }
  }

  // Soft “verplaatsen” cue when lead still open after visit
  if (
    a.status !== "geannuleerd" &&
    a.status !== "voltooid" &&
    (leadStatus === "na_afspraak" || leadStatus === "afspraak")
  ) {
    // keep planned look unless explicitly something else
  }

  return { badge, badgeClass, statusLabel, statusColor, tint, border };
}

function StickerCard({
  a,
  leadStatus,
  vervolgIndex,
  onClick,
}: {
  a: Afspraak;
  leadStatus: string | null;
  vervolgIndex: number;
  onClick: () => void;
}) {
  const meta = stickerMeta(a, leadStatus, vervolgIndex);
  const naam = a.leads?.naam || "Onbekend";
  const plaats = a.leads?.plaats || a.leads?.postcode || "—";
  const tijd = formatTimeNl(a.start_at);
  const soort = normalizeAfspraakSoort(a.soort);
  const typeLabel =
    soort === "vervolg_tel" || soort === "bel" || soort === "warme_bel"
      ? "Tel"
      : "Fysiek";
  const typeColor =
    typeLabel === "Tel" ? "#CA8A04" : "#16A34A";

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${meta.badge} · ${typeLabel} · ${meta.statusLabel} · ${naam} · ${plaats} · ${tijd}`}
      className="w-full rounded-md border px-1.5 py-1 text-left transition hover:brightness-[0.98]"
      style={{
        background: meta.tint,
        borderColor: meta.border,
        borderLeftWidth: 3,
        borderLeftColor: meta.statusColor,
      }}
    >
      <div className="flex min-w-0 items-center gap-1 overflow-hidden">
        <span
          className={`shrink-0 rounded px-1 py-px text-[9px] font-bold leading-tight ${meta.badgeClass}`}
        >
          {meta.badge}
        </span>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] font-medium text-[#4B5563]">
          <span
            className="inline-block h-1 w-1 rounded-full"
            style={{ background: typeColor }}
          />
          {typeLabel}
        </span>
        <span className="truncate text-[9px] font-medium" style={{ color: meta.statusColor }}>
          {meta.statusLabel}
        </span>
      </div>
      <p className="mt-0.5 truncate text-[11px] font-bold leading-tight text-[#111827]">
        {naam}
      </p>
      <p className="truncate text-[9px] leading-tight text-[#6B7280]">
        {plaats} · {tijd}
      </p>
    </button>
  );
}

function GeblokkeerdCell() {
  return (
    <div
      className="flex h-full min-h-[2.25rem] items-center justify-center gap-1 rounded border border-[#FECACA] px-1.5 py-1 text-[#B91C1C]"
      style={{
        background:
          "repeating-linear-gradient(135deg, #FEF2F2, #FEF2F2 6px, #FEE2E2 6px, #FEE2E2 12px)",
      }}
    >
      <span className="text-[10px]">🔒</span>
      <span className="text-[10px] font-semibold">Geblokkeerd</span>
    </div>
  );
}

export function AgendaPanel({
  leads,
  afspraken: afsprakenProp,
  defaultAdviseurId,
  adviseurs: adviseursProp = [],
  onStatusChange,
  onBellerChange,
}: {
  leads: Lead[];
  afspraken?: Afspraak[];
  defaultAdviseurId?: string;
  adviseurs?: Adviseur[];
  onStatusChange?: (leadId: string, status: LeadStatus) => void;
  onBellerChange?: (leadId: string, bellerId: string | null) => void;
}) {
  const [afspraken, setAfspraken] = useState<Afspraak[]>(afsprakenProp || []);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>(adviseursProp);
  const [loading, setLoading] = useState(!(afsprakenProp && afsprakenProp.length));
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [selectedDayKey, setSelectedDayKey] = useState(() =>
    dayKeyAmsterdam(new Date())
  );
  const [calendarView, setCalendarView] = useState<"dag" | "week">("week");
  const [mainView, setMainView] = useState<"agenda" | "leads">("agenda");
  const slideRef = useRef<HTMLDivElement>(null);
  const ignoreScrollSync = useRef(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [adviseurMenuOpen, setAdviseurMenuOpen] = useState(false);
  const [beschikbaarMap, setBeschikbaarMap] = useState<Map<string, boolean>>(
    new Map()
  );
  const [selected, setSelected] = useState<Afspraak | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planSlot, setPlanSlot] = useState<{
    adviseurId: string;
    startAt: string;
  } | null>(null);
  const [pickedLead, setPickedLead] = useState<Lead | null>(null);
  const [planSoort, setPlanSoort] = useState<AfspraakSoort>("nieuw");
  const [saving, setSaving] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);

  const todayKey = dayKeyAmsterdam(new Date());

  const days = useMemo(() => weekDaysFrom(weekAnchor), [weekAnchor]);
  const visibleDays = useMemo(() => {
    if (calendarView === "week") return days;
    const hit =
      days.find((d) => d.key === selectedDayKey) ||
      days.find((d) => d.key === todayKey) ||
      days[0];
    return [hit];
  }, [calendarView, days, selectedDayKey, todayKey]);

  const weekInfo = useMemo(() => schouwWeekFromDate(weekAnchor), [weekAnchor]);
  const weekJumpOptions = useMemo(() => agendaWeekJumpOptions(8, 40), []);

  const planAdviseurs = useMemo(
    () =>
      adviseurs.filter(
        (a) => a.actief && !isAdminAdviseur(a) && isPlanbareAdviseur(a)
      ),
    [adviseurs]
  );

  const visibleAdviseurs = useMemo(() => {
    let list = planAdviseurs;
    if (defaultAdviseurId) {
      list = list.filter((a) => a.id === defaultAdviseurId);
    }
    return list.filter((a) => !hiddenIds.has(a.id));
  }, [planAdviseurs, defaultAdviseurId, hiddenIds]);

  /** Leads met een zichtbare agenda-afspraak vandaag (op starttijd). */
  const leadsVandaag = useMemo(() => {
    const visibleAdvIds = new Set(visibleAdviseurs.map((a) => a.id));
    const todays = afspraken
      .filter((a) => {
        if (a.status === "geannuleerd") return false;
        if (!afspraakZichtbaarInAgenda(a, afspraken)) return false;
        if (dayKeyAmsterdam(a.start_at) !== todayKey) return false;
        if (defaultAdviseurId && a.adviseur_id !== defaultAdviseurId) {
          return false;
        }
        if (visibleAdvIds.size > 0 && !visibleAdvIds.has(a.adviseur_id)) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      );

    const byId = new Map(leads.map((l) => [l.id, l]));
    const seen = new Set<string>();
    const out: Lead[] = [];
    for (const a of todays) {
      if (seen.has(a.lead_id)) continue;
      seen.add(a.lead_id);
      const lead = byId.get(a.lead_id);
      if (lead) out.push(lead);
    }
    return out;
  }, [
    afspraken,
    leads,
    todayKey,
    defaultAdviseurId,
    visibleAdviseurs,
  ]);

  const leadStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) if (l.id && l.status) m.set(l.id, l.status);
    return m;
  }, [leads]);

  const adviseurNaam = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of adviseurs) m.set(a.id, a.naam);
    return m;
  }, [adviseurs]);

  function scrollToView(view: "agenda" | "leads") {
    const el = slideRef.current;
    if (!el) return;
    ignoreScrollSync.current = true;
    const idx = view === "agenda" ? 0 : 1;
    el.scrollTo({ left: idx * el.clientWidth, behavior: "smooth" });
    window.setTimeout(() => {
      ignoreScrollSync.current = false;
    }, 350);
  }

  function selectMainView(view: "agenda" | "leads") {
    setMainView(view);
    scrollToView(view);
  }

  useEffect(() => {
    const el = slideRef.current;
    if (!el) return;
    const onScroll = () => {
      if (ignoreScrollSync.current) return;
      const w = el.clientWidth || 1;
      const idx = Math.round(el.scrollLeft / w);
      setMainView(idx <= 0 ? "agenda" : "leads");
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (adviseursProp.length) setAdviseurs(adviseursProp);
  }, [adviseursProp]);

  /** Volgorde van vervolg-afspraken per lead. */
  const vervolgIndexByAfspraak = useMemo(() => {
    const byLead = new Map<string, Afspraak[]>();
    for (const a of afspraken) {
      const s = normalizeAfspraakSoort(a.soort);
      if (
        s !== "vervolg_fysiek" &&
        s !== "vervolg_tel" &&
        s !== "vervolg_punt"
      ) {
        continue;
      }
      const list = byLead.get(a.lead_id) || [];
      list.push(a);
      byLead.set(a.lead_id, list);
    }
    const out = new Map<string, number>();
    for (const [, list] of byLead) {
      list
        .slice()
        .sort(
          (x, y) =>
            new Date(x.start_at).getTime() - new Date(y.start_at).getTime()
        )
        .forEach((a, i) => out.set(a.id, i + 1));
    }
    return out;
  }, [afspraken]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, adv] = await Promise.all([
        fetch("/api/afspraken").then((r) => r.json()),
        fetch("/api/adviseurs").then((r) => r.json()),
      ]);
      if (!a.error) {
        const list = (a.afspraken || []) as Afspraak[];
        setAfspraken(
          defaultAdviseurId
            ? list.filter((x) => x.adviseur_id === defaultAdviseurId)
            : list
        );
      } else if (!afsprakenProp?.length) throw new Error(a.error);
      if (!adv.error) setAdviseurs(adv.adviseurs || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [afsprakenProp, defaultAdviseurId]);

  useEffect(() => {
    if (!afsprakenProp) return;
    setAfspraken(
      defaultAdviseurId
        ? afsprakenProp.filter((x) => x.adviseur_id === defaultAdviseurId)
        : afsprakenProp
    );
  }, [afsprakenProp, defaultAdviseurId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Beschikbaarheid alle zichtbare adviseurs voor dit jaar
  useEffect(() => {
    const ids = planAdviseurs.map((a) => a.id);
    if (!ids.length) return;
    let cancelled = false;
    const y = weekInfo.jaar;
    (async () => {
      const map = new Map<string, boolean>();
      await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(
              `/api/adviseurs/beschikbaarheid?adviseur_id=${id}&jaren=${y - 1},${y},${y + 1}`
            );
            const data = await res.json();
            for (const item of data.items || []) {
              const key = `${id}:${item.jaar}-W${String(item.week).padStart(2, "0")}`;
              map.set(key, item.beschikbaar !== false);
            }
          } catch {
            /* ignore */
          }
        })
      );
      if (!cancelled) setBeschikbaarMap(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [planAdviseurs, weekInfo.jaar]);

  function isWeekBlocked(adviseurId: string): boolean {
    const key = `${adviseurId}:${weekInfo.jaar}-W${String(weekInfo.week).padStart(2, "0")}`;
    const v = beschikbaarMap.get(key);
    return v === false;
  }

  async function toggleBlockWeek(adviseurId?: string) {
    const id = adviseurId || defaultAdviseurId || visibleAdviseurs[0]?.id;
    if (!id) {
      setError("Selecteer een adviseur om te blokkeren");
      return;
    }
    setBlockBusy(true);
    setError(null);
    const next = isWeekBlocked(id);
    try {
      const res = await fetch("/api/adviseurs/beschikbaarheid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adviseur_id: id,
          jaar: weekInfo.jaar,
          week: weekInfo.week,
          beschikbaar: next, // if blocked → make available
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Blokkeren mislukt");
      const key = `${id}:${weekInfo.jaar}-W${String(weekInfo.week).padStart(2, "0")}`;
      setBeschikbaarMap((prev) => {
        const copy = new Map(prev);
        copy.set(key, next);
        return copy;
      });
      setOkMsg(
        next
          ? `Week ${weekInfo.week}: weer beschikbaar`
          : `Week ${weekInfo.week}: geblokkeerd`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Blokkeren mislukt");
    } finally {
      setBlockBusy(false);
    }
  }

  function appointmentsInCell(
    adviseurId: string,
    dayKey: string,
    slotIdx: number
  ): Afspraak[] {
    return afspraken.filter((a) => {
      if (a.adviseur_id !== adviseurId) return false;
      if (!afspraakZichtbaarInAgenda(a, afspraken)) return false;
      if (dayKeyAmsterdam(a.start_at) !== dayKey) return false;
      return nearestSlotIndex(a.start_at) === slotIdx;
    });
  }

  async function planAfspraak(e: React.FormEvent) {
    e.preventDefault();
    if (!planSlot || !pickedLead) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: pickedLead.id,
          adviseur_id: planSlot.adviseurId,
          start_at: planSlot.startAt,
          soort: planSoort,
          ...(planSoort === "nieuw"
            ? { partner_aanwezig: true, andere_offertes_gehad: false }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Plannen mislukt");
      setOkMsg("Afspraak gepland");
      setPlanOpen(false);
      setPlanSlot(null);
      setPickedLead(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  function openPlan(adviseurId: string, dayKey: string, slotIdx: number) {
    if (isWeekBlocked(adviseurId)) {
      setError("Deze week is geblokkeerd voor deze adviseur");
      return;
    }
    const row = SLOT_ROWS[slotIdx];
    setPlanSlot({
      adviseurId,
      startAt: isoForDaySlot(dayKey, row.hour, row.minute),
    });
    setPlanSoort("nieuw");
    setPickedLead(null);
    setPlanOpen(true);
    setSelected(null);
  }

  const weekTitle = `Week ${weekInfo.week} — ${format(days[0].date, "d MMM.", { locale: nl })} t/m ${format(days[6].date, "d MMM. yyyy", { locale: nl })}`;
  const leadsTitle = `Leads vandaag · ${formatInTimeZone(new Date(), AMSTERDAM_TZ, "EEEE d MMMM", { locale: nl })}`;

  return (
    <div className="flex h-full min-h-[70vh] flex-col bg-white">
      {/* Header */}
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <div className="mb-3 flex w-fit rounded-lg border border-line p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => selectMainView("agenda")}
            className={[
              "rounded-md px-3 py-1.5",
              mainView === "agenda"
                ? "bg-green text-white"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            Agenda
          </button>
          <button
            type="button"
            onClick={() => selectMainView("leads")}
            className={[
              "rounded-md px-3 py-1.5",
              mainView === "leads"
                ? "bg-green text-white"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            Leads vandaag
            {leadsVandaag.length > 0 ? (
              <span className="ml-1.5 tabular-nums opacity-80">
                ({leadsVandaag.length})
              </span>
            ) : null}
          </button>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-display text-xl font-semibold text-ink sm:text-2xl">
              {mainView === "leads" ? leadsTitle : weekTitle}
            </h1>
            {mainView === "agenda" ? (
            <div className="mt-2 flex max-w-4xl flex-wrap gap-x-3 gap-y-1">
              {LEGEND.map((l) => (
                <span
                  key={l.label}
                  className="inline-flex items-center gap-1.5 text-[10px] text-muted"
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: l.color }}
                  />
                  {l.label}
                </span>
              ))}
            </div>
            ) : (
              <p className="mt-1 text-sm text-muted">
                Leads met een afspraak op de agenda vandaag — swipe of wissel van
                tab.
              </p>
            )}
          </div>

          {mainView === "agenda" ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex rounded-lg border border-line p-0.5 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setCalendarView("dag")}
                className={[
                  "rounded-md px-2.5 py-1.5",
                  calendarView === "dag"
                    ? "bg-green text-white"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                Dag
              </button>
              <button
                type="button"
                onClick={() => setCalendarView("week")}
                className={[
                  "rounded-md px-2.5 py-1.5",
                  calendarView === "week"
                    ? "bg-green text-white"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                Week
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                if (calendarView === "dag") {
                  const next = addDays(
                    days.find((d) => d.key === selectedDayKey)?.date ||
                      weekAnchor,
                    -1
                  );
                  setSelectedDayKey(dayKeyAmsterdam(next));
                  setWeekAnchor(next);
                } else {
                  setWeekAnchor((d) => addWeeks(d, -1));
                }
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line hover:bg-wash"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setWeekAnchor(now);
                setSelectedDayKey(dayKeyAmsterdam(now));
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
            >
              Vandaag
            </button>
            <button
              type="button"
              onClick={() => {
                if (calendarView === "dag") {
                  const next = addDays(
                    days.find((d) => d.key === selectedDayKey)?.date ||
                      weekAnchor,
                    1
                  );
                  setSelectedDayKey(dayKeyAmsterdam(next));
                  setWeekAnchor(next);
                } else {
                  setWeekAnchor((d) => addWeeks(d, 1));
                }
              }}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-line hover:bg-wash"
            >
              ›
            </button>
            <select
              value={schouwWeekValue(weekInfo.jaar, weekInfo.week)}
              onChange={(e) => {
                const p = parseSchouwWeekValue(e.target.value);
                if (!p) return;
                setWeekAnchor(
                  new Date(schouwWeekToMondayIso(p.jaar, p.week))
                );
              }}
              className="min-h-9 rounded-lg border border-line bg-white px-2 text-xs font-semibold"
            >
              {weekJumpOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  W{o.week} · {o.jaar}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={blockBusy}
              onClick={() => void toggleBlockWeek()}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash disabled:opacity-60"
            >
              Afblokken
            </button>
            {!defaultAdviseurId && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAdviseurMenuOpen((v) => !v)}
                  className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-wash"
                >
                  Adviseurs
                </button>
                {adviseurMenuOpen && (
                  <div className="absolute right-0 z-20 mt-1 max-h-64 w-56 overflow-auto border border-line bg-white p-2 shadow-lg">
                    {planAdviseurs.map((a) => {
                      const hidden = hiddenIds.has(a.id);
                      return (
                        <label
                          key={a.id}
                          className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm hover:bg-wash"
                        >
                          <input
                            type="checkbox"
                            checked={!hidden}
                            onChange={() => {
                              setHiddenIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(a.id)) next.delete(a.id);
                                else next.add(a.id);
                                return next;
                              });
                            }}
                          />
                          {a.naam}
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          ) : null}
        </div>

        {(error || okMsg) && (
          <div className="mt-3 space-y-1">
            {error && (
              <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
                {error}
              </p>
            )}
            {okMsg && (
              <p className="border border-green/30 bg-green-soft px-3 py-2 text-xs text-green-dark">
                {okMsg}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Swipebaar: Agenda | Leads vandaag */}
      <div
        ref={slideRef}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden scroll-smooth"
      >
        <div className="min-h-0 w-full min-w-full shrink-0 snap-start overflow-auto">
        {loading ? (
          <p className="p-8 text-center text-sm text-muted">Laden…</p>
        ) : visibleAdviseurs.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted">
            Geen adviseurs zichtbaar.
          </p>
        ) : (
          <div className="min-w-max">
            {/* Column headers */}
            <div
              className="sticky top-0 z-10 grid border-b border-line bg-white"
              style={{
                gridTemplateColumns: `72px repeat(${visibleAdviseurs.length}, minmax(160px, 1fr))`,
              }}
            >
              <div className="border-r border-line bg-[#FAFBFA]" />
              {visibleAdviseurs.map((a) => (
                <div
                  key={a.id}
                  className="border-r border-line px-2 py-2.5 text-center"
                >
                  <p className="truncate text-xs font-semibold text-ink">
                    {a.naam}
                  </p>
                  {isWeekBlocked(a.id) && (
                    <p className="mt-0.5 text-[10px] font-semibold text-[#B91C1C]">
                      Week geblokkeerd
                    </p>
                  )}
                </div>
              ))}
            </div>

            {visibleDays.map((day) => (
              <div key={day.key}>
                <div className="border-b border-line bg-[#F3F4F6] px-3 py-1.5 text-xs font-semibold capitalize text-[#4B5563]">
                  {format(day.date, "EEEE d MMM.", { locale: nl })}
                </div>
                {SLOT_ROWS.map((row, slotIdx) => (
                  <div
                    key={`${day.key}-${row.label}`}
                    className="grid border-b border-line"
                    style={{
                      gridTemplateColumns: `72px repeat(${visibleAdviseurs.length}, minmax(160px, 1fr))`,
                    }}
                  >
                    <div className="flex items-start justify-end border-r border-line bg-[#FAFBFA] px-2 py-1.5 text-[10px] font-semibold tabular-nums text-muted">
                      {row.label}
                    </div>
                    {visibleAdviseurs.map((adv) => {
                      const blocked = isWeekBlocked(adv.id);
                      const items = appointmentsInCell(
                        adv.id,
                        day.key,
                        slotIdx
                      );
                      return (
                        <div
                          key={`${adv.id}-${day.key}-${slotIdx}`}
                          className="min-h-[2.75rem] border-r border-line p-1"
                        >
                          {blocked && items.length === 0 ? (
                            <GeblokkeerdCell />
                          ) : items.length > 0 ? (
                            <div className="space-y-1">
                              {items.map((a) => (
                                <StickerCard
                                  key={a.id}
                                  a={a}
                                  leadStatus={
                                    leadStatusById.get(a.lead_id) ||
                                    a.leads?.status ||
                                    null
                                  }
                                  vervolgIndex={
                                    vervolgIndexByAfspraak.get(a.id) || 1
                                  }
                                  onClick={() => {
                                    setSelected(a);
                                    setPlanOpen(false);
                                  }}
                                />
                              ))}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                openPlan(adv.id, day.key, slotIdx)
                              }
                              className="flex h-full min-h-[2.25rem] w-full items-center justify-center rounded text-[11px] text-transparent hover:bg-[#F0FDF4] hover:text-green-dark"
                              title="Afspraak plannen"
                            >
                              +
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        </div>

        <div className="min-h-0 w-full min-w-full shrink-0 snap-start overflow-auto">
          {leadsVandaag.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <p className="font-display text-base font-semibold text-ink">
                Geen leads vandaag op de agenda
              </p>
              <p className="mt-1 text-sm text-muted">
                Zodra er huisbezoeken of vervolgafspraken voor vandaag staan,
                zie je ze hier in de leadtabel.
              </p>
            </div>
          ) : (
            <LeadsTable
              leads={leadsVandaag}
              adviseurs={adviseurs}
              onStatusChange={onStatusChange}
              onBellerChange={onBellerChange}
              showBellerColumn={Boolean(onBellerChange)}
            />
          )}
        </div>
      </div>

      {/* Detail drawer — zelfde als oude agenda */}
      {selected && (
        <AfspraakDetail
          afspraak={selected}
          allAfspraken={afspraken}
          onClose={() => setSelected(null)}
          onUpdated={(a) => {
            setAfspraken((prev) => prev.map((x) => (x.id === a.id ? a : x)));
            setSelected(a);
          }}
          onRemoved={(id) => {
            setAfspraken((prev) => prev.filter((x) => x.id !== id));
            setSelected(null);
          }}
          onCreated={(a) => {
            setAfspraken((prev) => [...prev, a]);
          }}
        />
      )}

      {/* Plan modal */}
      {planOpen && planSlot && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center">
          <form
            onSubmit={(e) => void planAfspraak(e)}
            className="w-full max-w-md space-y-3 border border-line bg-white p-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <p className="font-display text-base font-semibold">
                Afspraak plannen
              </p>
              <button
                type="button"
                onClick={() => setPlanOpen(false)}
                className="text-sm text-muted"
              >
                Sluiten
              </button>
            </div>
            <p className="text-xs text-muted">
              {adviseurNaam.get(planSlot.adviseurId)} ·{" "}
              {formatInTimeZone(
                new Date(planSlot.startAt),
                AMSTERDAM_TZ,
                "EEE d MMM HH:mm",
                { locale: nl }
              )}
            </p>
            <LeadZoekVeld
              value={pickedLead}
              onChange={setPickedLead}
              suggestions={leads}
            />
            <label className="block text-xs font-semibold uppercase text-muted">
              Soort
              <select
                value={planSoort}
                onChange={(e) =>
                  setPlanSoort(normalizeAfspraakSoort(e.target.value))
                }
                className="mt-1 w-full border border-line px-3 py-2 text-sm"
              >
                <option value="nieuw">Nieuw (huisbezoek)</option>
                <option value="vervolg_fysiek">1e/volgend vervolg fysiek</option>
                <option value="vervolg_tel">Vervolg telefonisch</option>
                <option value="bel">Belafspraak</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={saving || !pickedLead}
              className="w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
            >
              {saving ? "Bezig…" : "Plannen"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
