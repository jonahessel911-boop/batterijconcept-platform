"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type {
  InstallatiePartner,
  InstallatiePartnerTeamgenoot,
  Project,
} from "@/types/database";
import { AMSTERDAM_TZ, formatTimeNl } from "@/lib/format";
import {
  installatieDuurVoorVenster,
  SCHOUW_DUUR_MINUTEN,
} from "@/lib/planning-duur";
import {
  PARTNER_VENSTER_BOUNDS,
  PARTNER_VENSTERS,
  partnerAfblokKey,
  type PartnerVenster,
} from "@/lib/partner-slots";

type BusyItem = {
  id: string;
  kind: "schouw" | "installatie";
  start_at: string;
  end_at: string;
  label: string;
  project_nummer?: string | null;
};

type DayCol = {
  date: Date;
  key: string;
  short: string;
  dayNum: string;
  inMonth: boolean;
  weekend: boolean;
};

type ViewMode = "week" | "maand";

function ymdKeyFromParts(y: number, m0: number, d: number): string {
  return formatInTimeZone(
    fromZonedTime(
      new Date(y, m0, d, 12, 0, 0),
      AMSTERDAM_TZ
    ),
    AMSTERDAM_TZ,
    "yyyy-MM-dd"
  );
}

function weekDaysFrom(anchor: Date): DayCol[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  const monthPrefix = format(local, "yyyy-MM");
  return Array.from({ length: 6 }, (_, i) => {
    const date = addDays(monday, i);
    const key = ymdKeyFromParts(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    const dow = date.getDay();
    return {
      date,
      key,
      short: format(date, "EEE", { locale: nl }),
      dayNum: format(date, "d"),
      inMonth: key.startsWith(monthPrefix),
      weekend: dow === 0 || dow === 6,
    };
  });
}

function monthDaysFrom(anchor: Date): DayCol[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const start = startOfWeek(startOfMonth(local), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(local), { weekStartsOn: 1 });
  const monthPrefix = format(local, "yyyy-MM");
  return eachDayOfInterval({ start, end }).map((date) => {
    const key = ymdKeyFromParts(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );
    const dow = date.getDay();
    return {
      date,
      key,
      short: format(date, "EEE", { locale: nl }),
      dayNum: format(date, "d"),
      inMonth: key.startsWith(monthPrefix),
      weekend: dow === 0 || dow === 6,
    };
  });
}

function vensterForLocalHour(
  hour: number,
  minute: number
): PartnerVenster | null {
  const mins = hour * 60 + minute;
  for (const v of PARTNER_VENSTERS) {
    const b = PARTNER_VENSTER_BOUNDS[v];
    const start = b.startHour * 60 + b.startMin;
    const end = b.endHour * 60 + b.endMin;
    if (mins >= start && mins < end) return v;
  }
  return null;
}

const VENSTER_META: Record<
  PartnerVenster,
  { title: string; hours: string; short: string }
> = {
  ochtend: { title: "Ochtend", hours: "09:00–12:00", short: "Ochtend" },
  middag: { title: "Middag", hours: "13:00–17:00", short: "Middag" },
};

function SlotCell({
  venster,
  blocked,
  items,
  busy,
  compact,
  onToggle,
}: {
  venster: PartnerVenster;
  blocked: boolean;
  items: BusyItem[];
  busy: boolean;
  compact?: boolean;
  onToggle: () => void;
}) {
  const meta = VENSTER_META[venster];
  const hasWork = items.length > 0 && !blocked;

  return (
    <button
      type="button"
      disabled={busy}
      onClick={onToggle}
      title={
        blocked
          ? `${meta.title} dicht — klik om open te zetten`
          : hasWork
            ? `${meta.title} heeft planning — klik om toch te blokkeren`
            : `${meta.title} open — klik om te blokkeren`
      }
      className={[
        "flex w-full flex-col justify-center border text-left transition",
        compact ? "min-h-[2.75rem] gap-0.5 px-1.5 py-1" : "min-h-[4.5rem] gap-1 px-2 py-2",
        blocked
          ? "border-[#FECACA] bg-[#FEE2E2] text-[#991B1B] hover:bg-[#FECACA]"
          : hasWork
            ? "border-[#A7F3D0] bg-[#ECFDF5] text-[#065F46] hover:bg-[#D1FAE5]"
            : "border-line bg-white text-ink hover:border-[#0a4727]/35 hover:bg-[#F3F5F4]",
        busy ? "opacity-60" : "",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-1">
        <span
          className={[
            "font-bold uppercase tracking-wide",
            compact ? "text-[9px]" : "text-[10px]",
          ].join(" ")}
        >
          {meta.short}
        </span>
        <span
          className={[
            "font-bold uppercase tracking-wide",
            compact ? "text-[9px]" : "text-[10px]",
            blocked
              ? "text-[#991B1B]"
              : hasWork
                ? "text-[#047857]"
                : "text-green-dark",
          ].join(" ")}
        >
          {blocked ? "Dicht" : hasWork ? "Bezet" : "Open"}
        </span>
      </div>
      {hasWork ? (
        <ul className="space-y-0.5">
          {items.slice(0, compact ? 1 : 2).map((item) => (
            <li
              key={item.id}
              className={[
                "truncate font-medium leading-tight",
                compact ? "text-[10px]" : "text-[11px]",
              ].join(" ")}
            >
              {formatTimeNl(item.start_at)}{" "}
              {item.kind === "installatie" ? "Inst." : "Schouw"}
            </li>
          ))}
          {items.length > (compact ? 1 : 2) ? (
            <li className="text-[10px] text-muted">
              +{items.length - (compact ? 1 : 2)}
            </li>
          ) : null}
        </ul>
      ) : (
        <span
          className={[
            "leading-tight",
            compact ? "text-[10px] text-muted" : "text-[11px] text-muted",
          ].join(" ")}
        >
          {blocked ? "Niet beschikbaar" : meta.hours}
        </span>
      )}
    </button>
  );
}

export function PartnerAgendaPanel({
  initialPartnerId,
  projects = [],
  mode = "crm",
  portalToken,
  partnerNaam,
}: {
  initialPartnerId?: string | null;
  projects?: Project[];
  mode?: "crm" | "portal";
  portalToken?: string;
  partnerNaam?: string;
}) {
  const isPortal = mode === "portal";
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [partnerId, setPartnerId] = useState(initialPartnerId || "");
  const [teamgenoten, setTeamgenoten] = useState<
    InstallatiePartnerTeamgenoot[]
  >([]);
  const [teamgenootId, setTeamgenootId] = useState<string>("");
  const [anchor, setAnchor] = useState(() => new Date());
  const [view, setView] = useState<ViewMode>("maand");
  const [afblokkingen, setAfblokkingen] = useState<Set<string>>(new Set());
  const [blockBusy, setBlockBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isPortal);
  const [perMonteur, setPerMonteur] = useState(true);
  const [migrationRequired, setMigrationRequired] = useState(false);

  const days = useMemo(
    () => (view === "maand" ? monthDaysFrom(anchor) : weekDaysFrom(anchor)),
    [anchor, view]
  );
  const van = days[0]?.key || "";
  const tot = days[days.length - 1]?.key || "";
  const todayKey = useMemo(
    () => formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd"),
    []
  );

  const selectedTg = teamgenoten.find((t) => t.id === teamgenootId) || null;
  const effectiveTgId =
    perMonteur && teamgenoten.length > 0 ? teamgenootId || null : null;

  useEffect(() => {
    if (initialPartnerId) setPartnerId(initialPartnerId);
  }, [initialPartnerId]);

  useEffect(() => {
    if (isPortal) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/installatie-partners?include_inactive=1");
        const data = await res.json();
        if (cancelled) return;
        const list = (data.partners || []) as InstallatiePartner[];
        setPartners(list);
        if (!partnerId && list.length) {
          setPartnerId(list.find((p) => p.actief)?.id || list[0].id);
        }
      } catch {
        if (!cancelled) setError("Partners laden mislukt");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- alleen mount
  }, [isPortal]);

  const loadTeamgenoten = useCallback(async () => {
    if (isPortal && portalToken) {
      try {
        const res = await fetch(
          `/api/installatie/${encodeURIComponent(portalToken)}/teamgenoten`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Teamgenoten laden mislukt");
        const list = (
          (data.teamgenoten || []) as InstallatiePartnerTeamgenoot[]
        ).filter((t) => t.actief !== false);
        setTeamgenoten(list);
        setTeamgenootId((cur) =>
          cur && list.some((t) => t.id === cur) ? cur : list[0]?.id || ""
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Teamgenoten laden mislukt");
        setTeamgenoten([]);
        setTeamgenootId("");
      }
      return;
    }
    if (!partnerId) {
      setTeamgenoten([]);
      setTeamgenootId("");
      return;
    }
    try {
      const res = await fetch(
        `/api/installatie-partners/teamgenoten?partner_id=${encodeURIComponent(partnerId)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Teamgenoten laden mislukt");
      const list = (data.teamgenoten || []) as InstallatiePartnerTeamgenoot[];
      setTeamgenoten(list);
      setTeamgenootId((cur) =>
        cur && list.some((t) => t.id === cur) ? cur : list[0]?.id || ""
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Teamgenoten laden mislukt");
      setTeamgenoten([]);
      setTeamgenootId("");
    }
  }, [isPortal, portalToken, partnerId]);

  useEffect(() => {
    void loadTeamgenoten();
  }, [loadTeamgenoten]);

  const loadAfblokkingen = useCallback(async () => {
    if (!partnerId || !van || !tot) return;
    if (teamgenoten.length > 0 && !teamgenootId) return;
    try {
      const tgQs =
        teamgenoten.length > 0 && teamgenootId
          ? `&teamgenoot_id=${encodeURIComponent(teamgenootId)}`
          : "";
      const url =
        isPortal && portalToken
          ? `/api/installatie/${encodeURIComponent(portalToken)}/afblokkingen?van=${van}&tot=${tot}${tgQs}`
          : `/api/installatie-partners/afblokkingen?partner_id=${encodeURIComponent(partnerId)}&van=${van}&tot=${tot}${tgQs}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Afblokkingen laden mislukt");

      setPerMonteur(data.per_monteur !== false);
      setMigrationRequired(Boolean(data.migration_required));

      const next = new Set<string>();
      const tgForKey =
        data.per_monteur === false
          ? null
          : teamgenoten.length > 0
            ? teamgenootId
            : null;
      for (const item of data.items || []) {
        next.add(
          partnerAfblokKey(
            item.partner_id || partnerId,
            item.dag,
            item.venster as PartnerVenster,
            item.teamgenoot_id ?? tgForKey
          )
        );
      }
      setAfblokkingen(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afblokkingen laden mislukt");
    }
  }, [
    partnerId,
    van,
    tot,
    isPortal,
    portalToken,
    teamgenootId,
    teamgenoten.length,
  ]);

  useEffect(() => {
    void loadAfblokkingen();
  }, [loadAfblokkingen]);

  const busyByDayVenster = useMemo(() => {
    const map = new Map<string, BusyItem[]>();
    if (!partnerId) return map;
    for (const p of projects) {
      if (p.installatie_partner_id !== partnerId) continue;
      const leadNaam =
        (p as Project & { leads?: { naam?: string } | null }).leads?.naam ||
        p.titel ||
        "Project";

      if (p.schouw_at) {
        const start = new Date(p.schouw_at);
        if (!Number.isNaN(start.getTime())) {
          const local = toZonedTime(start, AMSTERDAM_TZ);
          const venster = vensterForLocalHour(
            local.getHours(),
            local.getMinutes()
          );
          if (venster) {
            const key = `${formatInTimeZone(start, AMSTERDAM_TZ, "yyyy-MM-dd")}:${venster}`;
            const list = map.get(key) || [];
            list.push({
              id: `${p.id}-schouw`,
              kind: "schouw",
              start_at: start.toISOString(),
              end_at: new Date(
                start.getTime() + SCHOUW_DUUR_MINUTEN * 60_000
              ).toISOString(),
              label: `Schouw · ${leadNaam}`,
              project_nummer: p.project_nummer,
            });
            map.set(key, list);
          }
        }
      }
      if (p.installatie_at) {
        const start = new Date(p.installatie_at);
        if (!Number.isNaN(start.getTime())) {
          const local = toZonedTime(start, AMSTERDAM_TZ);
          const venster = vensterForLocalHour(
            local.getHours(),
            local.getMinutes()
          );
          if (venster) {
            const key = `${formatInTimeZone(start, AMSTERDAM_TZ, "yyyy-MM-dd")}:${venster}`;
            const list = map.get(key) || [];
            list.push({
              id: `${p.id}-installatie`,
              kind: "installatie",
              start_at: start.toISOString(),
              end_at: new Date(
                start.getTime() +
                  installatieDuurVoorVenster(venster) * 60_000
              ).toISOString(),
              label: `Installatie · ${leadNaam}`,
              project_nummer: p.project_nummer,
            });
            map.set(key, list);
          }
        }
      }
    }
    return map;
  }, [projects, partnerId]);

  function isBlocked(dayKey: string, venster: PartnerVenster): boolean {
    if (!partnerId) return false;
    if (perMonteur && teamgenoten.length > 0 && !teamgenootId) return false;
    return afblokkingen.has(
      partnerAfblokKey(partnerId, dayKey, venster, effectiveTgId)
    );
  }

  async function toggleAfblok(dayKey: string, venster: PartnerVenster) {
    if (!partnerId || blockBusy) return;
    if (perMonteur && teamgenoten.length > 0 && !teamgenootId) {
      setError("Kies eerst een monteur.");
      return;
    }
    const key = partnerAfblokKey(partnerId, dayKey, venster, effectiveTgId);
    const currentlyBlocked = afblokkingen.has(key);
    const nextBlocked = !currentlyBlocked;
    setBlockBusy(true);
    setError(null);
    setOkMsg(null);
    setAfblokkingen((prev) => {
      const copy = new Set(prev);
      if (nextBlocked) copy.add(key);
      else copy.delete(key);
      return copy;
    });
    try {
      const url =
        isPortal && portalToken
          ? `/api/installatie/${encodeURIComponent(portalToken)}/afblokkingen`
          : "/api/installatie-partners/afblokkingen";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isPortal
            ? {
                dag: dayKey,
                venster,
                geblokkeerd: nextBlocked,
                teamgenoot_id: effectiveTgId,
              }
            : {
                partner_id: partnerId,
                dag: dayKey,
                venster,
                geblokkeerd: nextBlocked,
                teamgenoot_id: effectiveTgId,
              }
        ),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Blokkeren mislukt");

      if (typeof data.per_monteur === "boolean") {
        setPerMonteur(data.per_monteur);
      }
      if (data.migration_required) setMigrationRequired(true);

      const dagLabel = format(
        fromZonedTime(`${dayKey}T12:00:00`, AMSTERDAM_TZ),
        "EEE d MMM",
        { locale: nl }
      );
      setOkMsg(
        nextBlocked
          ? `${VENSTER_META[venster].title} ${dagLabel} dicht`
          : `${VENSTER_META[venster].title} ${dagLabel} weer open`
      );
    } catch (e) {
      setAfblokkingen((prev) => {
        const copy = new Set(prev);
        if (currentlyBlocked) copy.add(key);
        else copy.delete(key);
        return copy;
      });
      setError(e instanceof Error ? e.message : "Blokkeren mislukt");
    } finally {
      setBlockBusy(false);
    }
  }

  const partner = partners.find((p) => p.id === partnerId);
  const headingLabel = useMemo(() => {
    if (view === "week") {
      const a = days[0];
      const b = days[days.length - 1];
      if (!a || !b) return "";
      return `${a.dayNum}–${b.dayNum} ${format(b.date, "MMM", { locale: nl })}`;
    }
    return formatInTimeZone(anchor, AMSTERDAM_TZ, "MMMM yyyy", { locale: nl });
  }, [anchor, view, days]);

  const needsTg = perMonteur && teamgenoten.length > 0 && !teamgenootId;

  function navigate(delta: number) {
    if (view === "maand") {
      setAnchor((d) => {
        const local = toZonedTime(d, AMSTERDAM_TZ);
        const mid = addMonths(
          new Date(local.getFullYear(), local.getMonth(), 15, 12, 0, 0),
          delta
        );
        return fromZonedTime(mid, AMSTERDAM_TZ);
      });
    } else {
      setAnchor((d) => addWeeks(d, delta));
    }
  }

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <div className="border border-line bg-white px-3 py-3 sm:px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-lg font-semibold text-ink">
              Beschikbaarheid
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Tik op ochtend of middag om open ↔ dicht te zetten.
              {partnerNaam ? ` · ${partnerNaam}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isPortal ? (
              <select
                value={partnerId}
                onChange={(e) => setPartnerId(e.target.value)}
                className="border border-line bg-white px-2 py-1.5 text-xs font-semibold text-ink outline-none focus:border-green"
                aria-label="Partner"
              >
                <option value="">Partner…</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.naam}
                    {!p.actief ? " (uit)" : ""}
                  </option>
                ))}
              </select>
            ) : null}

            <div className="flex border border-line">
              {(
                [
                  { id: "maand" as const, label: "Maand" },
                  { id: "week" as const, label: "Week" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setView(opt.id)}
                  className={[
                    "px-3 py-1.5 text-xs font-semibold",
                    view === opt.id
                      ? "bg-[#0a4727] text-white"
                      : "bg-white text-ink hover:bg-wash",
                  ].join(" ")}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex items-center border border-line">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                aria-label="Vorige"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => setAnchor(new Date())}
                className="min-w-[7.5rem] border-x border-line px-2.5 py-1.5 text-xs font-semibold capitalize text-ink hover:bg-wash"
              >
                {headingLabel || "Vandaag"}
              </button>
              <button
                type="button"
                onClick={() => navigate(1)}
                className="px-2.5 py-1.5 text-xs font-semibold text-ink hover:bg-wash"
                aria-label="Volgende"
              >
                →
              </button>
            </div>
          </div>
        </div>

        {teamgenoten.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {teamgenoten.map((t) => {
              const active = t.id === teamgenootId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTeamgenootId(t.id)}
                  className={[
                    "border px-3 py-2 text-sm font-semibold transition",
                    active
                      ? "border-[#0a4727] bg-[#0a4727] text-white"
                      : "border-line bg-white text-ink hover:border-[#0a4727]/40 hover:bg-wash",
                  ].join(" ")}
                >
                  {t.naam}
                </button>
              );
            })}
          </div>
        ) : partnerId ? (
          <p className="mt-3 border border-[#C45A12]/25 bg-[#FFF0E6] px-3 py-2 text-[11px] text-[#C45A12]">
            Nog geen monteurs. Voeg ze toe bij Teamgenoten — dan kun je per
            persoon afblokken.
          </p>
        ) : null}

        {selectedTg ? (
          <p className="mt-2 text-xs text-muted">
            Agenda van{" "}
            <span className="font-semibold text-ink">{selectedTg.naam}</span>
            {" — "}
            rood = dicht, groen = gepland werk, wit = open.
          </p>
        ) : null}
      </div>

      {migrationRequired ? (
        <p className="border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
          Afblokken werkt nu voor het hele team. Voor apart per monteur: voer in
          Supabase{" "}
          <code className="font-mono text-[11px]">
            migrate-partner-afblokkingen-teamgenoot.sql
          </code>{" "}
          uit.
        </p>
      ) : null}

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}
      {okMsg ? (
        <p className="border border-green/30 bg-green-soft px-3 py-1.5 text-[11px] text-green-dark">
          {okMsg}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : !partnerId ? (
        <p className="text-sm text-muted">Kies een partner.</p>
      ) : needsTg ? (
        <p className="text-sm text-muted">Kies een monteur hierboven.</p>
      ) : view === "week" ? (
        <div className="overflow-x-auto border border-line bg-white">
          <div className="min-w-[44rem]">
            <div className="grid grid-cols-6 border-b border-line bg-[#0a4727] text-white">
              {days.map((d) => (
                <div
                  key={d.key}
                  className={[
                    "border-r border-white/15 px-2 py-2.5 text-center last:border-r-0",
                    d.key === todayKey ? "bg-white/10" : "",
                  ].join(" ")}
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                    {d.short}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">{d.dayNum}</p>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-6">
              {days.map((d) => (
                <div
                  key={d.key}
                  className={[
                    "space-y-1.5 border-r border-line p-1.5 last:border-r-0",
                    d.key === todayKey ? "bg-[#F0FDFA]/50" : "bg-white",
                    d.weekend ? "bg-[#F8FAFC]" : "",
                  ].join(" ")}
                >
                  {PARTNER_VENSTERS.map((venster) => (
                    <SlotCell
                      key={venster}
                      venster={venster}
                      blocked={isBlocked(d.key, venster)}
                      items={
                        busyByDayVenster.get(`${d.key}:${venster}`) || []
                      }
                      busy={blockBusy}
                      onToggle={() => void toggleAfblok(d.key, venster)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto border border-line bg-white">
          <div className="min-w-[52rem]">
            <div className="grid grid-cols-7 border-b border-line bg-[#FAFBFA]">
              {["ma", "di", "wo", "do", "vr", "za", "zo"].map((d) => (
                <div
                  key={d}
                  className="border-r border-line px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wide text-muted last:border-r-0"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                if (!d.inMonth) {
                  return (
                    <div
                      key={d.key}
                      className="min-h-[7rem] border-b border-r border-line bg-[#F4F6F5] last:border-r-0"
                      aria-hidden
                    />
                  );
                }
                return (
                  <div
                    key={d.key}
                    className={[
                      "min-h-[7rem] space-y-1 border-b border-r border-line p-1.5 last:border-r-0",
                      d.key === todayKey ? "bg-[#F0FDFA]" : "bg-white",
                    ].join(" ")}
                  >
                    <p
                      className={[
                        "mb-0.5 inline-flex h-6 min-w-6 items-center justify-center font-display text-sm font-semibold tabular-nums",
                        d.key === todayKey
                          ? "bg-[#0a4727] px-1.5 text-white"
                          : "text-ink",
                      ].join(" ")}
                    >
                      {d.dayNum}
                    </p>
                    {PARTNER_VENSTERS.map((venster) => (
                      <SlotCell
                        key={venster}
                        venster={venster}
                        blocked={isBlocked(d.key, venster)}
                        items={
                          busyByDayVenster.get(`${d.key}:${venster}`) || []
                        }
                        busy={blockBusy}
                        compact
                        onToggle={() => void toggleAfblok(d.key, venster)}
                      />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 px-0.5 text-[10px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 border border-line bg-white" />
          Open — klik om te blokkeren
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 bg-[#FEE2E2]" />
          Dicht — klik om open te zetten
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 bg-[#ECFDF5]" />
          Bezet (schouw/installatie)
        </span>
      </div>

      {partner?.start_adres ? (
        <p className="text-[10px] text-muted">
          Startadres: {partner.start_adres}
          {typeof partner.reistijd_buffer_min === "number"
            ? ` · buffer ${partner.reistijd_buffer_min} min`
            : ""}
        </p>
      ) : partnerId && !isPortal ? (
        <p className="text-[10px] text-muted">
          Geen startadres — stel in bij Team → Monteurs voor reistijd.
        </p>
      ) : null}
    </div>
  );
}
