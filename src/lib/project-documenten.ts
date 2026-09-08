/** Vaste omschrijving voor schouwformulier-uploads (client + server). */
export const SCHOUW_FORMULIER_OMSCHRIJVING = "Schouw formulier";

export function isSchouwFormulier(
  omschrijving: string | null | undefined
): boolean {
  return (
    (omschrijving || "").trim().toLowerCase() ===
    SCHOUW_FORMULIER_OMSCHRIJVING.toLowerCase()
  );
}
