"use client";

import { useState } from "react";
import type { Project } from "@/types/database";
import { PlanningAgenda } from "@/components/planning/PlanningAgenda";
import { ProjectenTable } from "./ProjectenTable";

export function BackofficePanel({ projecten }: { projecten: Project[] }) {
  const [view, setView] = useState<"orders" | "agenda">("orders");

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            {view === "agenda" ? "Agenda installateur" : "Backoffice"}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            {view === "agenda"
              ? "Schouwen en installaties — alleen inzage"
              : `${projecten.length} ${projecten.length === 1 ? "project" : "projecten"}`}
          </p>
        </div>
        <div className="flex rounded-full border border-line bg-white p-1 text-sm font-semibold">
          <button
            type="button"
            onClick={() => setView("orders")}
            className={[
              "rounded-full px-4 py-1.5",
              view === "orders"
                ? "bg-green text-white"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            Projecten
          </button>
          <button
            type="button"
            onClick={() => setView("agenda")}
            className={[
              "rounded-full px-4 py-1.5",
              view === "agenda"
                ? "bg-green text-white"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            Agenda
          </button>
        </div>
      </div>

      {view === "agenda" ? (
        <div className="px-5 pb-5">
          <PlanningAgenda
            orders={projecten}
            showPartner
            linkHref={(event) => `/projecten/${event.order.id}`}
          />
        </div>
      ) : (
        <ProjectenTable projecten={projecten} />
      )}
    </>
  );
}
