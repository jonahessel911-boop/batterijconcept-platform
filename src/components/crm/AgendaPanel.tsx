"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Adviseur, Afspraak, Lead } from "@/types/database";
import { formatDateTimeLongNl, formatDateTimeNl } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

export function AgendaPanel({
  leads,
  defaultAdviseurId,
}: {
  leads: Lead[];
  defaultAdviseurId?: string;
}) {
  const [afspraken, setAfspraken] = useState<Afspraak[]>([]);
  const [adviseurs, setAdviseurs] = useState<Adviseur[]>([]);
  const [slots, setSlots] = useState<{ start_at: string; end_at: string }[]>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const [leadId, setLeadId] = useState("");
  const [adviseurId, setAdviseurId] = useState(defaultAdviseurId || "");
  const [startAt, setStartAt] = useState("");
  const [notities, setNotities] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, adv] = await Promise.all([
        fetch("/api/afspraken").then((r) => r.json()),
        fetch("/api/adviseurs").then((r) => r.json()),
      ]);
      if (a.error) throw new Error(a.error);
      if (adv.error) throw new Error(adv.error);
      setAfspraken(a.afspraken || []);
      setAdviseurs(adv.adviseurs || []);
      setAdviseurId((prev) => {
        if (prev) return prev;
        if (defaultAdviseurId) return defaultAdviseurId;
        return adv.adviseurs?.[0]?.id || "";
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Laden mislukt");
    } finally {
      setLoading(false);
    }
  }, [defaultAdviseurId]);

  useEffect(() => {
    const id = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(id);
  }, [load]);

  useEffect(() => {
    if (!adviseurId) return;
    let cancelled = false;
    queueMicrotask(async () => {
      const res = await fetch(`/api/adviseurs?adviseur_id=${adviseurId}`);
      const data = await res.json();
      if (!cancelled) setSlots(data.slots || []);
    });
    return () => {
      cancelled = true;
    };
  }, [adviseurId]);

  const upcoming = useMemo(
    () =>
      afspraken.filter((a) => {
        if (defaultAdviseurId && a.adviseur_id !== defaultAdviseurId) {
          return false;
        }
        // Geannuleerd: blijven zichtbaar (niet uit DB) tot de geplande tijd voorbij is
        if (a.status === "geannuleerd") {
          return new Date(a.start_at) >= new Date();
        }
        if (new Date(a.start_at) < new Date()) return false;
        return true;
      }),
    [afspraken, defaultAdviseurId]
  );

  async function plan(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setOkMsg(null);
    try {
      const res = await fetch("/api/afspraken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: leadId,
          adviseur_id: adviseurId,
          start_at: startAt,
          notities: notities || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Opslaan mislukt");
      setOkMsg("Afspraak gepland — bevestigingsmail verstuurd.");
      setStartAt("");
      setNotities("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fout");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-0 lg:grid-cols-[340px_1fr]">
      <aside className="border-b border-line p-5 lg:border-b-0 lg:border-r">
        <h2 className="font-display text-base font-semibold text-ink">
          Nieuwe afspraak
        </h2>
        <p className="mt-1 text-xs text-muted">
          Koppel een lead aan een adviseur en kies een slot.
        </p>

        <form onSubmit={plan} className="mt-4 space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Lead
            <select
              required
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            >
              <option value="">Kies lead…</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.naam} ({l.lead_number})
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Adviseur
            <select
              required
              value={adviseurId}
              onChange={(e) => {
                setAdviseurId(e.target.value);
                setStartAt("");
              }}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            >
              <option value="">Kies adviseur…</option>
              {adviseurs.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.naam}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Beschikbaar slot
            <select
              required
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            >
              <option value="">Kies tijd…</option>
              {slots.slice(0, 40).map((s) => (
                <option key={s.start_at} value={s.start_at}>
                  {formatDateTimeNl(s.start_at)}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
            Interne notitie
            <span className="ml-1 font-normal normal-case tracking-normal text-muted/80">
              (alleen voor jullie, niet zichtbaar voor de klant)
            </span>
            <textarea
              value={notities}
              onChange={(e) => setNotities(e.target.value)}
              rows={3}
              placeholder="Bijv. bel vooraf, sleutel bij buren…"
              className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
            />
          </label>

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

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#e0651c] disabled:opacity-60"
          >
            {saving ? "Bezig…" : "Afspraak plannen"}
          </button>
        </form>
      </aside>

      <div className="min-w-0">
        {loading ? (
          <p className="px-6 py-14 text-center text-sm text-muted">Laden…</p>
        ) : upcoming.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-muted">
            Nog geen geplande afspraken.
          </p>
        ) : (
          <>
            <div className="crm-card-list md:hidden">
              {upcoming.map((a) => (
                <article key={a.id} className="crm-card">
                  <p className="font-medium text-ink">
                    {formatDateTimeLongNl(a.start_at)}
                  </p>
                  <p className="mt-1 text-sm font-medium">{a.leads?.naam || "—"}</p>
                  <p className="font-mono text-[11px] text-muted">
                    {a.leads?.lead_number}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-muted">
                      {a.adviseurs?.naam || "—"}
                    </span>
                    <StatusBadge kind="afspraak" value={a.status} />
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden md:block">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Wanneer</th>
                    <th>Lead</th>
                    <th>Adviseur</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((a) => (
                    <tr key={a.id} className="cursor-default">
                      <td className="whitespace-nowrap font-medium">
                        {formatDateTimeLongNl(a.start_at)}
                      </td>
                      <td>
                        <div className="font-medium">{a.leads?.naam || "—"}</div>
                        <div className="font-mono text-[11px] text-muted">
                          {a.leads?.lead_number}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        {a.adviseurs?.naam || "—"}
                      </td>
                      <td>
                        <StatusBadge kind="afspraak" value={a.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
