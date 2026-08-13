/** Haal een leesbare foutmelding uit Error / Postgrest / unknown */
export function errMessage(e: unknown, fallback = "Er ging iets mis"): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; error?: unknown; details?: unknown };
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.error === "string" && o.error) return o.error;
    if (typeof o.details === "string" && o.details) return o.details;
  }
  return fallback;
}
