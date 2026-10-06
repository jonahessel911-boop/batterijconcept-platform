/**
 * Inkooplijst per project: alleen hardware uit offerte + standaard accessoires.
 * Diensten (subsidie, warmtefonds, installatie) en losse omvormer-regels (al in pakket) worden overgeslagen.
 * Offerte zelf wordt niet aangepast.
 */
import {
  DEFAULT_BATTERIJ_PER_MODULE,
  DEFAULT_BASEPLATE_EX_BTW,
  DEFAULT_DTSU_METER_EX_BTW,
  DEFAULT_KOPPELKABEL_EX_BTW,
  DEFAULT_OMVORMER,
  findProductForRegel,
  modulesVoorSku,
  type ProductInkoop,
} from "@/lib/inkoop";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Leverancier voor Alpha ESS / G3 inkoop. */
export const INKOOP_LEVERANCIER = "Apex Power Supplies";

/** Status per inkoopregel (opgeslagen in project.materiaal_checks). */
export type InkoopRegelStatus = "te_kopen" | "besteld" | "geleverd";

export const INKOOP_REGEL_STATUS_LABEL: Record<InkoopRegelStatus, string> = {
  te_kopen: "Nog in te kopen",
  besteld: "Besteld — wacht op levering",
  geleverd: "Geleverd",
};

export type MateriaalChecks = Record<
  string,
  boolean | string | InkoopRegelStatus | null | undefined
>;

export function parseInkoopRegelStatus(
  value: boolean | string | InkoopRegelStatus | null | undefined
): InkoopRegelStatus {
  if (value === true || value === "besteld") return "besteld";
  if (value === "geleverd") return "geleverd";
  return "te_kopen";
}

/** Batterij-status uit Purchasing (`materiaal_checks`). */
export function batterijPurchasingStatus(
  checks: MateriaalChecks | null | undefined
): { besteld: boolean; geleverd: boolean } {
  const entries = Object.entries(checks || {});
  const batterij = entries.filter(([k]) => /batterij/i.test(k));
  const source = batterij.length > 0 ? batterij : entries;
  if (source.length === 0) {
    return { besteld: false, geleverd: false };
  }
  const statuses = source.map(([, v]) => parseInkoopRegelStatus(v));
  const geleverd = statuses.every((s) => s === "geleverd");
  const besteld = statuses.every(
    (s) => s === "besteld" || s === "geleverd"
  );
  return { besteld, geleverd };
}

export function resolveInkoopRegelStatus(
  item: InkoopChecklistItem,
  checks: MateriaalChecks | null | undefined
): InkoopRegelStatus {
  const c = checks || {};
  const direct = parseInkoopRegelStatus(c[item.key]);
  if (direct !== "te_kopen") return direct;
  if (item.regelId) return parseInkoopRegelStatus(c[item.regelId]);
  return "te_kopen";
}

export function orderInkoopSamenvatting(
  items: InkoopChecklistItem[],
  checks: MateriaalChecks | null | undefined
): {
  te_kopen: number;
  besteld: number;
  geleverd: number;
  overall: InkoopRegelStatus | "deels";
} {
  let te_kopen = 0;
  let besteld = 0;
  let geleverd = 0;
  for (const item of items) {
    const s = resolveInkoopRegelStatus(item, checks);
    if (s === "geleverd") geleverd += 1;
    else if (s === "besteld") besteld += 1;
    else te_kopen += 1;
  }
  let overall: InkoopRegelStatus | "deels" = "te_kopen";
  if (items.length > 0 && geleverd === items.length) overall = "geleverd";
  else if (items.length > 0 && te_kopen === 0) overall = "besteld";
  else if (besteld > 0 || geleverd > 0) overall = "deels";
  return { te_kopen, besteld, geleverd, overall };
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
  {
    key: "std:dtsu-meter",
    sku: "alpha-ess-dtsu-3ct-100a",
    naam: "Alpha ESS Meter DTSU 3CT 100A",
    inkoopExBtw: DEFAULT_DTSU_METER_EX_BTW,
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

/** true als regel minstens besteld is (of geleverd). Legacy boolean true telt mee. */
export function isInkoopItemBesteld(
  item: InkoopChecklistItem,
  checks: MateriaalChecks | null | undefined
): boolean {
  const s = resolveInkoopRegelStatus(item, checks);
  return s === "besteld" || s === "geleverd";
}

function guessSkuFromText(text: string): string | null {
  const m = text.match(/(\d+[.,]\d+)\s*kwh/i);
  if (m) return `ae-g3-${m[1].replace(",", ".")}`;
  return null;
}
