import type { OfferteRegel } from "@/types/database";

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
  if (/g3\s*t10/i.test(t)) return "Incl. 10 kW omvormer";
  if (/g3\s*s5/i.test(t)) return "Incl. 5 kW omvormer";
  return "Incl. omvormer";
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
 */
export function offerteRegelsVoorWeergave(
  regels: OfferteRegel[],
  opts: { financieringVoorbehoud?: boolean | null } = {}
): OfferteRegel[] {
  const sorted = [...regels].sort((a, b) => a.sort_order - b.sort_order);
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
    out.push(
      virtualRegel(label, next++)
    );
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
