import type { OfferteRegel } from "@/types/database";

const INSTALLATIE_OMSCHRIJVING = "Installatie + installatieopname";
const WARMTEFONDS_OMSCHRIJVING = "Warmtefonds aanvraag service";

function hasOmschrijving(
  regels: { omschrijving: string }[],
  pattern: RegExp
): boolean {
  return regels.some((r) => pattern.test(r.omschrijving));
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
 * (installatie + Warmtefonds indien van toepassing).
 */
export function offerteRegelsVoorWeergave(
  regels: OfferteRegel[],
  opts: { financieringVoorbehoud?: boolean | null } = {}
): OfferteRegel[] {
  const out = [...regels].sort((a, b) => a.sort_order - b.sort_order);
  const maxSort = out.reduce((m, r) => Math.max(m, r.sort_order), 0);
  let next = maxSort + 1;

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
