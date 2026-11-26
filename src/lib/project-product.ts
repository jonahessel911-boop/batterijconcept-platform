import { isBatterijPakketProduct, isWarmtepompProduct } from "@/lib/inkoop";
import { parseTcSwissIntakeStored } from "@/lib/tcswiss-intake";
import type { Project } from "@/types/database";

export type ProjectProductSoort = "warmtepomp" | "thuisbatterij";

export const PROJECT_PRODUCT_LABEL: Record<ProjectProductSoort, string> = {
  warmtepomp: "Warmtepomp",
  thuisbatterij: "Thuisbatterij",
};

type RegelLite = {
  sku?: string | null;
  naam?: string | null;
  omschrijving?: string | null;
  producten?: { sku?: string | null; naam?: string | null } | null;
};

function offerteVan(p: Project): {
  offerte_regels?: RegelLite[] | null;
} | null {
  const raw = p.offertes as
    | { offerte_regels?: RegelLite[] | null }
    | { offerte_regels?: RegelLite[] | null }[]
    | null
    | undefined;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

export function productSoortVanRegels(
  regels: RegelLite[] | null | undefined
): ProjectProductSoort | null {
  if (!regels?.length) return null;
  const mapped = regels.map((r) => ({
    sku: r.sku || r.producten?.sku,
    naam: r.naam || r.producten?.naam || r.omschrijving,
  }));
  if (mapped.some((r) => isWarmtepompProduct(r))) return "warmtepomp";
  if (mapped.some((r) => isBatterijPakketProduct(r))) return "thuisbatterij";
  const blob = mapped
    .map((r) => `${r.sku || ""} ${r.naam || ""}`)
    .join(" ")
    .toLowerCase();
  if (/warmtepomp|\btc swiss\b|gt14|full electric/.test(blob)) {
    return "warmtepomp";
  }
  if (/alpha ess|thuisbatterij|batterij|\bkwh\b/.test(blob)) {
    return "thuisbatterij";
  }
  return null;
}

export function isWarmtepompOrder(
  p: Project,
  extraRegels?: RegelLite[] | null
): boolean {
  return projectProductSoort(p, extraRegels) === "warmtepomp";
}

export function warmtepompProductNaam(
  regels: RegelLite[] | null | undefined
): string | null {
  if (!regels?.length) return null;
  const names: string[] = [];
  for (const r of regels) {
    const sku = r.sku || r.producten?.sku;
    const naam = r.naam || r.producten?.naam || r.omschrijving;
    if (!isWarmtepompProduct({ sku, naam })) continue;
    const label = (naam || sku || "").trim();
    if (label && !names.includes(label)) names.push(label);
  }
  return names[0] || null;
}

export function tcSwissDoorgestuurdTekst(productNaam: string | null | undefined): string {
  const naam = (productNaam || "").trim() || PROJECT_PRODUCT_LABEL.warmtepomp;
  return `Doorgestuurd naar TC Swiss - ${naam}`;
}

export function warmtepompProductNaamVanProject(
  p: Project,
  extraRegels?: RegelLite[] | null
): string {
  const nested = offerteVan(p)?.offerte_regels;
  return (
    warmtepompProductNaam(extraRegels || nested) ||
    PROJECT_PRODUCT_LABEL.warmtepomp
  );
}

export function projectProductSoort(
  p: Project,
  extraRegels?: RegelLite[] | null
): ProjectProductSoort | null {
  const nested = offerteVan(p)?.offerte_regels;
  const fromRegels = productSoortVanRegels(extraRegels || nested);
  if (fromRegels) return fromRegels;
  if (parseTcSwissIntakeStored(p.materiaal_checks)) return "warmtepomp";
  const titel = `${p.titel || ""}`.toLowerCase();
  if (/warmtepomp|\btc swiss\b/.test(titel)) return "warmtepomp";
  if (/batterij|alpha ess/.test(titel)) return "thuisbatterij";
  return null;
}
