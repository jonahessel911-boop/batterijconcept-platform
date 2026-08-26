"use client";

import { useState } from "react";
import type { Afspraak, Lead } from "@/types/database";
import { formatInTimeZone } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { AMSTERDAM_TZ, adresRegel, formatTimeNl } from "@/lib/format";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import type { FastDirectionSuggestion } from "@/lib/fast-direction";

type AdresLead = Pick<
  Lead,
  "id" | "naam" | "straat" | "huisnummer" | "toevoeging" | "postcode" | "plaats"
>;

function MapsPinIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className || "h-4 w-4"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2.2" />
      <path d="M4 19h16" />
    </svg>
  );
}

function resolveLead(
  afspraak: Afspraak,
  allLeads?: AdresLead[]
): AdresLead | null {
  if (afspraak.leads && "straat" in afspraak.leads) {
    const L = afspraak.leads;
    return {
      id: afspraak.lead_id,
      naam: L.naam,
      straat: L.straat,
      huisnummer: L.huisnummer,
      toevoeging: "toevoeging" in L ? L.toevoeging : null,
      postcode: L.postcode,
      plaats: L.plaats,
    };
  }
  return allLeads?.find((l) => l.id === afspraak.lead_id) || null;
}

/**
 * Klik-only: 3 opties — per dag beste fit in de route, vroegste dagen eerst.
 */
export function FastDirectionButton({
  adviseurId,
  lead,
  afspraken,
  allLeads,
  freeSlots,
  startAdres,
  startAdresLabel,
  onSelectSlot,
}: {
  adviseurId: string;
  lead: AdresLead | null;
  afspraken: Afspraak[];
  allLeads?: AdresLead[];
  freeSlots: { start_at: string; end_at: string }[];
  startAdres?: string | null;
  startAdresLabel?: string | null;
  onSelectSlot: (startAt: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<FastDirectionSuggestion[]>([]);
  const [selectedStart, setSelectedStart] = useState<string | null>(null);

  const targetAddress = lead ? adresRegel(lead) : "—";
  const canRun =
    Boolean(adviseurId) &&
    Boolean(lead) &&
    targetAddress !== "—" &&
    freeSlots.length > 0 &&
    !loading;

  async function run() {
    if (!canRun || !lead) return;
    setLoading(true);
    setError(null);
    setOptions([]);
    setSelectedStart(null);
    try {
      const stops = afspraken
        .filter(
          (a) =>
            a.adviseur_id === adviseurId &&
            afspraakBlokkeertAgenda(a.soort) &&
            a.status !== "geannuleerd" &&
            a.status !== "voltooid"
        )
        .map((a) => {
          const L = resolveLead(a, allLeads);
          const address = L ? adresRegel(L) : "—";
          return {
            start_at: a.start_at,
            end_at: a.end_at || a.start_at,
            address,
            label: L?.naam || "Afspraak",
          };
        })
        .filter((s) => s.address !== "—");

      // Meer slots → meer dagen in de top-3
      const slots = freeSlots.slice(0, 40);

      const res = await fetch("/api/fast-direction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetAddress,
          freeSlots: slots,
          stops,
          depotAddress: startAdres || null,
          depotLabel: startAdresLabel || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.available) {
        throw new Error(data.error || "Geen suggestie gevonden");
      }
      const list = (data.options ||
        (data.best ? [data.best] : [])) as FastDirectionSuggestion[];
      if (list.length === 0) {
        throw new Error("Geen suggestie gevonden");
      }
      setOptions(list);
      setSelectedStart(list[0].start_at);
      onSelectSlot(list[0].start_at);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analyse mislukt");
    } finally {
      setLoading(false);
    }
  }

  function choose(opt: FastDirectionSuggestion) {
    setSelectedStart(opt.start_at);
    onSelectSlot(opt.start_at);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={!canRun}
        onClick={() => void run()}
        title={
          targetAddress === "—"
            ? "Lead heeft geen adres"
            : "3 beste momenten: vroegste dagen, beste route-fit"
        }
        className="inline-flex w-full items-center justify-center gap-2 border border-[#1A4A6E]/30 bg-[#E8F0F6] px-3 py-2 text-xs font-semibold text-[#1A4A6E] transition hover:bg-[#d7e6f1] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <MapsPinIcon className="h-4 w-4 shrink-0" />
        <span>
          {loading ? "Route analyseren…" : "Google Maps Fast Direction"}
        </span>
      </button>

      {error && (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      )}

      {options.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#1A4A6E]/80">
            3 opties · vroegste dagen · beste fit die dag
          </p>
          {options.map((opt, i) => {
            const selected = selectedStart === opt.start_at;
            return (
              <button
                key={opt.start_at}
                type="button"
                onClick={() => choose(opt)}
                className={[
                  "w-full rounded-lg border px-3 py-2.5 text-left text-xs transition",
                  selected
                    ? "border-[#1A4A6E] bg-[#E8F0F6] text-[#1A4A6E] ring-1 ring-[#1A4A6E]/30"
                    : "border-line bg-white text-ink hover:border-[#1A4A6E]/40 hover:bg-[#E8F0F6]/50",
                ].join(" ")}
              >
                <p className="font-semibold">
                  Optie {i + 1}:{" "}
                  {formatInTimeZone(opt.start_at, AMSTERDAM_TZ, "EEE d MMM", {
                    locale: nl,
                  })}{" "}
                  · {formatTimeNl(opt.start_at)}
                  {!opt.feasible && (
                    <span className="ml-1.5 font-normal text-[#C45A12]">
                      (krap)
                    </span>
                  )}
                </p>
                <p className="mt-1 leading-relaxed opacity-90">{opt.reason}</p>
                {(opt.fromDurationText || opt.toDurationText) && (
                  <p className="mt-1 text-[11px] opacity-80">
                    {[
                      opt.fromLabel && opt.fromDurationText
                        ? `${opt.fromLabel} → hier: ${opt.fromDurationText}`
                        : null,
                      opt.toLabel && opt.toDurationText
                        ? `hier → ${opt.toLabel}: ${opt.toDurationText}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {opt.mapsUrl && (
                  <a
                    href={opt.mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="mt-2 inline-flex items-center gap-1.5 font-semibold text-[#1A4A6E] underline-offset-2 hover:underline"
                  >
                    <MapsPinIcon className="h-3.5 w-3.5" />
                    Open route in Google Maps
                  </a>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
