"use client";

import type { AanbetalingModus } from "@/lib/aanbetaling";
import {
  ENERGIE_CONTRACT_TYPE_LABEL,
  ENERGIE_CONTRACT_TYPES,
  type EnergieContractType,
  type EnergieVerbruikFormValues,
} from "@/lib/energie-contract";
import type { SaleOpbelMoment } from "@/lib/sale-opbel";
import { AanbetalingInstelling } from "./AanbetalingInstelling";

export type BackofficeActieFormValues = {
  aanbetalingModus: AanbetalingModus;
  aanbetalingHandmatig: string;
  backofficeNotitie: string;
  installateurNotitie: string;
  /** Optioneel: plan belmoment na sale-checkout */
  opbelMoment?: SaleOpbelMoment | null;
} & EnergieVerbruikFormValues;

type Props = {
  subtotaalExBtw: number;
  btwBedrag: number;
  totaalIncBtw: number;
  financieringVoorbehoud: boolean;
  adviseurNaam?: string | null;
  sessionNaam?: string | null;
  values: BackofficeActieFormValues;
  onChange: (patch: Partial<BackofficeActieFormValues>) => void;
  disabled?: boolean;
  /** Compact: geen aparte kop (voor inbedding in andere card) */
  compact?: boolean;
};

export function BackofficeActieForm({
  subtotaalExBtw,
  btwBedrag,
  totaalIncBtw,
  financieringVoorbehoud,
  adviseurNaam,
  sessionNaam,
  values,
  onChange,
  disabled = false,
  compact = false,
}: Props) {
  const contractType = values.energieContractType;

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {!compact && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#C45A12]">
            Actie vereist
          </p>
          <h3 className="mt-1 text-lg font-semibold text-ink">
            Backoffice invullen
          </h3>
          <p className="mt-1 text-xs text-muted">
            Betaalroute:{" "}
            <span className="font-semibold text-ink">
              {financieringVoorbehoud ? "Warmtefonds" : "Eigen middelen"}
            </span>
          </p>
        </div>
      )}

      {(adviseurNaam || sessionNaam) && (
        <div className="rounded-xl border border-line bg-wash px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Adviseur van dit project
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">
            {adviseurNaam || "Nog niet toegewezen"}
          </p>
          {sessionNaam ? (
            <p className="mt-1 text-xs text-muted">
              Notities worden opgeslagen als {sessionNaam}
            </p>
          ) : null}
        </div>
      )}

      <fieldset disabled={disabled} className="min-w-0 space-y-3">
        <AanbetalingInstelling
          modus={values.aanbetalingModus}
          onModusChange={(m) => onChange({ aanbetalingModus: m })}
          handmatig={values.aanbetalingHandmatig}
          onHandmatigChange={(v) => onChange({ aanbetalingHandmatig: v })}
          subtotaalExBtw={subtotaalExBtw}
          btwBedrag={btwBedrag}
          totaalIncBtw={totaalIncBtw}
          financieringVoorbehoud={financieringVoorbehoud}
        />

        <div className="rounded-xl border border-[#0a4727]/20 bg-[#F7F9F7] px-3 py-3 sm:px-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0a4727]">
            Energie · Frank overstap
          </p>
          <p className="mt-1 text-[11px] text-muted">
            Optioneel. Gas alleen invullen als de klant gas heeft.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Elektraverbruik (kWh/jaar)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                value={values.elektraVerbruikKwh}
                onChange={(e) =>
                  onChange({ elektraVerbruikKwh: e.target.value })
                }
                placeholder="bijv. 3500"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Gasverbruik (m³/jaar)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                value={values.gasVerbruikM3}
                onChange={(e) => onChange({ gasVerbruikM3: e.target.value })}
                placeholder="leeg = geen gas"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted sm:col-span-2">
              Teruglevering (kWh/jaar)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                step="1"
                value={values.terugleveringKwh}
                onChange={(e) =>
                  onChange({ terugleveringKwh: e.target.value })
                }
                placeholder="0 als geen teruglevering"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-green"
              />
            </label>
          </div>

          <div className="mt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">
              Type contract
            </p>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {ENERGIE_CONTRACT_TYPES.map((t) => {
                const active = contractType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() =>
                      onChange({
                        energieContractType: t as EnergieContractType,
                        ...(t !== "vast"
                          ? { energieContractEinddatum: "" }
                          : {}),
                      })
                    }
                    className={[
                      "min-h-9 border px-3 py-1.5 text-sm font-semibold",
                      active
                        ? "border-[#0a4727] bg-[#0a4727] text-white"
                        : "border-line bg-white text-ink hover:bg-wash",
                    ].join(" ")}
                  >
                    {ENERGIE_CONTRACT_TYPE_LABEL[t]}
                  </button>
                );
              })}
            </div>
          </div>

          {contractType === "vast" ? (
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted">
              Einddatum vast contract
              <input
                type="date"
                value={values.energieContractEinddatum}
                onChange={(e) =>
                  onChange({ energieContractEinddatum: e.target.value })
                }
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink outline-none focus:border-green sm:max-w-xs"
              />
            </label>
          ) : null}
        </div>

        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Notitie voor backoffice
          <textarea
            value={values.backofficeNotitie}
            onChange={(e) => onChange({ backofficeNotitie: e.target.value })}
            rows={3}
            placeholder="Wat moet backoffice weten?"
            className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          />
        </label>
        <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
          Notitie voor installateur
          <textarea
            value={values.installateurNotitie}
            onChange={(e) => onChange({ installateurNotitie: e.target.value })}
            rows={3}
            placeholder="Wat moet de installateur weten?"
            className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          />
        </label>
      </fieldset>
    </div>
  );
}
