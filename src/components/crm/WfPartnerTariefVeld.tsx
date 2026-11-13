"use client";

import {
  EDERGY_PER_AANVRAAG_EXCL,
  edergyBedragenVanExcl,
  edergyBedragenVanInc,
} from "@/lib/edergy-tarief";
import { formatEuro } from "@/lib/format";

type Props = {
  /** Eigen tarief incl. btw (DB). Null/leeg → standaard (€150 excl.). */
  value: number | null;
  /** Slaat incl. btw op (null = standaard). */
  onChange: (next: number | null) => void;
  /** Standaard excl. als er geen eigen bedrag staat. */
  standaardExcl?: number;
  className?: string;
};

/** Compacte prijs per WF-aanvraag — invoer excl. btw. */
export function WfPartnerTariefVeld({
  value,
  onChange,
  standaardExcl = EDERGY_PER_AANVRAAG_EXCL,
  className,
}: Props) {
  const eigen = value != null && Number.isFinite(value) && value > 0;
  const split = eigen
    ? edergyBedragenVanInc(Number(value))
    : edergyBedragenVanExcl(standaardExcl);
  const inputValue = String(split.perAanvraagExcl);

  return (
    <div
      className={["flex flex-wrap items-center gap-x-3 gap-y-1", className || ""]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="relative w-[7.5rem] shrink-0">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted">
          €
        </span>
        <input
          type="number"
          min={1}
          step={0.01}
          aria-label="Vergoeding excl. btw"
          value={inputValue}
          onChange={(e) => {
            const raw = e.target.value.replace(",", ".");
            if (!raw) {
              onChange(null);
              return;
            }
            const n = Number(raw);
            if (!Number.isFinite(n)) return;
            if (Math.abs(n - standaardExcl) < 0.005) {
              onChange(null);
              return;
            }
            const next = edergyBedragenVanExcl(Math.round(n * 100) / 100);
            onChange(next.perAanvraagInc);
          }}
          className="h-9 w-full border border-line bg-white py-1.5 pr-2 pl-7 text-sm font-semibold tabular-nums text-ink outline-none focus:border-green"
        />
      </div>
      <p className="min-w-0 text-[12px] text-muted">
        <span className="font-semibold tabular-nums text-ink">
          {formatEuro(split.perAanvraagExcl)} excl.
        </span>
        <span className="mx-1.5 text-line">·</span>
        btw {formatEuro(split.perAanvraagBtw)}
        <span className="mx-1.5 text-line">·</span>
        {formatEuro(split.perAanvraagInc)} incl.
        {eigen ? (
          <span className="font-medium text-green-dark"> · eigen</span>
        ) : (
          <span> · standaard</span>
        )}
      </p>
    </div>
  );
}
