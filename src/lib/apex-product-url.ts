/**
 * Directe deep-links naar Apex Power Supplies (Shopify).
 * Bekende SKU’s → productpagina; anders zoek-URL zodat je snel in winkelwagen kan.
 */

const APEX_BASE = "https://apexpowersupplies.com";

/** Interne SKU / key → Shopify product handle. */
const APEX_HANDLES: Record<string, string> = {
  // Accessoires
  "smile-3g-baseplate": "alphaess-base-plate-voor-3-8-4-5-9-3-kwh",
  "smile-g3-baseplate": "alphaess-base-plate-voor-3-8-4-5-9-3-kwh",
  "smile-g3-s5-wall-bracket": "alpha-ess-smile-g3-s5-inverter-wall-bracket",
  "smile-g3-wall-bracket": "alpha-ess-smile-g3-s5-inverter-wall-bracket",
  "smile-g3-kabelset-9.3": "alphaess-koppelkabel-single-kolom-9-3-kwh-modules",
  "smile-g3-kabelset-9,3": "alphaess-koppelkabel-single-kolom-9-3-kwh-modules",
  "alpha-ess-dtsu-3ct-100a": "alphaess-dtsu-3ct100a-slimme-meter",
  "meter-dtsu-3ct-100a": "alphaess-dtsu-3ct100a-slimme-meter",
  // Losse hardware
  "smile-g3-bat-9.3s": "alphaess-bat-9-3-kwh",
  "smile-g3-bat-9,3s": "alphaess-bat-9-3-kwh",
  "smile-g3-s5-inv": "alphaess-smile-g3-5kw-omvormer-1-fase",
  "smile-g3-t10-inv": "alphaess-smile-g3-10-kw-omvormer-3-fase",
  "bb-plus": "alphaess-backup-box-bb-plus",
};

const HANDLE_BAT = "alphaess-bat-9-3-kwh";
const HANDLE_OMV_S5 = "alphaess-smile-g3-5kw-omvormer-1-fase";
const HANDLE_OMV_T10 = "alphaess-smile-g3-10-kw-omvormer-3-fase";

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

function productUrl(handle: string): string {
  return `${APEX_BASE}/products/${handle}`;
}

/**
 * Pakket-SKU’s (AE-G3-S5-9.3 / AE-G3-T10-18.6) → juiste Apex-pagina
 * op basis van of de purchasing-regel batterij of omvormer is.
 */
function handleFromPackageSku(
  skuKey: string,
  naam: string
): string | null {
  const isS5 = /ae-g3-s5|g3-s5|smile-g3-s5/.test(skuKey);
  const isT10 = /ae-g3-t10|g3-t10|smile-g3-t10/.test(skuKey);
  if (!isS5 && !isT10) return null;

  const n = naam.toLowerCase();
  if (/omvormer|inverter/.test(n)) {
    return isT10 ? HANDLE_OMV_T10 : HANDLE_OMV_S5;
  }
  if (/batter|bat\b|kwh/.test(n)) {
    return HANDLE_BAT;
  }
  // Pakket zonder subtype → omvormer-pagina (meest herkenbaar)
  return isT10 ? HANDLE_OMV_T10 : HANDLE_OMV_S5;
}

/** Heuristiek op productnaam als SKU niet gemapt is. */
function handleFromNaam(naam: string): string | null {
  const n = naam.toLowerCase();
  if (/baseplate|base\s*plate|basisplaat/.test(n)) {
    return "alphaess-base-plate-voor-3-8-4-5-9-3-kwh";
  }
  if (/koppelkabel|kabelset/.test(n)) {
    return "alphaess-koppelkabel-single-kolom-9-3-kwh-modules";
  }
  if (/dtsu|slimme\s*meter|meter\s*dtsu/.test(n)) {
    return "alphaess-dtsu-3ct100a-slimme-meter";
  }
  if (
    /omvormer|inverter/.test(n) &&
    (/10\s*kw|t10|3[\s-]*fase|drie[\s-]*fase/.test(n) ||
      /3-fase/.test(n))
  ) {
    return HANDLE_OMV_T10;
  }
  if (
    /omvormer|inverter/.test(n) &&
    (/5\s*kw|s5|1[\s-]*fase|een[\s-]*fase/.test(n) || /1-fase/.test(n))
  ) {
    return HANDLE_OMV_S5;
  }
  if (/batter|bat\b|9[.,]3/.test(n) && !/omvormer|inverter|kabel|meter/.test(n)) {
    return HANDLE_BAT;
  }
  return null;
}

/** Productpagina of zoekresultaat op Apex. */
export function apexProductUrl(
  sku?: string | null,
  naam?: string | null
): string {
  const skuKey = sku ? normalizeKey(sku) : "";
  const label = (naam || "").trim();

  if (skuKey && APEX_HANDLES[skuKey]) {
    return productUrl(APEX_HANDLES[skuKey]);
  }

  const fromPackage = skuKey ? handleFromPackageSku(skuKey, label) : null;
  if (fromPackage) return productUrl(fromPackage);

  const fromNaam = label ? handleFromNaam(label) : null;
  if (fromNaam) return productUrl(fromNaam);

  const q = (sku || naam || "").trim();
  if (!q) return `${APEX_BASE}/collections/merk-alphaess`;
  return `${APEX_BASE}/search?q=${encodeURIComponent(q)}`;
}
