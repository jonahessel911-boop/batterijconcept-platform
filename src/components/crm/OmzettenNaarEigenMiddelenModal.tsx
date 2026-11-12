"use client";

import { useState } from "react";
import {
  aanbetalingVanOrder,
  parseEuroInput,
  type AanbetalingModus,
} from "@/lib/aanbetaling";
import { formatEuro } from "@/lib/format";
import { getSupabaseBrowser } from "@/lib/supabase";
import { AanbetalingInstelling } from "./AanbetalingInstelling";

type OfferteLike = {
  id: string;
  subtotaal_ex_btw?: number | null;
  btw_bedrag?: number | null;
  totaal_inc_btw?: number | null;
};

export function OmzettenNaarEigenMiddelenModal({
  open,
  onClose,
  projectId,
  leadId,
  offerte,
  hasVerstuurdeAanbetaling,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  leadId: string | null | undefined;
  offerte: OfferteLike | null | undefined;
  /** Concept blijft bijwerken; verzonden/betaald blijft staan. */
  hasVerstuurdeAanbetaling?: boolean;
  onDone: () => void | Promise<void>;
}) {
  /** Standaard EM: 50% vooraf */
  const [modus, setModus] = useState<AanbetalingModus>("helft");
  const [handmatig, setHandmatig] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const subtotaalExBtw = Number(offerte?.subtotaal_ex_btw) || 0;
  const btwBedrag = Number(offerte?.btw_bedrag) || 0;
  const totaalIncBtw = Number(offerte?.totaal_inc_btw) || 0;
  const preview = aanbetalingVanOrder({
    subtotaalExBtw,
    btwBedrag,
    totaalIncBtw,
    modus,
    handmatigIncBtw: parseEuroInput(handmatig),
    financieringVoorbehoud: false,
  });

  async function bevestig() {
    if (!offerte?.id) {
      setError("Geen getekende offerte gekoppeld.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const offRes = await fetch(`/api/offertes/${offerte.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financiering_voorbehoud: false,
          aanbetaling_modus: modus,
          aanbetaling_te_innen_inc: preview.bedragIncBtw,
          aanbetaling_bedrag_inc:
            modus === "handmatig" ? preview.bedragIncBtw : null,
        }),
      });
      const offData = await offRes.json().catch(() => ({}));
      if (!offRes.ok) {
        throw new Error(
          (offData as { error?: string }).error ||
            "Offerte omzetten naar eigen middelen mislukt"
        );
      }

      const projRes = await fetch(`/api/projecten/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          betaalwijze: "eigen_middelen",
          betaalwijze_gewijzigd_at: new Date().toISOString(),
          betaalwijze_reden: "Omgezet van Warmtefonds naar eigen middelen",
          aanbetaling_te_innen_inc: preview.bedragIncBtw,
          financiering_status: null,
        }),
      });
      const projData = await projRes.json().catch(() => ({}));
      if (!projRes.ok) {
        throw new Error(
          (projData as { error?: string }).error ||
            "Project betaalwijze bijwerken mislukt"
        );
      }

      if (leadId) {
        const sb = getSupabaseBrowser();
        await sb
          .from("leads")
          .update({ status: "sale_eigen_middelen" })
          .eq("id", leadId);
      }

      // €0 aanbetaling → geen factuur. Anders concept-aanbetalingsfactuur.
      if (!hasVerstuurdeAanbetaling) {
        const facRes = await fetch(`/api/offertes/${offerte.id}/factuur`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ soort: "aanbetaling" }),
        });
        const facData = await facRes.json().catch(() => ({}));
        if (!facRes.ok && !(facData as { skipped?: boolean }).skipped) {
          throw new Error(
            (facData as { error?: string }).error ||
              "Aanbetalingsfactuur bijwerken mislukt"
          );
        }
      }

      await onDone();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Omzetten naar eigen middelen mislukt"
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
        aria-labelledby="omzet-em-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto border border-line bg-white shadow-xl"
      >
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2
            id="omzet-em-title"
            className="font-display text-lg font-semibold text-ink"
          >
            Omzetten naar eigen middelen
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Standaard{" "}
            <span className="font-semibold text-ink">
              50% vooraf / 50% na installatie
            </span>
            . Je kunt hieronder een andere modus kiezen.
          </p>
        </div>

        <div className="space-y-3 px-4 py-4 sm:px-5">
          {hasVerstuurdeAanbetaling ? (
            <p className="border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950">
              Er staat al een verstuurde/betaalde aanbetalingsfactuur. Die blijft
              staan; alleen het betaalplan en eventuele{" "}
              <span className="font-semibold">concept</span>-factuur worden
              aangepast.
            </p>
          ) : (
            <p className="border border-line bg-wash px-3 py-2 text-[12px] text-muted">
              De concept-aanbetalingsfactuur wordt omgezet naar{" "}
              <span className="font-semibold text-ink">50% vooraf</span> (tenzij
              je een andere modus kiest).
            </p>
          )}

          <AanbetalingInstelling
            modus={modus}
            onModusChange={setModus}
            handmatig={handmatig}
            onHandmatigChange={setHandmatig}
            subtotaalExBtw={subtotaalExBtw}
            btwBedrag={btwBedrag}
            totaalIncBtw={totaalIncBtw}
            financieringVoorbehoud={false}
          />

          <p className="text-[12px] text-muted">
            Aanbetaling:{" "}
            <span className="font-semibold tabular-nums text-ink">
              {formatEuro(preview.bedragIncBtw)}
            </span>
            {" · "}
            Restant:{" "}
            <span className="font-semibold tabular-nums text-ink">
              {formatEuro(preview.restantIncBtw)}
            </span>
          </p>

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
            disabled={busy || !offerte?.id}
            onClick={() => void bevestig()}
            className="h-9 bg-green px-3 text-xs font-semibold text-white hover:bg-green-dark disabled:opacity-50"
          >
            {busy ? "Bezig…" : "Zet op eigen middelen"}
          </button>
        </div>
      </div>
    </div>
  );
}
