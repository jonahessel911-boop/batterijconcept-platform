"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { Adviseur, Afspraak, Factuur, Lead, Project } from "@/types/database";
import { PlanningAgenda } from "@/components/planning/PlanningAgenda";
import { BackofficeActiesList } from "./BackofficeActiesList";
import { BackofficeTable } from "./BackofficeTable";

export type BoView = "orders" | "agenda" | "acties";

export function parseBoView(raw: string | null | undefined): BoView {
  if (raw === "agenda") return "agenda";
  if (raw === "acties") return "acties";
  return "orders";
}

export function backofficeHref(view: BoView = "orders"): string {
  const bo =
    view === "agenda" ? "agenda" : view === "acties" ? "acties" : "orders";
  return `/?tab=projecten&bo=${bo}`;
}

export function BackofficePanel({
  projecten,
  adviseurs = [],
  facturen = [],
  leads = [],
  afspraken = [],
  adviseurId = null,
  onProjectUpdated,
  onFactuurUpdated,
  onLeadUpdated,
}: {
  projecten: Project[];
  adviseurs?: Adviseur[];
  facturen?: Factuur[];
  leads?: Lead[];
  afspraken?: Afspraak[];
  adviseurId?: string | null;
  onProjectUpdated?: (project: Project) => void;
  onFactuurUpdated?: (factuur: Factuur) => void;
  onLeadUpdated?: (id: string, patch: Partial<Lead>) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = parseBoView(searchParams.get("bo"));

  function setView(next: BoView) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "projecten");
    params.set("bo", next);
    router.replace(`/?${params.toString()}`, { scroll: false });
  }

  const title =
    view === "agenda"
      ? "Agenda"
      : view === "acties"
        ? "Acties"
        : "Projecten";
  const sub =
    view === "agenda"
      ? "Schouw en installatie"
      : view === "acties"
        ? "Herplannen, schouw, financiering en facturen"
        : `${projecten.length} projecten in de backoffice`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-muted">{sub}</p>
        </div>
        <div className="flex border border-line bg-white p-0.5 text-sm font-semibold">
          <button
            type="button"
            onClick={() => setView("orders")}
            className={[
              "px-4 py-1.5",
              view === "orders"
                ? "bg-green text-white"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            Projecten
          </button>
          <button
            type="button"
            onClick={() => setView("acties")}
            className={[
              "px-4 py-1.5",
              view === "acties"
                ? "bg-green text-white"
                : "text-muted hover:text-ink",
            ].join(" ")}
          >
            Acties
          </button>
          <button
            type="button"
            onClick={() => setView("agenda")}
            className={[
              "px-4 py-1.5",
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
            linkHref={(event) => `/projecten/${event.order.id}?from=agenda`}
            onOrderUpdated={onProjectUpdated}
          />
        </div>
      ) : view === "acties" ? (
        <BackofficeActiesList
          projecten={projecten}
          facturen={facturen}
          leads={leads}
          afspraken={afspraken}
          adviseurId={adviseurId}
          onProjectUpdated={onProjectUpdated}
          onFactuurUpdated={onFactuurUpdated}
          onLeadUpdated={onLeadUpdated}
        />
      ) : (
        <BackofficeTable
          projecten={projecten}
          adviseurs={adviseurs}
          onProjectUpdated={onProjectUpdated}
        />
      )}
    </>
  );
}
