"use client";

import type { Adviseur, Afspraak, Factuur, Lead, Project } from "@/types/database";
import { type BoView, backofficeHref, parseBoView } from "@/lib/bo-view";
import { useBoViewStore } from "@/lib/bo-view-store";
import { BackofficeActiesList } from "./BackofficeActiesList";
import { BackofficeTable } from "./BackofficeTable";
import { Planbord } from "./Planbord";
import { SchouwweekList } from "./SchouwweekList";
import { ServiceVerzoekenPanel } from "./ServiceVerzoekenPanel";
import { ToekomstigeTakenPanel } from "./ToekomstigeTakenPanel";
import { AiPanel } from "./AiPanel";

export type { BoView };
export { parseBoView, backofficeHref };

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
  const [view] = useBoViewStore();

  if (view === "orders") {
    return (
      <div className="pt-1">
        <BackofficeTable
          projecten={projecten}
          adviseurs={adviseurs}
          facturen={facturen}
          leads={leads}
          afspraken={afspraken}
          onProjectUpdated={onProjectUpdated}
          hideTitle
        />
      </div>
    );
  }

  if (view === "agenda") {
    return (
      <div className="px-5 pb-5 pt-5">
        <Planbord projecten={projecten} onProjectUpdated={onProjectUpdated} />
      </div>
    );
  }

  if (view === "schouwweek") {
    return <SchouwweekList projecten={projecten} />;
  }

  if (view === "service") {
    return (
      <div className="px-5 pb-5 pt-5">
        <ServiceVerzoekenPanel />
      </div>
    );
  }

  if (view === "taken") {
    return (
      <div className="px-5 pb-5 pt-5">
        <ToekomstigeTakenPanel />
      </div>
    );
  }

  if (view === "ai") {
    return <AiPanel />;
  }

  return (
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
  );
}
