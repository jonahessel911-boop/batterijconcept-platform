import type { SollicitatieStatus } from "@/types/database";

export const SOLLICITATIE_STATUSES: SollicitatieStatus[] = [
  "nieuw",
  "gescreend",
  "gesprek",
  "aangenomen",
  "afgewezen",
];

export function parseSollicitatieStatus(
  value: unknown
): SollicitatieStatus {
  const raw =
    typeof value === "string" && value.trim() ? value.trim() : null;
  if (raw && SOLLICITATIE_STATUSES.includes(raw as SollicitatieStatus)) {
    return raw as SollicitatieStatus;
  }
  return "nieuw";
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
