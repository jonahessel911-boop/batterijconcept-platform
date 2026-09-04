import type { BunqPayment } from "@/lib/bunq/client";

export type OpenFactuur = {
  id: string;
  factuur_nummer: string;
  bedrag_inc_btw: number;
  status: string;
  offerte_nummer?: string | null;
};

const REF_RE = /\b((?:FAC|OFF|BC)[-–]?\d{4}[-–]?\d+)\b/gi;

/** Haal factuur-/offerte-/lead-referenties uit omschrijving. */
export function extractPaymentRefs(description: string): string[] {
  const found = new Set<string>();
  const normalized = description.replace(/–/g, "-");
  for (const m of normalized.matchAll(REF_RE)) {
    found.add(m[1].toUpperCase().replace(/\s+/g, ""));
  }
  // Spaties in kenmerk: "OFF 2026 0001"
  const spaced = normalized.match(
    /\b((?:FAC|OFF|BC)\s*\d{4}\s*\d+)\b/gi
  );
  if (spaced) {
    for (const s of spaced) {
      found.add(s.toUpperCase().replace(/\s+/g, "-").replace(/-+/g, "-"));
    }
  }
  return [...found];
}

function amountsMatch(paid: number, invoice: number, tolerance = 0.05): boolean {
  return Math.abs(paid - invoice) <= tolerance;
}

function normalizeNummer(n: string): string {
  return n.toUpperCase().replace(/\s+/g, "").replace(/–/g, "-");
}

/**
 * Match inkomende bunq-betaling op openstaande factuur.
 * 1) Omschrijving bevat factuur_nummer of offerte_nummer
 * 2) Bedrag ≈ bedrag_inc_btw (±5 cent)
 */
export function matchPaymentToFactuur(
  payment: BunqPayment,
  facturen: OpenFactuur[]
): OpenFactuur | null {
  const paid = Number(payment.amount.value);
  if (!Number.isFinite(paid) || paid <= 0) return null;

  const refs = extractPaymentRefs(payment.description).map(normalizeNummer);
  const desc = payment.description.toUpperCase().replace(/\s+/g, "");

  const candidates = facturen.filter((f) => {
    if (!amountsMatch(paid, Number(f.bedrag_inc_btw))) return false;
    const fac = normalizeNummer(f.factuur_nummer);
    const off = f.offerte_nummer
      ? normalizeNummer(f.offerte_nummer)
      : null;
    if (refs.includes(fac) || (off && refs.includes(off))) return true;
    if (desc.includes(fac.replace(/-/g, "")) || desc.includes(fac)) return true;
    if (off && (desc.includes(off.replace(/-/g, "")) || desc.includes(off))) {
      return true;
    }
    return false;
  });

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    // Prefer exact factuur_nummer in refs
    const byFac = candidates.find((f) =>
      refs.includes(normalizeNummer(f.factuur_nummer))
    );
    return byFac || candidates[0];
  }
  return null;
}
