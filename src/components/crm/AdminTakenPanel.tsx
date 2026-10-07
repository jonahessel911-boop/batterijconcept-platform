"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ, formatDateTimeNl } from "@/lib/format";

type Soort = "taak" | "afspraak";

type AdminTaak = {
  id: string;
  titel: string;
  inhoud: string | null;
  soort?: Soort | null;
  due_at: string;
  end_at?: string | null;
  status: "todo" | "done";
  completed_at: string | null;
  created_at: string;
};

function defaultStartLocal(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd'T'HH:mm");
}

/** +1 uur op een datetime-local string (yyyy-MM-ddTHH:mm), wall-clock. */
function defaultEndLocal(startLocal: string): string {
  const m = startLocal.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
  );
  if (!m) return startLocal;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5])
  );
  d.setHours(d.getHours() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function dayKey(iso: string): string {
  return formatInTimeZone(iso, AMSTERDAM_TZ, "yyyy-MM-dd");
}

function dayLabel(iso: string): string {
  return formatInTimeZone(iso, AMSTERDAM_TZ, "EEEE d MMMM yyyy");
}

function timeRangeLabel(start: string, end?: string | null): string {
  const startT = formatInTimeZone(start, AMSTERDAM_TZ, "HH:mm");
  if (!end) return startT;
  const endT = formatInTimeZone(end, AMSTERDAM_TZ, "HH:mm");
  return `${startT} – ${endT}`;
}

function soortOf(t: AdminTaak): Soort {
  return t.soort === "afspraak" ? "afspraak" : "taak";
}

export function AdminTakenPanel() {
  const [taken, setTaken] = useState<AdminTaak[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const [soort, setSoort] = useState<Soort>("taak");
  const [titel, setTitel] = useState("");
  const [inhoud, setInhoud] = useState("");
  const [dueLocal, setDueLocal] = useState(defaultStartLocal);
  const [endLocal, setEndLocal] = useState(() =>
    defaultEndLocal(defaultStartLocal())
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin-taken?open=${showDone ? "0" : "1"}`
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Laden mislukt"
        );
      }
      if (
        (data as { error?: string }).error &&
        !(data as { taken?: unknown[] }).taken?.length
      ) {
        setError((data as { error: string }).error);
      }
      setTaken(((data as { taken?: AdminTaak[] }).taken || []) as AdminTaak[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [showDone]);

  useEffect(() => {
    void load();
  }, [load]);

  const openTaken = useMemo(
    () => taken.filter((t) => t.status === "todo"),
    [taken]
  );
  const doneTaken = useMemo(
    () => taken.filter((t) => t.status === "done"),
    [taken]
  );
  const list = showDone ? taken : openTaken;

  const overdueIds = useMemo(() => {
    const now = Date.now();
    return new Set(
      openTaken
        .filter((t) => {
          const end = t.end_at || t.due_at;
          return new Date(end).getTime() < now;
        })
        .map((t) => t.id)
    );
  }, [openTaken]);

  const groups = useMemo(() => {
    const map = new Map<string, AdminTaak[]>();
    for (const t of list) {
      const k = dayKey(t.due_at);
      const arr = map.get(k) || [];
      arr.push(t);
      map.set(k, arr);
    }
    return [...map.entries()].map(([key, items]) => ({
      key,
      label: dayLabel(items[0].due_at),
      items,
    }));
  }, [list]);

  function onSoortChange(next: Soort) {
    setSoort(next);
    if (next === "afspraak") {
      setEndLocal(defaultEndLocal(dueLocal));
    }
  }

  function onDueChange(v: string) {
    setDueLocal(v);
    if (soort === "afspraak") {
      setEndLocal(defaultEndLocal(v));
    }
  }

  async function createItem(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin-taken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titel,
          inhoud: inhoud.trim() || null,
          due_at: dueLocal,
          end_at: soort === "afspraak" ? endLocal : null,
          soort,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Aanmaken mislukt"
        );
      }
      setTitel("");
      setInhoud("");
      const nextStart = defaultStartLocal();
      setDueLocal(nextStart);
      setEndLocal(defaultEndLocal(nextStart));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Aanmaken mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function toggleDone(t: AdminTaak) {
    const next = t.status === "done" ? "todo" : "done";
    setTaken((prev) =>
      prev.map((x) =>
        x.id === t.id
          ? {
              ...x,
              status: next,
              completed_at: next === "done" ? new Date().toISOString() : null,
            }
          : x
      )
    );
    try {
      const res = await fetch(`/api/admin-taken/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || "Bijwerken mislukt"
        );
      }
      if (!showDone && next === "done") {
        setTaken((prev) => prev.filter((x) => x.id !== t.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bijwerken mislukt");
      await load();
    }
  }

  async function removeItem(id: string, soortItem: Soort) {
    const label = soortItem === "afspraak" ? "afspraak" : "taak";
    if (!window.confirm(`Deze ${label} verwijderen?`)) return;
    setTaken((prev) => prev.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/admin-taken/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error || "Verwijderen mislukt"
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verwijderen mislukt");
      await load();
    }
  }

  return (
    <div className="space-y-4 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">
            Agenda & taken
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Jouw persoonlijke agenda · taken en afspraken · alleen admin
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="border border-line bg-white px-3 py-2 text-xs font-semibold text-muted hover:bg-wash"
        >
          {showDone
            ? `Alleen open (${openTaken.length})`
            : `Toon afgerond (${doneTaken.length})`}
        </button>
      </div>

      <form
        onSubmit={(e) => void createItem(e)}
        className="space-y-3 border border-line bg-white p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
            Nieuw
          </p>
          <div className="inline-flex border border-line">
            <button
              type="button"
              onClick={() => onSoortChange("taak")}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                soort === "taak"
                  ? "bg-ink text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Taak
            </button>
            <button
              type="button"
              onClick={() => onSoortChange("afspraak")}
              className={[
                "px-3 py-1.5 text-xs font-semibold",
                soort === "afspraak"
                  ? "bg-ink text-white"
                  : "bg-white text-muted hover:bg-wash",
              ].join(" ")}
            >
              Afspraak
            </button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {soort === "afspraak" ? "Waarover / met wie" : "Wat moet er gebeuren"}
            </span>
            <input
              required
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              placeholder={
                soort === "afspraak"
                  ? "Bijv. Call met installateur / Lunch Huub"
                  : "Bijv. Creditfactuur Joling checken"
              }
              className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
            />
          </label>

          {soort === "afspraak" ? (
            <>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Start
                </span>
                <input
                  required
                  type="datetime-local"
                  value={dueLocal}
                  onChange={(e) => onDueChange(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Einde
                </span>
                <input
                  required
                  type="datetime-local"
                  value={endLocal}
                  onChange={(e) => setEndLocal(e.target.value)}
                  className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
                />
              </label>
            </>
          ) : (
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                Voor wanneer (datum + tijd)
              </span>
              <input
                required
                type="datetime-local"
                value={dueLocal}
                onChange={(e) => onDueChange(e.target.value)}
                className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
              />
            </label>
          )}

          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving || !titel.trim() || !dueLocal}
              className="w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50 sm:w-auto"
            >
              {saving
                ? "Bezig…"
                : soort === "afspraak"
                  ? "Afspraak toevoegen"
                  : "Taak toevoegen"}
            </button>
          </div>

          <label className="block sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              {soort === "afspraak" ? "Notities" : "Wat houdt de taak precies in"}
            </span>
            <textarea
              value={inhoud}
              onChange={(e) => setInhoud(e.target.value)}
              rows={3}
              placeholder={
                soort === "afspraak"
                  ? "Locatie, agenda, wat je wilt bespreken…"
                  : "Details, context, wat er mis is of wat je moet checken…"
              }
              className="mt-1 w-full resize-y border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
            />
          </label>
        </div>
      </form>

      {error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="py-10 text-center text-sm text-muted">Laden…</p>
      ) : list.length === 0 ? (
        <p className="border border-dashed border-line bg-wash px-4 py-10 text-center text-sm text-muted">
          {showDone
            ? "Nog geen items."
            : "Agenda leeg — voeg een taak of afspraak toe."}
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.key}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {g.label}
              </h3>
              <ul className="divide-y divide-line border border-line bg-white">
                {g.items.map((t) => {
                  const late = overdueIds.has(t.id);
                  const s = soortOf(t);
                  return (
                    <li
                      key={t.id}
                      className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4"
                    >
                      <button
                        type="button"
                        onClick={() => void toggleDone(t)}
                        className={[
                          "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[10px]",
                          t.status === "done"
                            ? "border-green bg-green text-white"
                            : "border-line bg-white text-transparent hover:border-green",
                        ].join(" ")}
                        aria-label={
                          t.status === "done" ? "Heropenen" : "Afronden"
                        }
                      >
                        ✓
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={[
                              "inline-flex px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              s === "afspraak"
                                ? "bg-[#E8F1FF] text-[#1D4ED8]"
                                : "bg-wash text-muted",
                            ].join(" ")}
                          >
                            {s === "afspraak" ? "Afspraak" : "Taak"}
                          </span>
                          <p
                            className={[
                              "text-sm font-semibold text-ink",
                              t.status === "done"
                                ? "line-through opacity-60"
                                : "",
                            ].join(" ")}
                          >
                            {t.titel}
                          </p>
                        </div>
                        {t.inhoud ? (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-muted">
                            {t.inhoud}
                          </p>
                        ) : null}
                        <p
                          className={[
                            "mt-1.5 text-xs font-semibold tabular-nums",
                            late && t.status === "todo"
                              ? "text-[#C45A12]"
                              : "text-muted",
                          ].join(" ")}
                        >
                          {late && t.status === "todo"
                            ? s === "afspraak"
                              ? "Voorbij · "
                              : "Te laat · "
                            : s === "afspraak"
                              ? ""
                              : "Deadline · "}
                          {s === "afspraak"
                            ? timeRangeLabel(t.due_at, t.end_at)
                            : formatDateTimeNl(t.due_at)}
                          {t.status === "done" && t.completed_at
                            ? ` · afgerond ${formatDateTimeNl(t.completed_at)}`
                            : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void removeItem(t.id, s)}
                        className="shrink-0 self-start text-xs font-semibold text-muted hover:text-[#C45A12]"
                      >
                        Verwijderen
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
