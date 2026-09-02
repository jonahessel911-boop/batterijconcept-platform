"use client";

import { useId } from "react";
import {
  AANBETALING_MODUS_OPTIES,
  aanbetalingVanOrder,
  parseEuroInput,
  type AanbetalingModus,
} from "@/lib/aanbetaling";
import { formatEuro } from "@/lib/format";

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
  if (!financieringVoorbehoud) {
    return (
      <p className="text-xs text-muted">
        Eigen middelen · order{" "}
        <span className="tabular-nums text-ink">{formatEuro(totaalIncBtw)}</span>
      </p>
    );
  }

  const opt = AANBETALING_MODUS_OPTIES.find((o) => o.value === modus);
  const preview = aanbetalingVanOrder({
    subtotaalExBtw,
    btwBedrag,
    totaalIncBtw,
    modus,
    handmatigIncBtw,
    financieringVoorbehoud: true,
  });

  return (
    <p className="text-xs text-muted">
      Warmtefonds · {opt?.label ?? modus} · restant{" "}
      <span className="tabular-nums text-ink">
        {formatEuro(preview.restantIncBtw)}
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
  const preview = aanbetalingVanOrder({
    subtotaalExBtw,
    btwBedrag,
    totaalIncBtw,
    modus,
    handmatigIncBtw: parseEuroInput(handmatig),
    financieringVoorbehoud: warmtefonds,
  });

  if (!warmtefonds) {
    return (
      <div className="space-y-3 border border-line bg-white px-3 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Betaalroute
          </p>
          <span className="rounded-md bg-wash px-2 py-0.5 text-[11px] font-semibold text-ink">
            Eigen middelen
          </span>
        </div>
        <p className="text-xs text-muted">
          Geen voorbehoud financiering Warmtefonds op deze offerte. De klant
          betaalt met eigen middelen — er is geen Warmtefonds-aanbetaling.
        </p>
        <div className="space-y-1 border-t border-line pt-3 text-sm">
          <p className="flex justify-between gap-3 text-muted">
            Orderbedrag incl. btw
            <span className="tabular-nums font-medium text-ink">
              {formatEuro(totaalIncBtw)}
            </span>
          </p>
          <p className="flex justify-between gap-3 text-muted">
            Aanbetaling Warmtefonds
            <span className="tabular-nums text-ink">{formatEuro(0)}</span>
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
        Aanbetaling = totaal incl. btw − Warmtefonds-deel.
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
          Aanbetaling
          <span className="tabular-nums text-ink">
            {formatEuro(preview.bedragIncBtw)}
          </span>
        </p>
        <p className="flex justify-between gap-3 text-muted">
          Restant (Warmtefonds)
          <span className="tabular-nums text-ink">
            {formatEuro(preview.restantIncBtw)}
          </span>
        </p>
      </div>
    </div>
  );
}
