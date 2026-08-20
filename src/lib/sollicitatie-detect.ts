/** Herken sollicitatie-payloads die per ongeluk naar /api/webhook/leads gaan. */
export function looksLikeSollicitatie(body: Record<string, unknown>): boolean {
  const bron = String(body.bron || body.source || "")
    .trim()
    .toLowerCase();
  if (
    bron.includes("sollicit") ||
    bron.includes("werkenbij") ||
    bron.includes("vacature") ||
    bron.includes("cv") ||
    bron.includes("instroom")
  ) {
    return true;
  }

  const type = String(body.type || body.soort || "")
    .trim()
    .toLowerCase();
  if (type.includes("sollicit")) return true;

  if (
    body.cv != null ||
    body.resume != null ||
    body.bestand != null ||
    body.attachment != null ||
    body.file_url != null ||
    body.cv_url != null ||
    body.file_base64 != null
  ) {
    return true;
  }

  // Expliciet cv/resume File-veld (niet elke willekeurige upload)
  for (const key of ["cv", "resume", "bestand", "attachment"]) {
    const value = body[key];
    if (
      typeof File !== "undefined" &&
      value instanceof File &&
      value.size > 0
    ) {
      return true;
    }
  }

  const naam = String(body.naam || body.name || "")
    .trim()
    .toLowerCase();
  if (naam.includes("sollicitant")) return true;

  const notitie = String(
    body.notitie || body.notes || body.message || body.opmerking || ""
  ).toLowerCase();
  if (
    notitie.includes("sollicitatie") ||
    notitie.includes("vacature") ||
    notitie.includes("werkenbij")
  ) {
    return true;
  }

  return false;
}
