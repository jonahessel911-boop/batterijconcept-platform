"use client";

import type { ProjectStatus } from "@/types/database";
import {
  normalizeProjectStatus,
  projectStatusLabel,
} from "@/lib/labels";
import {
  projectPipelineFor,
  type Betaalwijze,
} from "@/lib/project-status-config";

const COLS = 5;

/**
 * Monopoly-achtig statuspad: rijen naar beneden, oneven rijen omgekeerd
 * (heen → terug → heen), zodat labels leesbaar blijven.
 */
export function ProjectStatusPath({
  status,
  betaalwijze = "warmtefonds",
  onChange,
  disabled = false,
}: {
  status: string;
  betaalwijze?: Betaalwijze;
  onChange?: (status: ProjectStatus) => void;
  disabled?: boolean;
  /** @deprecated niet meer gebruikt — labels zijn altijd volledig */
  compact?: boolean;
}) {
  const pipeline = projectPipelineFor(betaalwijze);
  const current = normalizeProjectStatus(status);
  const isSideStatus =
    current === "service" ||
    current === "warmtefonds_afgewezen" ||
    current === "annulering" ||
    current === "hold_sales_actie";
  const currentIdx = isSideStatus ? -1 : pipeline.indexOf(current);

  const rows: ProjectStatus[][] = [];
  for (let i = 0; i < pipeline.length; i += COLS) {
    rows.push(pipeline.slice(i, i + COLS));
  }

  const clickable = Boolean(onChange) && !disabled;

  function cellClass(step: ProjectStatus, idx: number) {
    const active = idx === currentIdx;
    const done = currentIdx >= 0 && idx < currentIdx;
    return [
      "flex min-h-[3.25rem] w-full items-center justify-center rounded-md border px-1.5 py-2 text-center text-[11px] font-semibold leading-snug transition sm:px-2 sm:text-[12px]",
      clickable ? "cursor-pointer hover:brightness-95" : "cursor-default",
      active
        ? "border-[#0D9488] bg-[#0D9488] text-white shadow-sm"
        : done
          ? "border-[#5EEAD4] bg-[#CCFBF1] text-[#115E59]"
          : "border-line bg-[#F3F4F6] text-[#6B7280]",
    ].join(" ");
  }

  return (
    <div className="space-y-1" role="list" aria-label="Projectstatus">
      {rows.map((row, rowIdx) => {
        const rtl = rowIdx % 2 === 1;
        // L→R volgorde van cellen; bij RTL: pads links, stappen van rechts naar links
        const cells: (ProjectStatus | null)[] = [...row];
        while (cells.length < COLS) cells.push(null);
        const display = rtl ? [...cells].reverse() : cells;

        return (
          <div key={rowIdx}>
            {rowIdx > 0 ? (
              <div
                className={[
                  "flex px-1 py-0.5",
                  rtl ? "justify-end" : "justify-start",
                ].join(" ")}
                aria-hidden
              >
                {/* Pijl aan de kant waar de vorige rij eindigde */}
                <span className="text-sm font-bold leading-none text-[#0D9488]">
                  ↓
                </span>
              </div>
            ) : null}
            <div className="grid grid-cols-5 gap-1.5">
              {display.map((step, i) => {
                if (!step) {
                  return <div key={`empty-${rowIdx}-${i}`} aria-hidden />;
                }
                const idx = pipeline.indexOf(step);
                return (
                  <button
                    key={step}
                    type="button"
                    role="listitem"
                    disabled={!clickable || disabled}
                    title={projectStatusLabel[step]}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!onChange || disabled || step === current) return;
                      onChange(step);
                    }}
                    className={cellClass(step, idx)}
                  >
                    <span className="line-clamp-3">
                      {projectStatusLabel[step]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {isSideStatus ? (
        <p className="pt-2 text-xs text-muted">
          Huidige status (buiten hoofdpad):{" "}
          <span className="font-semibold text-ink">
            {projectStatusLabel[current]}
          </span>
        </p>
      ) : null}
    </div>
  );
}
