/**
 * Inkoopprijzen — defaults + berekening.
 * Bron van waarheid na migratie: tabel producten + inkoop_instellingen.
 */
export const DEFAULT_INSTALLATIE_STANDAARD = 675;
export const DEFAULT_WARMTEFONDS_AANVRAAG = 175;
export const DEFAULT_BATTERIJ_PER_MODULE = 1499.73;
export const DEFAULT_OMVORMER = 1089.62;
export const MODULE_KWH = 9.3;

/** Standaard G3-accessoires (ex. btw). */
export const DEFAULT_BASEPLATE_EX_BTW = 60;
export const DEFAULT_KOPPELKABEL_EX_BTW = 29.45;

export type InkoopInstellingen = {
  installatie_standaard: number;
  warmtefonds_aanvraag: number;
};

export type ProductInkoop = {
  id: string;
  sku: string | null;
  naam: string;
  omschrijving: string | null;
  prijs_ex_btw: number;
  btw_percentage: number;
  eenheid: string;
  actief: boolean;
  inkoop_batterij: number;
  inkoop_omvormer: number;
  inkoop_installatie: number;
  inkoop_warmtefonds: number;
};

export type HardwareKosten = {
  batterij: number;
  omvormer: number;
  installatie: number;
  warmtefonds: number;
  totaal: number;
  /** batterij + omvormer (+ warmtefonds indien meegenomen) */
  hardware: number;
  aantal: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function modulesVoorSku(sku: string | null | undefined): number {
  if (!sku) return 1;
  const m = sku.match(/(\d+(?:[.,]\d+)?)\s*$/);
  if (!m) return 1;
  const kwh = Number(m[1].replace(",", "."));
  if (!Number.isFinite(kwh) || kwh <= 0) return 1;
  return Math.max(1, Math.round(kwh / MODULE_KWH));
}

/** Standaard inkoopregels voor Alpha ESS-SKU’s. */
export function defaultInkoopVoorSku(sku: string | null | undefined): {
  inkoop_batterij: number;
  inkoop_omvormer: number;
  inkoop_installatie: number;
  inkoop_warmtefonds: number;
} {
  const modules = modulesVoorSku(sku);
  return {
    inkoop_batterij: round2(modules * DEFAULT_BATTERIJ_PER_MODULE),
    inkoop_omvormer: DEFAULT_OMVORMER,
    inkoop_installatie: DEFAULT_INSTALLATIE_STANDAARD,
    inkoop_warmtefonds: DEFAULT_WARMTEFONDS_AANVRAAG,
  };
}

export function productInkoopTotaal(p: {
  inkoop_batterij?: number | null;
  inkoop_omvormer?: number | null;
  inkoop_installatie?: number | null;
  inkoop_warmtefonds?: number | null;
}): number {
  return round2(
    Number(p.inkoop_batterij || 0) +
      Number(p.inkoop_omvormer || 0) +
      Number(p.inkoop_installatie || 0) +
      Number(p.inkoop_warmtefonds || 0)
  );
}

export function productMarge(p: {
  prijs_ex_btw: number;
  inkoop_batterij?: number | null;
  inkoop_omvormer?: number | null;
  inkoop_installatie?: number | null;
  inkoop_warmtefonds?: number | null;
}): { inkoop: number; marge: number; margePct: number } {
  const inkoop = productInkoopTotaal(p);
  const prijs = Number(p.prijs_ex_btw) || 0;
  const marge = round2(prijs - inkoop);
  return {
    inkoop,
    marge,
    margePct: prijs > 0 ? round2((marge / prijs) * 100) : 0,
  };
}

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Match offerte-regel op product (sku in tekst of naam). */
export function findProductForRegel(
  omschrijving: string | null | undefined,
  producten: ProductInkoop[]
): ProductInkoop | null {
  if (!omschrijving?.trim() || producten.length === 0) return null;
  const t = normalizeText(omschrijving);

  for (const p of producten) {
    if (p.sku && t.includes(normalizeText(p.sku))) return p;
  }
  for (const p of producten) {
    const naam = normalizeText(p.naam);
    if (naam && t.includes(naam)) return p;
  }
  // Alpha ESS 9,3 fallback op eerste 9.3 product
  if (
    (t.includes("9,3") || t.includes("9.3")) &&
    (t.includes("alpha") || t.includes("ae-g3"))
  ) {
    return (
      producten.find((p) => p.sku?.includes("9.3") || p.sku?.includes("9,3")) ||
      null
    );
  }
  return null;
}

/**
 * Hardware/inkoop voor offertregels.
 * includeWarmtefonds: true telt warmtefonds-aanvraag mee in hardware-totaal.
 */
export function inkoopKostenVoorRegels(
  regels: { omschrijving?: string | null; aantal?: number | null }[],
  producten: ProductInkoop[],
  opts?: { includeWarmtefonds?: boolean }
): HardwareKosten {
  const includeWf = opts?.includeWarmtefonds !== false;
  let batterij = 0;
  let omvormer = 0;
  let installatie = 0;
  let warmtefonds = 0;
  let aantal = 0;

  for (const r of regels) {
    const n = Math.max(0, Number(r.aantal) || 0);
    if (n <= 0) continue;
    const product = findProductForRegel(r.omschrijving, producten);
    if (!product) continue;
    // Skip zero-price adviesregels etc.
    if (
      !product.inkoop_batterij &&
      !product.inkoop_omvormer &&
      !product.inkoop_installatie &&
      !product.inkoop_warmtefonds
    ) {
      continue;
    }
    aantal += n;
    batterij += n * Number(product.inkoop_batterij || 0);
    omvormer += n * Number(product.inkoop_omvormer || 0);
    installatie += n * Number(product.inkoop_installatie || 0);
    warmtefonds += n * Number(product.inkoop_warmtefonds || 0);
  }

  batterij = round2(batterij);
  omvormer = round2(omvormer);
  installatie = round2(installatie);
  warmtefonds = round2(warmtefonds);
  const hardware = round2(
    batterij + omvormer + (includeWf ? warmtefonds : 0)
  );
  return {
    batterij,
    omvormer,
    installatie,
    warmtefonds,
    hardware,
    totaal: round2(hardware + installatie + (includeWf ? 0 : warmtefonds)),
    aantal,
  };
}
