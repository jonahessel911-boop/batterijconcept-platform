import OpenAI from "openai";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadInkomendeFactuurBytes } from "@/lib/inkomende-facturen";

export type InvoiceExtract = {
  leverancier: string | null;
  factuurdatum: string | null;
  /** Boekperiode YYYY-MM (meestal maand van factuurdatum) */
  boekperiode: string | null;
  factuurnummer: string | null;
  bedrag_ex_btw: number | null;
  btw_bedrag: number | null;
  bedrag_inc_btw: number | null;
  btw_pct: number | null;
  valuta: string | null;
  /** Korte omschrijving: waarvoor de factuur is */
  omschrijving: string | null;
  iban: string | null;
  referentie: string | null;
  vervaldatum: string | null;
  confidence: number;
};

const EXTRACT_PROMPT = `Je bent de boekhouder-assistent van Batterijconcept (ook: BatterijConcept, Batterij Concept).
Wij zijn de ONTVANGER / KLANT op elke inkomende factuur. Jij leest de factuur van de LEVERANCIER uit.

Geef ALLEEN geldige JSON terug (geen markdown) met dit schema:
{
  "leverancier": string|null,
  "factuurdatum": "YYYY-MM-DD"|null,
  "boekperiode": "YYYY-MM"|null,
  "factuurnummer": string|null,
  "bedrag_ex_btw": number|null,
  "btw_bedrag": number|null,
  "bedrag_inc_btw": number|null,
  "btw_pct": number|null,
  "valuta": "EUR"|string|null,
  "omschrijving": string|null,
  "iban": string|null,
  "referentie": string|null,
  "vervaldatum": "YYYY-MM-DD"|null,
  "confidence": number
}

Regels (strikt):
1. leverancier = wie de factuur STUURT (Autohopper, JDJ, Finc Accountants, …). NOOIT Batterijconcept / BatterijConcept / Jona Hessel / onze Daltonlaan-adresregel. Dat is WIJ (klant). Als het document "Batterijconcept" als geadresseerde toont, is dat niet de leverancier.
2. factuurnummer = factuurnr / invoice number / reserveringsnummer / bevestigingsnummer (bijv. 1459746). Gebruik # of "Betreft" als er geen aparte factuurnr-regel is.
3. Lees ALLE bedragen: Prijs excl. BTW, BTW 21%/9%, Prijs incl. BTW. bedrag_inc_btw = te betalen totaal (niet borg, niet extra km, niet eigen risico — tenzij dat het enige totaal is).
4. Voorbeeld Autohopper: "Prijs excl. BTW 506,00" + "BTW 21% 106,26" + "Prijs incl. BTW 612,26" → ex=506, btw=106.26, inc=612.26. Borg 1362,26 is GEEN factuurtotaal.
5. Als je alleen totaal ziet: zet bedrag_inc_btw. Vul ex/btw als percentage zichtbaar is (21/9/0).
6. Als je excl. + btw ziet: bereken incl. Als je incl. + btw% ziet: bereken excl. en btw.
7. factuurdatum = documentdatum (Den Bosch, 09-10-2026 → 2026-10-09). Niet vandaag, niet mail-ontvangst.
8. boekperiode = YYYY-MM van factuurdatum.
9. iban = IBAN van de LEVERANCIER om naartoe te betalen (NL + 16 tekens, spaties eruit). Niet onze Batterijconcept-IBAN tenzij dat expliciet de begunstigde is.
10. referentie = betalingskenmerk / reserveringsnummer / "Betreft".
11. vervaldatum indien aanwezig.
12. omschrijving kort (max ~120 tekens): waarvoor (bijv. "Autohopper huurauto BSUVA").
13. Bedragen als numbers, max 2 decimalen, punt als decimaal. NL 1.234,56 → 1234.56.
14. confidence 0–1. Verzin nooit bedragen of namen.`;

function getClient(): OpenAI {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "OPENAI_API_KEY ontbreekt. Zet deze in Vercel → Environment Variables."
    );
  }
  return new OpenAI({ apiKey: key });
}

export function openaiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function scanModel(): string {
  return (
    process.env.OPENAI_SCAN_MODEL?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-4o"
  );
}

function isImageMime(mime: string | null | undefined, name?: string | null): boolean {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return true;
  const n = (name || "").toLowerCase();
  return /\.(jpe?g|png|webp|gif)$/i.test(n);
}

function isPdfMime(mime: string | null | undefined, name?: string | null): boolean {
  const m = (mime || "").toLowerCase();
  if (m === "application/pdf" || m === "application/x-pdf") return true;
  return /\.pdf$/i.test(name || "");
}

function roundMoney(n: number | null): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

function parseMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return roundMoney(value);
  if (typeof value !== "string") return null;
  let normalized = value.replace(/€/g, "").trim().replace(/\s/g, "");
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(normalized)) {
    normalized = normalized.replace(",", ".");
  } else {
    normalized = normalized.replace(/[^\d.-]/g, "");
  }
  const n = Number(normalized);
  return Number.isFinite(n) ? roundMoney(n) : null;
}

function parseDateYmd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(t);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    return `${m[3]}-${mo}-${d}`;
  }
  const dt = new Date(t);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

function parseBoekperiode(value: unknown, factuurdatum: string | null): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d{4}-\d{2}$/.test(t)) return t;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t.slice(0, 7);
  }
  if (factuurdatum && /^\d{4}-\d{2}-\d{2}$/.test(factuurdatum)) {
    return factuurdatum.slice(0, 7);
  }
  return null;
}

function parseBtwPct(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const n = Math.round(value);
    if (n === 0 || n === 9 || n === 21) return n;
    return null;
  }
  if (typeof value === "string") {
    const m = /(\d{1,2})/.exec(value);
    if (!m) return null;
    const n = Number(m[1]);
    if (n === 0 || n === 9 || n === 21) return n;
  }
  return null;
}

function reconcileAmounts(
  ex: number | null,
  btw: number | null,
  inc: number | null,
  btwPct: number | null
): { ex: number | null; btw: number | null; inc: number | null } {
  let e = ex;
  let b = btw;
  let i = inc;

  if (i == null && e != null && b != null) i = roundMoney(e + b);
  if (e == null && i != null && b != null) e = roundMoney(i - b);
  if (b == null && e != null && i != null) b = roundMoney(i - e);

  // Alleen totaal + btw% → vul ex/btw
  if (i != null && e == null && b == null && btwPct != null && btwPct > 0) {
    e = roundMoney(i / (1 + btwPct / 100));
    b = roundMoney(i - (e ?? 0));
  }
  if (e != null && i == null && b == null && btwPct != null && btwPct > 0) {
    b = roundMoney(e * (btwPct / 100));
    i = roundMoney(e + (b ?? 0));
  }

  return { ex: e, btw: b, inc: i };
}

function parseExtractJson(raw: string): InvoiceExtract {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    }
  }

  const factuurdatum = parseDateYmd(obj.factuurdatum);
  const btwPct = parseBtwPct(obj.btw_pct);
  const amounts = reconcileAmounts(
    parseMoney(obj.bedrag_ex_btw),
    parseMoney(obj.btw_bedrag),
    parseMoney(obj.bedrag_inc_btw),
    btwPct
  );

  const confidenceRaw = obj.confidence;
  let confidence = 0.5;
  if (typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw)) {
    confidence = Math.min(1, Math.max(0, confidenceRaw));
  }

  return {
    leverancier: (() => {
      const raw =
        typeof obj.leverancier === "string" && obj.leverancier.trim()
          ? obj.leverancier.trim()
          : null;
      return isOnzeBedrijfsnaam(raw) ? null : raw;
    })(),
    factuurdatum,
    boekperiode: parseBoekperiode(obj.boekperiode, factuurdatum),
    factuurnummer:
      typeof obj.factuurnummer === "string" && obj.factuurnummer.trim()
        ? obj.factuurnummer.trim()
        : null,
    bedrag_ex_btw: amounts.ex,
    btw_bedrag: amounts.btw,
    bedrag_inc_btw: amounts.inc,
    btw_pct: btwPct,
    valuta:
      typeof obj.valuta === "string" && obj.valuta.trim()
        ? obj.valuta.trim().toUpperCase()
        : "EUR",
    omschrijving:
      typeof obj.omschrijving === "string" && obj.omschrijving.trim()
        ? obj.omschrijving.trim().slice(0, 200)
        : null,
    iban: normalizeExtractIban(obj.iban),
    referentie:
      typeof obj.referentie === "string" && obj.referentie.trim()
        ? obj.referentie.trim().slice(0, 120)
        : null,
    vervaldatum: parseDateYmd(obj.vervaldatum),
    confidence,
  };
}

function normalizeExtractIban(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (iban.startsWith("NL")) {
    const clipped = iban.slice(0, 18);
    return /^NL\d{2}[A-Z]{4}\d{10}$/.test(clipped) ? clipped : null;
  }
  if (iban.length >= 15 && iban.length <= 34) return iban;
  return null;
}

function isOnzeBedrijfsnaam(naam: string | null): boolean {
  if (!naam) return false;
  return /batterij\s*concept|jona\s+hessel/i.test(naam);
}

type ScanFile = {
  bytes: Buffer;
  mimeType: string | null;
  filename: string;
};

function buildContentParts(input: {
  files: ScanFile[];
  extraText?: string | null;
}): ChatCompletionContentPart[] {
  const parts: ChatCompletionContentPart[] = [
    {
      type: "text",
      text:
        EXTRACT_PROMPT +
        (input.extraText
          ? `\n\nE-mailcontext (onderwerp/body):\n${input.extraText.slice(0, 2500)}`
          : "") +
        (input.files.length > 1
          ? `\n\nEr zijn ${input.files.length} bijlagen (foto's/PDF). Combineer informatie uit alle pagina's.`
          : ""),
    },
  ];

  for (const file of input.files) {
    const b64 = file.bytes.toString("base64");
    const mime =
      (file.mimeType || "").toLowerCase() || "application/octet-stream";
    const filename = file.filename;

    if (isImageMime(mime, filename)) {
      const imgMime = mime.startsWith("image/") ? mime : "image/jpeg";
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${imgMime};base64,${b64}`,
          detail: "high",
        },
      });
      continue;
    }

    if (isPdfMime(mime, filename)) {
      parts.push({
        type: "file",
        file: {
          filename: filename.endsWith(".pdf")
            ? filename
            : `${filename || "factuur"}.pdf`,
          file_data: `data:application/pdf;base64,${b64}`,
        },
      } as ChatCompletionContentPart);
      continue;
    }

    parts.push({
      type: "image_url",
      image_url: {
        url: `data:image/jpeg;base64,${b64}`,
        detail: "high",
      },
    });
  }

  return parts;
}

export async function extractInvoiceFromBytes(input: {
  bytes: Buffer;
  mimeType?: string | null;
  filename?: string | null;
  extraText?: string | null;
}): Promise<InvoiceExtract> {
  return extractInvoiceFromFiles({
    files: [
      {
        bytes: input.bytes,
        mimeType: input.mimeType || null,
        filename: input.filename?.trim() || "document",
      },
    ],
    extraText: input.extraText,
  });
}

export async function extractInvoiceFromFiles(input: {
  files: ScanFile[];
  extraText?: string | null;
}): Promise<InvoiceExtract> {
  const client = getClient();
  if (!input.files.length) {
    throw new Error("Geen bestanden om te scannen");
  }

  for (const f of input.files) {
    if (!isImageMime(f.mimeType, f.filename) && !isPdfMime(f.mimeType, f.filename)) {
      throw new Error(
        `Bestandstype niet ondersteund voor AI-scan (${f.mimeType || f.filename})`
      );
    }
    if (f.bytes.byteLength > 20 * 1024 * 1024) {
      throw new Error("Bestand te groot voor AI-scan (max ~20 MB)");
    }
  }

  const completion = await client.chat.completions.create({
    model: scanModel(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: buildContentParts({
          files: input.files,
          extraText: input.extraText,
        }),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content || "";
  if (!raw.trim()) {
    throw new Error("AI gaf geen resultaat");
  }
  return parseExtractJson(raw);
}

export type ScanAndBookResult = {
  extract: InvoiceExtract;
  itemPatch: Record<string, unknown>;
  booked: boolean;
};

/**
 * Scan bijlagen van een inkomende factuur en bouw DB-patch.
 * Boekt (status=geboekt) als er een factuurdatum + bedrag is.
 */
export async function scanInkomendeFactuur(
  sb: SupabaseClient,
  factuurId: string
): Promise<ScanAndBookResult> {
  const { data: row, error } = await sb
    .from("inkomende_facturen")
    .select(
      "id, subject, body_text, from_name, from_email, leverancier, raw_payload, status, inkomende_factuur_bestanden(id, storage_path, bestandsnaam, mime_type, grootte_bytes, content_id)"
    )
    .eq("id", factuurId)
    .single();

  if (error || !row) {
    throw new Error(error?.message || "Factuur niet gevonden");
  }

  const bestanden = (
    (row as {
      inkomende_factuur_bestanden?: Array<{
        id: string;
        storage_path: string;
        bestandsnaam: string | null;
        mime_type: string | null;
        content_id: string | null;
        grootte_bytes: number | null;
      }>;
    }).inkomende_factuur_bestanden || []
  ).filter((b) => Boolean(b.storage_path));

  const scannable = bestanden.filter(
    (b) =>
      isImageMime(b.mime_type, b.bestandsnaam) ||
      isPdfMime(b.mime_type, b.bestandsnaam)
  );

  if (!scannable.length) {
    throw new Error("Geen scanbare bijlage (PDF of afbeelding) gevonden");
  }

  const pdfs = scannable.filter((b) => isPdfMime(b.mime_type, b.bestandsnaam));
  const images = scannable
    .filter((b) => isImageMime(b.mime_type, b.bestandsnaam))
    .sort((a, b) => {
      // Prefer non-cid (echte bijlagen) en grotere bestanden
      const ac = a.content_id ? 1 : 0;
      const bc = b.content_id ? 1 : 0;
      if (ac !== bc) return ac - bc;
      return (b.grootte_bytes || 0) - (a.grootte_bytes || 0);
    });

  // PDF eerst (max 1), anders tot 3 foto's (voor multi-page bonnetjes)
  const selected = pdfs.length
    ? pdfs.slice(0, 1)
    : images.slice(0, 3);

  const files: ScanFile[] = [];
  for (const pref of selected) {
    const downloaded = await downloadInkomendeFactuurBytes(sb, pref.storage_path);
    if ("error" in downloaded) {
      throw new Error(downloaded.error);
    }
    files.push({
      bytes: downloaded.bytes,
      mimeType: pref.mime_type || downloaded.contentType,
      filename: pref.bestandsnaam || "bijlage",
    });
  }

  const extraText = [
    row.subject ? `Onderwerp: ${row.subject}` : null,
    row.from_name || row.from_email
      ? `Afzender: ${row.from_name || ""} ${row.from_email || ""}`.trim()
      : null,
    row.body_text ? `Body:\n${String(row.body_text).slice(0, 1500)}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const extract = await extractInvoiceFromFiles({ files, extraText });

  const booked = Boolean(
    extract.factuurdatum &&
      (extract.bedrag_inc_btw != null || extract.bedrag_ex_btw != null) &&
      extract.confidence >= 0.45
  );

  const prevRaw =
    row.raw_payload && typeof row.raw_payload === "object"
      ? (row.raw_payload as Record<string, unknown>)
      : {};

  const nextRaw: Record<string, unknown> = {
    ...prevRaw,
    ai_extract: extract,
    ai_scanned_at: new Date().toISOString(),
    ai_bestand_ids: selected.map((s) => s.id),
  };
  delete nextRaw.ai_error;
  delete nextRaw.ai_error_at;

  const itemPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    raw_payload: nextRaw,
  };

  if (extract.leverancier) itemPatch.leverancier = extract.leverancier;
  if (extract.factuurdatum) itemPatch.factuurdatum = extract.factuurdatum;
  if (extract.bedrag_ex_btw != null) itemPatch.bedrag_ex_btw = extract.bedrag_ex_btw;
  if (extract.btw_bedrag != null) itemPatch.btw_bedrag = extract.btw_bedrag;
  if (extract.bedrag_inc_btw != null) itemPatch.bedrag_inc_btw = extract.bedrag_inc_btw;

  if (extract.omschrijving || extract.factuurnummer || extract.boekperiode) {
    const bits = [
      extract.omschrijving ? `Waarvoor: ${extract.omschrijving}` : null,
      extract.factuurnummer ? `Factuurnr: ${extract.factuurnummer}` : null,
      extract.boekperiode ? `Boekperiode: ${extract.boekperiode}` : null,
      extract.btw_pct != null ? `BTW: ${extract.btw_pct}%` : null,
    ].filter(Boolean);
    itemPatch.notitie = bits.join("\n");
  }

  if (booked) {
    itemPatch.status = "geboekt";
  } else if (row.status === "nieuw") {
    itemPatch.status = "in_behandeling";
  }

  return { extract, itemPatch, booked };
}

export async function scanAndPersistInkomendeFactuur(
  sb: SupabaseClient,
  factuurId: string
) {
  const { extract, itemPatch, booked } = await scanInkomendeFactuur(sb, factuurId);
  const { data, error } = await sb
    .from("inkomende_facturen")
    .update(itemPatch)
    .eq("id", factuurId)
    .select(
      "id, postmark_message_id, from_email, from_name, to_email, subject, body_text, received_at, status, leverancier, bedrag_ex_btw, btw_bedrag, bedrag_inc_btw, factuurdatum, project_id, notitie, created_at, updated_at"
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Opslaan na scan mislukt");
  }

  return { item: data, extract, booked };
}
