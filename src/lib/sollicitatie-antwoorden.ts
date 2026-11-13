/**
 * Parse sollicitatie.notitie → leesbare vraag/antwoord-rijen.
 * Ondersteunt:
 * - "Vraag: … Antwoord: …"
 * - "— Sollicitatieformulier —" + "label: waarde" regels
 */

const QUIZ_FIELD_LABELS = [
  "Postcode",
  "Huisnummer",
  "Toevoeging",
  "Straat",
  "Plaats",
  "Provincie",
  "Adres",
  "Uitslag",
] as const;

const ADRES_ROW_LABELS = new Set([
  "Postcode",
  "Huisnummer",
  "Toevoeging",
  "Straat",
  "Plaats",
  "Provincie",
  "Adres",
]);

export type SollicitatieAntwoordRow = {
  vraag: string;
  antwoord: string;
};

export type AdresVoorAntwoorden = {
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
};

/** Haal teamnotities (`[2026-…]` / `[12-11-2026 …]`) uit de quiz-tekst. */
function stripTrailingTeamNotes(raw: string): string {
  const lines = raw.split("\n");
  const cut = lines.findIndex(
    (l, i) =>
      i > 0 &&
      (/^\[\d{4}-\d{2}-\d{2}T/.test(l.trim()) ||
        /^\[\d{1,2}[-./]\d{1,2}[-./]\d{2,4}/.test(l.trim()))
  );
  if (cut === -1) return raw;
  return lines.slice(0, cut).join("\n").trim();
}

function cleanFieldValue(value: string): string {
  const cut = value.search(/\n?\s*\[\d{4}-\d{2}-\d{2}T/);
  if (cut >= 0) return value.slice(0, cut).trim();
  const cutNl = value.search(/\n?\s*\[\d{1,2}[-./]\d{1,2}[-./]\d{2,4}/);
  if (cutNl >= 0) return value.slice(0, cutNl).trim();
  return value.trim();
}

function extractLabeledFields(
  text: string
): { preamble: string; fields: Array<{ label: string; value: string }> } {
  const labelRe = new RegExp(
    `(${QUIZ_FIELD_LABELS.join("|")})\\s*:\\s*`,
    "gi"
  );
  const matches: Array<{ label: string; index: number; valueStart: number }> =
    [];
  let m: RegExpExecArray | null;
  while ((m = labelRe.exec(text))) {
    matches.push({
      label: m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase(),
      index: m.index,
      valueStart: m.index + m[0].length,
    });
  }
  if (!matches.length) {
    return { preamble: text.trim(), fields: [] };
  }
  const preamble = text.slice(0, matches[0]!.index).trim();
  const fields = matches.map((hit, i) => {
    const end = i + 1 < matches.length ? matches[i + 1]!.index : text.length;
    return {
      label: hit.label,
      value: cleanFieldValue(text.slice(hit.valueStart, end)),
    };
  });
  for (const f of fields) {
    const canon = QUIZ_FIELD_LABELS.find(
      (l) => l.toLowerCase() === f.label.toLowerCase()
    );
    if (canon) f.label = canon;
  }
  return { preamble, fields };
}

function parseVraagAntwoordBlocks(raw: string): SollicitatieAntwoordRow[] {
  const pairs: SollicitatieAntwoordRow[] = [];
  const re =
    /Vraag:\s*([\s\S]*?)\s*Antwoord:\s*([\s\S]*?)(?=(?:\n\s*Vraag:)|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const vraag = m[1]!.trim();
    const antwoord = cleanFieldValue(m[2]!.trim());
    if (!vraag && !antwoord) continue;
    const { preamble, fields } = extractLabeledFields(antwoord);
    if (!fields.length) {
      pairs.push({ vraag, antwoord });
      continue;
    }
    if (preamble) pairs.push({ vraag, antwoord: preamble });
    for (const f of fields) {
      if (!f.value) continue;
      pairs.push({ vraag: f.label, antwoord: f.value });
    }
  }
  return pairs;
}

function parseFormulierLines(raw: string): SollicitatieAntwoordRow[] {
  const lines = raw
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: SollicitatieAntwoordRow[] = [];
  for (const line of lines) {
    if (/^—\s*Sollicitatieformulier/i.test(line)) continue;
    if (/^Vraag:/i.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const vraag = line.slice(0, colon).trim();
    const antwoord = cleanFieldValue(line.slice(colon + 1));
    if (!vraag || !antwoord) continue;
    if (/^\[/.test(vraag)) continue;
    out.push({ vraag, antwoord });
  }
  return out;
}

export function isQuizNotitieText(text: string): boolean {
  if (/Vraag:\s*[\s\S]*?\s*Antwoord:/i.test(text)) return true;
  if (/Sollicitatieformulier/i.test(text)) return true;
  return false;
}

/** Vraag/antwoord-rijen uit de volledige notitie. */
export function parseSollicitatieAntwoordRows(
  notitie: string | null | undefined
): SollicitatieAntwoordRow[] {
  const raw = stripTrailingTeamNotes((notitie || "").trim());
  if (!raw) return [];

  const fromBlocks = parseVraagAntwoordBlocks(raw);
  if (fromBlocks.length) return fromBlocks;

  const formPart = raw.includes("Sollicitatieformulier")
    ? raw.slice(raw.search(/Sollicitatieformulier/i))
    : raw;
  return parseFormulierLines(formPart);
}

/**
 * Vul/verrijk adresrijen (straat, huisnr, postcode, plaats, provincie)
 * met opgeslagen kolommen — zichtbaar in de antwoordenlijst.
 */
export function enrichAntwoordRowsWithAdres(
  rows: SollicitatieAntwoordRow[],
  adres: AdresVoorAntwoorden,
  provincie?: string | null
): SollicitatieAntwoordRow[] {
  const fromRows = (label: string) =>
    rows.find((r) => r.vraag.toLowerCase() === label.toLowerCase())?.antwoord
      ?.trim() || "";

  const scrub = (value: string) =>
    value
      .replace(
        /\s*(Postcode|Huisnummer|Toevoeging|Straat|Plaats|Provincie|Adres|Uitslag)\s*:?.*$/i,
        ""
      )
      .trim();

  const straat = scrub((adres.straat || "").trim() || fromRows("Straat"));
  const hnRaw =
    [adres.huisnummer, adres.toevoeging].filter(Boolean).join(" ").trim() ||
    fromRows("Huisnummer");
  const hn = scrub(hnRaw).replace(/\s+Uitslag\b.*$/i, "").trim();
  const pc = scrub((adres.postcode || "").trim() || fromRows("Postcode"));
  const plaats = scrub((adres.plaats || "").trim() || fromRows("Plaats"));
  const prov = scrub(
    (provincie || "").trim() && (provincie || "").trim() !== "(onbekend)"
      ? (provincie || "").trim()
      : fromRows("Provincie")
  );

  const adresBlock: SollicitatieAntwoordRow[] = [
    straat ? { vraag: "Straat", antwoord: straat } : null,
    hn ? { vraag: "Huisnummer", antwoord: hn } : null,
    pc ? { vraag: "Postcode", antwoord: pc } : null,
    plaats ? { vraag: "Plaats", antwoord: plaats } : null,
    prov ? { vraag: "Provincie", antwoord: prov } : null,
  ].filter((r): r is SollicitatieAntwoordRow => Boolean(r));

  if (!adresBlock.length) return rows;

  const quizOnly = rows.filter(
    (r) => !ADRES_ROW_LABELS.has(r.vraag) && r.vraag !== "Uitslag"
  );
  const uitslag = rows.find((r) => r.vraag === "Uitslag");
  return [
    ...quizOnly,
    ...adresBlock,
    ...(uitslag
      ? [{ vraag: "Uitslag", antwoord: cleanFieldValue(uitslag.antwoord) }]
      : []),
  ];
}
