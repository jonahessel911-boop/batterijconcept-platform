/**
 * TC Swiss-warmtepompen per adviseur.
 * Sku begint met WP:{adviseurId}: zodat ze alleen in dat account in de offerte staan.
 * Thuisbatterijen (sku zonder dat voorvoegsel) blijven voor iedereen.
 *
 * Adviesprijzen zo gezet dat bruto €-marge ≈ 9,3 kWh-batterij (~€4.942 excl.),
 * naast de vaste opslag WARMTEPOMP_OPSLAAG_INCL.
 */

export const WARMTEPOMP_MERK = "TC Swiss";
export const WARMTEPOMP_OPSLAAG_INCL = 1500;
/** Doel-brutomarge excl. btw — gelijk aan Alpha ESS 9,3 pakket. */
export const WARMTEPOMP_DOEL_MARGE_EXCL = 4942.15;

export type WarmtepompCatalogusItem = {
  code: string;
  naam: string;
  /** Inkoop excl. btw */
  inkoopExcl: number;
  /** Adviesverkoopprijs incl. btw, vóór de opslag */
  adviesIncl: number;
};

export const WARMTEPOMP_CATALOGUS: WarmtepompCatalogusItem[] = [
  {
    code: "TC-GT08-FE",
    naam: "TC Swiss Full electric GT08 – 8 kW",
    inkoopExcl: 8275,
    adviesIncl: 14493,
  },
  {
    code: "TC-GT14-FE",
    naam: "TC Swiss Full electric GT14 – 14 kW",
    inkoopExcl: 9350,
    adviesIncl: 15794,
  },
  {
    code: "TC-GT08-FER",
    naam: "TC Swiss Full electric ready GT08 – 8 kW",
    inkoopExcl: 7150,
    adviesIncl: 13132,
  },
  {
    code: "TC-GT14-FER",
    naam: "TC Swiss Full electric ready GT14 – 12 kW",
    inkoopExcl: 8350,
    adviesIncl: 14584,
  },
  {
    code: "TC-GT08-CAS",
    naam: "TC Swiss GT08 cascade",
    inkoopExcl: 3500,
    adviesIncl: 8715,
  },
  {
    code: "TC-GT14-CAS",
    naam: "TC Swiss GT14 cascade",
    inkoopExcl: 4500,
    adviesIncl: 9925,
  },
];

export function warmtepompSku(adviseurId: string, code: string): string {
  return `WP:${adviseurId}:${code}`;
}

export function warmtepompSkusVoorAdviseur(adviseurId: string): string[] {
  return WARMTEPOMP_CATALOGUS.map((item) => warmtepompSku(adviseurId, item.code));
}

/** Verkoop excl. btw: adviesprijs + €1.500, beide incl. btw, daarna terugrekenen. */
export function warmtepompVerkoopExcl(adviesIncl: number): number {
  const incl = adviesIncl + WARMTEPOMP_OPSLAAG_INCL;
  return Math.round((incl / 1.21) * 100) / 100;
}

/** Incl. btw zoals de offerte die uitrekent (soms 1 cent naast een rond bedrag). */
export function warmtepompVerkoopIncl(adviesIncl: number): number {
  const ex = warmtepompVerkoopExcl(adviesIncl);
  return Math.round(ex * 121) / 100;
}

/** Gedeelde catalogus blijft zichtbaar. WP-sku alleen voor die adviseur. */
export function productZichtbaarVoorAdviseur(
  product: { sku?: string | null },
  adviseurId: string | null | undefined
): boolean {
  const sku = product.sku || "";
  if (!sku.startsWith("WP:")) return true;
  if (!adviseurId) return false;
  return sku.startsWith(`WP:${adviseurId}:`);
}
