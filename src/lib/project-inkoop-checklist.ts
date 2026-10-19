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
export type InkoopRegelStatus =
  | "te_kopen"
  | "besteld"
  | "geleverd"
  | "geannuleerd";

export const INKOOP_REGEL_STATUS_LABEL: Record<InkoopRegelStatus, string> = {
  te_kopen: "Nog in te kopen",
  besteld: "Besteld — wacht op levering",
  geleverd: "Geleverd",
  geannuleerd: "Vervallen (na schouw)",
};

/** Montage-accessoire keuze na schouw (niet in PDF). */
export type MontageAccessoire = "baseplate" | "wallbracket";

export const SCHOUW_MONTAGE_CHECK_KEY = "__schouw_montage";
export const INKOOP_EXTRA_NOTITIES_KEY = "__inkoop_extra_notities";
export const INKOOP_NOTE_PREFIX = "__note:";

export const SCHOUW_MONTAGE_NA_SCHOUW_NOTE =
  "Na schouw blijkt dat deze nodig is.";

export function inkoopNoteKey(itemKey: string): string {
  return `${INKOOP_NOTE_PREFIX}${itemKey}`;
}

export function parseMontageAccessoire(
  value: unknown
): MontageAccessoire | null {
  if (value === "baseplate" || value === "wallbracket") return value;
  return null;
}

export function getInkoopItemNote(
  checks: MateriaalChecks | null | undefined,
  itemKey: string
): string | null {
  const raw = checks?.[inkoopNoteKey(itemKey)];
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t || null;
}

export function getInkoopExtraNotities(
  checks: MateriaalChecks | null | undefined
): string | null {
  const raw = checks?.[INKOOP_EXTRA_NOTITIES_KEY];
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  return t || null;
}

/** Leverancierbetaling per project (kolommen op projecten). */
export type InkoopLeverancierStatus = "geen" | "betaald" | "op_krediet";

export const INKOOP_LEVERANCIER_STATUS_LABEL: Record<
  InkoopLeverancierStatus,
  string
> = {
  geen: "—",
  betaald: "Betaald",
  op_krediet: "Op krediet",
};

export function parseInkoopLeverancierStatus(
  value: unknown
): InkoopLeverancierStatus {
  if (value === "betaald" || value === "op_krediet") return value;
  return "geen";
}

export type MateriaalChecks = Record<
  string,
  boolean | string | InkoopRegelStatus | null | undefined
>;

export function parseInkoopRegelStatus(
  value: boolean | string | InkoopRegelStatus | null | undefined
): InkoopRegelStatus {
  if (value === true || value === "besteld") return "besteld";
  if (value === "geleverd") return "geleverd";
  if (value === "geannuleerd") return "geannuleerd";
  return "te_kopen";
}

/** Batterij-status uit Purchasing (`materiaal_checks`). */
export function batterijPurchasingStatus(
  checks: MateriaalChecks | null | undefined
): { besteld: boolean; geleverd: boolean } {
  const entries = Object.entries(checks || {}).filter(
    ([k, v]) =>
      !k.startsWith("__") && parseInkoopRegelStatus(v) !== "geannuleerd"
  );
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
  let active = 0;
  for (const item of items) {
    const s = resolveInkoopRegelStatus(item, checks);
    if (s === "geannuleerd") continue;
    active += 1;
    if (s === "geleverd") geleverd += 1;
    else if (s === "besteld") besteld += 1;
    else te_kopen += 1;
  }
  let overall: InkoopRegelStatus | "deels" = "te_kopen";
  if (active > 0 && geleverd === active) overall = "geleverd";
  else if (active > 0 && te_kopen === 0) overall = "besteld";
  else if (besteld > 0 || geleverd > 0) overall = "deels";
  return { te_kopen, besteld, geleverd, overall };
}

/** Standaard montage: baseplate. Wall bracket alleen na schouw-wissel. */
export const INKOOP_BASEPLATE = {
  key: "std:baseplate",
  sku: "smile-3g-baseplate",
  naam: "Alpha ESS Baseplate G3 Universal",
  inkoopExBtw: DEFAULT_BASEPLATE_EX_BTW,
} as const;

export const INKOOP_WALLBRACKET = {
  key: "std:wallbracket",
  sku: "smile-g3-s5-wall-bracket",
  naam: "Alpha ESS Smile G3 S5 inverter wall bracket",
  inkoopExBtw: DEFAULT_BASEPLATE_EX_BTW,
} as const;

/** Overige standaard accessoires (ex. btw) — Apex / Alpha ESS G3. */
export const STANDAARD_INKOOP_ACCESSOIRES = [
  INKOOP_BASEPLATE,
  {
    key: "std:koppelkabel",
    sku: "smile-g3-kabelset-9.3",
    naam: "Koppelkabel",
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
  /** Toelichting (bijv. na schouw) — niet op offerte. */
  notitie?: string | null;
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
 * Na schouw: wissel baseplate ↔ wall bracket in purchasing.
 * Oude regel → geannuleerd (doorstreept), nieuwe → te_kopen + notitie.
 */
export function applySchouwMontageToChecks(
  checks: MateriaalChecks | null | undefined,
  montage: MontageAccessoire,
  extraNotities?: string | null
): MateriaalChecks {
  const next: MateriaalChecks = { ...(checks || {}) };
  const prev = parseMontageAccessoire(next[SCHOUW_MONTAGE_CHECK_KEY]);
  next[SCHOUW_MONTAGE_CHECK_KEY] = montage;

  const extra = (extraNotities || "").trim();
  if (extra) next[INKOOP_EXTRA_NOTITIES_KEY] = extra;
  else delete next[INKOOP_EXTRA_NOTITIES_KEY];

  const keepIfOrdered = (key: string) => {
    const s = parseInkoopRegelStatus(next[key]);
    return s === "besteld" || s === "geleverd";
  };

  if (montage === "wallbracket") {
    if (!keepIfOrdered(INKOOP_BASEPLATE.key)) {
      next[INKOOP_BASEPLATE.key] = "geannuleerd";
    }
    delete next[inkoopNoteKey(INKOOP_BASEPLATE.key)];
    if (!keepIfOrdered(INKOOP_WALLBRACKET.key)) {
      next[INKOOP_WALLBRACKET.key] = "te_kopen";
    }
    // Notitie alleen als we wisselen t.o.v. standaard/baseplate
    if (prev !== "wallbracket") {
      next[inkoopNoteKey(INKOOP_WALLBRACKET.key)] =
        SCHOUW_MONTAGE_NA_SCHOUW_NOTE;
    }
  } else {
    // baseplate bevestigd
    if (prev === "wallbracket" || next[INKOOP_WALLBRACKET.key] != null) {
      if (!keepIfOrdered(INKOOP_WALLBRACKET.key)) {
        next[INKOOP_WALLBRACKET.key] = "geannuleerd";
      }
      if (!keepIfOrdered(INKOOP_BASEPLATE.key)) {
        next[INKOOP_BASEPLATE.key] = "te_kopen";
      }
      next[inkoopNoteKey(INKOOP_BASEPLATE.key)] =
        SCHOUW_MONTAGE_NA_SCHOUW_NOTE;
      delete next[inkoopNoteKey(INKOOP_WALLBRACKET.key)];
    } else {
      // Standaard bevestigd — geen doorstrepen nodig
      if (!keepIfOrdered(INKOOP_BASEPLATE.key)) {
        // laat te_kopen/undefined
        if (next[INKOOP_BASEPLATE.key] === "geannuleerd") {
          next[INKOOP_BASEPLATE.key] = "te_kopen";
        }
      }
      delete next[inkoopNoteKey(INKOOP_BASEPLATE.key)];
      delete next[inkoopNoteKey(INKOOP_WALLBRACKET.key)];
    }
  }

  return next;
}

/**
 * Bouw checklist: per hardware-regel batterij (+ omvormer) en vaste accessoires.
 * Check-keys blijven stabiel voor `project.materiaal_checks`.
 * Optioneel `checks` voor schouw-montage (wall bracket tonen / notities).
 */
export function buildInkoopChecklist(
  regels: OfferteRegelInkoop[],
  producten: ProductInkoop[] = [],
  checks?: MateriaalChecks | null
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

  const montage = parseMontageAccessoire(checks?.[SCHOUW_MONTAGE_CHECK_KEY]);
  const showWallbracket =
    montage === "wallbracket" ||
    checks?.[INKOOP_WALLBRACKET.key] != null ||
    Boolean(getInkoopItemNote(checks, INKOOP_WALLBRACKET.key));

  // Baseplate altijd (standaard); doorstreept als schouw wall bracket koos.
  items.push({
    key: INKOOP_BASEPLATE.key,
    label: INKOOP_BASEPLATE.naam,
    sku: INKOOP_BASEPLATE.sku,
    aantal: 1,
    inkoopExBtw: INKOOP_BASEPLATE.inkoopExBtw,
    bron: "standaard",
    notitie: getInkoopItemNote(checks, INKOOP_BASEPLATE.key),
  });

  if (showWallbracket) {
    items.push({
      key: INKOOP_WALLBRACKET.key,
      label: INKOOP_WALLBRACKET.naam,
      sku: INKOOP_WALLBRACKET.sku,
      aantal: 1,
      inkoopExBtw: INKOOP_WALLBRACKET.inkoopExBtw,
      bron: "standaard",
      notitie: getInkoopItemNote(checks, INKOOP_WALLBRACKET.key),
    });
  }

  for (const a of STANDAARD_INKOOP_ACCESSOIRES) {
    if (a.key === INKOOP_BASEPLATE.key) continue;
    items.push({
      key: a.key,
      label: a.naam,
      sku: a.sku,
      aantal: 1,
      inkoopExBtw: a.inkoopExBtw,
      bron: "standaard",
      notitie: getInkoopItemNote(checks, a.key),
    });
  }

  return items;
}

export function inkoopChecklistTotaalExBtw(
  items: InkoopChecklistItem[],
  checks?: MateriaalChecks | null
): number {
  return round2(
    items.reduce((s, i) => {
      if (
        checks &&
        resolveInkoopRegelStatus(i, checks) === "geannuleerd"
      ) {
        return s;
      }
      return s + (Number(i.inkoopExBtw) || 0);
    }, 0)
  );
}

/** true als regel minstens besteld is (of geleverd). Legacy boolean true telt mee. */
export function isInkoopItemBesteld(
  item: InkoopChecklistItem,
  checks: MateriaalChecks | null | undefined
): boolean {
  const s = resolveInkoopRegelStatus(item, checks);
  return s === "besteld" || s === "geleverd";
}

/** Som ex. btw van regels die minstens besteld zijn (zelfde eenheid als checklist-totaal). */
export function inkoopBesteldTotaalExBtw(
  items: InkoopChecklistItem[],
  checks: MateriaalChecks | null | undefined
): number {
  return round2(
    items.reduce((s, item) => {
      if (!isInkoopItemBesteld(item, checks)) return s;
      return s + (Number(item.inkoopExBtw) || 0);
    }, 0)
  );
}

/** Som ex. btw van regels die nog te_kopen zijn. */
export function inkoopTeBestellenTotaalExBtw(
  items: InkoopChecklistItem[],
  checks: MateriaalChecks | null | undefined
): number {
  return round2(
    items.reduce((s, item) => {
      if (resolveInkoopRegelStatus(item, checks) !== "te_kopen") return s;
      return s + (Number(item.inkoopExBtw) || 0);
    }, 0)
  );
}

function guessSkuFromText(text: string): string | null {
  const m = text.match(/(\d+[.,]\d+)\s*kwh/i);
  if (m) return `ae-g3-${m[1].replace(",", ".")}`;
  return null;
}
