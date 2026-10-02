import OpenAI from "openai";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions";
import type { SupabaseClient } from "@supabase/supabase-js";
import { downloadInkomendeFactuurBytes } from "@/lib/inkomende-facturen";

export type InvoiceExtract = {
  leverancier: string | null;
  factuurdatum: string | null;
  factuurnummer: string | null;
  bedrag_ex_btw: number | null;
  btw_bedrag: number | null;
  bedrag_inc_btw: number | null;
  valuta: string | null;
  omschrijving: string | null;
  confidence: number;
};

const EXTRACT_PROMPT = `Je leest Nederlandse facturen, bonnetjes en kassabonnen (foto of PDF).
Geef ALLEEN geldige JSON terug (geen markdown, geen uitleg) met dit schema:
{
  "leverancier": string|null,
  "factuurdatum": "YYYY-MM-DD"|null,
  "factuurnummer": string|null,
  "bedrag_ex_btw": number|null,
  "btw_bedrag": number|null,
  "bedrag_inc_btw": number|null,
  "valuta": "EUR"|string|null,
  "omschrijving": string|null,
  "confidence": number
}

Regels:
- Bedragen als numbers met max 2 decimalen (punt als decimaal).
- factuurdatum = document-/factuurdatum, niet betaaldatum of ontvangstdatum.
- Als alleen een totaal zichtbaar is: zet bedrag_inc_btw.
- Als btw 21%/9%/0% duidelijk is en je 1 bedrag hebt, vul ex/btw/inc consistent in.
- leverancier = bedrijfsnaam van de leverancier/winkel.
- confidence tussen 0 en 1 (hoe zeker je bent van de kernvelden).
- Bij onleesbaar/onzeker: null + lagere confidence.`;

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
  return /\.(jpe?g|png|webp|gif|heic)$/i.test(n);
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

  let ex = parseMoney(obj.bedrag_ex_btw);
  let btw = parseMoney(obj.btw_bedrag);
  let inc = parseMoney(obj.bedrag_inc_btw);

  if (inc == null && ex != null && btw != null) inc = roundMoney(ex + btw);
  if (ex == null && inc != null && btw != null) ex = roundMoney(inc - btw);
  if (btw == null && ex != null && inc != null) btw = roundMoney(inc - ex);

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
    factuurdatum: parseDateYmd(obj.factuurdatum),
    factuurnummer:
      typeof obj.factuurnummer === "string" && obj.factuurnummer.trim()
        ? obj.factuurnummer.trim()
        : null,
    bedrag_ex_btw: ex,
    btw_bedrag: btw,
    bedrag_inc_btw: inc,
    valuta:
      typeof obj.valuta === "string" && obj.valuta.trim()
        ? obj.valuta.trim().toUpperCase()
        : "EUR",
    omschrijving:
      typeof obj.omschrijving === "string" && obj.omschrijving.trim()
        ? obj.omschrijving.trim()
        : null,
    confidence,
  };
}

function buildContentParts(input: {
  bytes: Buffer;
  mimeType: string | null;
  filename: string;
  extraText?: string | null;
}): ChatCompletionContentPart[] {
  const parts: ChatCompletionContentPart[] = [
    {
      type: "text",
      text:
        EXTRACT_PROMPT +
        (input.extraText
          ? `\n\nE-mailcontext (onderwerp/body):\n${input.extraText.slice(0, 2500)}`
          : ""),
    },
  ];

  const b64 = input.bytes.toString("base64");
  const mime = (input.mimeType || "").toLowerCase() || "application/octet-stream";

  if (isImageMime(mime, input.filename)) {
    const imgMime = mime.startsWith("image/") ? mime : "image/jpeg";
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${imgMime};base64,${b64}`,
        detail: "high",
      },
    });
    return parts;
  }

  if (isPdfMime(mime, input.filename)) {
    // OpenAI chat completions file input (gpt-4o)
    parts.push({
      type: "file",
      file: {
        filename: input.filename.endsWith(".pdf")
          ? input.filename
          : `${input.filename || "factuur"}.pdf`,
        file_data: `data:application/pdf;base64,${b64}`,
      },
    } as ChatCompletionContentPart);
    return parts;
  }

  // Onbekend type: probeer als image
  parts.push({
    type: "image_url",
    image_url: {
      url: `data:image/jpeg;base64,${b64}`,
      detail: "high",
    },
  });
  return parts;
}

export async function extractInvoiceFromBytes(input: {
  bytes: Buffer;
  mimeType?: string | null;
  filename?: string | null;
  extraText?: string | null;
}): Promise<InvoiceExtract> {
  const client = getClient();
  const filename = input.filename?.trim() || "document";
  const mimeType = input.mimeType || null;

  if (!isImageMime(mimeType, filename) && !isPdfMime(mimeType, filename)) {
    throw new Error(
      `Bestandstype niet ondersteund voor AI-scan (${mimeType || filename})`
    );
  }

  // Soft size guard for API (vision/file)
  if (input.bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error("Bestand te groot voor AI-scan (max ~20 MB)");
  }

  const completion = await client.chat.completions.create({
    model: scanModel(),
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: buildContentParts({
          bytes: input.bytes,
          mimeType,
          filename,
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
    (row as { inkomende_factuur_bestanden?: Array<{
      id: string;
      storage_path: string;
      bestandsnaam: string | null;
      mime_type: string | null;
      content_id: string | null;
    }> }).inkomende_factuur_bestanden || []
  ).filter((b) => {
    // Skip tiny inline cid images when er ook “echte” bijlagen zijn
    return Boolean(b.storage_path);
  });

  const scannable = bestanden.filter(
    (b) =>
      isImageMime(b.mime_type, b.bestandsnaam) ||
      isPdfMime(b.mime_type, b.bestandsnaam)
  );

  if (!scannable.length) {
    throw new Error("Geen scanbare bijlage (PDF of afbeelding) gevonden");
  }

  // Prefer PDF, anders grootste image
  const preferred =
    scannable.find((b) => isPdfMime(b.mime_type, b.bestandsnaam)) ||
    [...scannable].sort((a, b) => {
      // prefer non-cid
      const ac = a.content_id ? 1 : 0;
      const bc = b.content_id ? 1 : 0;
      return ac - bc;
    })[0];

  const downloaded = await downloadInkomendeFactuurBytes(
    sb,
    preferred.storage_path
  );
  if ("error" in downloaded) {
    throw new Error(downloaded.error);
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

  const extract = await extractInvoiceFromBytes({
    bytes: downloaded.bytes,
    mimeType: preferred.mime_type || downloaded.contentType,
    filename: preferred.bestandsnaam || "bijlage",
    extraText,
  });

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
      ai_bestand_id: preferred.id,
    },
  };

  if (extract.leverancier) itemPatch.leverancier = extract.leverancier;
  if (extract.factuurdatum) itemPatch.factuurdatum = extract.factuurdatum;
  if (extract.bedrag_ex_btw != null) itemPatch.bedrag_ex_btw = extract.bedrag_ex_btw;
  if (extract.btw_bedrag != null) itemPatch.btw_bedrag = extract.btw_bedrag;
  if (extract.bedrag_inc_btw != null) itemPatch.bedrag_inc_btw = extract.bedrag_inc_btw;

  if (extract.omschrijving || extract.factuurnummer) {
    const bits = [
      extract.factuurnummer ? `Factuurnr: ${extract.factuurnummer}` : null,
      extract.omschrijving,
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
