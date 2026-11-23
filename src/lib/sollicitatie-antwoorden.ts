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

export type AntwoordBestand = {
  id: string;
  bestandsnaam?: string | null;
};

export function sollicitatieFileHref(
  sollicitatieId: string,
  fileId: string
): string {
  return `/api/instroom/${encodeURIComponent(sollicitatieId)}/files/${encodeURIComponent(fileId)}`;
}

export function isCvLikeAntwoord(vraag: string, antwoord: string): boolean {
  const v = (vraag || "").replace(/\s+/g, " ").trim().toLowerCase();
  const a = (antwoord || "").trim();
  if (/\.(pdf|docx?|rtf)$/i.test(a)) return true;
  if (
    v === "cv" ||
    v.includes("curriculum") ||
    v.includes("resume") ||
    /\bcv\b/.test(v)
  ) {
    return true;
  }
  return false;
}

export function bestandVoorAntwoord(
  vraag: string,
  antwoord: string,
  bestanden: AntwoordBestand[]
): AntwoordBestand | null {
  if (!bestanden.length) return null;
  const name = (antwoord || "").trim().toLowerCase();
  const exact = bestanden.find(
    (b) => (b.bestandsnaam || "").trim().toLowerCase() === name
  );
  if (exact) return exact;
  if (isCvLikeAntwoord(vraag, antwoord)) return bestanden[0] || null;
  return null;
}

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

const SKIP_FILTER_VRAGEN = new Set([
  ...ADRES_ROW_LABELS,
  "Naam",
  "Email",
  "E-mail",
  "Telefoon",
]);

function normalizeVraagKey(vraag: string): string {
  return vraag.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Splits checkbox-antwoorden (`Batterijen · Isolatie`), niet op komma (KvK-opties). */
export function splitKwalificatieAntwoord(antwoord: string): string[] {
  const raw = (antwoord || "").trim();
  if (!raw) return [];
  const parts = raw
    .split(/\s*·\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [raw];
}

export function isKwalificatieFilterVraag(vraag: string): boolean {
  const t = (vraag || "").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (SKIP_FILTER_VRAGEN.has(t)) return false;
  if (/gegevens achter/i.test(t)) return false;
  return true;
}

export function shortKwalificatieVraagLabel(vraag: string): string {
  const t = vraag.replace(/\s+/g, " ").trim();
  const l = t.toLowerCase();
  if (l === "uitslag") return "Uitslag";
  if (l.includes("hoe oud")) return "Leeftijd";
  if (l.includes("rijbewijs")) return "Rijbewijs";
  if (l.includes("kvk")) return "KvK";
  if (/full[- ]?time/.test(l) && /€?\s*10/.test(l)) return "Fulltime / €10k";
  if (/full[- ]?time/.test(l)) return "Fulltime";
  if (l.includes("product")) return "Producten";
  if (l.includes("ervaring")) return "Verduurzaming";
  if (l.includes("verduurzaming")) return "Verduurzaming";
  if (l.includes("markt")) return "Markt";
  if (l.includes("utrecht")) return "Kantoor Utrecht";
  if (l.includes("appointment") || l.includes("telemarketing")) return "Bellen";
  if (t.length <= 32) return t;
  return `${t.slice(0, 30)}…`;
}

function cleanFilterAntwoord(vraag: string, token: string): string | null {
  const raw = token.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  if (shortKwalificatieVraagLabel(vraag) === "Uitslag") {
    if (/geen match/i.test(raw)) return "Geen match";
    if (/in aanmerking/i.test(raw)) return "In aanmerking";
    if (raw.length > 36) return null;
    return raw;
  }
  if (raw.length > 80) return null;
  return raw;
}

export type KwalificatieFilterVraag = {
  /** Stabiele filter-key = korte label (clustered). */
  vraag: string;
  label: string;
  opties: string[];
  count: number;
};

export function collectKwalificatieFilterVragen(
  rowsPerKandidaat: SollicitatieAntwoordRow[][]
): KwalificatieFilterVraag[] {
  const map = new Map<
    string,
    { label: string; opties: Map<string, number>; count: number }
  >();

  for (const rows of rowsPerKandidaat) {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!isKwalificatieFilterVraag(row.vraag)) continue;
      const label = shortKwalificatieVraagLabel(row.vraag);
      if (!label || label === "Functie") continue;
      let entry = map.get(label);
      if (!entry) {
        entry = { label, opties: new Map(), count: 0 };
        map.set(label, entry);
      }
      if (!seen.has(label)) {
        entry.count += 1;
        seen.add(label);
      }
      for (const token of splitKwalificatieAntwoord(row.antwoord)) {
        const clean = cleanFilterAntwoord(row.vraag, token);
        if (!clean) continue;
        entry.opties.set(clean, (entry.opties.get(clean) || 0) + 1);
      }
    }
  }

  const out: KwalificatieFilterVraag[] = [];
  for (const entry of map.values()) {
    let opties = [...entry.opties.entries()]
      .sort(
        (a, b) =>
          b[1] - a[1] || a[0].localeCompare(b[0], "nl", { numeric: true })
      )
      .map(([label]) => label);
    const hasJaNee = opties.some((o) => /^(ja|nee)\b/i.test(o));
    if (hasJaNee) {
      opties = opties.filter((o) => !/^\d+([.,]\d+)?$/.test(o));
    }
    if (opties.length === 0 || opties.length > 40) continue;
    out.push({
      vraag: entry.label,
      label: entry.label,
      opties,
      count: entry.count,
    });
  }

  out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "nl"));
  return out.slice(0, 8);
}

export function kandidaatMatchtKwalificatieFilter(
  rows: SollicitatieAntwoordRow[],
  vraagOfLabel: string,
  gewenst: string
): boolean {
  const want = gewenst.trim().toLowerCase();
  if (!want) return true;
  const key = normalizeVraagKey(vraagOfLabel);
  const labelKey = shortKwalificatieVraagLabel(vraagOfLabel);
  const hits = rows.filter((r) => {
    if (!isKwalificatieFilterVraag(r.vraag)) return false;
    if (normalizeVraagKey(r.vraag) === key) return true;
    return shortKwalificatieVraagLabel(r.vraag) === labelKey;
  });
  if (!hits.length) return false;
  return hits.some((r) => {
    const tokens = [
      r.antwoord.trim(),
      ...splitKwalificatieAntwoord(r.antwoord),
    ]
      .map((t) => cleanFilterAntwoord(r.vraag, t) || t.trim())
      .filter(Boolean);
    return tokens.some((t) => t.toLowerCase() === want);
  });
}
