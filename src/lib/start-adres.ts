/**
 * Startadres-helpers voor reistijd / Fast Direction.
 * NL én BE moeten bruikbaar zijn (sommige adviseurs vertrekken vanuit België).
 */

export type StartAdresLand = "NL" | "BE";

/**
 * Land voor geocoding/reistijd.
 * Let op: 4 cijfers zonder letters is ambigu (NL PC4 óf BE).
 * Bekende NL-plaatsen (Sluis, Axel, …) winnen van een losse “België”-suffix.
 */
const NL_GRENS_PLAATSEN =
  /\b(sluis|breskens|oostburg|cadzand|aalst|axel|terneuzen|hulst|sas van gent|koewacht|philippine|biervliet|ijsendoorn|middelburg|vlissingen|goes|yerseke)\b/i;

export function detectStartAdresLand(
  address: string | null | undefined
): StartAdresLand | null {
  const t = (address || "").trim();
  if (!t) return null;

  // NL-postcode met letters = altijd NL
  if (/\b\d{4}\s*[A-Za-z]{2}\b/.test(t)) return "NL";

  // Zeeuws-Vlaanderen / bekende NL-grensplaatsen: niet per ongeluk BE
  if (NL_GRENS_PLAATSEN.test(t)) return "NL";

  if (/\b(nederland|netherlands)\b/i.test(t) || /,\s*NL\s*$/i.test(t)) {
    return "NL";
  }
  if (/\b(belgi[eë]|belgium)\b/i.test(t) || /,\s*BE\s*$/i.test(t)) {
    return "BE";
  }
  return null;
}

/**
 * Bruikbaar voor geocoding/reistijd: straat + huisnummer + postcode/plaats.
 * "Sint Annastraat Sluis" zonder nummer → niet ok.
 */
export function isUsableStartAdres(
  address: string | null | undefined
): boolean {
  const t = (address || "").trim();
  if (!t || t === "—") return false;
  if (t.length < 8) return false;
  if (!/\d/.test(t)) return false; // huisnummer of postcode
  const parts = t.split(/[,\s]+/).filter(Boolean);
  return parts.length >= 3;
}

/** Land toevoegen / corrigeren (helpt Google Geocoding). */
export function ensureStartAdresCountry(
  address: string,
  land?: StartAdresLand | null
): string {
  const t = address.trim();
  if (!t) return t;
  const detected = land || detectStartAdresLand(t);
  // Verkeerde land-suffix corrigeren (bijv. Sluis + “België”)
  if (detected === "NL" && /\b(belgi[eë]|belgium)\b/i.test(t)) {
    return t
      .replace(/,?\s*(belgi[eë]|belgium)\s*$/i, "")
      .replace(/,?\s*BE\s*$/i, "")
      .trim()
      .concat(", Nederland");
  }
  if (detected === "BE" && /\b(nederland|netherlands)\b/i.test(t)) {
    return t
      .replace(/,?\s*(nederland|netherlands)\s*$/i, "")
      .replace(/,?\s*NL\s*$/i, "")
      .trim()
      .concat(", België");
  }
  if (/\b(nederland|netherlands|belgi[eë]|belgium)\b/i.test(t)) return t;
  if (/,\s*(NL|BE)\s*$/i.test(t)) return t;
  if (detected === "BE") return `${t}, België`;
  if (detected === "NL") return `${t}, Nederland`;
  return t;
}
