import type { OfferteRegel } from "@/types/database";
import { MODULE_KWH } from "@/lib/inkoop";

const INSTALLATIE_OMSCHRIJVING = "Installatie + installatieopname";
const WARMTEFONDS_OMSCHRIJVING = "Warmtefonds aanvraag service";

function hasOmschrijving(
  regels: { omschrijving: string }[],
  pattern: RegExp
): boolean {
  return regels.some((r) => pattern.test(r.omschrijving));
}

function normalizeOmschrijving(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

export const EXTRA_METERKAST_SKU = "EXTRA-METERKAST";
export const EXTRA_NOODSTROOM_SKU = "EXTRA-NOODSTROOM";
export const EXTRA_METERKAST_NAAM = "Meterkast vervangen";
export const EXTRA_NOODSTROOM_NAAM = "Noodstroom";

/** Extra’s die intern meetellen, maar niet op de klantofferte (PDF/tekenen). */
export function isVerborgenOfferteProduct(p: {
  sku?: string | null;
  naam?: string | null;
}): boolean {
  const sku = (p.sku || "").trim().toUpperCase();
  if (sku === EXTRA_METERKAST_SKU || sku === EXTRA_NOODSTROOM_SKU) return true;
  const n = normalizeOmschrijving(p.naam || "").trim();
  return n === "meterkast vervangen" || n === "noodstroom";
}

export function isVerborgenOfferteRegel(r: {
  omschrijving?: string | null;
}): boolean {
  const o = normalizeOmschrijving(r.omschrijving || "").trim();
  if (o === "meterkast vervangen" || o.startsWith("meterkast vervangen ")) {
    return true;
  }
  if (o === "noodstroom" || o.startsWith("noodstroom ")) return true;
  if (o === "korting meterkast vervangen" || o.startsWith("korting meterkast")) {
    return true;
  }
  if (o === "korting noodstroom" || o.startsWith("korting noodstroom")) {
    return true;
  }
  return false;
}

export function extraKortingOmschrijving(productNaam: string): string {
  return `Korting ${productNaam}`;
}

/** Zichtbare kortingsregel (niet verborgen in productprijzen). */
export function isKortingRegel(r: {
  omschrijving: string;
  prijs_ex_btw?: number | null;
}): boolean {
  const o = normalizeOmschrijving(r.omschrijving || "").trim();
  return o === "korting" || o.startsWith("korting ");
}

/** Korting incl. btw (negatief bedrag, of 0). */
export function kortingIncVanRegels(
  regels: {
    omschrijving: string;
    aantal: number;
    prijs_ex_btw: number;
    btw_percentage?: number | null;
    totaal_ex_btw?: number | null;
  }[]
): number {
  let inc = 0;
  for (const r of regels) {
    if (!isKortingRegel(r)) continue;
    const lineEx =
      Number(r.totaal_ex_btw ?? Number(r.aantal) * Number(r.prijs_ex_btw)) || 0;
    const pct = Number(r.btw_percentage ?? 21) || 21;
    inc += lineEx * (1 + pct / 100);
  }
  const rounded = Math.round(inc * 100) / 100;
  return rounded < 0 ? rounded : 0;
}

/** Korting op de klantofferte: geen meterkast/noodstroom-korting. */
export function zichtbareKortingIncVanRegels(
  regels: Parameters<typeof kortingIncVanRegels>[0]
): number {
  return kortingIncVanRegels(regels.filter((r) => !isVerborgenOfferteRegel(r)));
}

type RegelBedrag = {
  omschrijving?: string | null;
  aantal: number;
  prijs_ex_btw: number;
  btw_percentage?: number | null;
  totaal_ex_btw?: number | null;
};

function regelExBtw(r: RegelBedrag): number {
  return (
    Number(r.totaal_ex_btw ?? Number(r.aantal) * Number(r.prijs_ex_btw)) || 0
  );
}

/** Netto extra’s (meterkast/noodstroom ± korting) die niet op de klantofferte horen. */
export function verborgenExtraNetto(
  regels: RegelBedrag[]
): { ex: number; inc: number } {
  let ex = 0;
  let inc = 0;
  for (const r of regels) {
    if (!isVerborgenOfferteRegel(r)) continue;
    const lineEx = regelExBtw(r);
    const pct = Number(r.btw_percentage ?? 21) || 21;
    ex += lineEx;
    inc += lineEx * (1 + pct / 100);
  }
  return {
    ex: Math.round(ex * 100) / 100,
    inc: Math.round(inc * 100) / 100,
  };
}

export function zichtbareOfferteTotalen(offerte: {
  subtotaal_ex_btw: number;
  btw_bedrag: number;
  totaal_inc_btw: number;
}, regels: RegelBedrag[]) {
  const hidden = verborgenExtraNetto(regels);
  const subtotaalEx = Math.round((Number(offerte.subtotaal_ex_btw) - hidden.ex) * 100) / 100;
  const totaalInc = Math.round((Number(offerte.totaal_inc_btw) - hidden.inc) * 100) / 100;
  const btw = Math.round((totaalInc - subtotaalEx) * 100) / 100;
  return { subtotaalEx, btw, totaalInc };
}

/** Alpha ESS 9,3 of 18,6 kWh (S5/T10). */
export function isAlphaEssMetOmvormerRegel(
  text: string | null | undefined
): boolean {
  if (!text) return false;
  const t = normalizeOmschrijving(text);
  if (!t.includes("alpha ess")) return false;
  const kwh93 = t.includes("9,3") || t.includes("9.3");
  const kwh186 = t.includes("18,6") || t.includes("18.6");
  return kwh93 || kwh186;
}

/** Label voor omvormerregel op basis van pakketnaam. */
export function omvormerOmschrijvingVoor(
  text: string | null | undefined
): string | null {
  if (!isAlphaEssMetOmvormerRegel(text)) return null;
  const t = text || "";
  if (/g3\s*t10/i.test(t)) return "10 kW omvormer";
  if (/g3\s*s5/i.test(t)) return "5 kW omvormer";
  return "Omvormer";
}

function virtualRegel(
  omschrijving: string,
  sortOrder: number
): OfferteRegel {
  return {
    id: `virtual-${sortOrder}-${omschrijving.slice(0, 12)}`,
    offerte_id: "",
    product_id: null,
    omschrijving,
    aantal: 1,
    prijs_ex_btw: 0,
    btw_percentage: 21,
    totaal_ex_btw: 0,
    sort_order: sortOrder,
  };
}

/**
 * Vult ontbrekende standaardregels aan voor weergave/PDF
 * (omvormer bij 9,3/18,6 kWh + installatie + Warmtefonds).
 * Kortingsregels worden weggelaten — die horen onder de prijs als − €.
 */
export function offerteRegelsVoorWeergave(
  regels: OfferteRegel[],
  opts: { financieringVoorbehoud?: boolean | null } = {}
): OfferteRegel[] {
  const sorted = [...regels]
    .filter((r) => !isKortingRegel(r) && !isVerborgenOfferteRegel(r))
    .sort((a, b) => a.sort_order - b.sort_order);
  const out: OfferteRegel[] = [];
  const maxSort = sorted.reduce((m, r) => Math.max(m, r.sort_order), 0);
  let next = maxSort + 1;

  const alreadyHasOmvormer = hasOmschrijving(sorted, /omvormer/i);
  let omvormerToegevoegd = false;

  for (const r of sorted) {
    out.push(r);
    if (alreadyHasOmvormer || omvormerToegevoegd) continue;
    const label = omvormerOmschrijvingVoor(r.omschrijving);
    if (!label) continue;
    out.push(virtualRegel(label, next++));
    // Zelfde aantal als batterijpakket
    out[out.length - 1].aantal = Math.max(1, Number(r.aantal) || 1);
    omvormerToegevoegd = true;
  }

  const hasPaidProduct = out.some((r) => Number(r.prijs_ex_btw) > 0);
  if (
    hasPaidProduct &&
    !hasOmschrijving(out, /installatie\s*\+\s*installatieopname/i)
  ) {
    out.push(virtualRegel(INSTALLATIE_OMSCHRIJVING, next++));
  }

  if (
    opts.financieringVoorbehoud &&
    !hasOmschrijving(out, /warmtefonds\s+aanvraag/i)
  ) {
    out.push(virtualRegel(WARMTEFONDS_OMSCHRIJVING, next++));
  }

  return out;
}

export { INSTALLATIE_OMSCHRIJVING, WARMTEFONDS_OMSCHRIJVING };

function isServiceOfAdministratieRegel(omschrijving: string): boolean {
  const o = normalizeOmschrijving(omschrijving).trim();
  if (!o) return true;
  if (o.includes("warmtefonds")) return true;
  if (o.includes("btw subsidie")) return true;
  if (/installatie\s*\+\s*installatieopname/.test(o)) return true;
  return false;
}

/** Productregels die de monteur nodig heeft (batterij, extra’s, omvormer). */
export function isInstallatieProductRegel(r: {
  omschrijving?: string | null;
  prijs_ex_btw?: number | null;
}): boolean {
  const raw = r.omschrijving || "";
  if (isKortingRegel({ omschrijving: raw })) return false;
  if (isServiceOfAdministratieRegel(raw)) return false;
  const o = normalizeOmschrijving(raw).trim();
  if (o === "meterkast vervangen" || o.startsWith("meterkast vervangen ")) {
    return true;
  }
  if (o === "noodstroom" || o.startsWith("noodstroom ")) return true;
  if (o.includes("meterkast")) return true;
  if (o.includes("omvormer")) return true;
  if (o.includes("alpha ess") || /\d+(?:[.,]\d+)?\s*kwh/.test(o)) return true;
  if (Number(r.prijs_ex_btw) > 0) return true;
  return false;
}

function kwhUitOmschrijving(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*kwh/i);
  if (!m) return null;
  const kwh = Number(m[1].replace(",", "."));
  return Number.isFinite(kwh) && kwh > 0 ? kwh : null;
}

/** 18,6 kWh = 2 modules van 9,3; 27,9 = 3, enz. */
export function batterijModulesVanOmschrijving(text: string): number {
  const kwh = kwhUitOmschrijving(text);
  if (kwh == null) return 1;
  return Math.max(1, Math.round(kwh / MODULE_KWH));
}

function isAlphaEssPakketRegel(omschrijving: string): boolean {
  const o = normalizeOmschrijving(omschrijving);
  if (!o.includes("alpha ess") && !o.includes("ae-g3") && !/\bsmile\b/.test(o)) {
    return false;
  }
  return kwhUitOmschrijving(omschrijving) != null || o.includes("kwh");
}

function isLosseOmvormerRegel(omschrijving: string): boolean {
  const o = normalizeOmschrijving(omschrijving);
  return (
    /\bomvormer\b/.test(o) &&
    !o.includes("alpha ess") &&
    !o.includes("kwh")
  );
}

export function installatieProductRegelsVoorMonteur(
  regels: {
    omschrijving?: string | null;
    aantal?: number | null;
    prijs_ex_btw?: number | null;
    sort_order?: number | null;
  }[]
): { omschrijving: string; aantal: number }[] {
  const sorted = [...regels].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  const producten = sorted.filter(isInstallatieProductRegel);
  const extras: { omschrijving: string; aantal: number }[] = [];
  let modules = 0;
  let omvormer: string | null = null;

  for (const r of producten) {
    const naam = (r.omschrijving || "").trim();
    if (!naam) continue;
    const n = Math.max(1, Number(r.aantal) || 1);

    if (isLosseOmvormerRegel(naam)) {
      omvormer = omvormer || naam;
      continue;
    }

    if (isAlphaEssPakketRegel(naam)) {
      modules += batterijModulesVanOmschrijving(naam) * n;
      omvormer = omvormerOmschrijvingVoor(naam) || omvormer;
      continue;
    }

    extras.push({ omschrijving: naam, aantal: n });
  }

  const out: { omschrijving: string; aantal: number }[] = [];
  if (modules > 0) {
    out.push({
      omschrijving: "Alpha ESS 9,3 kWh",
      aantal: modules,
    });
    if (omvormer) {
      out.push({ omschrijving: omvormer, aantal: 1 });
    }
    out.push({
      omschrijving: "Koppelkabel single column (9,3 kWh)",
      aantal: modules,
    });
    out.push({
      omschrijving: "Alpha ESS Meter DTSU 3CT 100A",
      aantal: 1,
    });
  } else if (omvormer) {
    out.push({ omschrijving: omvormer, aantal: 1 });
  }

  return [...out, ...extras];
}
