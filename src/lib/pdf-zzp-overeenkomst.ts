/**
 * ZZP-samenwerkingsovereenkomst: ongewijzigde print-PDF + invulvelden /
 * handtekeningen op pagina 7 (stippellijnen).
 */

import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/** Template: exacte printversie, geen tekstwijzigingen. */
export const ZZP_OVEREENKOMST_TEMPLATE = path.join(
  process.cwd(),
  "assets/contracts/zzp-adviseur-overeenkomst.pdf"
);

/** PyMuPDF top-origin underscore-lijnen op pagina 7. */
const PAGE_H = 841.88977;
const FIELD_X = 262;
const FIELD_W = 280;
const FONT_SIZE = 10;

type LineKey =
  | "ingangsdatum"
  | "bc_naam"
  | "bc_email"
  | "bc_plaats_datum"
  | "bc_handtekening"
  | "adv_naam_onderneming"
  | "adv_handelsnaam"
  | "adv_adres"
  | "adv_postcode_plaats"
  | "adv_kvk"
  | "adv_btw"
  | "adv_email"
  | "adv_iban"
  | "adv_ondertekenaar"
  | "adv_plaats_datum"
  | "adv_handtekening";

/** Underscore bounding boxes (top-origin y0/y1). */
const LINES: Record<LineKey, { y0: number; y1: number }> = {
  ingangsdatum: { y0: 117.25, y1: 128.25 },
  bc_naam: { y0: 166.95, y1: 177.95 },
  bc_email: { y0: 191.8, y1: 202.8 },
  bc_plaats_datum: { y0: 216.65, y1: 227.65 },
  bc_handtekening: { y0: 245.5, y1: 256.5 },
  adv_naam_onderneming: { y0: 293.2, y1: 304.2 },
  adv_handelsnaam: { y0: 318.05, y1: 329.05 },
  adv_adres: { y0: 342.9, y1: 353.9 },
  adv_postcode_plaats: { y0: 367.75, y1: 378.75 },
  adv_kvk: { y0: 392.6, y1: 403.6 },
  adv_btw: { y0: 417.45, y1: 428.45 },
  adv_email: { y0: 442.3, y1: 453.3 },
  adv_iban: { y0: 467.15, y1: 478.15 },
  adv_ondertekenaar: { y0: 492.0, y1: 503.0 },
  adv_plaats_datum: { y0: 516.85, y1: 527.85 },
  adv_handtekening: { y0: 545.7, y1: 556.7 },
};

export type ZzpContractFields = {
  ingangsdatum?: string | null;
  bc_naam?: string | null;
  bc_email?: string | null;
  bc_plaats_datum?: string | null;
  adv_naam_onderneming?: string | null;
  adv_handelsnaam?: string | null;
  adv_adres?: string | null;
  adv_postcode_plaats?: string | null;
  adv_kvk?: string | null;
  adv_btw?: string | null;
  adv_email?: string | null;
  adv_iban?: string | null;
  adv_ondertekenaar?: string | null;
  adv_plaats_datum?: string | null;
};

export type ZzpContractSignatures = {
  /** data:image/… PNG/JPEG */
  bc_handtekening?: string | null;
  adv_handtekening?: string | null;
};

function baselineY(line: { y0: number; y1: number }): number {
  // Tekst net boven de stippellijn
  return PAGE_H - line.y1 + 3;
}

function signatureY(line: { y0: number; y1: number }, height: number): number {
  // Handtekening ÓNDER de stippellijn — daar is genoeg ruimte tot de voettekst
  return PAGE_H - line.y1 - height - 2;
}

async function embedDataUrl(
  doc: PDFDocument,
  dataUrl: string
): Promise<Awaited<ReturnType<PDFDocument["embedPng"]>> | null> {
  const m = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  if (/png/i.test(m[1])) return doc.embedPng(bytes);
  return doc.embedJpg(bytes);
}

function drawFieldText(
  page: ReturnType<PDFDocument["getPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  key: Exclude<LineKey, "bc_handtekening" | "adv_handtekening">,
  value: string | null | undefined
) {
  const v = (value || "").trim();
  if (!v) return;
  const line = LINES[key];
  const maxLen = 62;
  const text = v.length > maxLen ? `${v.slice(0, maxLen - 1)}…` : v;
  page.drawText(text, {
    x: FIELD_X,
    y: baselineY(line),
    size: FONT_SIZE,
    font,
    color: rgb(0.08, 0.1, 0.09),
    maxWidth: FIELD_W,
  });
}

/**
 * Bouwt PDF: originele overeenkomst + ingevulde stippellijnen + handtekeningen.
 */
export async function buildZzpOvereenkomstPdf(opts: {
  fields: ZzpContractFields;
  signatures?: ZzpContractSignatures;
}): Promise<Uint8Array> {
  const templateBytes = await readFile(ZZP_OVEREENKOMST_TEMPLATE);
  const doc = await PDFDocument.load(templateBytes, {
    updateMetadata: false,
  });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const page = pages[6];
  if (!page) {
    throw new Error("ZZP-overeenkomst template mist pagina 7");
  }

  // Geen BC-handtekening: witvlak over “Plaats en datum” + “Handtekening”
  // onder “Voor BatterijConcept” (alleen adviseur tekent).
  const coverTop = LINES.bc_plaats_datum.y0 - 4;
  const coverBottom = LINES.adv_naam_onderneming.y0 - 8;
  page.drawRectangle({
    x: 48,
    y: PAGE_H - coverBottom,
    width: 500,
    height: coverBottom - coverTop,
    color: rgb(1, 1, 1),
  });

  const f = opts.fields;
  drawFieldText(page, font, "ingangsdatum", f.ingangsdatum);
  drawFieldText(page, font, "bc_naam", f.bc_naam);
  drawFieldText(page, font, "bc_email", f.bc_email);
  drawFieldText(page, font, "adv_naam_onderneming", f.adv_naam_onderneming);
  drawFieldText(page, font, "adv_handelsnaam", f.adv_handelsnaam);
  drawFieldText(page, font, "adv_adres", f.adv_adres);
  drawFieldText(page, font, "adv_postcode_plaats", f.adv_postcode_plaats);
  drawFieldText(page, font, "adv_kvk", f.adv_kvk);
  drawFieldText(page, font, "adv_btw", f.adv_btw);
  drawFieldText(page, font, "adv_email", f.adv_email);
  drawFieldText(page, font, "adv_iban", f.adv_iban);
  drawFieldText(page, font, "adv_ondertekenaar", f.adv_ondertekenaar);
  drawFieldText(page, font, "adv_plaats_datum", f.adv_plaats_datum);

  const advSig = opts.signatures?.adv_handtekening;
  if (advSig) {
    const img = await embedDataUrl(doc, advSig);
    if (img) {
      const line = LINES.adv_handtekening;
      const maxW = 280;
      const maxH = 72;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: FIELD_X,
        y: signatureY(line, h),
        width: w,
        height: h,
      });
    }
  }

  return doc.save({ useObjectStreams: false });
}
