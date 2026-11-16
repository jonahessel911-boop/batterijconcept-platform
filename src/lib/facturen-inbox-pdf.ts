/**
 * PDF-tekst uitlezen voor Facturen Inbox (bijlage → velden rechts).
 * Fallback: screenshot + OCR als IBAN ontbreekt in de tekstlaag
 * (vaak in footer/grafiek).
 */

import { downloadInboxAttachment } from "@/lib/inbox-attachments";
import type { InboxAttachment } from "@/lib/inbox";

const IBAN_HINT =
  /\bIBAN\b|\bNL\d{2}\s*[A-Z]{4}\s*\d{4}|\b[A-Z]{2}\d{2}\s?[A-Z]{4}/i;

function pageDataToPngBuffer(data: unknown): Buffer | null {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.from(data);
  if (typeof data === "object" && data !== null) {
    const rec = data as Record<string, unknown>;
    if (rec.type === "Buffer" && Array.isArray(rec.data)) {
      return Buffer.from(rec.data as number[]);
    }
    // Numeriek object {0:137,1:80,...} van JSON-achtige serialisatie
    const keys = Object.keys(rec)
      .filter((k) => /^\d+$/.test(k))
      .map(Number)
      .sort((a, b) => a - b);
    if (keys.length > 100 && keys[0] === 0) {
      const arr = new Uint8Array(keys.length);
      for (const i of keys) arr[i] = Number(rec[String(i)]) & 0xff;
      return Buffer.from(arr);
    }
  }
  return null;
}

async function ocrPdfScreenshots(bytes: Buffer): Promise<string> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const shot = await parser.getScreenshot({
        scale: 2,
        // Alleen eerste pagina — IBAN zit vrijwel altijd op p1 footer
        partial: [1],
      } as { scale: number; partial?: number[] });
      const pages = shot?.pages || [];
      if (!pages.length) return "";
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("nld+eng");
      try {
        const parts: string[] = [];
        for (const page of pages.slice(0, 1)) {
          const png = pageDataToPngBuffer(
            (page as { data?: unknown }).data
          );
          if (!png?.length) continue;
          const { data } = await worker.recognize(png);
          if (data?.text?.trim()) parts.push(data.text.trim());
        }
        return parts.join("\n");
      } finally {
        await worker.terminate().catch(() => undefined);
      }
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch (e) {
    console.warn(
      "facturen-inbox-pdf OCR:",
      e instanceof Error ? e.message : e
    );
    return "";
  }
}

export async function extractTextFromPdfBytes(
  bytes: Buffer
): Promise<string> {
  if (!bytes?.length) return "";
  let text = "";
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      text = String(result?.text || "").trim();
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch (e) {
    console.warn(
      "facturen-inbox-pdf:",
      e instanceof Error ? e.message : e
    );
  }

  // Footer-IBAN mist vaak in tekstlaag → OCR
  if (!IBAN_HINT.test(text)) {
    const ocr = await ocrPdfScreenshots(bytes);
    if (ocr) {
      text = text ? `${text}\n\n${ocr}` : ocr;
    }
  }
  return text;
}

/** Eerste PDF-bijlage downloaden + tekst (max ~80k chars). */
export async function extractTextFromMailPdfs(
  attachments: InboxAttachment[] | null | undefined
): Promise<string> {
  const pdfs = (attachments || []).filter(
    (a) =>
      /pdf/i.test(a.contentType || "") || /\.pdf$/i.test(a.filename || "")
  );
  if (!pdfs.length) return "";
  const parts: string[] = [];
  for (const pdf of pdfs.slice(0, 2)) {
    if (!pdf.storagePath) continue;
    const file = await downloadInboxAttachment(pdf.storagePath);
    if (!file?.bytes?.length) continue;
    const text = await extractTextFromPdfBytes(file.bytes);
    if (text) parts.push(text);
  }
  return parts.join("\n\n").slice(0, 80_000);
}
