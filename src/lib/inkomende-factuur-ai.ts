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
  confidence: number;
};

const EXTRACT_PROMPT = `Je bent een Nederlandse boekhouder-assistent. Je leest facturen, bonnetjes en kassabonnen uit foto's of PDF's.

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
  "confidence": number
}

Regels (strikt):
1. Lees ALLE bedragen die je ziet: subtotaal excl. btw, btw-regel(s), en totaal incl. btw.
2. bedrag_inc_btw = te betalen totaal (incl. btw). bedrag_ex_btw = excl. btw. btw_bedrag = som van alle btw.
3. Als je alleen "totaal" ziet zonder btw-splitsing: zet bedrag_inc_btw. Vul ex/btw in als btw-percentage (21/9/0) zichtbaar is.
4. Als je excl. + btw ziet: bereken incl. Als je incl. + btw% ziet: bereken excl. en btw.
5. btw_pct = 21, 9 of 0 als duidelijk; anders null. Bij gemengde tarieven: null en vul wel btw_bedrag.
6. factuurdatum = document-/factuurdatum (niet vandaag, niet ontvangstdatum e-mail).
7. boekperiode = maand waarin dit geboekt moet worden = YYYY-MM van de factuurdatum. Gebruik factuurdatum, nooit de scan-datum.
8. omschrijving = kort (max ~120 tekens) waarvóór: product/dienst/regel (bijv. "Installatiemateriaal", "Benzine tankstation", "Hosting Q3").
9. leverancier = bedrijfs-/winkelnaam van de leverancier.
10. Bedragen als numbers met max 2 decimalen (punt als decimaalteken). Nederlandse notatie zoals 1.234,56 omzetten.
11. confidence 0–1: hoog alleen als datum + totaal betrouwbaar zijn.
12. Bij onleesbaar: null + lagere confidence. Verzin nooit bedragen.`;

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
    leverancier:
      typeof obj.leverancier === "string" && obj.leverancier.trim()
        ? obj.leverancier.trim()
        : null,
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
    confidence,
  };
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

  const itemPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    raw_payload: {
      ...prevRaw,
      ai_extract: extract,
      ai_scanned_at: new Date().toISOString(),
      ai_bestand_ids: selected.map((s) => s.id),
    },
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
