"use client";

import { useEffect, useState } from "react";
import {
  isAanbetalingFactuurOmschrijving,
  parseEuroInput,
} from "@/lib/aanbetaling";
import { formatEuro } from "@/lib/format";
import type { Factuur } from "@/types/database";

function euroInputFromNumber(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return "";
  return String(Number(n)).replace(".", ",");
}

export function AanbetalingBewerkenModal({
  open,
  onClose,
  projectId,
  offerteId,
  warmtefonds,
  currentStatus,
  vorigeAanbetalingInc,
  facturen,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  offerteId: string;
  warmtefonds: boolean;
  currentStatus: string;
  vorigeAanbetalingInc: number | null;
  facturen: Factuur[];
  onDone: () => void | Promise<void>;
}) {
  const [nieuw, setNieuw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNieuw(euroInputFromNumber(vorigeAanbetalingInc));
    setError(null);
    setBusy(false);
  }, [open, vorigeAanbetalingInc]);

  if (!open) return null;

  const vorige = Number(vorigeAanbetalingInc) || 0;
  const nieuwBedrag = parseEuroInput(nieuw);
  const isNul = nieuwBedrag <= 0;

  const hasVerstuurdeAanbetaling = facturen.some(
    (f) =>
      !f.credit_van_factuur_id &&
      isAanbetalingFactuurOmschrijving(f.omschrijving) &&
      f.status !== "concept"
  );

  async function bevestig() {
    setBusy(true);
    setError(null);
    try {
      const offRes = await fetch(`/api/offertes/${offerteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          aanbetaling_modus: "handmatig",
          aanbetaling_bedrag_inc: nieuwBedrag,
          aanbetaling_te_innen_inc: nieuwBedrag,
        }),
      });
      const offData = await offRes.json().catch(() => ({}));
      if (!offRes.ok) {
        throw new Error(
          (offData as { error?: string }).error ||
            "Aanbetaling opslaan mislukt"
        );
      }

      // Concept bijwerken of bij €0 verwijderen (verzonden facturen blijven)
      const facRes = await fetch(`/api/offertes/${offerteId}/factuur`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soort: "aanbetaling" }),
      });
      const facData = await facRes.json().catch(() => ({}));
      if (!facRes.ok && !(facData as { skipped?: boolean }).skipped) {
        throw new Error(
          (facData as { error?: string }).error ||
            "Conceptfactuur bijwerken mislukt"
        );
      }

      // €0: Opstarten WF + sync taken (BTW-factuur-actie weg)
      const nextStatus =
        isNul && warmtefonds ? "schouwweek_inplannen" : currentStatus;
      const projRes = await fetch(`/api/projecten/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          aanbetaling_te_innen_inc: nieuwBedrag,
        }),
      });
      const projData = await projRes.json().catch(() => ({}));
      if (!projRes.ok) {
        throw new Error(
          (projData as { error?: string }).error ||
            "Project bijwerken mislukt"
        );
      }

      await onDone();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Aanbetaling bewerken mislukt"
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="aanbetaling-bewerken-title"
        className="max-h-[90vh] w-full max-w-md overflow-y-auto border border-line bg-white shadow-xl"
      >
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2
            id="aanbetaling-bewerken-title"
            className="font-display text-lg font-semibold text-ink"
          >
            Aanbetaling bewerken
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Pas het aanbetalingsbedrag aan. Bij €0 verdwijnt de conceptfactuur
            {warmtefonds ? " en gaat het project naar Opstarten WF" : ""}.
          </p>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-5">
          {hasVerstuurdeAanbetaling ? (
            <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
              Er staat al een verstuurde/betaalde aanbetalingsfactuur. Die blijft
              staan; alleen het plan en eventuele{" "}
              <span className="font-semibold">concept</span>-factuur wijzigen.
            </p>
          ) : null}

          <label className="block text-xs text-muted">
            Vorige aanbetaling
            <input
              type="text"
              readOnly
              value={formatEuro(vorige)}
              className="mt-1 w-full border border-line bg-wash px-2.5 py-2 text-sm tabular-nums text-ink outline-none"
            />
          </label>

          <label className="block text-xs text-muted">
            Nieuwe aanbetaling (incl. btw)
            <input
              type="text"
              inputMode="decimal"
              value={nieuw}
              onChange={(e) => setNieuw(e.target.value)}
              placeholder="0,00"
              className="mt-1 w-full border border-line bg-white px-2.5 py-2 text-sm tabular-nums outline-none focus:border-green"
            />
          </label>

          {isNul ? (
            <p className="border border-[#0D9488]/25 bg-[#F0FDFA] px-3 py-2 text-[12px] text-[#115E59]">
              Bij €0: concept-aanbetalingsfactuur wordt verwijderd
              {warmtefonds ? ", status → Opstarten WF" : ""}, en de
              BTW-factuur-actie verdwijnt.
            </p>
          ) : null}

          {error ? (
            <p className="text-[13px] font-medium text-red-700">{error}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-5">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="h-9 border border-line bg-white px-3 text-xs font-semibold text-ink hover:bg-wash disabled:opacity-50"
          >
            Annuleren
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void bevestig()}
            className="h-9 bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
          >
            {busy ? "Bezig…" : "Opslaan"}
          </button>
        </div>
      </div>
    </div>
  );
}
