"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addDays,
  addWeeks,
  format,
  startOfWeek,
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { InstallatiePartner, Project } from "@/types/database";
import { AMSTERDAM_TZ, formatTimeNl } from "@/lib/format";
import {
  INSTALLATIE_DUUR_MINUTEN,
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

function dayKeyAmsterdam(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function weekDaysFrom(anchor: Date) {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 6 }, (_, i) => {
    const date = addDays(monday, i);
    return {
      date,
      key: format(date, "yyyy-MM-dd"),
      label: format(date, "EEE d MMM", { locale: nl }),
    };
  });
}

function vensterForLocalHour(hour: number, minute: number): PartnerVenster | null {
  const mins = hour * 60 + minute;
  for (const v of PARTNER_VENSTERS) {
    const b = PARTNER_VENSTER_BOUNDS[v];
    const start = b.startHour * 60 + b.startMin;
    const end = b.endHour * 60 + b.endMin;
    if (mins >= start && mins < end) return v;
  }
  return null;
}

export function PartnerAgendaPanel({
  initialPartnerId,
  projects = [],
}: {
  initialPartnerId?: string | null;
  projects?: Project[];
}) {
  const [partners, setPartners] = useState<InstallatiePartner[]>([]);
  const [partnerId, setPartnerId] = useState(initialPartnerId || "");
  const [weekAnchor, setWeekAnchor] = useState(() => new Date());
  const [afblokMode, setAfblokMode] = useState(false);
  const [afblokkingen, setAfblokkingen] = useState<Set<string>>(new Set());
  const [blockBusy, setBlockBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const days = useMemo(() => weekDaysFrom(weekAnchor), [weekAnchor]);
  const van = days[0]?.key || "";
  const tot = days[days.length - 1]?.key || "";

  useEffect(() => {
    if (initialPartnerId) setPartnerId(initialPartnerId);
  }, [initialPartnerId]);

  useEffect(() => {
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
  }, []);

  const loadAfblokkingen = useCallback(async () => {
    if (!partnerId || !van || !tot) return;
    try {
      const res = await fetch(
        `/api/installatie-partners/afblokkingen?partner_id=${encodeURIComponent(partnerId)}&van=${van}&tot=${tot}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Afblokkingen laden mislukt");
      const next = new Set<string>();
      for (const item of data.items || []) {
        next.add(
          partnerAfblokKey(
            item.partner_id,
            item.dag,
            item.venster as PartnerVenster
          )
        );
      }
      setAfblokkingen(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Afblokkingen laden mislukt");
    }
  }, [partnerId, van, tot]);

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
            const key = `${dayKeyAmsterdam(start)}:${venster}`;
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
            const key = `${dayKeyAmsterdam(start)}:${venster}`;
            const list = map.get(key) || [];
            list.push({
              id: `${p.id}-installatie`,
              kind: "installatie",
              start_at: start.toISOString(),
              end_at: new Date(
                start.getTime() + INSTALLATIE_DUUR_MINUTEN * 60_000
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
    return afblokkingen.has(partnerAfblokKey(partnerId, dayKey, venster));
  }

  async function toggleAfblok(dayKey: string, venster: PartnerVenster) {
    if (!partnerId || blockBusy) return;
    const key = partnerAfblokKey(partnerId, dayKey, venster);
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
      const res = await fetch("/api/installatie-partners/afblokkingen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partner_id: partnerId,
          dag: dayKey,
          venster,
          geblokkeerd: nextBlocked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Blokkeren mislukt");
      setOkMsg(
        data.message ||
          (nextBlocked
            ? `${dayKey} ${venster} geblokkeerd`
            : `${dayKey} ${venster} weer open`)
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

  return (
    <div className="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Partner-agenda
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Ochtend 09–12 (schouw) · Middag 13–17 (installatie 4u of schouws)
          </p>
          <a
            href="/?tab=agenda"
            className="mt-1 inline-block text-xs font-medium text-green-dark hover:underline"
          >
            ← Terug naar adviseur-agenda
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">
            Partner
            <select
              value={partnerId}
              onChange={(e) => setPartnerId(e.target.value)}
              className="ml-2 border border-line bg-white px-2 py-1.5 text-sm text-ink outline-none focus:border-green"
            >
              <option value="">Kies…</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.naam}
                  {!p.actief ? " (uit)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setWeekAnchor((d) => addWeeks(d, -1))}
            className="border border-line bg-white px-3 py-1.5 text-sm hover:bg-wash"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setWeekAnchor(new Date())}
            className="border border-line bg-white px-3 py-1.5 text-sm hover:bg-wash"
          >
            Deze week
          </button>
          <button
            type="button"
            onClick={() => setWeekAnchor((d) => addWeeks(d, 1))}
            className="border border-line bg-white px-3 py-1.5 text-sm hover:bg-wash"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => setAfblokMode((m) => !m)}
            className={[
              "px-3 py-1.5 text-sm font-semibold",
              afblokMode
                ? "bg-orange text-white"
                : "border border-line bg-white text-ink hover:bg-wash",
            ].join(" ")}
          >
            {afblokMode ? "Klaar met afblokken" : "Afblokken"}
          </button>
        </div>
      </div>

      {(error || okMsg || afblokMode) && (
        <div className="space-y-2">
          {afblokMode && (
            <p className="border border-orange/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
              Klik op een venster om het te blokkeren of weer open te zetten.
            </p>
          )}
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

      {loading ? (
        <p className="text-sm text-muted">Laden…</p>
      ) : !partnerId ? (
        <p className="text-sm text-muted">Kies een partner.</p>
      ) : (
        <div className="overflow-x-auto border border-line">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="bg-wash">
                <th className="border-b border-r border-line px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  Venster
                </th>
                {days.map((d) => (
                  <th
                    key={d.key}
                    className="border-b border-r border-line px-2 py-2 text-center text-xs font-semibold text-ink last:border-r-0"
                  >
                    {d.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PARTNER_VENSTERS.map((venster) => {
                const bounds = PARTNER_VENSTER_BOUNDS[venster];
                return (
                  <tr key={venster}>
                    <td className="border-b border-r border-line bg-wash/50 px-3 py-3 align-top">
                      <p className="font-semibold capitalize text-ink">
                        {venster}
                      </p>
                      <p className="text-[11px] text-muted">{bounds.label}</p>
                    </td>
                    {days.map((d) => {
                      const blocked = isBlocked(d.key, venster);
                      const items =
                        busyByDayVenster.get(`${d.key}:${venster}`) || [];
                      return (
                        <td
                          key={d.key}
                          className={[
                            "border-b border-r border-line p-1.5 align-top last:border-r-0",
                            blocked
                              ? "bg-[#FEE2E2]"
                              : afblokMode
                                ? "cursor-pointer hover:bg-orange/10"
                                : "bg-white",
                          ].join(" ")}
                          onClick={() => {
                            if (afblokMode) void toggleAfblok(d.key, venster);
                          }}
                        >
                          {blocked ? (
                            <p className="px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-[#B91C1C]">
                              Afgeblokt
                            </p>
                          ) : items.length === 0 ? (
                            <p className="px-1 py-2 text-center text-[11px] text-muted">
                              {afblokMode ? "Blokkeer" : "Vrij"}
                            </p>
                          ) : (
                            <ul className="space-y-1">
                              {items.map((item) => (
                                <li
                                  key={item.id}
                                  className={[
                                    "px-1.5 py-1 text-[11px] leading-snug",
                                    item.kind === "installatie"
                                      ? "bg-green-soft text-green-dark"
                                      : "bg-wash text-ink",
                                  ].join(" ")}
                                >
                                  <span className="font-semibold">
                                    {formatTimeNl(item.start_at)}
                                  </span>{" "}
                                  {item.label}
                                  {item.project_nummer ? (
                                    <span className="text-muted">
                                      {" "}
                                      · {item.project_nummer}
                                    </span>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {partner?.start_adres ? (
        <p className="text-xs text-muted">
          Startadres: {partner.start_adres}
          {typeof partner.reistijd_buffer_min === "number"
            ? ` · buffer ${partner.reistijd_buffer_min} min`
            : ""}
        </p>
      ) : partnerId ? (
        <p className="text-xs text-muted">
          Geen startadres — stel in bij Team → Monteurs voor reistijd.
        </p>
      ) : null}
    </div>
  );
}
