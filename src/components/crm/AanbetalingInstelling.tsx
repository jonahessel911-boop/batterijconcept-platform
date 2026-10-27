"use client";

import { useId } from "react";
import {
  AANBETALING_MODUS_OPTIES,
  EIGEN_MIDDELEN_AANBETALING_OPTIES,
  RESTANT_VAST_INC_BTW,
  aanbetalingVanOrder,
  eigenMiddelenUiKeuze,
  parseEuroInput,
  type AanbetalingModus,
} from "@/lib/aanbetaling";
import { formatEuro } from "@/lib/format";

const EIGEN_PCT_SHORTCUTS = [25, 50, 75, 100] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function AanbetalingSamenvatting({
  modus,
  handmatigIncBtw = 0,
  subtotaalExBtw,
  btwBedrag,
  totaalIncBtw,
  financieringVoorbehoud = true,
}: {
  modus: AanbetalingModus;
  handmatigIncBtw?: number;
  subtotaalExBtw: number;
  btwBedrag: number;
  totaalIncBtw: number;
  financieringVoorbehoud?: boolean;
}) {
  const preview = aanbetalingVanOrder({
    subtotaalExBtw,
    btwBedrag,
    totaalIncBtw,
    modus,
    handmatigIncBtw,
    financieringVoorbehoud,
  });

  if (!financieringVoorbehoud) {
    const keuze = eigenMiddelenUiKeuze(modus, handmatigIncBtw, totaalIncBtw);
    const label =
      keuze === "volledig"
        ? "100% vooraf"
        : keuze === "handmatig"
          ? "Custom aanbetaling"
          : "50% vooraf";
    return (
      <p className="text-xs text-muted">
        Eigen middelen · {label}{" "}
        <span className="tabular-nums text-ink">
          {formatEuro(preview.bedragIncBtw)}
        </span>
        {preview.restantIncBtw > 0.01 ? (
          <>
            {" · "}
            restant{" "}
            <span className="tabular-nums text-ink">
              {formatEuro(preview.restantIncBtw)}
            </span>
          </>
        ) : null}
      </p>
    );
  }

  const opt = AANBETALING_MODUS_OPTIES.find((o) => o.value === modus);
  return (
    <p className="text-xs text-muted">
      Warmtefonds · {opt?.label ?? modus} · aanbetaling{" "}
      <span className="tabular-nums text-ink">
        {formatEuro(preview.bedragIncBtw)}
      </span>
      {" · "}
      WF-aanvraag{" "}
      <span className="tabular-nums text-ink">
        {formatEuro(preview.warmtefondsIncBtw)}
      </span>
    </p>
  );
}

export function AanbetalingInstelling({
  modus,
  onModusChange,
  handmatig,
  onHandmatigChange,
  subtotaalExBtw,
  btwBedrag,
  totaalIncBtw,
  financieringVoorbehoud = true,
}: {
  modus: AanbetalingModus;
  onModusChange: (m: AanbetalingModus) => void;
  handmatig: string;
  onHandmatigChange: (v: string) => void;
  subtotaalExBtw: number;
  btwBedrag: number;
  totaalIncBtw: number;
  financieringVoorbehoud?: boolean;
}) {
  const name = useId();
  const warmtefonds = Boolean(financieringVoorbehoud);
  const handmatigNum = parseEuroInput(handmatig);
  const preview = aanbetalingVanOrder({
    subtotaalExBtw,
    btwBedrag,
    totaalIncBtw,
    modus,
    handmatigIncBtw: handmatigNum,
    financieringVoorbehoud: warmtefonds,
  });

  if (!warmtefonds) {
    const keuze = eigenMiddelenUiKeuze(modus, handmatigNum, totaalIncBtw);

    function pickEigen(next: "helft" | "volledig" | "handmatig") {
      if (next === "helft") {
        onModusChange("helft");
        return;
      }
      if (next === "volledig") {
        onModusChange("handmatig");
        onHandmatigChange(String(round2(totaalIncBtw)));
        return;
      }
      onModusChange("handmatig");
      if (
        !handmatig.trim() ||
        Math.abs(handmatigNum - totaalIncBtw) < 0.02 ||
        Math.abs(handmatigNum - round2(totaalIncBtw / 2)) < 0.02
      ) {
        onHandmatigChange(String(round2(totaalIncBtw * 0.25)));
      }
    }

    function setPct(pct: number) {
      onModusChange("handmatig");
      onHandmatigChange(String(round2((totaalIncBtw * pct) / 100)));
    }

    return (
      <div className="space-y-3 border border-line bg-white px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Betaalplan
          </p>
          <span className="rounded-md bg-wash px-2 py-0.5 text-[11px] font-semibold text-ink">
            Eigen middelen
          </span>
        </div>
        <p className="text-xs text-muted">
          Kies de eerste aanbetaling. Bij een meerfasenplan (bijv. 25% voor
          schouw, 25% na schouw) vul je hier die eerste termijn in en noteer je
          de rest bij backoffice-notitie.
        </p>
        <div className="space-y-2">
          {EIGEN_MIDDELEN_AANBETALING_OPTIES.map((opt) => (
            <label
              key={opt.value}
              className="flex items-start gap-3 text-sm text-ink"
            >
              <input
                type="radio"
                name={name}
                checked={keuze === opt.value}
                onChange={() => pickEigen(opt.value)}
                className="mt-1 accent-green"
              />
              <span>
                <span className="font-medium">{opt.label}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {opt.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
        {keuze === "handmatig" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {EIGEN_PCT_SHORTCUTS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => setPct(pct)}
                  className="border border-line bg-wash px-2.5 py-1 text-xs font-semibold text-ink hover:border-green/50 hover:bg-green-soft"
                >
                  {pct}%
                </button>
              ))}
            </div>
            <label className="block text-xs font-medium text-muted">
              Aanbetaling incl. btw
              <input
                type="text"
                inputMode="decimal"
                value={handmatig}
                onChange={(e) => {
                  onModusChange("handmatig");
                  onHandmatigChange(e.target.value);
                }}
                placeholder="Bijv. 2115,99"
                className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
              />
            </label>
          </div>
        )}
        <div className="space-y-1 border-t border-line pt-3 text-sm">
          <p className="flex justify-between gap-3 text-muted">
            Orderbedrag incl. btw
            <span className="tabular-nums font-medium text-ink">
              {formatEuro(totaalIncBtw)}
            </span>
          </p>
          <p className="flex justify-between gap-3 text-muted">
            Aanbetaling (vooraf)
            <span className="tabular-nums font-medium text-ink">
              {formatEuro(preview.bedragIncBtw)}
            </span>
          </p>
          <p className="flex justify-between gap-3 text-muted">
            Restant
            <span className="tabular-nums text-ink">
              {formatEuro(preview.restantIncBtw)}
            </span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 border border-line bg-white px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Aanbetaling Warmtefonds
        </p>
        <span className="rounded-md bg-green-soft px-2 py-0.5 text-[11px] font-semibold text-green-dark">
          Warmtefonds
        </span>
      </div>
      <p className="text-xs text-muted">
        Standaard betaalt de klant de BTW. Warmtefonds-aanvraag is max.{" "}
        {formatEuro(RESTANT_VAST_INC_BTW)}. Restantfactuur pas ná goedkeuring.
      </p>
      <div className="space-y-2">
        {AANBETALING_MODUS_OPTIES.map((opt) => (
          <label
            key={opt.value}
            className="flex items-start gap-3 text-sm text-ink"
          >
            <input
              type="radio"
              name={name}
              checked={modus === opt.value}
              onChange={() => onModusChange(opt.value)}
              className="mt-1 accent-green"
            />
            <span>
              <span className="font-medium">{opt.label}</span>
              <span className="mt-0.5 block text-xs text-muted">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {modus === "handmatig" && (
        <label className="block text-xs font-medium text-muted">
          Aanbetaling incl. btw
          <input
            type="text"
            inputMode="decimal"
            value={handmatig}
            onChange={(e) => onHandmatigChange(e.target.value)}
            placeholder="Bijv. 1887,85"
            className="mt-1 w-full border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-green"
          />
        </label>
      )}
      <div className="space-y-1 border-t border-line pt-3 text-sm">
        <p className="flex justify-between gap-3 text-muted">
          Aanbetaling (klant)
          <span className="tabular-nums text-ink">
            {formatEuro(preview.bedragIncBtw)}
          </span>
        </p>
        <p className="flex justify-between gap-3 text-muted">
          Warmtefonds-aanvraag (max. {formatEuro(RESTANT_VAST_INC_BTW)})
          <span className="tabular-nums font-medium text-ink">
            {formatEuro(preview.warmtefondsIncBtw)}
          </span>
        </p>
        {preview.overigNaWarmtefondsIncBtw > 0.01 ? (
          <p className="flex justify-between gap-3 text-[#C45A12]">
            Nog open na WF (niet via Warmtefonds)
            <span className="tabular-nums font-medium">
              {formatEuro(preview.overigNaWarmtefondsIncBtw)}
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
