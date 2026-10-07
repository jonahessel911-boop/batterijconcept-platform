"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ, formatDateTimeNl } from "@/lib/format";

type AdminTaak = {
  id: string;
  titel: string;
  inhoud: string | null;
  due_at: string;
  status: "todo" | "done";
  completed_at: string | null;
  created_at: string;
};

function defaultDueLocal(): string {
  const d = new Date();
  d.setHours(d.getHours() + 2, 0, 0, 0);
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd'T'HH:mm");
}

export function AdminTakenPanel() {
  const [taken, setTaken] = useState<AdminTaak[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const [titel, setTitel] = useState("");
  const [inhoud, setInhoud] = useState("");
  const [dueLocal, setDueLocal] = useState(defaultDueLocal);

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
      if ((data as { error?: string }).error && !(data as { taken?: unknown[] }).taken?.length) {
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
      openTaken.filter((t) => new Date(t.due_at).getTime() < now).map((t) => t.id)
    );
  }, [openTaken]);

  async function createTaak(e: React.FormEvent) {
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
      setDueLocal(defaultDueLocal());
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

  async function removeTaak(id: string) {
    if (!window.confirm("Deze taak verwijderen?")) return;
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
          <h2 className="font-display text-xl font-semibold text-ink">Taken</h2>
          <p className="mt-0.5 text-sm text-muted">
            Jouw fix-lijst · deadline met tijd · alleen zichtbaar voor admin
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
        onSubmit={(e) => void createTaak(e)}
        className="space-y-3 border border-line bg-white p-4 sm:p-5"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
          Nieuwe taak
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Wat moet er gebeuren
            </span>
            <input
              required
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              placeholder="Bijv. Creditfactuur Joling checken"
              className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Voor wanneer (datum + tijd)
            </span>
            <input
              required
              type="datetime-local"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2.5 text-sm outline-none focus:border-green"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={saving || !titel.trim() || !dueLocal}
              className="w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-50 sm:w-auto"
            >
              {saving ? "Bezig…" : "Taak toevoegen"}
            </button>
          </div>
          <label className="block sm:col-span-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted">
              Wat houdt de taak precies in
            </span>
            <textarea
              value={inhoud}
              onChange={(e) => setInhoud(e.target.value)}
              rows={3}
              placeholder="Details, context, wat er mis is of wat je moet checken…"
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
            ? "Nog geen taken."
            : "Geen open taken — voeg hierboven iets toe dat je moet fixen."}
        </p>
      ) : (
        <ul className="divide-y divide-line border border-line bg-white">
          {list.map((t) => {
            const late = overdueIds.has(t.id);
            return (
              <li key={t.id} className="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-start sm:gap-4">
                <button
                  type="button"
                  onClick={() => void toggleDone(t)}
                  className={[
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[10px]",
                    t.status === "done"
                      ? "border-green bg-green text-white"
                      : "border-line bg-white text-transparent hover:border-green",
                  ].join(" ")}
                  aria-label={t.status === "done" ? "Heropenen" : "Afronden"}
                >
                  ✓
                </button>
                <div className="min-w-0 flex-1">
                  <p
                    className={[
                      "text-sm font-semibold text-ink",
                      t.status === "done" ? "line-through opacity-60" : "",
                    ].join(" ")}
                  >
                    {t.titel}
                  </p>
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
                    {late && t.status === "todo" ? "Te laat · " : "Deadline · "}
                    {formatDateTimeNl(t.due_at)}
                    {t.status === "done" && t.completed_at
                      ? ` · afgerond ${formatDateTimeNl(t.completed_at)}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeTaak(t.id)}
                  className="shrink-0 self-start text-xs font-semibold text-muted hover:text-[#C45A12]"
                >
                  Verwijderen
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
