/**
 * Systeem SIN (AlphaESS) zoals gebruikt in Batterijconcept.
 *
 * Format uit AlphaESS / ons portaal:
 * - precies 15 tekens
 * - alleen letters + cijfers
 * - begint met AL (vaak ALD… of ALB…)
 * - voorbeeld-URL: https://portal.alphaess.com/b/ess/{SIN}/ess-site
 */
export const SYSTEEM_SIN_LENGTH = 15;

/** Genormaliseerd: spaties weg, uppercase. */
export function normalizeSysteemSin(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

/**
 * @returns foutmelding of null als geldig
 */
export function validateSysteemSin(
  raw: string | null | undefined
): string | null {
  const sin = normalizeSysteemSin(raw);
  if (!sin) return "SIN is verplicht";
  if (sin.length !== SYSTEEM_SIN_LENGTH) {
    return `SIN moet precies ${SYSTEEM_SIN_LENGTH} tekens zijn (nu ${sin.length})`;
  }
  if (!/^[A-Z0-9]+$/.test(sin)) {
    return "SIN mag alleen letters en cijfers bevatten";
  }
  if (!sin.startsWith("AL")) {
    return "SIN moet met AL beginnen (AlphaESS, bijv. ALD… of ALB…)";
  }
  return null;
}

export function isValidSysteemSin(raw: string | null | undefined): boolean {
  return validateSysteemSin(raw) === null;
}
