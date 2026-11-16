/**
 * Heuristische extractie van factuurvelden uit mailtekst (NL/EN).
 */

export type FactuurExtract = {
  factuur_nummer: string | null;
  bedrijfsnaam: string | null;
  iban: string | null;
  bedrag_ex_btw: number | null;
  bedrag_inc_btw: number | null;
  btw_bedrag: number | null;
  vervaldatum: string | null; // yyyy-mm-dd
  factuurdatum: string | null;
  referentie: string | null;
};

function normalizeIban(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

function parseEuroAmount(raw: string): number | null {
  const cleaned = raw
    .replace(/€/g, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function parseNlDate(raw: string): string | null {
  const t = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(t);
  if (dmy) {
    const d = dmy[1]!.padStart(2, "0");
    const m = dmy[2]!.padStart(2, "0");
    let y = dmy[3]!;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m}-${d}`;
  }
  return null;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

/** Dichtstbijzijnde woensdag voor uitbetaling (ma–wo → deze wo; do–zo → volgende wo). */
export function dichtstbijzijndeBetaalWoensdag(
  from: Date = new Date()
): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Amsterdam",
    weekday: "short",
  }).format(from);
  const ymd = fmt.format(from);
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const dow = map[weekday] ?? 0;
  const add = dow <= 2 ? 2 - dow : 9 - dow;
  noon.setUTCDate(noon.getUTCDate() + add);
  return fmt.format(noon);
}

export function extractFactuurFromText(
  text: string,
  opts?: { subject?: string | null; fromName?: string | null }
): FactuurExtract {
  const hay = `${opts?.subject || ""}\n${text || ""}`;

  const ibanRaw = firstMatch(hay, [
    /\bIBAN\b[:\s]*([A-Z]{2}\d{2}[\sA-Z0-9]{10,30})/i,
    /\b(NL\d{2}\s?[A-Z]{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{0,2})\b/i,
    /\b([A-Z]{2}\d{2}[A-Z0-9]{10,28})\b/,
  ]);
  const iban = ibanRaw ? normalizeIban(ibanRaw) : null;

  const factuur_nummer = firstMatch(hay, [
    /factuur(?:nummer| nr\.?|nr\.?)[:\s#]*([A-Z0-9][-A-Z0-9/]{2,40})/i,
    /invoice\s*(?:number|no\.?|#)[:\s]*([A-Z0-9][-A-Z0-9/]{2,40})/i,
    /\bF[-\s]?(\d{4}[-/]\d{3,})\b/i,
  ]);

  const bedragInc = firstMatch(hay, [
    /(?:totaal|te\s*betalen|amount\s*due|incl\.?\s*btw)[:\s]*€?\s*([\d.,]+)/i,
    /€\s*([\d.,]+)\s*(?:incl\.?\s*btw|totaal)/i,
  ]);
  const bedragEx = firstMatch(hay, [
    /(?:subtotaal|excl\.?\s*btw|ex\.?\s*btw|subtotal)[:\s]*€?\s*([\d.,]+)/i,
    /€\s*([\d.,]+)\s*(?:excl\.?\s*btw|ex\.?\s*btw)/i,
  ]);
  const btw = firstMatch(hay, [
    /(?:btw|vat)\s*(?:\d+\s*%?)?[:\s]*€?\s*([\d.,]+)/i,
  ]);

  const bedrag_inc_btw = bedragInc ? parseEuroAmount(bedragInc) : null;
  const bedrag_ex_btw = bedragEx ? parseEuroAmount(bedragEx) : null;
  const btw_bedrag = btw ? parseEuroAmount(btw) : null;

  const vervalRaw = firstMatch(hay, [
    /verval(?:datum)?[:\s]*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})/i,
    /due\s*date[:\s]*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})/i,
  ]);
  const factuurRaw = firstMatch(hay, [
    /factuurdatum[:\s]*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})/i,
    /invoice\s*date[:\s]*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})/i,
  ]);

  const bedrijfsnaam =
    firstMatch(hay, [
      /(?:bedrijfsnaam|leverancier|crediteur|van)[:\s]*([^\n]{3,80})/i,
    ]) ||
    (opts?.fromName && !/@/.test(opts.fromName) ? opts.fromName.trim() : null);

  const referentie = firstMatch(hay, [
    /(?:kenmerk|referentie|betalingskenmerk|payment\s*reference)[:\s]*([A-Z0-9][-A-Z0-9/ ]{2,60})/i,
  ]);

  return {
    factuur_nummer,
    bedrijfsnaam,
    iban: iban && iban.length >= 15 ? iban : null,
    bedrag_ex_btw,
    bedrag_inc_btw,
    btw_bedrag,
    vervaldatum: vervalRaw ? parseNlDate(vervalRaw) : null,
    factuurdatum: factuurRaw ? parseNlDate(factuurRaw) : null,
    referentie,
  };
}
