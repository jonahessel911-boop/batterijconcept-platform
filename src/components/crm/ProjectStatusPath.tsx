"use client";

import type { ProjectStatus } from "@/types/database";
import {
  normalizeProjectStatus,
  projectStatusLabel,
} from "@/lib/labels";
import {
  PROJECT_STATUS_BY_KEY,
  PROJECT_STATUS_FASE_LABEL,
  projectPipelineFor,
  toOperationalStatus,
  type Betaalwijze,
  type ProjectStatusFase,
  type ProjectStatusKey,
} from "@/lib/project-status-config";

type FaseGroup = {
  fase: ProjectStatusFase;
  steps: ProjectStatusKey[];
};

function groupByFase(pipeline: ProjectStatusKey[]): FaseGroup[] {
  const groups: FaseGroup[] = [];
  for (const step of pipeline) {
    const fase = PROJECT_STATUS_BY_KEY[step]?.fase ?? "overig";
    const last = groups[groups.length - 1];
    if (last && last.fase === fase) {
      last.steps.push(step);
    } else {
      groups.push({ fase, steps: [step] });
    }
  }
  return groups;
}

/**
 * Operationeel statuspad — gegroepeerd per fase.
 * Warmtefonds-financiering zit hier niet in (aparte track).
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
  compact?: boolean;
}) {
  const pipeline = projectPipelineFor(betaalwijze);
  const raw = normalizeProjectStatus(status);
  const isSideStatus =
    raw === "service" ||
    raw === "annulering" ||
    raw === "hold_sales_actie";
  const current = isSideStatus ? raw : toOperationalStatus(raw);
  const currentIdx = isSideStatus ? -1 : pipeline.indexOf(current);
  const groups = groupByFase(pipeline);
  const clickable = Boolean(onChange) && !disabled;
  const progressPct =
    pipeline.length > 0 && currentIdx >= 0
      ? Math.round(((currentIdx + 1) / pipeline.length) * 100)
      : 0;

  return (
    <div className="space-y-3" aria-label="Orderstatus">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
            Orderstatus
          </p>
          <p className="mt-0.5 truncate text-[15px] font-semibold text-ink">
            {projectStatusLabel[current] || current}
          </p>
        </div>
        {!isSideStatus && currentIdx >= 0 ? (
          <p className="shrink-0 text-[11px] tabular-nums text-muted">
            {currentIdx + 1}/{pipeline.length}
          </p>
        ) : null}
      </div>

      {!isSideStatus ? (
        <div
          className="h-1 overflow-hidden rounded-full bg-[#E8EBE9]"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-[#0D9488] transition-[width] duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      ) : (
        <div className="bg-[#FDECEA] px-3 py-2 text-sm text-[#C62828]">
          Buiten hoofdpad:{" "}
          <span className="font-semibold">
            {projectStatusLabel[raw]}
          </span>
        </div>
      )}

      <div className="space-y-3">
        {groups.map((group) => {
          const groupIndices = group.steps.map((s) => pipeline.indexOf(s));
          const groupActive = groupIndices.includes(currentIdx);
          const groupDone =
            currentIdx >= 0 && Math.max(...groupIndices) < currentIdx;
          // Ingeklapt: afgeronde fases als één regel
          if (groupDone && !groupActive) {
            return (
              <div
                key={group.fase}
                className="flex items-center gap-2 text-[12px] text-[#0F766E]"
              >
                <span
                  className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0D9488] text-white"
                  aria-hidden
                >
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5">
                    <path
                      d="M2.5 6.2 4.8 8.5 9.5 3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <span className="font-medium">
                  {PROJECT_STATUS_FASE_LABEL[group.fase]}
                </span>
              </div>
            );
          }

          return (
            <div key={group.fase}>
              <p
                className={[
                  "mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
                  groupActive ? "text-[#0F766E]" : "text-muted",
                ].join(" ")}
              >
                {PROJECT_STATUS_FASE_LABEL[group.fase]}
              </p>
              <ol className="space-y-0.5">
                {group.steps.map((step) => {
                  const idx = pipeline.indexOf(step);
                  const active = idx === currentIdx;
                  const done = currentIdx >= 0 && idx < currentIdx;

                  return (
                    <li key={step}>
                      <button
                        type="button"
                        disabled={!clickable}
                        aria-current={active ? "step" : undefined}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!onChange || disabled || step === current)
                            return;
                          onChange(step);
                        }}
                        className={[
                          "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] transition",
                          clickable ? "hover:bg-wash cursor-pointer" : "cursor-default",
                          active
                            ? "bg-[#CCFBF1]/80 font-semibold text-[#115E59]"
                            : done
                              ? "font-medium text-ink"
                              : "text-muted",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2",
                            active
                              ? "border-[#0D9488] bg-[#0D9488]"
                              : done
                                ? "border-[#0D9488] bg-[#0D9488]"
                                : "border-[#C5CBC7] bg-white",
                          ].join(" ")}
                        >
                          {done && !active ? (
                            <svg
                              viewBox="0 0 12 12"
                              className="h-2 w-2 text-white"
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
                          ) : null}
                        </span>
                        {projectStatusLabel[step]}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}
