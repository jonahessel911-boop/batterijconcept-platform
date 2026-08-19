/** Standaard installatiekosten per project (excl. btw). */
export const STANDAARD_INSTALLATIEKOSTEN = 675;

/** Inkoop Alpha ESS 9,3 kWh (excl. btw). */
export const KOSTEN_ALPHA_ESS_93 = {
  batterij: 1499.73,
  omvormer: 1089.62,
} as const;

export type HardwareKosten = {
  batterij: number;
  omvormer: number;
  totaal: number;
  aantal: number;
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
  };
}
