"use client";

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Adviseur, Afspraak, Factuur, Lead, Project } from "@/types/database";
import { openBackofficeActies } from "@/lib/backoffice-acties";
import { BackofficeActiesList } from "./BackofficeActiesList";
import { BackofficeTable } from "./BackofficeTable";
import { Planbord } from "./Planbord";

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

  const openActieCount = useMemo(
    () =>
      openBackofficeActies(projecten, facturen, new Date(), {
        leads,
        afspraken,
      }).length,
    [projecten, facturen, leads, afspraken]
  );

  function setView(next: BoView) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "projecten");
    params.set("bo", next);
    router.replace(`/?${params.toString()}`, { scroll: false });
  }

  const title =
    view === "agenda"
      ? "Planbord"
      : view === "acties"
        ? "Acties"
        : "Projecten";
  const sub =
    view === "agenda"
      ? "Schouw en installatie per week"
      : view === "acties"
        ? openActieCount > 0
          ? `${openActieCount} openstaande ${openActieCount === 1 ? "actie" : "acties"}`
          : "Herplannen, schouw, financiering en facturen"
        : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            {title}
          </h2>
          {sub ? <p className="mt-0.5 text-sm text-muted">{sub}</p> : null}
        </div>
        <div className="flex border border-line bg-white p-0.5 text-sm font-semibold">
          {(
            [
              ["orders", "Projecten"],
              ["acties", "Acties"],
              ["agenda", "Planbord"],
            ] as const
          ).map(([id, label]) => {
            const isActive = view === id;
            const showActieBadge = id === "acties" && openActieCount > 0;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                className={[
                  "inline-flex items-center gap-1.5 px-4 py-1.5",
                  isActive
                    ? "bg-green text-white"
                    : "text-muted hover:text-ink",
                ].join(" ")}
              >
                {label}
                {showActieBadge ? (
                  <span
                    className={[
                      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-[#C45A12] text-white",
                    ].join(" ")}
                    title={`${openActieCount} openstaande ${openActieCount === 1 ? "actie" : "acties"}`}
                  >
                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/25 text-[9px]">
                      I
                    </span>
                    <span className="tabular-nums">{openActieCount}</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {view === "orders" ? (
        <BackofficeTable
          projecten={projecten}
          adviseurs={adviseurs}
          facturen={facturen}
          leads={leads}
          afspraken={afspraken}
          onProjectUpdated={onProjectUpdated}
          hideTitle
        />
      ) : view === "agenda" ? (
        <div className="px-5 pb-5">
          <Planbord
            projecten={projecten}
            onProjectUpdated={onProjectUpdated}
          />
        </div>
      ) : (
        <BackofficeActiesList
          projecten={projecten}
          facturen={facturen}
          leads={leads}
          afspraken={afspraken}
          adviseurs={adviseurs}
          adviseurId={adviseurId}
          onProjectUpdated={onProjectUpdated}
          onFactuurUpdated={onFactuurUpdated}
          onLeadUpdated={onLeadUpdated}
        />
      )}
    </>
  );
}
