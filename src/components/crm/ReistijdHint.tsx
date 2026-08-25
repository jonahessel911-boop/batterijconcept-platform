"use client";

import { useEffect, useState } from "react";
import type { Afspraak, Lead } from "@/types/database";
import { adresRegel } from "@/lib/format";
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

/** Toont reistijd van vorige fysieke afspraak → nieuwe lead. */
export function ReistijdHint({
  adviseurId,
  startAt,
  lead,
  afspraken,
  allLeads,
}: {
  adviseurId: string;
  startAt: string;
  lead: Pick<
    Lead,
    "straat" | "huisnummer" | "toevoeging" | "postcode" | "plaats"
  > | null;
  afspraken: Afspraak[];
  /** Fallback als afspraken geen nested leads hebben (bijv. BelPanel). */
  allLeads?: AdresLead[];
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

    const prev = [...afspraken]
      .filter(
        (a) =>
          a.adviseur_id === adviseurId &&
          afspraakBlokkeertAgenda(a.soort) &&
          a.status !== "geannuleerd" &&
          new Date(a.end_at || a.start_at).getTime() <= startMs
      )
      .sort(
        (a, b) =>
          new Date(b.end_at || b.start_at).getTime() -
          new Date(a.end_at || a.start_at).getTime()
      )[0];

    if (!prev) {
      setText(null);
      return;
    }

    const prevLead = resolvePrevLead(prev, allLeads);
    const from = prevLead ? adresRegel(prevLead) : "";
    if (!from || from === "—") {
      setText(null);
      return;
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
        setText(
          `Reistijd vanaf vorige afspraak (${prevLead?.naam || "vorige"}): ${data.durationText}${
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
  }, [adviseurId, startAt, lead, afspraken, allLeads]);

  if (!text) return null;
  return (
    <p className="rounded-lg border border-[#1A4A6E]/20 bg-[#E8F0F6] px-3 py-2 text-xs text-[#1A4A6E]">
      {text}
    </p>
  );
}
