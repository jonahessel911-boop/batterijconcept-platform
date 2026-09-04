"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Factuur, Project } from "@/types/database";
import { openBackofficeActies } from "@/lib/backoffice-acties";
import { PlanningAgenda } from "@/components/planning/PlanningAgenda";
import { ProjectKanban } from "./ProjectKanban";
import { BackofficeActiesList } from "./BackofficeActiesList";

export type BoView = "acties" | "orders" | "agenda";

export function parseBoView(raw: string | null | undefined): BoView {
  if (raw === "orders" || raw === "agenda" || raw === "acties") return raw;
  return "orders";
}

export function backofficeHref(view: BoView = "acties"): string {
  return `/?tab=projecten&bo=${view}`;
}

export function BackofficePanel({
  projecten,
  facturen = [],
  onProjectUpdated,
  onFactuurUpdated,
}: {
  projecten: Project[];
  facturen?: Factuur[];
  onProjectUpdated?: (project: Project) => void;
  onFactuurUpdated?: (factuur: Factuur) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = parseBoView(searchParams.get("bo"));
  const actieCount = useMemo(
    () => openBackofficeActies(projecten, facturen).length,
    [projecten, facturen]
  );

  function setView(next: BoView) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "projecten");
    params.set("bo", next);
    router.replace(`/?${params.toString()}`, { scroll: false });
  }

  const title =
    view === "agenda"
      ? "Agenda installateur"
      : view === "acties"
        ? "Acties"
        : "Backoffice";

  const subtitle =
    view === "agenda"
      ? "Schouw en installatie in één agenda"
      : view === "acties"
        ? actieCount === 0
          ? "Geen openstaande acties"
          : `${actieCount} openstaande ${actieCount === 1 ? "actie" : "acties"}`
        : `${projecten.length} ${projecten.length === 1 ? "project" : "projecten"} · sleep tussen kolommen`;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{subtitle}</p>
        </div>
        <div className="flex flex-wrap rounded-full border border-line bg-white p-1 text-sm font-semibold">
          {(
            [
              { id: "acties", label: "Acties", count: actieCount },
              { id: "orders", label: "Kanban", count: projecten.length },
              { id: "agenda", label: "Agenda" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setView(tab.id)}
              className={[
                "rounded-full px-4 py-1.5",
                view === tab.id
                  ? "bg-green text-white"
                  : "text-muted hover:text-ink",
              ].join(" ")}
            >
              {tab.label}
              {"count" in tab && typeof tab.count === "number" ? (
                <span
                  className={[
                    "ml-1.5 inline-flex min-w-[1.25rem] items-center justify-center px-1 text-[10px] tabular-nums",
                    view === tab.id
                      ? "bg-white/20 text-white"
                      : "bg-[#eef1ef] text-muted",
                  ].join(" ")}
                >
                  {tab.count}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {view === "agenda" ? (
        <div className="px-5 pb-5">
          <PlanningAgenda
            orders={projecten}
            showPartner
            linkHref={(event) => `/projecten/${event.order.id}?from=agenda`}
          />
        </div>
      ) : view === "acties" ? (
        <BackofficeActiesList
          projecten={projecten}
          facturen={facturen}
          onProjectUpdated={onProjectUpdated}
          onFactuurUpdated={onFactuurUpdated}
        />
      ) : (
        <ProjectKanban
          projecten={projecten}
          onProjectUpdated={onProjectUpdated}
        />
      )}
    </>
  );
}
