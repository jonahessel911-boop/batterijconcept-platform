import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

/**
 * Inkoopprijzen — defaults + berekening.
 * Bron van waarheid na migratie: tabel producten + inkoop_instellingen.
 */

export const DEFAULT_INSTALLATIE_STANDAARD = 675;
export const DEFAULT_WARMTEFONDS_AANVRAAG = 175;
export const DEFAULT_BATTERIJ_PER_MODULE = 1499.73;
export const DEFAULT_OMVORMER = 1089.62;
export const MODULE_KWH = 9.3;

/** Productselect zonder inkoop-kolommen (werkt altijd). */
export const PRODUCT_SELECT_BASE =
  "id, sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief";

/** Volledige select — alleen als migrate-inkoop.sql is gedraaid. */
export const PRODUCT_SELECT_INKOOP =
  "id, sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief, inkoop_batterij, inkoop_omvormer, inkoop_installatie, inkoop_warmtefonds";

/**
 * Process-cache: voorkomt eindeloze PostgREST 42703/PGRST205 spam.
 * Start op `false` (veilig zonder migratie). Na geslaagde write of
 * expliciete probe → `true`. Herstart na migrate-inkoop.sql pikt DB op
 * via `probeInkoopSchemaOnce`.
 */
let inkoopColumnsReady = false;
let inkoopInstellingenReady = false;
let didProbeInkoopSchema = false;

function isMissingInkoopSchema(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /inkoop_/i.test(msg) ||
    /inkoop_instellingen/i.test(msg) ||
    /schema cache/i.test(msg) ||
    /does not exist/i.test(msg)
  );
}

/**
 * Eenmalige stille probe per process — alleen als nog niemand heeft
 * gemarkeerd. Geen herhaalde fails in Supabase-logs.
 */
export async function probeInkoopSchemaOnce(
  sb: SupabaseClient
): Promise<void> {
  if (didProbeInkoopSchema) return;
  didProbeInkoopSchema = true;

  const cols = await sb.from("producten").select("inkoop_batterij").limit(1);
  inkoopColumnsReady = !cols.error;

  const inst = await sb.from("inkoop_instellingen").select("id").limit(1);
  if (!inst.error) {
    inkoopInstellingenReady = true;
  } else if (isMissingInkoopSchema(inst.error)) {
    inkoopInstellingenReady = false;
  }
}

/** true als producten.inkoop_* kolommen bestaan. */
export async function hasInkoopProductColumns(
  sb: SupabaseClient
): Promise<boolean> {
  await probeInkoopSchemaOnce(sb);
  return inkoopColumnsReady;
}

/** true als tabel inkoop_instellingen bestaat. */
export async function hasInkoopInstellingenTable(
  sb: SupabaseClient
): Promise<boolean> {
  await probeInkoopSchemaOnce(sb);
  return inkoopInstellingenReady;
}

/** Markeer schema als beschikbaar (na geslaagde write). */
export function markInkoopSchemaReady(opts?: {
  columns?: boolean;
  instellingen?: boolean;
}): void {
  didProbeInkoopSchema = true;
  if (opts?.columns) inkoopColumnsReady = true;
  if (opts?.instellingen) inkoopInstellingenReady = true;
}

/** Markeer schema als ontbrekend (na 42703/PGRST205). */
export function markInkoopSchemaMissing(opts?: {
  columns?: boolean;
  instellingen?: boolean;
}): void {
  didProbeInkoopSchema = true;
  if (opts?.columns) inkoopColumnsReady = false;
  if (opts?.instellingen) inkoopInstellingenReady = false;
}

export { isMissingInkoopSchema };

/** Standaard G3-accessoires (ex. btw). */
export const DEFAULT_BASEPLATE_EX_BTW = 60;
export const DEFAULT_KOPPELKABEL_EX_BTW = 29.45;
export const DEFAULT_DTSU_METER_EX_BTW = 112.34;

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
  /** Alpha ESS-pakket (niet accessoires, niet warmtepomp). */
  aantalBatterijPakket: number;
  aantalWarmtepomp: number;
};

export type OfferteInkoopRegel = {
  omschrijving?: string | null;
  aantal?: number | null;
  product_id?: string | null;
};

/** Catalogus-inkoop voor P&L / interne ordermail. */
export async function loadProductenInkoop(
  sb: SupabaseClient
): Promise<ProductInkoop[]> {
  await probeInkoopSchemaOnce(sb);
  const select = (
    inkoopColumnsReady ? PRODUCT_SELECT_INKOOP : PRODUCT_SELECT_BASE
  ) as typeof PRODUCT_SELECT_BASE;
  const rows = await fetchAllRows<Partial<ProductInkoop>>((from, to) =>
    sb
      .from("producten")
      .select(select)
      .eq("actief", true)
      .order("id")
      .range(from, to)
  ).catch(() => [] as Partial<ProductInkoop>[]);
  return rows.map((p) => ({
    id: String(p.id || ""),
    sku: p.sku ?? null,
    naam: p.naam || "",
    omschrijving: p.omschrijving ?? null,
    prijs_ex_btw: Number(p.prijs_ex_btw) || 0,
    btw_percentage: Number(p.btw_percentage) || 21,
    eenheid: p.eenheid || "stuk",
    actief: p.actief !== false,
    inkoop_batterij: Number(p.inkoop_batterij) || 0,
    inkoop_omvormer: Number(p.inkoop_omvormer) || 0,
    inkoop_installatie: Number(p.inkoop_installatie) || 0,
    inkoop_warmtefonds: Number(p.inkoop_warmtefonds) || 0,
  }));
}

export function isWarmtepompProduct(p: {
  sku?: string | null;
  naam?: string | null;
}): boolean {
  const sku = (p.sku || "").toUpperCase();
  if (sku.startsWith("WP:") || /TC-GT\d{2}/.test(sku)) return true;
  const n = (p.naam || "").toLowerCase();
  return n.includes("tc swiss") || n.includes("warmtepomp");
}

export function isBatterijPakketProduct(p: {
  sku?: string | null;
  naam?: string | null;
}): boolean {
  const sku = (p.sku || "").toUpperCase();
  if (sku.startsWith("WP:")) return false;
  if (sku.startsWith("AE-G3-")) return true;
  const n = (p.naam || "").toLowerCase();
  return n.includes("alpha ess") && n.includes("kwh");
}

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
  const tcCode = t.match(/tc-gt\d{2}-[a-z]+/i);
  if (tcCode) {
    const needle = tcCode[0].toUpperCase();
    const hit = producten.find((p) =>
      (p.sku || "").toUpperCase().includes(needle)
    );
    if (hit) return hit;
  }
  for (const p of producten) {
    const naam = normalizeText(p.naam);
    if (naam && (t.includes(naam) || naam.includes(t))) return p;
  }
  // Merk + type (bijv. "Huawei LUNA" ↔ product "Huawei LUNA2000-…")
  for (const p of producten) {
    const naam = normalizeText(p.naam);
    if (!naam) continue;
    const tokens = naam.split(/[^a-z0-9]+/).filter((x) => x.length >= 3);
    if (tokens.length === 0) continue;
    if (tokens.every((tok) => t.includes(tok))) return p;
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
  // Huawei / LUNA zonder exacte catalogusnaam
  if (t.includes("huawei") || t.includes("luna")) {
    return (
      producten.find((p) => {
        const n = normalizeText(p.naam);
        const s = normalizeText(p.sku || "");
        return n.includes("huawei") || n.includes("luna") || s.includes("luna");
      }) || null
    );
  }
  return null;
}

/**
 * Hardware/inkoop voor offertregels.
 * includeWarmtefonds: true telt warmtefonds-aanvraag mee in hardware-totaal.
 */
export function inkoopKostenVoorRegels(
  regels: OfferteInkoopRegel[],
  producten: ProductInkoop[],
  opts?: { includeWarmtefonds?: boolean }
): HardwareKosten {
  const includeWf = opts?.includeWarmtefonds !== false;
  const byId = new Map(producten.map((p) => [p.id, p]));
  let batterij = 0;
  let omvormer = 0;
  let installatie = 0;
  let warmtefonds = 0;
  let aantal = 0;
  let aantalBatterijPakket = 0;
  let aantalWarmtepomp = 0;

  for (const r of regels) {
    const n = Math.max(0, Number(r.aantal) || 0);
    if (n <= 0) continue;
    const pid = (r.product_id || "").trim();
    const product =
      (pid ? byId.get(pid) : undefined) ||
      findProductForRegel(r.omschrijving, producten);
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
    if (isWarmtepompProduct(product)) aantalWarmtepomp += n;
    else if (isBatterijPakketProduct(product)) aantalBatterijPakket += n;
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
    aantalBatterijPakket,
    aantalWarmtepomp,
  };
}

/** Hardware-inkoop per offertregel (voor interne ordermail). */
export function inkoopRegelsDetail(
  regels: OfferteInkoopRegel[],
  producten: ProductInkoop[]
): { label: string; inkoop: number }[] {
  const byId = new Map(producten.map((p) => [p.id, p]));
  const out: { label: string; inkoop: number }[] = [];
  for (const r of regels) {
    const n = Math.max(0, Number(r.aantal) || 0);
    if (n <= 0) continue;
    const pid = (r.product_id || "").trim();
    const product =
      (pid ? byId.get(pid) : undefined) ||
      findProductForRegel(r.omschrijving, producten);
    if (!product) continue;
    const inkoop = round2(
      n *
        (Number(product.inkoop_batterij || 0) +
          Number(product.inkoop_omvormer || 0) +
          Number(product.inkoop_warmtefonds || 0))
    );
    if (inkoop <= 0) continue;
    const naam = product.naam || r.omschrijving || "Product";
    out.push({ label: n === 1 ? naam : `${n}× ${naam}`, inkoop });
  }
  return out;
}
