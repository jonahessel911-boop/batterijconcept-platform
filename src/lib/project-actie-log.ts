import type { Offerte, Project } from "@/types/database";
import {
  belSchouwActieTitel,
  isBelSchouwActieOpen,
  isSchakelFinancieringActieOpen,
  isWarmtefondsSale,
} from "@/lib/backoffice-acties";
import { formatProjectSchouwWeek } from "@/lib/schouw-week";

export type ProjectActieLogItem = {
  key: string;
  titel: string;
  detail?: string;
  /** ISO timestamp wanneer voltooid; null = nog open */
  at: string | null;
  status: "open" | "done";
};

function warmtefondsVan(
  project: Project | null | undefined,
  offerte: Offerte | null | undefined
): boolean {
  return isWarmtefondsSale({
    leadStatus: project?.leads?.status,
    financieringVoorbehoud:
      offerte?.financiering_voorbehoud ??
      project?.offertes?.financiering_voorbehoud,
  });
}

/**
 * Chronologische actie-log (nieuwste eerst) voor een getekende offerte / project.
 * Gebaseerd op bestaande timestamps — geen aparte events-tabel.
 */
export function buildProjectActieLog(opts: {
  project?: Project | null;
  offerte?: Offerte | null;
}): ProjectActieLogItem[] {
  const { project, offerte } = opts;
  const items: ProjectActieLogItem[] = [];
  const warmtefonds = warmtefondsVan(project, offerte);

  if (offerte?.ondertekend_op) {
    items.push({
      key: "offerte-ondertekend",
      titel: "Offerte ondertekend",
      detail: [
        offerte.offerte_nummer,
        offerte.ondertekend_naam,
        warmtefonds ? "Warmtefonds" : "Eigen middelen",
      ]
        .filter(Boolean)
        .join(" · "),
      at: offerte.ondertekend_op,
      status: "done",
    });
  }

  const backofficeAt =
    offerte?.backoffice_afgerond_at || project?.backoffice_afgerond_at || null;
  if (offerte?.actie_required) {
    items.push({
      key: "backoffice-actie",
      titel: "Backoffice invullen",
      detail: "Actie nog open op de ondertekende offerte",
      at: null,
      status: "open",
    });
  } else if (backofficeAt || offerte?.status === "ondertekend") {
    items.push({
      key: "backoffice-actie",
      titel: "Backoffice-actie afgerond",
      detail: "Project mag naar backoffice",
      at: backofficeAt,
      status: "done",
    });
  }

  if (project) {
    items.push({
      key: "project-aangemaakt",
      titel: "Project in backoffice",
      detail: project.project_nummer,
      at: project.created_at,
      status: "done",
    });

    if (warmtefonds) {
      if (isSchakelFinancieringActieOpen(project)) {
        items.push({
          key: "schakel-financiering",
          titel: "Schakelen met financieringsman",
          detail: "Warmtefonds — nog open",
          at: null,
          status: "open",
        });
      } else if (project.financiering_geschakeld_at) {
        items.push({
          key: "schakel-financiering",
          titel: "Financieringsman geschakeld",
          detail: "Warmtefonds",
          at: project.financiering_geschakeld_at,
          status: "done",
        });
      }
    }

    if (isBelSchouwActieOpen(project)) {
      items.push({
        key: "bel-schouw",
        titel: belSchouwActieTitel(project),
        detail: warmtefonds
          ? "Schouwweek + aanbetaling — nog open"
          : "Schouw inplannen — nog open",
        at: null,
        status: "open",
      });
    } else if (project.bel_schouw_aanbetaling_at) {
      items.push({
        key: "bel-schouw",
        titel: "Klant gebeld voor schouw" + (warmtefonds ? " + aanbetaling" : ""),
        detail: formatProjectSchouwWeek(project) || undefined,
        at: project.bel_schouw_aanbetaling_at,
        status: "done",
      });
    }

    if (project.schouw_at || project.schouw_week) {
      items.push({
        key: "schouw-gepland",
        titel: "Schouwweek gepland",
        detail:
          formatProjectSchouwWeek(project) ||
          project.installatie_partners?.naam ||
          project.monteur ||
          undefined,
        at: project.schouw_at || project.bel_schouw_aanbetaling_at || project.created_at,
        status: "done",
      });
    }

    if (project.installatie_at) {
      items.push({
        key: "installatie-gepland",
        titel: "Installatie gepland",
        detail: project.installatie_partners?.naam || project.monteur || undefined,
        at: project.installatie_at,
        status: "done",
      });
    }

    if (project.opleverdatum) {
      items.push({
        key: "oplevering",
        titel: "Oplevering gepland",
        at: project.opleverdatum,
        status: "done",
      });
    }
  }

  return items.sort((a, b) => {
    // Open eerst, daarna nieuwste voltooid
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return tb - ta;
  });
}

export function openActieCount(items: ProjectActieLogItem[]): number {
  return items.filter((i) => i.status === "open").length;
}
