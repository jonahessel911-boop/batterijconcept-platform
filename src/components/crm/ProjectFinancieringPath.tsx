"use client";

import { useState } from "react";
import type { FinancieringStatus } from "@/lib/financiering-status";
import {
  FINANCIERING_PIPELINE,
  FINANCIERING_STATUS_LABEL,
  FINANCIERING_STATUS_LABEL_KORT,
} from "@/lib/financiering-status";
import { magWarmtefondsRestantFactuur, RESTANT_VAST_INC_BTW } from "@/lib/aanbetaling";
import { formatDateTimeNl, formatEuro } from "@/lib/format";

/**
 * Parallel Warmtefonds-spoor — los van orderstatus.
 * Stap 2 (afspraak gepland) vraagt interne datum/tijd.
 */
export function ProjectFinancieringPath({
  status,
  afspraakAt = null,
  onChange,
  disabled = false,
  aanbetalingInc = null,
  warmtefondsInc = null,
  restantFactuurStatus = null,
  onOpenFinancieel,
}: {
  status: FinancieringStatus | null;
  afspraakAt?: string | null;
  onChange?: (
    status: FinancieringStatus | null,
    extra?: { warmtefonds_afspraak_at?: string | null }
  ) => void;
  disabled?: boolean;
  /** Klant-aanbetaling (meestal BTW). */
  aanbetalingInc?: number | null;
  /** Warmtefonds-aanvraagbedrag (max € 8.500). */
  warmtefondsInc?: number | null;
  /** Status van bestaande restantfactuur, indien aanwezig. */
  restantFactuurStatus?: string | null;
  onOpenFinancieel?: () => void;
}) {
  const [pendingAfspraak, setPendingAfspraak] = useState(false);
  const [afspraakLocal, setAfspraakLocal] = useState("");

  const currentIdx =
    status && status !== "afgewezen"
      ? FINANCIERING_PIPELINE.indexOf(status)
      : -1;
  const clickable = Boolean(onChange) && !disabled;
  const isAfgewezen = status === "afgewezen";

  function toDatetimeLocalValue(iso: string | null | undefined): string {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n: number) => String(n).padStart(2, "0");
    // Europe/Amsterdam approx via local browser — CRM users are NL
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function selectStep(step: FinancieringStatus) {
    if (!onChange || disabled) return;
    if (step === "afspraak_ingepland") {
      setAfspraakLocal(toDatetimeLocalValue(afspraakAt) || "");
      setPendingAfspraak(true);
      return;
    }
    setPendingAfspraak(false);
    onChange(step);
  }

  function confirmAfspraak() {
    if (!onChange || !afspraakLocal) return;
    const d = new Date(afspraakLocal);
    if (Number.isNaN(d.getTime())) return;
    setPendingAfspraak(false);
    onChange("afspraak_ingepland", {
      warmtefonds_afspraak_at: d.toISOString(),
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Financiering
          </p>
          <p className="mt-0.5 text-[15px] font-semibold text-ink">
            {isAfgewezen
              ? "Afgewezen"
              : status
                ? FINANCIERING_STATUS_LABEL_KORT[status]
                : "Nog niet gestart"}
          </p>
          {status === "afspraak_ingepland" && afspraakAt ? (
            <p className="mt-0.5 text-[12px] text-muted">
              Afspraak: {formatDateTimeNl(afspraakAt)}
            </p>
          ) : null}
        </div>
        <span className="text-[11px] text-muted">Warmtefonds</span>
      </div>

      <ol className="space-y-0.5">
        {FINANCIERING_PIPELINE.map((step, idx) => {
          const active = currentIdx === idx;
          const done = currentIdx >= 0 && idx < currentIdx;

          return (
            <li key={step}>
              <button
                type="button"
                disabled={!clickable}
                title={FINANCIERING_STATUS_LABEL[step]}
                onClick={() => selectStep(step)}
                className={[
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition",
                  clickable
                    ? "hover:bg-[#FFF7ED] cursor-pointer"
                    : "cursor-default",
                  active
                    ? "bg-[#FFF0E6] font-semibold text-[#C45A12]"
                    : done
                      ? "font-medium text-ink"
                      : "text-muted",
                ].join(" ")}
              >
                <span
                  className={[
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 text-[9px] font-bold",
                    active
                      ? "border-[#C45A12] bg-[#C45A12] text-white"
                      : done
                        ? "border-[#C45A12] bg-[#C45A12] text-white"
                        : "border-[#D1D5D3] bg-white text-[#9CA3AF]",
                  ].join(" ")}
                >
                  {done && !active ? (
                    <svg
                      viewBox="0 0 12 12"
                      className="h-2 w-2"
                      aria-hidden
                    >
                      <path
                        d="M2.5 6.2 4.8 8.5 9.5 3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" />
                  ) : (
                    idx + 1
                  )}
                </span>
                {FINANCIERING_STATUS_LABEL_KORT[step]}
              </button>
            </li>
          );
        })}
      </ol>

      {pendingAfspraak ? (
        <div className="space-y-2 border border-[#FDBA74]/50 bg-[#FFF7ED] px-3 py-3">
          <p className="text-[12px] font-semibold text-ink">
            Wanneer is de Warmtefonds-afspraak?
          </p>
          <p className="text-[11px] text-muted">
            Alleen interne info — geen mail naar de klant.
          </p>
          <input
            type="datetime-local"
            value={afspraakLocal}
            onChange={(e) => setAfspraakLocal(e.target.value)}
            disabled={disabled}
            className="w-full border border-line bg-white px-2.5 py-2 text-sm text-ink outline-none focus:border-[#C45A12]"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled || !afspraakLocal}
              onClick={confirmAfspraak}
              className="bg-[#C45A12] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[#A84A0E] disabled:opacity-50"
            >
              Opslaan
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setPendingAfspraak(false)}
              className="px-3 py-1.5 text-[12px] font-semibold text-muted hover:bg-wash"
            >
              Annuleren
            </button>
          </div>
        </div>
      ) : null}

      {(aanbetalingInc != null || warmtefondsInc != null) && !isAfgewezen ? (
        <div className="space-y-1.5 border border-[#FDBA74]/40 bg-[#FFF7ED] px-3 py-2.5 text-[12px]">
          {aanbetalingInc != null ? (
            <p className="flex justify-between gap-2 text-muted">
              Aanbetaling (klant)
              <span className="tabular-nums font-medium text-ink">
                {formatEuro(aanbetalingInc)}
              </span>
            </p>
          ) : null}
          {warmtefondsInc != null ? (
            <p className="flex justify-between gap-2 text-muted">
              WF-aanvraag (max. {formatEuro(RESTANT_VAST_INC_BTW)})
              <span className="tabular-nums font-semibold text-[#C45A12]">
                {formatEuro(warmtefondsInc)}
              </span>
            </p>
          ) : null}
          {magWarmtefondsRestantFactuur(status) ? (
            <p className="pt-1 text-[11px] text-green-dark">
              {restantFactuurStatus === "verzonden" ||
              restantFactuurStatus === "betaald" ||
              restantFactuurStatus === "deels_betaald"
                ? `Restantfactuur ${restantFactuurStatus}.`
                : restantFactuurStatus === "concept"
                  ? "Restantfactuur staat klaar als concept — versturen via Financieel."
                  : "Goedgekeurd — restantfactuur mag nu aangemaakt/verstuurd worden."}
              {onOpenFinancieel ? (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={onOpenFinancieel}
                    className="font-semibold underline hover:no-underline"
                  >
                    Naar Financieel
                  </button>
                </>
              ) : null}
            </p>
          ) : (
            <p className="pt-1 text-[11px] text-muted">
              Restantfactuur pas versturen ná “Aanvraag goedgekeurd”.
            </p>
          )}
        </div>
      ) : null}

      {clickable ? (
        <div className="flex flex-wrap items-center gap-1 border-t border-line pt-2.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange?.("afgewezen")}
            className={[
              "px-2 py-1 text-[11px] font-semibold transition",
              isAfgewezen
                ? "bg-[#FDECEA] text-[#C62828]"
                : "text-muted hover:bg-wash hover:text-ink",
            ].join(" ")}
          >
            Afgewezen
          </button>
          {status ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                onChange?.(null, { warmtefonds_afspraak_at: null })
              }
              className="px-2 py-1 text-[11px] font-semibold text-muted hover:bg-wash hover:text-ink"
            >
              Reset
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
