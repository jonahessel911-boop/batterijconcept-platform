import { jsPDF } from "jspdf";
import type { Offerte, OfferteRegel } from "@/types/database";
import { formatDateNl, formatDateTimeNl, formatEuro } from "@/lib/format";
import { companyInfo, loadLogoDataUrl } from "@/lib/pdf-brand";
import { offerteRegelsVoorWeergave } from "@/lib/offerte-regels";

type SignPayload = {
  naam: string;
  handtekeningDataUrl: string;
  ondertekendOp: Date;
};

type PdfInput = {
  offerte: Offerte;
  regels: OfferteRegel[];
  sign?: SignPayload;
  adres?: string;
};

const GREEN: [number, number, number] = [26, 138, 62];
const DEEPER: [number, number, number] = [10, 71, 39];
const MINT: [number, number, number] = [62, 207, 142];
const ORANGE: [number, number, number] = [196, 90, 18];
const INK: [number, number, number] = [26, 31, 28];
const MUTED: [number, number, number] = [90, 99, 92];
const LINE: [number, number, number] = [226, 232, 228];
const WASH: [number, number, number] = [244, 248, 245];
const SOFT: [number, number, number] = [232, 246, 236];
const DATUM_BG: [number, number, number] = [232, 236, 233];
const FIELD_BORDER: [number, number, number] = [213, 224, 216];

function ensureSpace(
  doc: jsPDF,
  y: number,
  need: number,
  pageW: number,
  margin: number
): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need < pageH - 18) return y;
  drawCornerAccent(doc, pageW, pageH);
  doc.addPage();
  return 18;
}

/** Zelfde diagonale header als de ondertekenpagina. */
function drawDiagonalHeader(doc: jsPDF, pageW: number) {
  doc.setFillColor(...DEEPER);
  doc.triangle(0, 0, pageW, 0, 0, 68, "F");
  doc.setFillColor(...GREEN);
  doc.triangle(0, 0, pageW * 0.72, 0, 0, 54, "F");
  doc.setFillColor(...MINT);
  doc.triangle(pageW * 0.35, 0, pageW, 0, pageW, 36, "F");
}

function drawCornerAccent(doc: jsPDF, pageW: number, pageH: number) {
  doc.setFillColor(...GREEN);
  doc.triangle(pageW, pageH - 36, pageW, pageH, pageW - 48, pageH, "F");
  doc.setFillColor(...MINT);
  doc.triangle(pageW, pageH - 18, pageW, pageH, pageW - 24, pageH, "F");
}

function embedSignature(
  doc: jsPDF,
  dataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number
) {
  if (!dataUrl.startsWith("data:image")) {
    throw new Error("Handtekening ontbreekt in de PDF");
  }
  const jpeg = /image\/jpe?g/i.test(dataUrl);
  const formats = jpeg ? (["JPEG", "PNG"] as const) : (["PNG", "JPEG"] as const);
  const alias = `handtekening-${Math.random().toString(36).slice(2, 8)}`;
  let lastErr: unknown;
  for (const format of formats) {
    try {
      doc.addImage(dataUrl, format, x, y, w, h, alias, "FAST");
      return;
    } catch (err) {
      lastErr = err;
    }
    try {
      const b64 = dataUrl.split(",")[1];
      if (b64) {
        doc.addImage(b64, format, x, y, w, h, alias, "FAST");
        return;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("Handtekening kon niet in de PDF worden gezet");
}

/**
 * PDF 1-op-1 met de ondertekenpagina.
 * Bij `sign`: naam, handtekening en onderteken-datum/tijd (Europe/Amsterdam) ingevuld.
 */
export async function buildOffertePdf(input: PdfInput): Promise<Blob> {
  const { offerte, regels, sign, adres } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageW - margin * 2;
  const co = companyInfo();

  drawDiagonalHeader(doc, pageW);

  // —— Header: OFFERTE links, logo + bedrijf rechts ——
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...INK);
  doc.text("OFFERTE", margin, 26);

  const logo = loadLogoDataUrl();
  const rightX = pageW - margin;
  const logoSize = 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const word = "Batterij";
  const word2 = "concept";
  const brandW = doc.getTextWidth(word) + doc.getTextWidth(word2);
  const brandStart = rightX - brandW;
  if (logo) {
    try {
      doc.addImage(
        logo,
        "PNG",
        brandStart - logoSize - 2.5,
        11,
        logoSize,
        logoSize
      );
    } catch {
      /* ignore */
    }
  }
  doc.setTextColor(...DEEPER);
  doc.text(word, brandStart, 18.5);
  doc.setTextColor(...ORANGE);
  doc.text(word2, brandStart + doc.getTextWidth(word), 18.5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...INK);
  const rightLines = [
    (co.legal || co.naam).toUpperCase(),
    co.telefoon || null,
    co.email || null,
    co.website || null,
    co.kvk ? `KvK ${co.kvk}` : null,
  ].filter(Boolean) as string[];
  let ry = 24;
  for (const line of rightLines) {
    doc.text(line, rightX, ry, { align: "right" });
    ry += 3.6;
  }

  let y = Math.max(52, ry + 8);

  // —— Datum + offertenummer ——
  doc.setFillColor(...DATUM_BG);
  doc.rect(margin, y, 22, 5.5, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...INK);
  doc.text("DATUM", margin + 2, y + 3.8);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(formatDateNl(offerte.created_at), margin, y + 11);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("OFFERTENUMMER", margin + 52, y + 3.8);
  doc.setFont("courier", "normal");
  doc.setFontSize(10);
  doc.text(offerte.offerte_nummer, margin + 52, y + 11);

  y += 20;

  // —— Offerte aan ——
  const klant = offerte.leads?.naam || "Klant";
  const adresTxt = adres && adres !== "—" ? adres : "";
  const klantEmail = offerte.leads?.email?.trim() || "";
  const klantTel = offerte.leads?.telefoon?.trim() || "";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...INK);
  doc.text("OFFERTE AAN:", margin, y);
  y += 5;
  doc.setFontSize(10);
  doc.text(klant, margin, y);
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  if (adresTxt) {
    doc.text(adresTxt, margin, y);
    y += 4.2;
  }
  if (klantEmail) {
    doc.text(klantEmail, margin, y);
    y += 4.2;
  }
  if (klantTel) {
    doc.text(klantTel, margin, y);
    y += 4.2;
  }
  y += 5;

  if (offerte.intro_tekst) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const intro = doc.splitTextToSize(offerte.intro_tekst, contentW);
    doc.text(intro, margin, y);
    y += intro.length * 4.6 + 6;
  }

  // —— Tabel: Omschrijving | Aantal ——
  const colDesc = margin;
  const colAantal = pageW - margin;
  const descMaxW = contentW - 22;
  const weergaveRegels = offerteRegelsVoorWeergave(regels, {
    financieringVoorbehoud: offerte.financiering_voorbehoud,
  });

  doc.setDrawColor(...DEEPER);
  doc.setLineWidth(0.7);
  doc.line(margin, y + 6.5, pageW - margin, y + 6.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...DEEPER);
  doc.text("OMSCHRIJVING", colDesc, y + 4.5);
  doc.text("AANTAL", colAantal, y + 4.5, { align: "right" });
  y += 9;

  for (const r of weergaveRegels) {
    const desc = doc.splitTextToSize(r.omschrijving, descMaxW);
    const rowH = Math.max(8, desc.length * 4.2 + 3);
    y = ensureSpace(doc, y, rowH + 2, pageW, margin);

    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(margin, y + rowH - 0.5, pageW - margin, y + rowH - 0.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(desc, colDesc, y + 3.5);
    doc.setFont("helvetica", "normal");
    doc.text(String(r.aantal), colAantal, y + 3.5, { align: "right" });
    y += rowH;
  }

  y += 8;
  y = ensureSpace(doc, y, 30, pageW, margin);

  // —— Totalen (rechts, zelfde kaders als pagina) ——
  const boxW = 78;
  const boxX = pageW - margin - boxW;
  const totalRows: { label: string; value: string; bold?: boolean }[] = [
    {
      label: "Totaal excl. BTW",
      value: formatEuro(Number(offerte.subtotaal_ex_btw)),
    },
    {
      label: "21% BTW",
      value: formatEuro(Number(offerte.btw_bedrag)),
    },
    {
      label: "Totaal incl. BTW",
      value: formatEuro(Number(offerte.totaal_inc_btw)),
      bold: true,
    },
  ];

  for (const row of totalRows) {
    doc.setDrawColor(213, 221, 216);
    doc.setLineWidth(0.3);
    if (row.bold) {
      doc.setFillColor(...WASH);
      doc.rect(boxX, y, boxW, 8.5, "FD");
    } else {
      doc.setFillColor(255, 255, 255);
      doc.rect(boxX, y, boxW, 8, "FD");
    }
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...(row.bold ? DEEPER : MUTED));
    doc.text(row.label, boxX + 3, y + 5.4);
    doc.setTextColor(...(row.bold ? DEEPER : INK));
    doc.text(row.value, boxX + boxW - 3, y + 5.4, { align: "right" });
    y += row.bold ? 8.5 : 8;
  }

  // —— Ondertekening (zelfde blok als pagina) ——
  y += 10;
  const sigH = offerte.financiering_voorbehoud ? 92 : 84;
  y = ensureSpace(doc, y, sigH + 6, pageW, margin);

  doc.setFillColor(...WASH);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentW, sigH, 3, 3, "FD");

  let sy = y + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text("Ondertekening", margin + 5, sy);
  sy += 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    sign
      ? "Deze offerte is digitaal ondertekend."
      : "Vul je naam in en zet je handtekening hieronder.",
    margin + 5,
    sy
  );
  sy += 8;

  // Volledige naam
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text("Volledige naam", margin + 5, sy);
  sy += 2;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...FIELD_BORDER);
  doc.roundedRect(margin + 5, sy, contentW - 10, 8, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...INK);
  doc.text(sign?.naam || " ", margin + 8, sy + 5.5);
  sy += 12;

  // Datum / tijd ondertekening
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Datum", margin + 5, sy);
  sy += 2;
  doc.setFillColor(...SOFT);
  doc.roundedRect(margin + 5, sy, contentW - 10, 8, 1.5, 1.5, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...DEEPER);
  const ondertekenLabel = sign
    ? formatDateTimeNl(sign.ondertekendOp)
    : formatDateTimeNl(new Date());
  doc.text(ondertekenLabel, margin + 8, sy + 5.5);
  doc.setTextColor(...MUTED);
  doc.setFontSize(8);
  doc.text(
    "(Europe/Amsterdam)",
    margin + 8 + doc.getTextWidth(ondertekenLabel) + 3,
    sy + 5.5
  );
  sy += 12;

  // Akkoord
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(
    sign
      ? "☑  Ik ga akkoord met deze offerte."
      : "☐  Ik ga akkoord met deze offerte.",
    margin + 5,
    sy
  );
  sy += 7;

  // Handtekening
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Handtekening", margin + 5, sy);
  sy += 2;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...FIELD_BORDER);
  doc.roundedRect(margin + 5, sy, 78, 24, 1.5, 1.5, "FD");
  if (sign) {
    embedSignature(doc, sign.handtekeningDataUrl, margin + 7, sy + 1.5, 74, 21);
  }

  if (offerte.financiering_voorbehoud) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...ORANGE);
    doc.text(
      "Onder voorbehoud van financiering Warmtefonds",
      margin + 5,
      y + sigH - 5
    );
  }

  // Alleen hoekje zoals op de pagina — geen extra footertekst
  drawCornerAccent(doc, pageW, pageH);
  return doc.output("blob");
}

export async function buildSignedOffertePdf(input: PdfInput): Promise<Blob> {
  return buildOffertePdf(input);
}
