import fs from "fs";
import path from "path";

export const PDF_COLORS = {
  green: [26, 138, 62] as [number, number, number],
  dark: [13, 92, 50] as [number, number, number],
  orange: [243, 112, 33] as [number, number, number],
  charcoal: [46, 51, 48] as [number, number, number],
  muted: [90, 99, 92] as [number, number, number],
  line: [210, 216, 212] as [number, number, number],
  wash: [244, 248, 245] as [number, number, number],
  grayRow: [242, 242, 242] as [number, number, number],
};

/** Bedrijfsgegevens voor PDF (env overschrijft defaults). */
export function companyInfo() {
  return {
    naam: process.env.COMPANY_NAME || "BatterijConcept",
    legal:
      process.env.COMPANY_LEGAL || "BatterijConcept",
    adres: process.env.COMPANY_ADDRESS || "Alfred Nobellaan 68",
    postcodePlaats: process.env.COMPANY_CITY || "3731DW De Bilt",
    land: process.env.COMPANY_COUNTRY || "Nederland",
    btw: process.env.COMPANY_BTW || "",
    kvk: process.env.COMPANY_KVK || "42141855",
    vestigingsnummer:
      process.env.COMPANY_VESTIGINGSNUMMER || "000066465834",
    iban: process.env.COMPANY_IBAN || "",
    email: process.env.COMPANY_EMAIL || "info@batterijconcept.nl",
    factuurEmail:
      process.env.COMPANY_INVOICE_EMAIL || "info@batterijconcept.nl",
    telefoon: process.env.COMPANY_PHONE || "085 800 1645",
    website: process.env.COMPANY_WEBSITE || "Batterijconcept.nl",
  };
}

export function loadPublicPngDataUrl(
  relativePath: string
): string | null {
  try {
    const full = path.join(process.cwd(), "public", relativePath);
    if (!fs.existsSync(full)) return null;
    const b64 = fs.readFileSync(full).toString("base64");
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}

export function loadLogoDataUrl(): string | null {
  return (
    loadPublicPngDataUrl("logo.png") ||
    loadPublicPngDataUrl("icon-512.png")
  );
}

/** Kies productfoto op basis van omschrijving / sku. */
export function productImageForLine(omschrijving: string): string | null {
  const t = omschrijving.toLowerCase();
  if (
    t.includes("install") ||
    t.includes("montage") ||
    t.includes("meterkast")
  ) {
    return loadPublicPngDataUrl("products/install.png");
  }
  if (
    t.includes("omvormer") ||
    t.includes("inverter") ||
    t.includes("smart-meter") ||
    t.includes("smart meter") ||
    t.includes("t10")
  ) {
    return loadPublicPngDataUrl("products/inverter.png");
  }
  if (
    t.includes("advies") ||
    t.includes("subsidie") ||
    t.includes("korting")
  ) {
    return loadPublicPngDataUrl("products/advies.png");
  }
  // Batterijen / Alpha ESS / default product
  if (
    t.includes("alpha") ||
    t.includes("batterij") ||
    t.includes("smile") ||
    t.includes("g3") ||
    t.includes("kwh")
  ) {
    return loadPublicPngDataUrl("products/battery.png");
  }
  return loadPublicPngDataUrl("products/battery.png");
}

export function formatEuroPdf(n: number): string {
  return (
    new Intl.NumberFormat("nl-NL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n) + " €"
  );
}
