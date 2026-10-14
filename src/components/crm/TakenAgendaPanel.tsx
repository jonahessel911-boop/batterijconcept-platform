"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { addDays, startOfWeek } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import type { Adviseur } from "@/types/database";
import { AMSTERDAM_TZ, formatTimeNl } from "@/lib/format";
import { normalizeRol } from "@/lib/rollen";

type AgendaItem = {
  id: string;
  titel: string;
  inhoud: string | null;
  soort: "taak" | "afspraak";
  start_at: string;
  end_at: string | null;
  status: "todo" | "done";
  adviseur_id: string;
};

type ProjectTaakRow = {
  id: string;
  titel: string;
  status: string;
  due_at: string | null;
  afdeling: string | null;
  project_id: string;
  projecten?: {
    project_nummer?: string | null;
    titel?: string | null;
    leads?:
      | { naam?: string | null; plaats?: string | null }
      | { naam?: string | null; plaats?: string | null }[]
      | null;
  } | null;
};

type DayCol = { key: string; label: string; sub: string; weekend: boolean };

type Chip =
  | {
      kind: "persoonlijk";
      id: string;
      dayKey: string;
      titel: string;
      timeLabel: string;
      detail: string | null;
      soort: "taak" | "afspraak";
      overdue: boolean;
    }
  | {
      kind: "project";
      id: string;
      dayKey: string;
      titel: string;
      timeLabel: string;
      detail: string | null;
      projectId: string;
      overdue: boolean;
    };

function weekDaysFrom(anchor: Date): DayCol[] {
  const local = toZonedTime(anchor, AMSTERDAM_TZ);
  const monday = startOfWeek(local, { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const noon = fromZonedTime(
      new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0),
      AMSTERDAM_TZ
    );
    const key = formatInTimeZone(noon, AMSTERDAM_TZ, "yyyy-MM-dd");
    const dow = date.getDay();
    return {
      key,
      label: formatInTimeZone(noon, AMSTERDAM_TZ, "EEE", { locale: nl }),
      sub: formatInTimeZone(noon, AMSTERDAM_TZ, "d MMM", { locale: nl }),
      weekend: dow === 0 || dow === 6,
    };
  });
}

function dayKeyOf(iso: string): string {
  return formatInTimeZone(iso, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultDatetimeForDay(dayKey: string, hour = 9): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  return toDatetimeLocalValue(new Date(y, m - 1, d, hour, 0, 0, 0));
}

function plusOneHour(local: string): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return local;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5])
  );
  d.setHours(d.getHours() + 1);
  return toDatetimeLocalValue(d);
}

function leadNaam(t: ProjectTaakRow): string | null {
  const join = t.projecten?.leads;
  const L = Array.isArray(join) ? join[0] : join;
  return L?.naam?.trim() || null;
}

function isBoMedewerker(a: Adviseur): boolean {
  if (a.actief === false) return false;
  const rol = normalizeRol(a.rol);
  return rol === "backoffice" || rol === "admin";
}

export function TakenAgendaPanel({
  adviseurs,
  sessionAdviseurId,
  sessionRol,
}: {
  adviseurs: Adviseur[];
  sessionAdviseurId?: string | null;
  sessionRol?: string | null;
}) {
  const medewerkers = useMemo(
    () =>
      adviseurs
        .filter(isBoMedewerker)
        .sort((a, b) => a.naam.localeCompare(b.naam, "nl")),
    [adviseurs]
  );

  const isAdmin = normalizeRol(sessionRol) === "admin";
  const defaultId =
    (sessionAdviseurId &&
      medewerkers.some((m) => m.id === sessionAdviseurId) &&
      sessionAdviseurId) ||
    medewerkers[0]?.id ||
    "";

  const [medewerkerId, setMedewerkerId] = useState(defaultId);
  const [anchor, setAnchor] = useState(() => new Date());
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [projectTaken, setProjectTaken] = useState<ProjectTaakRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [formDay, setFormDay] = useState<string | null>(null);
  const [titel, setTitel] = useState("");
  const [inhoud, setInhoud] = useState("");
  const [soort, setSoort] = useState<"taak" | "afspraak">("afspraak");
  const [startLocal, setStartLocal] = useState(() =>
    defaultDatetimeForDay(
      formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd"),
      10
    )
  );
  const [endLocal, setEndLocal] = useState(() =>
    plusOneHour(
      defaultDatetimeForDay(
        formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd"),
        10
      )
    )
  );

  useEffect(() => {
    if (!medewerkerId && defaultId) setMedewerkerId(defaultId);
  }, [defaultId, medewerkerId]);

  const days = useMemo(() => weekDaysFrom(anchor), [anchor]);
  const fromIso = useMemo(() => {
    if (!days[0]) return null;
    return fromZonedTime(`${days[0].key}T00:00:00`, AMSTERDAM_TZ).toISOString();
  }, [days]);
  const toIso = useMemo(() => {
    const last = days[6];
    if (!last) return null;
    return fromZonedTime(`${last.key}T23:59:59`, AMSTERDAM_TZ).toISOString();
  }, [days]);

  const weekLabel = useMemo(() => {
    if (!days[0] || !days[6]) return "";
    return `${days[0].sub} – ${days[6].sub}`;
  }, [days]);

  const load = useCallback(async () => {
    if (!medewerkerId || !fromIso || !toIso) {
      setItems([]);
      setProjectTaken([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        adviseur_id: medewerkerId,
        from: fromIso,
        to: toIso,
        open: "1",
      });
      const res = await fetch(`/api/bo-agenda?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Laden mislukt"
        );
      }
      if ((data as { error?: string }).error && !(data as { items?: unknown[] }).items) {
        setError((data as { error: string }).error);
      }
      setItems(((data as { items?: AgendaItem[] }).items || []) as AgendaItem[]);
      setProjectTaken(
        ((data as { project_taken?: ProjectTaakRow[] }).project_taken ||
          []) as ProjectTaakRow[]
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
      setItems([]);
      setProjectTaken([]);
    } finally {
      setLoading(false);
    }
  }, [medewerkerId, fromIso, toIso]);

  useEffect(() => {
    void load();
  }, [load]);

  const chipsByDay = useMemo(() => {
    const map = new Map<string, Chip[]>();
    for (const d of days) map.set(d.key, []);
    const now = Date.now();

    for (const it of items) {
      const key = dayKeyOf(it.start_at);
      const list = map.get(key);
      if (!list) continue;
      const end = it.end_at || it.start_at;
      list.push({
        kind: "persoonlijk",
        id: it.id,
        dayKey: key,
        titel: it.titel,
        timeLabel:
          it.soort === "afspraak" && it.end_at
            ? `${formatTimeNl(it.start_at)}–${formatTimeNl(it.end_at)}`
            : formatTimeNl(it.start_at),
        detail: it.inhoud,
        soort: it.soort,
        overdue: new Date(end).getTime() < now,
      });
    }

    for (const t of projectTaken) {
      if (!t.due_at) continue;
      const key = dayKeyOf(t.due_at);
      const list = map.get(key);
      if (!list) continue;
      const klant = leadNaam(t);
      const nr = t.projecten?.project_nummer;
      list.push({
        kind: "project",
        id: t.id,
        dayKey: key,
        titel: t.titel,
        timeLabel: formatTimeNl(t.due_at),
        detail: [nr, klant].filter(Boolean).join(" · ") || null,
        projectId: t.project_id,
        overdue: new Date(t.due_at).getTime() < now,
      });
    }

    for (const [, list] of map) {
      list.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
    }
    return map;
  }, [days, items, projectTaken]);

  function openCreate(dayKey?: string) {
    const key =
      dayKey ||
      formatInTimeZone(new Date(), AMSTERDAM_TZ, "yyyy-MM-dd");
    const start = defaultDatetimeForDay(key, 10);
    setFormDay(key);
    setTitel("");
    setInhoud("");
    setSoort("afspraak");
    setStartLocal(start);
    setEndLocal(plusOneHour(start));
    setShowForm(true);
  }

  async function createItem(e: React.FormEvent) {
    e.preventDefault();
    if (!titel.trim() || !medewerkerId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bo-agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titel: titel.trim(),
          inhoud: inhoud.trim() || null,
          soort,
          start_at: startLocal,
          end_at: soort === "afspraak" ? endLocal : null,
          adviseur_id: medewerkerId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Aanmaken mislukt"
        );
      }
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aanmaken mislukt");
    } finally {
      setBusy(false);
    }
  }

  async function markDone(id: string) {
    try {
      await fetch(`/api/bo-agenda/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      await load();
    } catch {
      /* ignore */
    }
  }

  async function removeItem(id: string) {
    if (!window.confirm("Agenda-item verwijderen?")) return;
    try {
      await fetch(`/api/bo-agenda/${id}`, { method: "DELETE" });
      await load();
    } catch {
      /* ignore */
    }
  }

  const medewerkerNaam =
    medewerkers.find((m) => m.id === medewerkerId)?.naam || "—";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Medewerker
          </p>
          {isAdmin ? (
            <select
              value={medewerkerId}
              onChange={(e) => setMedewerkerId(e.target.value)}
              className="mt-0.5 border border-line bg-white px-2 py-1.5 text-sm font-semibold text-ink outline-none focus:border-green"
            >
              {medewerkers.length === 0 ? (
                <option value="">Geen backoffice-medewerkers</option>
              ) : (
                medewerkers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.naam}
                    {normalizeRol(m.rol) === "admin" ? " (admin)" : ""}
                  </option>
                ))
              )}
            </select>
          ) : (
            <p className="mt-0.5 text-sm font-semibold text-ink">
              {medewerkerNaam}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setAnchor((a) => addDays(a, -7))}
            className="border border-line px-2 py-1 text-xs font-semibold text-ink hover:bg-wash"
          >
            ← Week
          </button>
          <button
            type="button"
            onClick={() => setAnchor(new Date())}
            className="border border-line px-2 py-1 text-xs font-semibold text-ink hover:bg-wash"
          >
            Vandaag
          </button>
          <button
            type="button"
            onClick={() => setAnchor((a) => addDays(a, 7))}
            className="border border-line px-2 py-1 text-xs font-semibold text-ink hover:bg-wash"
          >
            Week →
          </button>
          <span className="px-2 text-xs font-medium text-muted">{weekLabel}</span>
          <button
            type="button"
            onClick={() => openCreate()}
            className="bg-green px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
          >
            + Agenda
          </button>
        </div>
      </div>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <form
          onSubmit={(e) => void createItem(e)}
          className="space-y-2 border border-line bg-wash px-3 py-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Nieuw · {formDay || "—"} · {medewerkerNaam}
            </p>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-xs text-muted hover:text-ink"
            >
              Annuleren
            </button>
          </div>
          <div className="flex gap-2">
            {(["afspraak", "taak"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSoort(s)}
                className={[
                  "border px-2.5 py-1 text-xs font-semibold",
                  soort === s
                    ? "border-green bg-green-soft text-green-dark"
                    : "border-line bg-white text-ink",
                ].join(" ")}
              >
                {s === "afspraak" ? "Agenda-punt" : "Taak"}
              </button>
            ))}
          </div>
          <input
            value={titel}
            onChange={(e) => setTitel(e.target.value)}
            placeholder="Bijv. Overstap Frank Energie · bellen"
            required
            className="w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
          />
          <textarea
            value={inhoud}
            onChange={(e) => setInhoud(e.target.value)}
            placeholder="Notitie (optioneel)"
            rows={2}
            className="w-full border border-line bg-white px-2.5 py-2 text-sm outline-none focus:border-green"
          />
          <div className="flex flex-wrap gap-2">
            <label className="text-xs text-muted">
              Start
              <input
                type="datetime-local"
                value={startLocal}
                onChange={(e) => {
                  setStartLocal(e.target.value);
                  if (soort === "afspraak") {
                    setEndLocal(plusOneHour(e.target.value));
                  }
                }}
                className="mt-0.5 block border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-green"
              />
            </label>
            {soort === "afspraak" ? (
              <label className="text-xs text-muted">
                Eind
                <input
                  type="datetime-local"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                  className="mt-0.5 block border border-line bg-white px-2 py-1.5 text-sm outline-none focus:border-green"
                />
              </label>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={busy || !titel.trim()}
            className="bg-green px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Bezig…" : "Opslaan"}
          </button>
        </form>
      ) : null}

      <div className="overflow-x-auto border border-line">
        <div className="grid min-w-[720px] grid-cols-7 divide-x divide-line">
          {days.map((d) => {
            const chips = chipsByDay.get(d.key) || [];
            return (
              <div
                key={d.key}
                className={[
                  "min-h-[220px] bg-white",
                  d.weekend ? "bg-[#FAFAF8]" : "",
                ].join(" ")}
              >
                <button
                  type="button"
                  onClick={() => openCreate(d.key)}
                  className="flex w-full items-baseline justify-between gap-1 border-b border-line px-2 py-1.5 text-left hover:bg-wash"
                  title="Agenda-punt toevoegen"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {d.label}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    {d.sub.split(" ")[0]}
                  </span>
                </button>
                <div className="space-y-1 p-1.5">
                  {loading ? (
                    <p className="px-1 py-2 text-[10px] text-muted">…</p>
                  ) : chips.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[10px] text-muted/70">
                      —
                    </p>
                  ) : (
                    chips.map((c) => (
                      <div
                        key={`${c.kind}-${c.id}`}
                        className={[
                          "border px-1.5 py-1 text-left",
                          c.kind === "project"
                            ? "border-[#1A4A6E]/25 bg-[#E8F0F6]"
                            : c.soort === "taak"
                              ? "border-[#C9A227]/40 bg-[#FFF8D6]"
                              : "border-[#0D5C32]/25 bg-[#E8F6EC]",
                          c.overdue ? "ring-1 ring-[#C45A12]/40" : "",
                        ].join(" ")}
                      >
                        <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">
                          {c.timeLabel}
                          {c.kind === "project" ? " · taak" : ""}
                        </p>
                        <p className="text-[11px] font-semibold leading-snug text-ink">
                          {c.kind === "project" ? (
                            <a
                              href={`/projecten/${c.projectId}?from=taken-agenda`}
                              className="hover:underline"
                            >
                              {c.titel}
                            </a>
                          ) : (
                            c.titel
                          )}
                        </p>
                        {c.detail ? (
                          <p className="mt-0.5 text-[10px] leading-snug text-muted">
                            {c.detail}
                          </p>
                        ) : null}
                        {c.kind === "persoonlijk" ? (
                          <div className="mt-1 flex gap-1">
                            <button
                              type="button"
                              onClick={() => void markDone(c.id)}
                              className="text-[9px] font-semibold text-green-dark hover:underline"
                            >
                              Klaar
                            </button>
                            <button
                              type="button"
                              onClick={() => void removeItem(c.id)}
                              className="text-[9px] font-semibold text-muted hover:text-[#C62828]"
                            >
                              Wis
                            </button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-[10px] text-muted">
        Groen = eigen agenda · geel = eigen taak · blauw = projecttaak
        (toegewezen). Klik op een dagkop om snel iets in te plannen.
      </p>
    </div>
  );
}
