"use client";

import { useCallback, useEffect, useState } from "react";
import type { LeadEvent } from "@/types/database";
import { formatDateTimeNl } from "@/lib/format";

export function LeadTimeline({ leadId }: { leadId: string }) {
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/events`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Laden mislukt");
      setEvents((data.events as LeadEvent[]) || []);
      setHint(data.hint || null);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return <p className="text-sm text-muted">Geschiedenis laden…</p>;
  }

  if (hint && events.length === 0) {
    return (
      <p className="text-sm text-muted">
        Tijdlijn nog niet actief. Voer{" "}
        <code className="text-xs">migrate-platform-verbeteringen.sql</code> uit
        in Supabase.
      </p>
    );
  }

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted">
        Nog geen gebeurtenissen. Statuswijzigingen en belacties verschijnen
        hier.
      </p>
    );
  }

  return (
    <ol className="relative space-y-0 border-l border-line pl-4">
      {events.map((ev) => (
        <li key={ev.id} className="relative pb-4 last:pb-0">
          <span className="absolute -left-[1.28rem] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-green bg-white" />
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            {formatDateTimeNl(ev.created_at)}
            {ev.soort ? ` · ${ev.soort}` : ""}
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink">{ev.titel}</p>
          {ev.detail?.trim() && (
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">
              {ev.detail}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
