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
  const subject = (opts?.subject || "").trim();
  const hay = `${subject}\n${text || ""}`;

  const ibanRaw = firstMatch(hay, [
    // "IBAN NL40 RABO 0302 4843 29" / "IBAN: NL…"
    /\bIBAN\b[:\s]*([A-Z]{2}\s*\d{2}(?:\s*[A-Z0-9]{4}){3}(?:\s*[A-Z0-9]{0,4})?)/i,
    /\b(NL\s*\d{2}(?:\s*[A-Z]{4})(?:\s*\d{4}){3})\b/i,
    /\b(NL\d{2}(?:\s?[A-Z0-9]{4}){4})\b/i,
  ]);
  let iban = ibanRaw ? normalizeIban(ibanRaw) : null;
  // NL-IBAN is precies 18 tekens — knip trailing rotzooi (bijv. "T" van "T.n.v.")
  if (iban?.startsWith("NL")) {
    iban = iban.slice(0, 18);
    if (iban.length !== 18 || !/^NL\d{2}[A-Z]{4}\d{10}$/.test(iban)) {
      iban = null;
    }
  } else if (iban && (iban.length < 15 || iban.length > 34)) {
    iban = null;
  }

  const rawFactuurnr =
    firstMatch(hay, [
      /factuurn(?:ummer)?(?:\s*nr\.?)?[:\s#]*([A-Z0-9][-A-Z0-9/.]{2,40})/i,
      /factuur\s*(?:nummer|nr\.?|#)?[:\s#]*([A-Z0-9][-A-Z0-9/.]{2,40})/i,
      /invoice\s*(?:number|no\.?|#)[:\s]*([A-Z0-9][-A-Z0-9/.]{2,40})/i,
      /\b(FAC[-/]?\d{4}[-/]\d{3,})\b/i,
      /\bF[-\s]?(\d{4}[-/]\d{3,})\b/i,
      // Bestandsnaam / subject: 202602850-jdj-investments-…
      /^(\d{6,12})[-_]/m,
    ]) ||
    firstMatch(subject, [/^(\d{6,12})\b/, /\b(FAC[-/]?\d{4}[-/]\d{3,})\b/i]);
  const factuur_nummer = rawFactuurnr
    ? rawFactuurnr.replace(/[.\s]+$/g, "")
    : null;

  // Let op: geen "totaal" matchen in "subtotaal"
  const bedragInc = firstMatch(hay, [
    /(?:^|[^\w])(?:totaal(?:\s*incl\.?\s*btw)?|te\s*betalen|amount\s*due)[:\s]*€?\s*([\d.,]+)/im,
    /(?:^|[^\w])bedrag[:\s]*€?\s*([\d.,]+)/im,
    /€\s*([\d.,]+)\s*(?:incl\.?\s*btw|(?<!sub)totaal)/i,
  ]);
  const bedragEx = firstMatch(hay, [
    /(?:subtotaal|excl\.?\s*btw|ex\.?\s*btw|subtotal)[:\s]*€?\s*([\d.,]+)/i,
    /€\s*([\d.,]+)\s*(?:excl\.?\s*btw|ex\.?\s*btw)/i,
  ]);
  const btw = firstMatch(hay, [
    /(?:^|[^\w])(?:btw|vat)\s*(?:\d+\s*%?)?[:\s]*€?\s*([\d.,]+)/im,
  ]);

  let bedrag_inc_btw = bedragInc ? parseEuroAmount(bedragInc) : null;
  let bedrag_ex_btw = bedragEx ? parseEuroAmount(bedragEx) : null;
  let btw_bedrag = btw ? parseEuroAmount(btw) : null;
  // Vul ontbrekende bedragen uit BTW-som
  if (
    bedrag_inc_btw == null &&
    bedrag_ex_btw != null &&
    btw_bedrag != null
  ) {
    bedrag_inc_btw =
      Math.round((bedrag_ex_btw + btw_bedrag) * 100) / 100;
  }
  if (
    bedrag_ex_btw == null &&
    bedrag_inc_btw != null &&
    btw_bedrag != null
  ) {
    bedrag_ex_btw =
      Math.round((bedrag_inc_btw - btw_bedrag) * 100) / 100;
  }
  // Inconsistente BTW-parse (ruis uit PDF) weggooien
  if (
    bedrag_inc_btw != null &&
    bedrag_ex_btw != null &&
    btw_bedrag != null
  ) {
    const sum = Math.round((bedrag_ex_btw + btw_bedrag) * 100) / 100;
    if (Math.abs(sum - bedrag_inc_btw) > 0.05) {
      btw_bedrag = null;
      bedrag_ex_btw = null;
    }
  }

  const vervalRaw = firstMatch(hay, [
    /verval(?:datum)?[:\s]*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})/i,
    /due\s*date[:\s]*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})/i,
    /voor\s+([0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4})\s+te\s+voldoen/i,
  ]);
  const factuurRaw = firstMatch(hay, [
    /factuurdatum[:\s]*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})/i,
    /invoice\s*date[:\s]*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})/i,
  ]);

  const firstLine = (text || "")
    .split(/\n/)
    .map((l) => l.trim())
    .find((l) => l.length >= 3 && !/^factuur/i.test(l));

  const cleanName = (s: string | null | undefined) => {
    let t = (s || "").trim();
    if (!t) return null;
    // Behoud B.V. / N.V. — strip alleen losse trailing punt
    if (/\b[BN]\.?V\.?$/i.test(t)) {
      return t.replace(/\s+/g, " ").replace(/B\.?V\.?$/i, "B.V.");
    }
    return t.replace(/[.\s]+$/g, "") || null;
  };

  const bedrijfsnaam = cleanName(
    firstMatch(hay, [
      /statutaire\s*naam\s+([A-Za-z0-9][^\n|]{2,70}?)(?=\s+KvK|\s+BTW|\s+IBAN|$)/i,
      /(?:bedrijfsnaam|leverancier|crediteur)[:\s]*([^\n]{3,80})/i,
    ]) ||
      (firstLine &&
      /\b(b\.?v\.?|n\.?v\.?|vof|eenmanszaak|holding|accountants)\b/i.test(
        firstLine
      ) &&
      !/\binvestments\b/i.test(firstLine)
        ? firstLine.slice(0, 80)
        : null) ||
      (firstLine &&
      /\b(b\.?v\.?|n\.?v\.?|vof|eenmanszaak|holding|investments)\b/i.test(
        firstLine
      )
        ? firstLine.slice(0, 80)
        : null) ||
      (opts?.fromName && !/@/.test(opts.fromName)
        ? opts.fromName.trim()
        : null)
  );

  const referentie = firstMatch(hay, [
    /(?:kenmerk|referentie|betalingskenmerk|omschrijving|betreft|payment\s*reference)[:\s]*([A-Z0-9][-A-Z0-9/ ]{2,80})/i,
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
