import { jsPDF } from "jspdf";
import type { Offerte, OfferteRegel } from "@/types/database";
import { BEDRIJFSWAARDEN } from "@/types/database";
import {
  formatDateShort,
  formatDateTimeLongNl,
} from "@/lib/format";
import {
  PDF_COLORS,
  companyInfo,
  formatEuroPdf,
  loadLogoDataUrl,
  productImageForLine,
} from "@/lib/pdf-brand";

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

const {
  green: GREEN,
  dark: DARK,
  orange: ORANGE,
  charcoal: CHARCOAL,
  muted: MUTED,
  line: LINE,
  wash: WASH,
  grayRow: GRAY,
} = PDF_COLORS;

function ensureSpace(
  doc: jsPDF,
  y: number,
  need: number,
  pageW: number,
  margin: number
): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need < pageH - 22) return y;
  drawFooter(doc, pageW, margin);
  doc.addPage();
  return 18;
}

function drawFooter(doc: jsPDF, pageW: number, margin: number) {
  const pageH = doc.internal.pageSize.getHeight();
  const co = companyInfo();
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.line(margin, pageH - 14, pageW - margin, pageH - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(
    `${co.website} · ${co.email} · ${co.telefoon}`,
    pageW / 2,
    pageH - 9,
    { align: "center" }
  );
}

function drawHeaderBar(doc: jsPDF, pageW: number, margin: number, title: string) {
  let y = 12;
  const logo = loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, y, 18, 18);
    } catch {
      /* ignore */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...DARK);
  const tx = margin + (logo ? 22 : 0);
  doc.text("Batterij", tx, y + 8);
  doc.setTextColor(...ORANGE);
  doc.text("concept", tx + doc.getTextWidth("Batterij"), y + 8);

  const co = companyInfo();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CHARCOAL);
  doc.text(co.legal, pageW - margin, y + 5, { align: "right" });
  doc.setTextColor(...MUTED);
  doc.text(co.telefoon, pageW - margin, y + 10, { align: "right" });
  doc.text(co.email, pageW - margin, y + 14.5, { align: "right" });

  y = 36;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageW - margin, y);
  doc.setDrawColor(...ORANGE);
  doc.setLineWidth(0.5);
  doc.line(margin, y + 1.2, pageW - margin, y + 1.2);

  y = 46;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...DARK);
  doc.text(title, margin, y);
  return y + 8;
}

/**
 * Strakke offerte-PDF met logo, productfoto's en duidelijke totalen.
 */
export async function buildOffertePdf(input: PdfInput): Promise<Blob> {
  const { offerte, regels, sign, adres } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;

  // —— PAGINA 1: cover / waarden ——
  let y = drawHeaderBar(
    doc,
    pageW,
    margin,
    offerte.titel || "Offerte thuisbatterij"
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(`Offertenummer ${offerte.offerte_nummer}`, margin, y);
  if (offerte.geldig_tot) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ORANGE);
    doc.text("Geldig tot:", margin + 70, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...CHARCOAL);
    doc.text(formatDateShort(offerte.geldig_tot), margin + 90, y);
  }
  y += 10;

  // Klantblok
  doc.setFillColor(...WASH);
  doc.rect(margin, y, pageW - margin * 2, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Offerte voor", margin + 3, y + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...CHARCOAL);
  doc.text(offerte.leads?.naam || "Klant", margin + 3, y + 13);
  if (adres && adres !== "—") {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(adres, margin + 3, y + 18);
  }
  y += 30;

  if (offerte.intro_tekst) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...CHARCOAL);
    const intro = doc.splitTextToSize(offerte.intro_tekst, pageW - margin * 2);
    doc.text(intro, margin, y);
    y += intro.length * 4.5 + 8;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text("Onze waarden", margin, y);
  y += 8;

  for (const w of BEDRIJFSWAARDEN) {
    y = ensureSpace(doc, y, 18, pageW, margin);
    doc.setFillColor(...WASH);
    doc.rect(margin, y - 3, pageW - margin * 2, 14, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...GREEN);
    doc.text(w.titel, margin + 3, y + 2);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const lines = doc.splitTextToSize(w.tekst, pageW - margin * 2 - 6);
    doc.text(lines.slice(0, 2), margin + 3, y + 7);
    y += 17;
  }

  drawFooter(doc, pageW, margin);

  // —— PAGINA 2+: producten ——
  doc.addPage();
  y = drawHeaderBar(doc, pageW, margin, "Specificatie & prijzen");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`${offerte.offerte_nummer} · ${offerte.leads?.naam || ""}`, margin, y);
  y += 8;

  // Table header
  const imgCol = margin;
  const descCol = margin + 28;
  const qtyCol = pageW - margin - 70;
  const priceCol = pageW - margin - 38;
  const totalCol = pageW - margin;

  doc.setFillColor(...DARK);
  doc.rect(margin, y, pageW - margin * 2, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  doc.text("PRODUCT", descCol, y + 5.5);
  doc.text("AANTAL", qtyCol, y + 5.5, { align: "right" });
  doc.text("PRIJS", priceCol, y + 5.5, { align: "right" });
  doc.text("BEDRAG", totalCol - 2, y + 5.5, { align: "right" });
  y += 10;

  for (const r of regels) {
    const rowH = 26;
    y = ensureSpace(doc, y, rowH + 4, pageW, margin);

    const lineEx = Math.round(r.aantal * r.prijs_ex_btw * 100) / 100;
    const lineInc =
      Math.round(
        r.aantal * r.prijs_ex_btw * (1 + (r.btw_percentage ?? 21) / 100) * 100
      ) / 100;

    // zebra
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.rect(margin, y, pageW - margin * 2, rowH);

    const img = productImageForLine(r.omschrijving);
    if (img) {
      try {
        doc.addImage(img, "PNG", imgCol + 2, y + 3, 20, 20);
      } catch {
        /* ignore */
      }
    } else {
      doc.setFillColor(...WASH);
      doc.rect(imgCol + 2, y + 3, 20, 20, "F");
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...CHARCOAL);
    const desc = doc.splitTextToSize(r.omschrijving, qtyCol - descCol - 8);
    doc.text(desc.slice(0, 2), descCol, y + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      `${formatEuroPdf(r.prijs_ex_btw)} excl. · BTW ${r.btw_percentage ?? 21}%`,
      descCol,
      y + 18
    );

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...CHARCOAL);
    doc.text(String(r.aantal), qtyCol, y + 12, { align: "right" });
    doc.text(formatEuroPdf(lineEx), priceCol, y + 12, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(formatEuroPdf(lineInc), totalCol - 2, y + 12, {
      align: "right",
    });

    y += rowH + 2;
  }

  y += 6;
  y = ensureSpace(doc, y, 40, pageW, margin);

  // Totalenblok rechts
  const tw = 70;
  const tx = pageW - margin - tw;

  doc.setFillColor(...GRAY);
  doc.rect(tx, y, tw, 7, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CHARCOAL);
  doc.text("Excl. btw", tx + 2, y + 4.8);
  doc.text(formatEuroPdf(Number(offerte.subtotaal_ex_btw)), tx + tw - 2, y + 4.8, {
    align: "right",
  });
  y += 7;

  doc.setFillColor(...GRAY);
  doc.rect(tx, y, tw, 7, "F");
  doc.text("BTW 21%", tx + 2, y + 4.8);
  doc.text(formatEuroPdf(Number(offerte.btw_bedrag)), tx + tw - 2, y + 4.8, {
    align: "right",
  });
  y += 7;

  doc.setFillColor(...DARK);
  doc.rect(tx, y, tw, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.text("Totaal", tx + 2, y + 6);
  doc.text(formatEuroPdf(Number(offerte.totaal_inc_btw)), tx + tw - 2, y + 6, {
    align: "right",
  });
  y += 16;

  if (offerte.financiering_voorbehoud) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...ORANGE);
    doc.text("Onder voorbehoud van financiering Warmtefonds", margin, y);
    y += 10;
  }

  // —— Ondertekening ——
  y = ensureSpace(doc, y, 70, pageW, margin);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text("Ondertekening", margin, y);
  y += 8;

  if (sign) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...CHARCOAL);
    doc.text(`Naam: ${sign.naam}`, margin, y);
    y += 5;
    doc.text(
      `Datum en tijd: ${formatDateTimeLongNl(sign.ondertekendOp)} (Europe/Amsterdam)`,
      margin,
      y
    );
    y += 5;
    doc.text(`Offerte: ${offerte.offerte_nummer}`, margin, y);
    y += 8;
    doc.setTextColor(...MUTED);
    doc.text("Handtekening:", margin, y);
    y += 3;
    try {
      doc.addImage(sign.handtekeningDataUrl, "PNG", margin, y, 65, 26);
      y += 30;
    } catch {
      y += 20;
    }
    doc.setDrawColor(...LINE);
    doc.line(margin, y, margin + 65, y);
    y += 6;
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      `Ondertekend door ${sign.naam} op ${formatDateTimeLongNl(sign.ondertekendOp)}`,
      margin,
      y,
      { maxWidth: pageW - margin * 2 }
    );
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text("Naam: _______________________________", margin, y);
    y += 8;
    doc.text("Datum: _______________________________", margin, y);
    y += 8;
    doc.text("Handtekening:", margin, y);
    y += 22;
    doc.setDrawColor(...LINE);
    doc.line(margin, y, margin + 65, y);
  }

  drawFooter(doc, pageW, margin);
  return doc.output("blob");
}

export async function buildSignedOffertePdf(input: PdfInput): Promise<Blob> {
  return buildOffertePdf(input);
}
