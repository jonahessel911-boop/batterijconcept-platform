import { isKortingRegel } from "@/lib/offerte-regels";

type RegelLike = {
  omschrijving?: string | null;
  product_id?: string | null;
  prijs_ex_btw?: number | null;
  sort_order?: number | null;
};

/** Eerste catalogusproduct (of eerste betaalde regel) uit offerte-regels. */
export function primaireProductOmschrijving(
  regels: RegelLike[] | null | undefined
): string | null {
  if (!regels?.length) return null;
  const sorted = [...regels].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  );
  const withProduct = sorted.find((r) => r.product_id);
  const fromProduct = withProduct?.omschrijving?.trim();
  if (fromProduct) return fromProduct;

  const paid = sorted.find(
    (r) =>
      Number(r.prijs_ex_btw) > 0 &&
      !isKortingRegel({ omschrijving: r.omschrijving || "" })
  );
  return paid?.omschrijving?.trim() || null;
}

/** Product als eerste regel, daarna type/suffix (voor herkenning aanbetaling/restant). */
export function factuurOmschrijvingMetProduct(
  product: string | null | undefined,
  suffix: string
): string {
  const p = product?.trim();
  const s = suffix.trim();
  if (!p) return s;
  if (!s) return p;
  return `${p} — ${s}`;
}
