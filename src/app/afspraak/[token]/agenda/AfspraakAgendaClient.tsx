"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddToCalendarPanel } from "@/components/afspraak/AddToCalendarPanel";
import type { CalendarEventInput } from "@/lib/add-to-calendar";
import type { AgendaProvider } from "@/lib/afspraak-opvolging/agenda-track";
import { adresRegel } from "@/lib/format";
import { AFSPRAAK_DUUR_MINUTEN } from "@/lib/slots";

type Lead = {
  naam?: string | null;
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
};

type Adviseur = { naam?: string | null };

type AfspraakPayload = {
  id: string;
  start_at: string;
  end_at?: string | null;
  manage_token: string;
  leads?: Lead | Lead[] | null;
  adviseurs?: Adviseur | Adviseur[] | null;
};

function asOne<T>(raw: T | T[] | null | undefined): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

function trackAgenda(
  token: string,
  body: { event: "open" } | { event: "add"; provider: AgendaProvider }
) {
  void fetch(`/api/afspraken/${encodeURIComponent(token)}/agenda-track`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    /* fire-and-forget */
  });
}

export function AfspraakAgendaClient({ token }: { token: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [afspraak, setAfspraak] = useState<AfspraakPayload | null>(null);
  const openTracked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/afspraken/${encodeURIComponent(token)}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Afspraak niet gevonden");
        if (!cancelled) setAfspraak(data.afspraak as AfspraakPayload);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Fout");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!afspraak || openTracked.current) return;
    openTracked.current = true;
    trackAgenda(token, { event: "open" });
  }, [afspraak, token]);

  const onTrack = useCallback(
    (provider: AgendaProvider) => {
      trackAgenda(token, { event: "add", provider });
    },
    [token]
  );

  const event = useMemo((): CalendarEventInput | null => {
    if (!afspraak?.start_at) return null;
    const start = new Date(afspraak.start_at);
    if (Number.isNaN(start.getTime())) return null;
    const end = afspraak.end_at
      ? new Date(afspraak.end_at)
      : new Date(start.getTime() + AFSPRAAK_DUUR_MINUTEN * 60_000);
    const lead = asOne(afspraak.leads);
    const adviseur = asOne(afspraak.adviseurs);
    const adviseurNaam = adviseur?.naam?.trim() || "Batterijconcept";
    const location = lead ? adresRegel(lead) : undefined;

    return {
      title: "Afspraak · Batterijconcept",
      description: [
        `Kosteloos adviesgesprek met ${adviseurNaam}.`,
        "Duur: ongeveer 90 minuten.",
        "Handig: jaarafrekening (en eventueel zonnepaneelgegevens) bij de hand.",
        "Alle hoofdbewoners van de woning aanwezig voor de regelingstoets.",
        "",
        "Vragen? 085 800 1645 · info@batterijconcept.nl",
      ].join("\n"),
      location: location || undefined,
      start,
      end: Number.isNaN(end.getTime())
        ? new Date(start.getTime() + AFSPRAAK_DUUR_MINUTEN * 60_000)
        : end,
    };
  }, [afspraak]);

  return (
    <main className="min-h-screen bg-[#f2ede8] px-4 py-10 text-[#1e3a2f]">
      {loading ? (
        <p className="text-center text-sm text-[#6b7570]">Laden…</p>
      ) : error || !event ? (
        <div className="mx-auto max-w-md rounded-2xl border border-[#d9d2c8] bg-white p-5 text-center">
          <p className="font-semibold">Afspraak niet gevonden</p>
          <p className="mt-2 text-sm text-[#6b7570]">
            {error || "Deze link is ongeldig of verlopen."}
          </p>
        </div>
      ) : (
        <AddToCalendarPanel
          event={event}
          icsHref={`/api/afspraken/${encodeURIComponent(token)}/calendar`}
          onTrack={onTrack}
        />
      )}
    </main>
  );
}
