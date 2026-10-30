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

export function OmzettenNaarWarmtefondsModal({
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
  /** Altijd BTW als default bij omzetting naar WF */
  const [modus, setModus] = useState<AanbetalingModus>("btw");
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
    financieringVoorbehoud: true,
  });

  async function bevestig() {
    if (!offerte?.id) {
      setError("Geen getekende offerte gekoppeld.");
      return;
    }
    if (modus === "handmatig" && preview.bedragIncBtw <= 0) {
      setError("Vul een geldig aanbetalingsbedrag in.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const offRes = await fetch(`/api/offertes/${offerte.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          financiering_voorbehoud: true,
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
            "Offerte omzetten naar Warmtefonds mislukt"
        );
      }

      const projRes = await fetch(`/api/projecten/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          betaalwijze: "warmtefonds",
          betaalwijze_gewijzigd_at: new Date().toISOString(),
          betaalwijze_reden: "Omgezet van eigen middelen naar Warmtefonds",
          aanbetaling_te_innen_inc: preview.bedragIncBtw,
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
          .update({ status: "sale_financiering" })
          .eq("id", leadId);
      }

      // Concept-aanbetalingsfactuur → BTW-bedrag (standaard WF)
      if (!hasVerstuurdeAanbetaling) {
        const facRes = await fetch(`/api/offertes/${offerte.id}/factuur`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ soort: "aanbetaling" }),
        });
        if (!facRes.ok) {
          const facData = await facRes.json().catch(() => ({}));
          throw new Error(
            (facData as { error?: string }).error ||
              "BTW-aanbetalingsfactuur bijwerken mislukt"
          );
        }
      }

      await onDone();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Omzetten naar Warmtefonds mislukt"
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
        aria-labelledby="omzet-wf-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto border border-line bg-white shadow-xl"
      >
        <div className="border-b border-line px-4 py-3 sm:px-5">
          <h2
            id="omzet-wf-title"
            className="font-display text-lg font-semibold text-ink"
          >
            Omzetten naar Warmtefonds
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Standaard betaalt de klant de{" "}
            <span className="font-semibold text-ink">BTW als aanbetaling</span>.
            Je kunt hieronder een andere modus kiezen.
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
            <p className="border border-[#0D9488]/25 bg-[#F0FDFA] px-3 py-2 text-[12px] text-[#115E59]">
              De concept-aanbetalingsfactuur wordt omgezet naar een{" "}
              <span className="font-semibold">BTW-factuur</span> (tenzij je een
              andere modus kiest).
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
            financieringVoorbehoud
          />

          <p className="text-[12px] text-muted">
            Aanbetaling klant:{" "}
            <span className="font-semibold tabular-nums text-ink">
              {formatEuro(preview.bedragIncBtw)}
            </span>
            {" · "}
            WF-aanvraag:{" "}
            <span className="font-semibold tabular-nums text-ink">
              {formatEuro(preview.warmtefondsIncBtw)}
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
            {busy ? "Bezig…" : "Zet op Warmtefonds"}
          </button>
        </div>
      </div>
    </div>
  );
}
