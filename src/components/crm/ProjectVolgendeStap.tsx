"use client";

import type { Project, ProjectStatus } from "@/types/database";
import {
  resolveProjectVolgendeStap,
  type ProjectVolgendeStapInfo,
} from "@/lib/project-volgende-stap";

export function ProjectVolgendeStap({
  project,
  disabled,
  onStatusChange,
  onPlanSchouwdag,
}: {
  project: Project;
  disabled?: boolean;
  onStatusChange?: (status: ProjectStatus) => void;
  onPlanSchouwdag?: () => void;
}) {
  const stap = resolveProjectVolgendeStap(project);
  if (!stap) return null;

  return <VolgendeStapBanner stap={stap} disabled={disabled} onStatusChange={onStatusChange} onPlanSchouwdag={onPlanSchouwdag} />;
}

function VolgendeStapBanner({
  stap,
  disabled,
  onStatusChange,
  onPlanSchouwdag,
}: {
  stap: ProjectVolgendeStapInfo;
  disabled?: boolean;
  onStatusChange?: (status: ProjectStatus) => void;
  onPlanSchouwdag?: () => void;
}) {
  const tone = stap.overdue
    ? {
        border: "border-[#FDBA74]/70",
        bg: "bg-[#FFF7ED]",
        eyebrow: "text-[#C45A12]",
      }
    : stap.urgent
      ? {
          border: "border-[#0D9488]/30",
          bg: "bg-[#F0FDFA]",
          eyebrow: "text-[#0F766E]",
        }
      : {
          border: "border-line",
          bg: "bg-white",
          eyebrow: "text-muted",
        };

  function handleActie() {
    if (!stap.actie) return;
    if (stap.actie.kind === "status") {
      onStatusChange?.(stap.actie.status as ProjectStatus);
      return;
    }
    if (stap.actie.openSoort === "schouwdag") {
      onPlanSchouwdag?.();
    }
    const el = document.querySelector(stap.actie.href);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className={`border px-4 py-4 sm:px-5 ${tone.border} ${tone.bg}`}>
      <p
        className={`text-[10px] font-semibold uppercase tracking-[0.1em] ${tone.eyebrow}`}
      >
        {stap.eyebrow}
      </p>
      <p className="mt-1 text-[15px] font-semibold text-ink">{stap.titel}</p>

      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Waarom
          </dt>
          <dd className="mt-0.5 text-ink">{stap.reden}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
            Uiterlijk
          </dt>
          <dd
            className={[
              "mt-0.5 font-medium",
              stap.overdue ? "text-[#C45A12]" : "text-ink",
            ].join(" ")}
          >
            {stap.uiterlijkLabel}
          </dd>
        </div>
      </dl>

      {stap.actie ? (
        <button
          type="button"
          disabled={disabled}
          onClick={handleActie}
          className={[
            "mt-3 px-3.5 py-2 text-sm font-semibold disabled:opacity-60",
            stap.overdue
              ? "bg-[#C45A12] text-white hover:bg-[#A84A0E]"
              : stap.urgent
                ? "bg-[#0D9488] text-white hover:bg-[#0F766E]"
                : "border border-[#0D9488] bg-[#F0FDFA] text-[#115E59] hover:bg-[#CCFBF1]",
          ].join(" ")}
        >
          {stap.actie.label}
        </button>
      ) : null}
    </section>
  );
}
