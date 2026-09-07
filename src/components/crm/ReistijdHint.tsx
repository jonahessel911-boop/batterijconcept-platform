"use client";

import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import type { Afspraak, Lead } from "@/types/database";
import { AMSTERDAM_TZ, adresRegel, formatTimeNl } from "@/lib/format";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";

type AdresLead = Pick<
  Lead,
  "id" | "naam" | "straat" | "huisnummer" | "toevoeging" | "postcode" | "plaats"
>;

function resolveAfspraakLead(
  a: Afspraak,
  allLeads?: AdresLead[]
): AdresLead | null {
  if (a.leads && "straat" in a.leads) {
    const L = a.leads;
    return {
      id: a.lead_id,
      naam: L.naam,
      straat: L.straat,
      huisnummer: L.huisnummer,
      toevoeging: "toevoeging" in L ? L.toevoeging : null,
      postcode: L.postcode,
      plaats: L.plaats,
    };
  }
  return allLeads?.find((l) => l.id === a.lead_id) || null;
}

function formatGapMinutes(mins: number): string {
  if (mins < 0) return "overlapt";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (m === 0) return `${h}u`;
  return `${h}u ${m}m`;
}

async function fetchTravel(
  from: string,
  to: string
): Promise<{ durationText: string; distanceText?: string } | null> {
  const qs = new URLSearchParams({ from, to });
  const res = await fetch(`/api/travel-time?${qs}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.available) return null;
  return {
    durationText: data.durationText as string,
    distanceText: data.distanceText as string | undefined,
  };
}

/**
 * Bij gekozen timeslot: reistijd vanaf vorige afspraak (of startpunt)
 * én gap + reistijd naar de volgende afspraak diezelfde dag.
 */
export function ReistijdHint({
  adviseurId,
  startAt,
  lead,
  afspraken,
  allLeads,
  startAdres,
  startAdresLabel,
  /** Duur van het te boeken slot in minuten (default 120). */
  slotDurationMin = 120,
}: {
  adviseurId: string;
  startAt: string;
  lead: Pick<
    Lead,
    "straat" | "huisnummer" | "toevoeging" | "postcode" | "plaats"
  > | null;
  afspraken: Afspraak[];
  allLeads?: AdresLead[];
  /** Vertrekadres adviseur (Instellingen). */
  startAdres?: string | null;
  startAdresLabel?: string | null;
  slotDurationMin?: number;
}) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const to = lead ? adresRegel(lead) : "";
    if (!adviseurId || !startAt) {
      setLines([]);
      return;
    }
    const startMs = new Date(startAt).getTime();
    if (Number.isNaN(startMs)) {
      setLines([]);
      return;
    }
    const endMs = startMs + slotDurationMin * 60_000;
    const dayKey = formatInTimeZone(startAt, AMSTERDAM_TZ, "yyyy-MM-dd");

    const dayAfspraken = [...afspraken]
      .filter(
        (a) =>
          a.adviseur_id === adviseurId &&
          afspraakBlokkeertAgenda(a.soort) &&
          a.status !== "geannuleerd" &&
          formatInTimeZone(a.start_at, AMSTERDAM_TZ, "yyyy-MM-dd") === dayKey
      )
      .sort(
        (a, b) =>
          new Date(a.start_at).getTime() - new Date(b.start_at).getTime()
      );

    const prev = [...dayAfspraken]
      .filter((a) => new Date(a.end_at || a.start_at).getTime() <= startMs)
      .sort(
        (a, b) =>
          new Date(b.end_at || b.start_at).getTime() -
          new Date(a.end_at || a.start_at).getTime()
      )[0];

    const next = dayAfspraken.find(
      (a) => new Date(a.start_at).getTime() >= endMs
    );

    let cancelled = false;
    queueMicrotask(async () => {
      const out: string[] = [];

      // ── Vanaf vorige / startpunt ──────────────────────────────────
      if (to && to !== "—") {
        let from = "";
        let label = "";
        if (prev) {
          const prevLead = resolveAfspraakLead(prev, allLeads);
          from = prevLead ? adresRegel(prevLead) : "";
          label = prevLead?.naam || "vorige afspraak";
        } else {
          from = (startAdres || "").trim();
          label = startAdresLabel?.trim() || "startpunt";
        }
        if (from && from !== "—") {
          try {
            const travel = await fetchTravel(from, to);
            if (cancelled) return;
            if (travel) {
              const prefix = prev
                ? `Vanaf vorige (${label})`
                : `Vanaf startpunt (${label})`;
              out.push(
                `${prefix}: ${travel.durationText}${
                  travel.distanceText ? ` · ${travel.distanceText}` : ""
                }`
              );
            }
          } catch {
            /* ignore */
          }
        }
      }

      // ── Naar volgende afspraak ────────────────────────────────────
      if (next) {
        const nextLead = resolveAfspraakLead(next, allLeads);
        const nextNaam = nextLead?.naam || "volgende afspraak";
        const nextTime = formatTimeNl(next.start_at);
        const gapMin = Math.round(
          (new Date(next.start_at).getTime() - endMs) / 60_000
        );
        const gapLabel = formatGapMinutes(gapMin);
        let nextLine = `Naar volgende (${nextNaam} ${nextTime}): ${gapLabel} tussenruimte`;

        const nextAdres = nextLead ? adresRegel(nextLead) : "";
        if (to && to !== "—" && nextAdres && nextAdres !== "—") {
          try {
            const travel = await fetchTravel(to, nextAdres);
            if (cancelled) return;
            if (travel) {
              nextLine += ` · reistijd ${travel.durationText}`;
              if (travel.distanceText) nextLine += ` (${travel.distanceText})`;
            }
          } catch {
            /* ignore */
          }
        }
        out.push(nextLine);
      } else if (dayAfspraken.length > 0 || startAt) {
        // Alleen tonen als er een slot gekozen is: laatste van de dag
        const laterSameDay = dayAfspraken.some(
          (a) => new Date(a.start_at).getTime() > startMs
        );
        if (!laterSameDay) {
          out.push("Geen volgende afspraak die dag");
        }
      }

      if (!cancelled) setLines(out);
    });

    return () => {
      cancelled = true;
    };
  }, [
    adviseurId,
    startAt,
    lead,
    afspraken,
    allLeads,
    startAdres,
    startAdresLabel,
    slotDurationMin,
  ]);

  if (!lines.length) return null;
  return (
    <div className="space-y-1.5 rounded-lg border border-[#1A4A6E]/20 bg-[#E8F0F6] px-3 py-2 text-xs text-[#1A4A6E]">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}
