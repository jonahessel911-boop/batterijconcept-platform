"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lead } from "@/types/database";
import { adresRegel } from "@/lib/format";

/** Zelfde shape als /api/best-slots — Bel-systeem is leidend voor ranking. */
export type BestSlotOption = {
  slot_id: string;
  start_at: string;
  end_at: string;
  label_nl: string;
  label_kort: string;
  adviseur_id: string;
  adviseur_naam: string;
  feasible: boolean;
  reason: string | null;
  conversie_pct: number | null;
  conversie_gelopen?: number | null;
  reistijd_min: number | null;
  /** true = vanaf startadres; false = vanaf vorige afspraak die dag */
  reistijd_vanaf_startadres: boolean | null;
  /** Terugreis naar startadres (laatste/enige afspraak die dag) */
  reistijd_terug_min?: number | null;
  /** Geen open huisbezoeken in planvenster → voorrang */
  lege_agenda?: boolean;
  /** Open huisbezoeken in planvenster */
  agenda_afspraken?: number;
};

export function bestSlotsHelpText(opts: {
  lockAdviseur?: boolean;
  limit?: number;
}): string {
  if (opts.lockAdviseur) {
    return "Opties in jouw agenda · bevestigingsmail gaat mee.";
  }
  const limit = opts.limit ?? 5;
  return (
    `Top ${limit}: reistijd eerst, daarna lege agenda & conversie` +
    (limit <= 5
      ? " · min. 2 adviseurs"
      : " · ook zelfde adviseur als die dichterbij is") +
    ". Lege agenda’s worden vooraan geschoven."
  );
}

/** Fetch + state voor top-slots — zelfde params als Bel-paneel. */
export function useBestSlots(opts: {
  lead: Pick<
    Lead,
    "id" | "straat" | "huisnummer" | "toevoeging" | "postcode" | "plaats"
  > | null;
  lockAdviseur?: boolean;
  defaultAdviseurId?: string | null;
  enabled?: boolean;
}) {
  const {
    lead,
    lockAdviseur = false,
    defaultAdviseurId,
    enabled = true,
  } = opts;

  const [bestSlots, setBestSlots] = useState<BestSlotOption[]>([]);
  const [bestSlotsLoading, setBestSlotsLoading] = useState(false);
  const [bestSlotsLoadingMore, setBestSlotsLoadingMore] = useState(false);
  const [bestSlotsError, setBestSlotsError] = useState<string | null>(null);
  const [bestSlotsMode, setBestSlotsMode] = useState<
    "route" | "calendar" | null
  >(null);
  const [bestSlotsLimit, setBestSlotsLimit] = useState<5 | 10>(5);

  const reset = useCallback(() => {
    setBestSlots([]);
    setBestSlotsLimit(5);
    setBestSlotsError(null);
    setBestSlotsMode(null);
  }, []);

  useEffect(() => {
    if (!enabled || !lead?.id) {
      reset();
      return;
    }
    const adres = adresRegel(lead);
    if (adres === "—") {
      setBestSlots([]);
      setBestSlotsLimit(5);
      setBestSlotsError(
        "Lead heeft geen volledig adres — top-opties niet beschikbaar."
      );
      setBestSlotsLoading(false);
      setBestSlotsMode(null);
      return;
    }

    let cancelled = false;
    setBestSlotsLoading(true);
    setBestSlotsError(null);
    setBestSlotsLimit(5);
    queueMicrotask(async () => {
      try {
        const qs = new URLSearchParams({
          lead_id: lead.id,
          limit: "5",
          days: "14",
        });
        if (lockAdviseur && defaultAdviseurId) {
          qs.set("adviseur_id", defaultAdviseurId);
        }
        const res = await fetch(`/api/best-slots?${qs}`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setBestSlots([]);
          setBestSlotsError(
            (data as { error?: string }).error || "Beste opties laden mislukt"
          );
          setBestSlotsMode(null);
          return;
        }
        let slots = (data.slots || []) as BestSlotOption[];
        if (lockAdviseur && defaultAdviseurId) {
          slots = slots.filter((s) => s.adviseur_id === defaultAdviseurId);
        }
        setBestSlots(slots);
        setBestSlotsMode(
          data.mode === "route" || data.mode === "calendar" ? data.mode : null
        );
        setBestSlotsError(null);
      } catch {
        if (!cancelled) {
          setBestSlots([]);
          setBestSlotsError("Beste opties laden mislukt");
        }
      } finally {
        if (!cancelled) setBestSlotsLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    lead?.id,
    lead?.straat,
    lead?.huisnummer,
    lead?.toevoeging,
    lead?.postcode,
    lead?.plaats,
    lockAdviseur,
    defaultAdviseurId,
    reset,
  ]);

  async function loadMeerBestSlots() {
    if (!lead?.id || bestSlotsLoadingMore || bestSlotsLimit >= 10) return;
    setBestSlotsLoadingMore(true);
    setBestSlotsError(null);
    try {
      const qs = new URLSearchParams({
        lead_id: lead.id,
        limit: "10",
        days: "14",
      });
      if (lockAdviseur && defaultAdviseurId) {
        qs.set("adviseur_id", defaultAdviseurId);
      }
      const res = await fetch(`/api/best-slots?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (data as { error?: string }).error || "Extra opties laden mislukt"
        );
      }
      let slots = (data.slots || []) as BestSlotOption[];
      if (lockAdviseur && defaultAdviseurId) {
        slots = slots.filter((s) => s.adviseur_id === defaultAdviseurId);
      }
      setBestSlots(slots);
      setBestSlotsLimit(10);
      setBestSlotsMode(
        data.mode === "route" || data.mode === "calendar" ? data.mode : null
      );
    } catch (e) {
      setBestSlotsError(
        e instanceof Error ? e.message : "Extra opties laden mislukt"
      );
    } finally {
      setBestSlotsLoadingMore(false);
    }
  }

  return {
    bestSlots,
    bestSlotsLoading,
    bestSlotsLoadingMore,
    bestSlotsError,
    bestSlotsMode,
    bestSlotsLimit,
    loadMeerBestSlots,
    resetBestSlots: reset,
  };
}

/** Lijst UI — volgorde = API-volgorde van Bel (geen client-sort). */
export function BestSlotsOptionsList({
  slots,
  selectedSlotId,
  onSelect,
  loading,
  error,
  mode,
  limit,
  loadingMore,
  onLoadMore,
  lockAdviseur,
}: {
  slots: BestSlotOption[];
  selectedSlotId: string | null;
  onSelect: (slot: BestSlotOption) => void;
  loading: boolean;
  error: string | null;
  mode?: "route" | "calendar" | null;
  limit: number;
  loadingMore: boolean;
  onLoadMore: () => void;
  lockAdviseur?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {lockAdviseur
            ? "Beste opties (jouw agenda)"
            : "Beste opties (alle adviseurs)"}
        </span>
        {mode === "route" ? (
          <span className="text-[10px] font-medium text-green-deeper">
            Incl. reistijd
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-muted">Beste opties berekenen…</p>
      ) : error ? (
        <p className="border border-[#C45A12]/30 bg-[#FFF0E6] px-3 py-2 text-xs text-[#C45A12]">
          {error}
        </p>
      ) : slots.length === 0 ? (
        <p className="text-sm text-muted">
          Geen gezamenlijke opties — kies handmatig hieronder.
        </p>
      ) : (
        <>
          <ul className="space-y-1.5">
            {slots.map((slot, idx) => {
              const selected = selectedSlotId === slot.slot_id;
              return (
                <li key={slot.slot_id}>
                  <button
                    type="button"
                    onClick={() => onSelect(slot)}
                    className={[
                      "flex w-full items-start gap-2.5 border px-3 py-2.5 text-left transition",
                      selected
                        ? "border-green bg-green-soft"
                        : "border-line bg-white hover:border-green/50",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-xs font-bold",
                        selected
                          ? "bg-green text-white"
                          : "bg-wash text-muted",
                      ].join(" ")}
                    >
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">
                        {slot.label_kort || slot.label_nl}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
                        <span className="font-medium text-ink">
                          {slot.adviseur_naam}
                        </span>
                        {slot.lege_agenda ? (
                          <span className="bg-[#FFF0E6] px-1 py-0.5 text-[10px] font-semibold text-[#C45A12]">
                            Lege agenda
                          </span>
                        ) : slot.agenda_afspraken != null &&
                          slot.agenda_afspraken > 0 &&
                          slot.agenda_afspraken < 3 ? (
                          <span className="bg-[#FFF8D6] px-1 py-0.5 text-[10px] font-semibold text-[#7A5C00]">
                            Dunne agenda ({slot.agenda_afspraken})
                          </span>
                        ) : null}
                        {slot.conversie_pct != null ? (
                          <span>
                            {slot.conversie_pct.toLocaleString("nl-NL")}%
                            conversie
                            {slot.conversie_gelopen != null
                              ? ` · ${slot.conversie_gelopen} gelopen`
                              : ""}
                          </span>
                        ) : (
                          <span>Nog geen gelopen afspraken</span>
                        )}
                        {slot.reistijd_min != null ? (
                          <span>
                            ~{slot.reistijd_min} min
                            {slot.reistijd_vanaf_startadres === false
                              ? " vanaf vorige afspraak"
                              : slot.reistijd_vanaf_startadres === true
                                ? " vanaf start"
                                : " route"}
                            {slot.reistijd_terug_min != null
                              ? ` · ~${slot.reistijd_terug_min} min terug`
                              : ""}
                          </span>
                        ) : slot.reistijd_terug_min != null ? (
                          <span>
                            ~{slot.reistijd_terug_min} min terug naar
                            startadres
                          </span>
                        ) : null}
                        {!slot.feasible ? (
                          <span className="text-[#C45A12]">Strak</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {limit < 10 && slots.length >= 5 ? (
            <button
              type="button"
              disabled={loadingMore}
              onClick={onLoadMore}
              className="w-full border border-line bg-wash px-3 py-2 text-xs font-semibold text-ink hover:bg-white disabled:opacity-50"
            >
              {loadingMore ? "Extra opties laden…" : "5 meer laden"}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
