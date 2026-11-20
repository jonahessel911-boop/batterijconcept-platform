/**
 * Project-/hardwarekosten.
 * Defaults blijven beschikbaar; live cijfers komen uit producten (Inkoop-tab).
 */
import {
  DEFAULT_INSTALLATIE_STANDAARD,
  DEFAULT_BATTERIJ_PER_MODULE,
  DEFAULT_OMVORMER,
  inkoopKostenVoorRegels,
  type HardwareKosten as InkoopHardware,
  type OfferteInkoopRegel,
  type ProductInkoop,
} from "@/lib/inkoop";

/** @deprecated Gebruik inkoop_instellingen.installatie_standaard */
export const STANDAARD_INSTALLATIEKOSTEN = DEFAULT_INSTALLATIE_STANDAARD;

/** @deprecated Gebruik product.inkoop_* */
export const KOSTEN_ALPHA_ESS_93 = {
  batterij: DEFAULT_BATTERIJ_PER_MODULE,
  omvormer: DEFAULT_OMVORMER,
} as const;

export type HardwareKosten = {
  batterij: number;
  omvormer: number;
  totaal: number;
  aantal: number;
  aantalBatterijPakket: number;
  aantalWarmtepomp: number;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True voor Alpha ESS 9,3 kWh (S5 en T10). */
export function isAlphaEss93(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase().replace(/\s+/g, " ");
  const kwh = t.includes("9,3") || t.includes("9.3");
  const sku = t.includes("ae-g3-s5-9.3") || t.includes("ae-g3-t10-9.3");
  return sku || (t.includes("alpha ess") && kwh);
}

/**
 * Legacy fallback zonder productcatalogus.
 * Met producten: geef `producten` mee via `hardwareKostenVoorRegelsMetProducten`.
 */
export function hardwareKostenVoorRegels(
  regels: { omschrijving?: string | null; aantal?: number | null }[]
): HardwareKosten {
  let aantal = 0;
  for (const r of regels) {
    if (!isAlphaEss93(r.omschrijving)) continue;
    aantal += Math.max(0, Number(r.aantal) || 0);
  }
  const batterij = round2(aantal * KOSTEN_ALPHA_ESS_93.batterij);
  const omvormer = round2(aantal * KOSTEN_ALPHA_ESS_93.omvormer);
  return {
    batterij,
    omvormer,
    totaal: round2(batterij + omvormer),
    aantal,
    aantalBatterijPakket: aantal,
    aantalWarmtepomp: 0,
  };
}

/** Standaard installatie alleen bij batterijpakket; WP-only telt 0 tenzij projectkosten. */
export function pnlInstallatieVoorOrder(
  projectkosten: number | null | undefined,
  standaard: number,
  kosten: HardwareKosten
): number {
  if (Number(projectkosten) > 0) return Number(projectkosten);
  if (kosten.aantalBatterijPakket > 0) return standaard;
  return 0;
}

/** Inkoop uit productcatalogus (batterij + omvormer + warmtefonds). */
export function hardwareKostenVoorRegelsMetProducten(
  regels: OfferteInkoopRegel[],
  producten: ProductInkoop[]
): HardwareKosten {
  if (!producten.length) return hardwareKostenVoorRegels(regels);
  const k: InkoopHardware = inkoopKostenVoorRegels(regels, producten, {
    includeWarmtefonds: true,
  });
  if (k.aantal === 0) return hardwareKostenVoorRegels(regels);
  return {
    batterij: k.batterij,
    omvormer: round2(k.omvormer + k.warmtefonds),
    totaal: k.hardware,
    aantal: k.aantal,
    aantalBatterijPakket: k.aantalBatterijPakket,
    aantalWarmtepomp: k.aantalWarmtepomp,
  };
}
