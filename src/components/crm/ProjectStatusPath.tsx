"use client";

import type { ProjectStatus } from "@/types/database";
import {
  normalizeProjectStatus,
  PROJECT_PIPELINE,
  projectStatusLabel,
} from "@/lib/labels";

/**
 * Salesforce-achtige status-chevrons. Klik = status wijzigen.
 */
export function ProjectStatusPath({
  status,
  onChange,
  disabled = false,
  compact = false,
}: {
  status: string;
  onChange?: (status: ProjectStatus) => void;
  disabled?: boolean;
  /** Kortere labels voor smalle layouts */
  compact?: boolean;
}) {
  const current = normalizeProjectStatus(status);
  const currentIdx = PROJECT_PIPELINE.indexOf(
    current === "service" ? "installatie_voltooid" : current
  );

  const shortLabel: Partial<Record<ProjectStatus, string>> = {
    schouw_aanbetaling: "Schouw + aanbetaling",
    aanbetaling_betaald: "Aanbetaling betaald",
    schouw_in_afwachting: "Schouw afwachting",
    schouw_voltooid: "Schouw voltooid",
    restfactuur_verstuurd: "Restfactuur",
    restfactuur_betaald: "Rest betaald",
    materiaal_installatie: "Materiaal + installatie",
    installatie_voltooid: "Installatie klaar",
  };

  return (
    <div
      className={[
        "flex w-full overflow-x-auto",
        compact ? "gap-0" : "gap-0",
      ].join(" ")}
      role="list"
      aria-label="Projectstatus"
    >
      {PROJECT_PIPELINE.map((step, idx) => {
        const active = idx === currentIdx;
        const done = currentIdx >= 0 && idx < currentIdx;
        const label = compact
          ? shortLabel[step] || projectStatusLabel[step]
          : projectStatusLabel[step];
        const clickable = Boolean(onChange) && !disabled;

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
            className={[
              "relative min-w-0 flex-1 px-2 py-2 text-center text-[10px] font-semibold leading-tight sm:px-3 sm:text-[11px]",
              compact ? "min-w-[5.5rem] py-1.5" : "min-w-[6.5rem] sm:min-w-0",
              clickable ? "cursor-pointer" : "cursor-default",
              active
                ? "bg-[#0D9488] text-white"
                : done
                  ? "bg-[#99F6E4] text-[#115E59]"
                  : "bg-[#E5E7EB] text-[#6B7280]",
              idx === 0 ? "rounded-l-md" : "",
              idx === PROJECT_PIPELINE.length - 1 ? "rounded-r-md" : "",
            ].join(" ")}
            style={{
              clipPath:
                idx === PROJECT_PIPELINE.length - 1
                  ? undefined
                  : "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)",
              marginRight: idx === PROJECT_PIPELINE.length - 1 ? 0 : "-8px",
              zIndex: PROJECT_PIPELINE.length - idx,
              paddingLeft: idx === 0 ? undefined : "14px",
              paddingRight:
                idx === PROJECT_PIPELINE.length - 1 ? undefined : "18px",
            }}
          >
            <span className="relative z-[1] line-clamp-2">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
