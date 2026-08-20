/** Herken sollicitatie-payloads die per ongeluk naar /api/webhook/leads gaan. */
export function looksLikeSollicitatie(body: Record<string, unknown>): boolean {
  const bron = String(body.bron || "")
    .trim()
    .toLowerCase();
  if (
    bron.includes("sollicit") ||
    bron.includes("werkenbij") ||
    bron.includes("vacature") ||
    bron.includes("cv")
  ) {
    return true;
  }

  const type = String(body.type || body.soort || "")
    .trim()
    .toLowerCase();
  if (type.includes("sollicit")) return true;

  if (body.cv != null || body.resume != null) return true;

  const naam = String(body.naam || body.name || "")
    .trim()
    .toLowerCase();
  if (naam.includes("sollicitant")) return true;

  return false;
}
