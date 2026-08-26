"use client";

import { useEffect, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import type { Afspraak, Lead } from "@/types/database";
import { AMSTERDAM_TZ, adresRegel } from "@/lib/format";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";

type AdresLead = Pick<
  Lead,
  "id" | "naam" | "straat" | "huisnummer" | "toevoeging" | "postcode" | "plaats"
>;

function resolvePrevLead(
  prev: Afspraak,
  allLeads?: AdresLead[]
): AdresLead | null {
  if (prev.leads && "straat" in prev.leads) {
    const L = prev.leads;
    return {
      id: prev.lead_id,
      naam: L.naam,
      straat: L.straat,
      huisnummer: L.huisnummer,
      toevoeging: "toevoeging" in L ? L.toevoeging : null,
      postcode: L.postcode,
      plaats: L.plaats,
    };
  }
  return allLeads?.find((l) => l.id === prev.lead_id) || null;
}

/**
 * Reistijd diezelfde dag: vorige fysieke afspraak → lead,
 * of vanaf startadres adviseur als er die dag nog geen afspraak is.
 */
export function ReistijdHint({
  adviseurId,
  startAt,
  lead,
  afspraken,
  allLeads,
  startAdres,
  startAdresLabel,
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
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const to = lead ? adresRegel(lead) : "";
    if (!adviseurId || !startAt || !to || to === "—") {
      setText(null);
      return;
    }
    const startMs = new Date(startAt).getTime();
    if (Number.isNaN(startMs)) {
      setText(null);
      return;
    }

    const dayKey = formatInTimeZone(startAt, AMSTERDAM_TZ, "yyyy-MM-dd");

    const prev = [...afspraken]
      .filter(
        (a) =>
          a.adviseur_id === adviseurId &&
          afspraakBlokkeertAgenda(a.soort) &&
          a.status !== "geannuleerd" &&
          formatInTimeZone(a.start_at, AMSTERDAM_TZ, "yyyy-MM-dd") === dayKey &&
          new Date(a.end_at || a.start_at).getTime() <= startMs
      )
      .sort(
        (a, b) =>
          new Date(b.end_at || b.start_at).getTime() -
          new Date(a.end_at || a.start_at).getTime()
      )[0];

    let from = "";
    let label = "";

    if (prev) {
      const prevLead = resolvePrevLead(prev, allLeads);
      from = prevLead ? adresRegel(prevLead) : "";
      label = prevLead?.naam || "vorige afspraak";
      if (!from || from === "—") {
        setText(null);
        return;
      }
    } else {
      from = (startAdres || "").trim();
      if (!from || from === "—") {
        setText(null);
        return;
      }
      label = startAdresLabel?.trim() || "startpunt";
    }

    let cancelled = false;
    queueMicrotask(async () => {
      try {
        const qs = new URLSearchParams({ from, to });
        const res = await fetch(`/api/travel-time?${qs}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data.available) {
          setText(null);
          return;
        }
        const prefix = prev
          ? `Reistijd vanaf vorige afspraak (${label})`
          : `Reistijd vanaf startpunt (${label})`;
        setText(
          `${prefix}: ${data.durationText}${
            data.distanceText ? ` · ${data.distanceText}` : ""
          }`
        );
      } catch {
        if (!cancelled) setText(null);
      }
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
  ]);

  if (!text) return null;
  return (
    <p className="rounded-lg border border-[#1A4A6E]/20 bg-[#E8F0F6] px-3 py-2 text-xs text-[#1A4A6E]">
      {text}
    </p>
  );
}
