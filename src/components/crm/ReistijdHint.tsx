"use client";

import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import type { Afspraak, Lead } from "@/types/database";
import { AMSTERDAM_TZ, adresRegel, formatTimeNl } from "@/lib/format";
import { afspraakTeltVoorReistijd } from "@/lib/afspraak-soort";
import { resolveDayStartAdres } from "@/lib/start-adres";

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
 * Bij gekozen timeslot (handmatig of custom): reistijd vanaf vorige
 * fysieke huisafspraak (of startpunt) én naar de volgende diezelfde dag.
 * Is dit de laatste van de dag → reistijd terug naar huis (persoonlijk
 * startadres, niet de maandag-meeting). Telefonisch / bel telt nooit mee.
 */
export function ReistijdHint({
  adviseurId,
  startAt,
  lead,
  afspraken,
  allLeads,
  startAdres,
  startAdresLabel,
  startVanafHuisMaandag,
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
  /** true = maandag ook vanaf huis (Team-checkbox). */
  startVanafHuisMaandag?: boolean | null;
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
          afspraakTeltVoorReistijd(a.soort) &&
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
          label = prevLead?.naam || "vorig huisbezoek";
        } else {
          // Maandag → Daltonlaan, tenzij start_vanaf_huis_maandag
          const dayStart = resolveDayStartAdres(
            startAdres,
            startAt,
            adviseurId,
            startVanafHuisMaandag
          );
          from = (dayStart.address || startAdres || "").trim();
          label =
            dayStart.label ||
            startAdresLabel?.trim() ||
            "startpunt";
        }
        if (from && from !== "—") {
          try {
            const travel = await fetchTravel(from, to);
            if (cancelled) return;
            if (travel) {
              const prefix = prev
                ? `Vanaf vorig huisbezoek (${label})`
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

      // ── Naar volgende afspraak óf terug naar huis ─────────────────
      if (next) {
        const nextLead = resolveAfspraakLead(next, allLeads);
        const nextNaam = nextLead?.naam || "volgend huisbezoek";
        const nextTime = formatTimeNl(next.start_at);
        const gapMin = Math.round(
          (new Date(next.start_at).getTime() - endMs) / 60_000
        );
        const gapLabel = formatGapMinutes(gapMin);
        let nextLine = `Naar volgend huisbezoek (${nextNaam} ${nextTime}): ${gapLabel} tussenruimte`;

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
      } else if (startAt) {
        // Laatste (of enige) afspraak die dag → terugreis naar huis
        const laterSameDay = dayAfspraken.some(
          (a) => new Date(a.start_at).getTime() > startMs
        );
        if (!laterSameDay) {
          const home = (startAdres || "").trim();
          if (to && to !== "—" && home && home !== "—") {
            try {
              const travel = await fetchTravel(to, home);
              if (cancelled) return;
              if (travel) {
                out.push(
                  `Naar huis: ${travel.durationText}${
                    travel.distanceText ? ` · ${travel.distanceText}` : ""
                  }`
                );
              } else {
                out.push("Naar huis: reistijd onbekend");
              }
            } catch {
              out.push("Naar huis: reistijd onbekend");
            }
          } else if (!home || home === "—") {
            out.push("Geen startadres — reistijd naar huis niet te berekenen");
          }
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
    startVanafHuisMaandag,
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
