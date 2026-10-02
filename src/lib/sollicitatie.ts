import type { SollicitatieStatus } from "@/types/database";

export const SOLLICITATIE_STATUSES: SollicitatieStatus[] = [
  "nieuw",
  "geen_contact",
  "diskwalificatie",
  "gesprek_gepland",
  "gesprek_gehad",
  "aangenomen_training_gepland",
  "aangenomen_actief",
];

export const SOLLICITATIE_STATUS_LABEL: Record<SollicitatieStatus, string> = {
  nieuw: "Nieuw",
  geen_contact: "Geen contact",
  diskwalificatie: "Diskwalificatie",
  gesprek_gepland: "Gesprek gepland",
  gesprek_gehad: "Gesprek gehad - in beoordeling",
  aangenomen_training_gepland: "Aangenomen - training gepland",
  aangenomen_actief: "Aangenomen - actief",
};

/** Status waarvoor notitie + vervolgtaak verplicht zijn. */
export const SOLLICITATIE_STATUS_MET_VERVOLG: SollicitatieStatus =
  "gesprek_gehad";

/** Status waarbij een trainingmoment verplicht is. */
export const SOLLICITATIE_STATUS_MET_TRAINING: SollicitatieStatus =
  "aangenomen_training_gepland";

/** Locatie + bel-info voor bevestigingsmail sollicitatiegesprek. */
export const RECRUITMENT_GESPREK_LOCATIE = "Daltonlaan 500, 3584 BK Utrecht";
export const RECRUITMENT_GESPREK_TEL = "+31 6 12 20 45 25";
export const RECRUITMENT_GESPREK_CONTACT = "Huub";

/** Standaard trainingslocatie (zelfde kantoor). */
export const RECRUITMENT_TRAINING_LOCATIE = RECRUITMENT_GESPREK_LOCATIE;
/** Map legacy DB-waarden naar huidige kanban-status. */
export function normalizeSollicitatieStatus(
  value: string | null | undefined
): SollicitatieStatus {
  const raw = (value || "").trim();
  if (raw === "afgewezen") return "diskwalificatie";
  if (raw === "gesprek" || raw === "gescreend") return "gesprek_gepland";
  if (raw === "gesprek_gehad_in_beoordeling") return "gesprek_gehad";
  // Oude "Aangenomen" → training gepland
  if (raw === "aangenomen") return "aangenomen_training_gepland";
  if (SOLLICITATIE_STATUSES.includes(raw as SollicitatieStatus)) {
    return raw as SollicitatieStatus;
  }
  return "nieuw";
}

export function parseSollicitatieStatus(value: unknown): SollicitatieStatus {
  if (typeof value !== "string" || !value.trim()) return "nieuw";
  return normalizeSollicitatieStatus(value);
}

/**
 * Bij plannen van een gesprek: alleen promoveren vanuit vroege stages,
 * niet terugzetten vanuit beoordeling / aangenomen.
 */
export function canAutoPromoteToGesprekGepland(
  status: SollicitatieStatus
): boolean {
  return (
    status === "nieuw" ||
    status === "geen_contact" ||
    status === "gesprek_gepland"
  );
}

/** FormData/JSON payload zonder File-objecten (voor jsonb). */
export function sanitizeSollicitatiePayload(
  body: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      out[key] = value;
    } else if (typeof File !== "undefined" && value instanceof File) {
      out[key] = {
        name: value.name,
        size: value.size,
        type: value.type,
      };
    }
  }
  return out;
}
