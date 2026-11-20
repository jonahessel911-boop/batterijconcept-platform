/** Vaste omschrijving voor schouwformulier-uploads (client + server). */
export const SCHOUW_FORMULIER_OMSCHRIJVING = "Schouw formulier";

/** Verplichte foto bij schouw. */
export const FOTO_METERKAST_OMSCHRIJVING = "Foto meterkast";

/** Vaste omschrijving voor opleveringsrapport (formulier + handtekening monteur). */
export const OPLEVERINGSRAPPORT_OMSCHRIJVING = "Opleveringsrapport";

/** Verplichte foto bij oplevering. */
export const FOTO_BATTERIJ_OMSCHRIJVING = "Foto batterij";

/** Verplichte video bij oplevering (30s–60s). */
export const VIDEO_INSTALLATIE_OMSCHRIJVING = "Video installatie";

/** Optionele foto’s bij service-afspraak (niet verplicht). */
export const SERVICE_FOTO_OMSCHRIJVING = "Service foto";

export function isServiceFoto(
  omschrijving: string | null | undefined
): boolean {
  return (
    (omschrijving || "").trim().toLowerCase() ===
    SERVICE_FOTO_OMSCHRIJVING.toLowerCase()
  );
}

function compactLabel(value: string | null | undefined): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./]+/g, "");
}

export function isSchouwFormulier(
  omschrijving: string | null | undefined
): boolean {
  const raw = (omschrijving || "").trim().toLowerCase();
  if (!raw) return false;
  const compact = compactLabel(raw);
  if (
    compact === "schouwformulier" ||
    compact.startsWith("schouwformulier")
  ) {
    return true;
  }
  return raw.includes("schouw") && raw.includes("formulier");
}

/** Bewijs dat de schouw is gedaan: vast label, of schouw-PDF/rapport. */
export function isSchouwFormulierBewijs(
  omschrijving?: string | null,
  bestandsnaam?: string | null,
  storagePath?: string | null
): boolean {
  if (isSchouwFormulier(omschrijving)) return true;
  const blob = [omschrijving, bestandsnaam, storagePath]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!blob.includes("schouw")) return false;
  return (
    /\.pdf\b/.test(blob) ||
    blob.includes("formulier") ||
    blob.includes("rapport")
  );
}

export function isOpleveringsrapport(
  omschrijving: string | null | undefined
): boolean {
  return (
    (omschrijving || "").trim().toLowerCase() ===
    OPLEVERINGSRAPPORT_OMSCHRIJVING.toLowerCase()
  );
}

/** Bewijs dat het opleverformulier is ingevuld: vast label, of oplever-PDF. */
export function isOpleveringsrapportBewijs(
  omschrijving?: string | null,
  bestandsnaam?: string | null,
  storagePath?: string | null
): boolean {
  if (isOpleveringsrapport(omschrijving)) return true;
  const blob = [omschrijving, bestandsnaam, storagePath]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!blob) return false;
  const compact = compactLabel(blob);
  if (
    compact.includes("opleveringsrapport") ||
    compact.includes("opleverformulier")
  ) {
    return true;
  }
  if (!blob.includes("oplever")) return false;
  return (
    blob.includes("formulier") ||
    blob.includes("rapport") ||
    /\.pdf\b/.test(blob)
  );
}

export function isFotoMeterkast(
  omschrijving: string | null | undefined
): boolean {
  return (
    (omschrijving || "").trim().toLowerCase() ===
    FOTO_METERKAST_OMSCHRIJVING.toLowerCase()
  );
}

export function isFotoBatterij(
  omschrijving: string | null | undefined
): boolean {
  return (
    (omschrijving || "").trim().toLowerCase() ===
    FOTO_BATTERIJ_OMSCHRIJVING.toLowerCase()
  );
}

export function isVideoInstallatie(
  omschrijving: string | null | undefined
): boolean {
  return (
    (omschrijving || "").trim().toLowerCase() ===
    VIDEO_INSTALLATIE_OMSCHRIJVING.toLowerCase()
  );
}

/** Documenten die als PDF mogen (naast foto's). */
export function isProjectDocumentUpload(
  omschrijving: string | null | undefined
): boolean {
  return isSchouwFormulier(omschrijving) || isOpleveringsrapport(omschrijving);
}
