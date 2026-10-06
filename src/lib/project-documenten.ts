/** Vaste omschrijving voor schouwformulier-uploads (client + server). */
export const SCHOUW_FORMULIER_OMSCHRIJVING = "Schouw formulier";

/** Vaste omschrijving voor opleveringsrapport met klant-handtekening. */
export const OPLEVERINGSRAPPORT_OMSCHRIJVING = "Opleveringsrapport";

export function isSchouwFormulier(
  omschrijving: string | null | undefined
): boolean {
  return (
    (omschrijving || "").trim().toLowerCase() ===
    SCHOUW_FORMULIER_OMSCHRIJVING.toLowerCase()
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

/** Documenten die als PDF mogen (naast foto's). */
export function isProjectDocumentUpload(
  omschrijving: string | null | undefined
): boolean {
  return isSchouwFormulier(omschrijving) || isOpleveringsrapport(omschrijving);
}
