import type { SollicitatieStatus } from "@/types/database";

export const SOLLICITATIE_STATUSES: SollicitatieStatus[] = [
  "nieuw",
  "diskwalificatie",
  "gesprek_gepland",
  "aangenomen",
];

export const SOLLICITATIE_STATUS_LABEL: Record<SollicitatieStatus, string> = {
  nieuw: "Nieuw",
  diskwalificatie: "Diskwalificatie",
  gesprek_gepland: "Gesprek gepland",
  aangenomen: "Aangenomen",
};

/** Map legacy DB-waarden naar huidige kanban-status. */
export function normalizeSollicitatieStatus(
  value: string | null | undefined
): SollicitatieStatus {
  const raw = (value || "").trim();
  if (raw === "afgewezen") return "diskwalificatie";
  if (raw === "gesprek" || raw === "gescreend") return "gesprek_gepland";
  if (SOLLICITATIE_STATUSES.includes(raw as SollicitatieStatus)) {
    return raw as SollicitatieStatus;
  }
  return "nieuw";
}

export function parseSollicitatieStatus(value: unknown): SollicitatieStatus {
  if (typeof value !== "string" || !value.trim()) return "nieuw";
  return normalizeSollicitatieStatus(value);
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
