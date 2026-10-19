/**
 * Productfoto’s voor standaard Alpha ESS-accessoires (Apex).
 * Gebruikt in purchasing-popup en inkooplijst.
 */

export type InkoopProductImage = {
  key: string;
  sku: string;
  naam: string;
  imageSrc: string;
};

/** Standaard accessoires met foto + naam (zoals bij Apex besteld). */
export const INKOOP_PRODUCT_IMAGES: InkoopProductImage[] = [
  {
    key: "baseplate",
    sku: "smile-3g-baseplate",
    naam: "Alpha ESS Baseplate G3 Universal",
    imageSrc: "/inkoop/baseplate.png",
  },
  {
    key: "wallbracket",
    sku: "smile-g3-s5-wall-bracket",
    naam: "Alpha ESS Smile G3 S5 inverter wall bracket",
    imageSrc: "/inkoop/wallbracket.png",
  },
  {
    key: "meter-dtsu",
    sku: "alpha-ess-dtsu-3ct-100a",
    naam: "Alpha ESS Meter DTSU 3CT 100A",
    imageSrc: "/inkoop/meter-dtsu.png",
  },
  {
    key: "koppelkabel",
    sku: "smile-g3-kabelset-9.3",
    naam: "Koppelkabel",
    imageSrc: "/inkoop/koppelkabel.png",
  },
];

function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Match op SKU of naam → productfoto. */
export function inkoopProductImageFor(
  sku?: string | null,
  naam?: string | null
): InkoopProductImage | null {
  const skuKey = sku ? normalize(sku) : "";
  if (skuKey) {
    const bySku = INKOOP_PRODUCT_IMAGES.find(
      (p) => normalize(p.sku) === skuKey
    );
    if (bySku) return bySku;
  }
  const n = (naam || "").toLowerCase();
  if (!n) return null;
  if (/wall\s*bracket|wandbeugel|muurbeugel/.test(n)) {
    return INKOOP_PRODUCT_IMAGES.find((p) => p.key === "wallbracket") || null;
  }
  if (/baseplate|basisplaat/.test(n)) {
    return INKOOP_PRODUCT_IMAGES.find((p) => p.key === "baseplate") || null;
  }
  if (/dtsu|meter/.test(n)) {
    return INKOOP_PRODUCT_IMAGES.find((p) => p.key === "meter-dtsu") || null;
  }
  if (/koppelkabel|kabelset/.test(n)) {
    return INKOOP_PRODUCT_IMAGES.find((p) => p.key === "koppelkabel") || null;
  }
  return null;
}
