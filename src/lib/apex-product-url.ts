/**
 * Directe deep-links naar Apex Power Supplies (Shopify).
 * Bekende SKU’s → productpagina; anders zoek-URL zodat je snel in winkelwagen kan.
 */

const APEX_BASE = "https://apexpowersupplies.com";

/** Interne SKU / key → Shopify product handle. */
const APEX_HANDLES: Record<string, string> = {
  "smile-3g-baseplate": "alpha-ess-baseplate-g3-universal",
  "smile-g3-baseplate": "alpha-ess-baseplate-g3-universal",
  "smile-g3-s5-wall-bracket": "alpha-ess-smile-g3-s5-inverter-wall-bracket",
  "smile-g3-wall-bracket": "alpha-ess-smile-g3-s5-inverter-wall-bracket",
  "smile-g3-kabelset-9.3": "alphaess-koppelkabel-single-kolom-9-3-kwh-modules",
  "smile-g3-kabelset-9,3": "alphaess-koppelkabel-single-kolom-9-3-kwh-modules",
  "alpha-ess-dtsu-3ct-100a": "alpha-ess-meter-dtsu-3ct-100a",
  "meter-dtsu-3ct-100a": "alpha-ess-meter-dtsu-3ct-100a",
  "smile-g3-bat-9.3s": "alpha-ess-smile-g3-batterij-9-3s-ip65",
  "smile-g3-bat-9,3s": "alpha-ess-smile-g3-batterij-9-3s-ip65",
  "bb-plus": "alphaess-backup-box-bb-plus",
};

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Productpagina of zoekresultaat op Apex. */
export function apexProductUrl(
  sku?: string | null,
  naam?: string | null
): string {
  const skuKey = sku ? normalizeKey(sku) : "";
  if (skuKey && APEX_HANDLES[skuKey]) {
    return `${APEX_BASE}/products/${APEX_HANDLES[skuKey]}`;
  }
  const q = (sku || naam || "").trim();
  if (!q) return `${APEX_BASE}/collections/merk-alphaess`;
  return `${APEX_BASE}/search?q=${encodeURIComponent(q)}`;
}
