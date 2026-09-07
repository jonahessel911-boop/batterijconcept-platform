import { addDays } from "date-fns";
import type { ProjectAfdeling } from "@/lib/project-afdeling";
import { normalizeProjectStatus } from "@/lib/labels";

export type TaakStatus = "todo" | "doing" | "done";

export type AutoTaakDef = {
  autoKey: string;
  titel: string;
  afdeling: ProjectAfdeling;
  /** Dagen tot due vanaf nu */
  dueInDays: number;
};

/** Taken die open moeten staan bij deze projectstatus. */
export function autoTakenVoorStatus(status: string): AutoTaakDef[] {
  const s = normalizeProjectStatus(status);
  switch (s) {
    case "schouw_aanbetaling":
      return [
        {
          autoKey: "schouw_aanbetaling:schouwweek",
          titel: "Schouwweek inplannen",
          afdeling: "Planning",
          dueInDays: 1,
        },
        {
          autoKey: "schouw_aanbetaling:aanbetaling",
          titel: "Aanbetalingsfactuur versturen",
          afdeling: "Facturatie",
          dueInDays: 1,
        },
      ];
    case "aanbetaling_betaald":
      return [
        {
          autoKey: "aanbetaling_betaald:schouwdag",
          titel: "Schouwdag inplannen",
          afdeling: "Planning",
          dueInDays: 2,
        },
      ];
    case "schouw_in_afwachting":
      return [
        {
          autoKey: "schouw_in_afwachting:opvolgen",
          titel: "Schouw opvolgen / bevestigen",
          afdeling: "Planning",
          dueInDays: 3,
        },
      ];
    case "schouw_voltooid":
      return [
        {
          autoKey: "schouw_voltooid:restfactuur",
          titel: "Restfactuur opstellen en versturen",
          afdeling: "Facturatie",
          dueInDays: 2,
        },
      ];
    case "restfactuur_verstuurd":
      return [
        {
          autoKey: "restfactuur_verstuurd:betaling",
          titel: "Restfactuur betaling volgen",
          afdeling: "Facturatie",
          dueInDays: 7,
        },
      ];
    case "restfactuur_betaald":
      return [
        {
          autoKey: "restfactuur_betaald:materiaal",
          titel: "Materiaal inkopen",
          afdeling: "Installatie",
          dueInDays: 3,
        },
        {
          autoKey: "restfactuur_betaald:installatie",
          titel: "Installatie inplannen",
          afdeling: "Planning",
          dueInDays: 5,
        },
      ];
    case "materiaal_installatie":
      return [
        {
          autoKey: "materiaal_installatie:uitvoeren",
          titel: "Installatie uitvoeren / opvolgen",
          afdeling: "Installatie",
          dueInDays: 7,
        },
      ];
    case "installatie_voltooid":
    case "service":
      return [];
    default:
      return [];
  }
}

export function dueAtFromDays(days: number, from = new Date()): string {
  return addDays(from, days).toISOString();
}
