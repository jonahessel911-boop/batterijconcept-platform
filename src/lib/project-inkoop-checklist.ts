/**
 * Inkooplijst per project: alleen hardware uit offerte + standaard accessoires.
 * Diensten (subsidie, warmtefonds, installatie) en losse omvormer-regels (al in pakket) worden overgeslagen.
 * Offerte zelf wordt niet aangepast.
 */
import {
  DEFAULT_BATTERIJ_PER_MODULE,
  DEFAULT_BASEPLATE_EX_BTW,
  DEFAULT_KOPPELKABEL_EX_BTW,
  DEFAULT_OMVORMER,
  findProductForRegel,
  modulesVoorSku,
  type ProductInkoop,
} from "@/lib/inkoop";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Standaard accessoires (ex. btw) — Apex / Alpha ESS G3. */
export const STANDAARD_INKOOP_ACCESSOIRES = [
  {
    key: "std:baseplate",
    sku: "smile-3g-baseplate",
    naam: "Alpha ESS Baseplate G3 Universal",
    inkoopExBtw: DEFAULT_BASEPLATE_EX_BTW,
  },
  {
    key: "std:koppelkabel",
    sku: "smile-g3-kabelset-9.3",
    naam: "AlphaESS Koppelkabel Single kolom 9.3 kWh modules",
    inkoopExBtw: DEFAULT_KOPPELKABEL_EX_BTW,
  },
] as const;

export type InkoopChecklistItem = {
  key: string;
  label: string;
  sku: string | null;
  aantal: number;
  inkoopExBtw: number;
  bron: "offerte" | "standaard";
  /** Offerte-regel id indien van toepassing. */
  regelId?: string;
};

export type OfferteRegelInkoop = {
  id: string;
  omschrijving: string;
  aantal: number;
  sku?: string | null;
  product_id?: string | null;
};

/** Regels die niet bij fysieke inkoop horen (offerte blijft ongewijzigd). */
export function isInkoopUitsluitenRegel(omschrijving: string): boolean {
  const t = omschrijving.toLowerCase().replace(/\s+/g, " ").trim();
  if (!t) return true;

  if (
    /btw.?subsid|subsidie.?aanvraag|warmtefonds|aanvraag\s*service|installatie\s*\+|installatieopname|installatie.?opname|service.?installatie/.test(
      t
    )
  ) {
    return true;
  }

  // Losse omvormer-regel (bijv. "5 kW omvormer") — zit al in Alpha ESS-pakket
  const isStandaloneOmvormer =
    /\bomvormer\b/.test(t) &&
    !/alpha|ae-g3|batter|kwh|smile/.test(t);
  if (isStandaloneOmvormer) return true;

  return false;
}

/**
 * Bouw checklist: per hardware-regel batterij (+ omvormer) en vaste accessoires.
 * Check-keys blijven stabiel voor `project.materiaal_checks`.
 */
export function buildInkoopChecklist(
  regels: OfferteRegelInkoop[],
  producten: ProductInkoop[] = []
): InkoopChecklistItem[] {
  const items: InkoopChecklistItem[] = [];

  for (const r of regels) {
    const n = Math.max(0, Number(r.aantal) || 0);
    if (n <= 0) continue;
    if (isInkoopUitsluitenRegel(r.omschrijving)) continue;

    const product =
      (r.product_id
        ? producten.find((p) => p.id === r.product_id)
        : null) || findProductForRegel(r.omschrijving, producten);

    const hasHardware = product
      ? Number(product.inkoop_batterij || 0) > 0 ||
        Number(product.inkoop_omvormer || 0) > 0
      : false;

    if (product && hasHardware) {
      const batterij = round2(n * Number(product.inkoop_batterij || 0));
      const omvormer = round2(n * Number(product.inkoop_omvormer || 0));
      if (batterij > 0) {
        items.push({
          key: `regel:${r.id}:batterij`,
          label: `${r.omschrijving} — batterij`,
          sku: product.sku,
          aantal: n,
          inkoopExBtw: batterij,
          bron: "offerte",
          regelId: r.id,
        });
      }
      if (omvormer > 0) {
        items.push({
          key: `regel:${r.id}:omvormer`,
          label: `${r.omschrijving} — omvormer`,
          sku: product.sku,
          aantal: n,
          inkoopExBtw: omvormer,
          bron: "offerte",
          regelId: r.id,
        });
      }
      continue;
    }

    // Fallback: Alpha ESS-achtige regels zonder catalogusmatch
    const modules = modulesVoorSku(
      product?.sku || r.sku || guessSkuFromText(r.omschrijving)
    );
    const looksLikeBattery =
      /alpha|batter|ae-g3|smile/i.test(r.omschrijving) &&
      /\d+[.,]\d+/.test(r.omschrijving);
    if (looksLikeBattery) {
      items.push({
        key: `regel:${r.id}:batterij`,
        label: `${r.omschrijving} — batterij`,
        sku: product?.sku || null,
        aantal: n,
        inkoopExBtw: round2(n * modules * DEFAULT_BATTERIJ_PER_MODULE),
        bron: "offerte",
        regelId: r.id,
      });
      items.push({
        key: `regel:${r.id}:omvormer`,
        label: `${r.omschrijving} — omvormer`,
        sku: product?.sku || null,
        aantal: n,
        inkoopExBtw: round2(n * DEFAULT_OMVORMER),
        bron: "offerte",
        regelId: r.id,
      });
      continue;
    }

    // Geen overige diensten/regels in de inkooplijst
  }

  for (const a of STANDAARD_INKOOP_ACCESSOIRES) {
    items.push({
      key: a.key,
      label: a.naam,
      sku: a.sku,
      aantal: 1,
      inkoopExBtw: a.inkoopExBtw,
      bron: "standaard",
    });
  }

  return items;
}

export function inkoopChecklistTotaalExBtw(
  items: InkoopChecklistItem[]
): number {
  return round2(items.reduce((s, i) => s + (Number(i.inkoopExBtw) || 0), 0));
}

/** Legacy: oude checks op alleen regel-id ook als “besteld” beschouwen. */
export function isInkoopItemBesteld(
  item: InkoopChecklistItem,
  checks: Record<string, boolean> | null | undefined
): boolean {
  const c = checks || {};
  if (c[item.key]) return true;
  if (item.regelId && c[item.regelId]) return true;
  return false;
}

function guessSkuFromText(text: string): string | null {
  const m = text.match(/(\d+[.,]\d+)\s*kwh/i);
  if (m) return `ae-g3-${m[1].replace(",", ".")}`;
  return null;
}
