import { jsPDF } from "jspdf";
import type { Factuur, Lead, Offerte } from "@/types/database";
import { formatDateShort } from "@/lib/format";
import {
  PDF_COLORS,
  companyInfo,
  formatEuroPdf,
  loadLogoDataUrl,
} from "@/lib/pdf-brand";

type PdfInput = {
  factuur: Factuur;
  lead?: Pick<
    Lead,
    | "naam"
    | "email"
    | "telefoon"
    | "lead_number"
    | "straat"
    | "huisnummer"
    | "toevoeging"
    | "postcode"
    | "plaats"
  > | null;
  offerte?: Pick<
    Offerte,
    "offerte_nummer" | "subtotaal_ex_btw" | "btw_bedrag" | "totaal_inc_btw"
  > | null;
};

const { green: GREEN, dark: DARK, orange: ORANGE, charcoal: CHARCOAL, muted: MUTED, line: LINE, grayRow: GRAY } =
  PDF_COLORS;

/**
 * Factuur-PDF in strakke layout:
 * logo linksboven · bedrijfsgegevens rechts · titel · tabel · totalen.
 */
export async function buildFactuurPdf(input: PdfInput): Promise<Blob> {
  const { factuur, lead, offerte } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const co = companyInfo();
  let y = 14;

  // —— Logo linksboven ——
  const logo = loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, y, 22, 22);
    } catch {
      /* ignore */
    }
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...DARK);
  doc.text("Batterij", margin + (logo ? 26 : 0), y + 10);
  doc.setTextColor(...ORANGE);
  doc.text("concept", margin + (logo ? 26 : 0) + doc.getTextWidth("Batterij"), y + 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Opwekken · Opladen · Opslaan", margin + (logo ? 26 : 0), y + 16);

  // —— Bedrijf rechtsboven ——
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CHARCOAL);
  const rightLines = [
    co.legal,
    co.adres,
    co.postcodePlaats,
    co.land,
    co.btw ? `BTW: ${co.btw}` : null,
    co.kvk ? `KVK: ${co.kvk}` : null,
    co.vestigingsnummer ? `Vestigingsnr: ${co.vestigingsnummer}` : null,
  ].filter(Boolean) as string[];
  let ry = y + 4;
  for (const line of rightLines) {
    doc.text(line, pageW - margin, ry, { align: "right" });
    ry += 4;
  }

  y = 44;

  // —— Titel ——
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...DARK);
  doc.text(`Factuur ${factuur.factuur_nummer}`, margin, y);
  if (factuur.status === "concept") {
    doc.setFontSize(9);
    doc.setTextColor(...ORANGE);
    doc.text("CONCEPT", pageW - margin, y, { align: "right" });
  }
  y += 10;

  // —— Datums (oranje labels zoals referentie) ——
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...ORANGE);
  doc.text("Factuurdatum:", margin, y);
  doc.text("Vervaldatum:", margin + 55, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...CHARCOAL);
  doc.setFontSize(9);
  doc.text(formatDateShort(factuur.factuurdatum), margin + 28, y);
  doc.text(
    formatDateShort(factuur.vervaldatum) || "—",
    margin + 82,
    y
  );
  y += 12;

  // —— Klant rechts ——
  const klantX = pageW - margin - 70;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Factuur aan", klantX, y - 8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...CHARCOAL);
  let ky = y - 3;
  doc.text(lead?.naam || "Klant", klantX, ky);
  ky += 4.5;
  if (lead) {
    const street = [lead.straat, [lead.huisnummer, lead.toevoeging].filter(Boolean).join("")]
      .filter(Boolean)
      .join(" ");
    if (street) {
      doc.text(street, klantX, ky);
      ky += 4.5;
    }
    const city = [lead.postcode, lead.plaats].filter(Boolean).join(" ");
    if (city) {
      doc.text(city, klantX, ky);
      ky += 4.5;
    }
  }

  y += 8;

  // —— Tabel header ——
  const col = {
    oms: margin,
    aantal: margin + 95,
    prijs: margin + 115,
    btw: margin + 140,
    bedrag: pageW - margin,
  };
  const tableW = pageW - margin * 2;

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.rect(margin, y, tableW, 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("OMSCHRIJVING", col.oms + 2, y + 5.5);
  doc.text("AANTAL", col.aantal, y + 5.5, { align: "right" });
  doc.text("PRIJS", col.prijs, y + 5.5, { align: "right" });
  doc.text("BTW", col.btw, y + 5.5, { align: "right" });
  doc.text("BEDRAG", col.bedrag - 2, y + 5.5, { align: "right" });
  y += 8;

  // —— Regel(s) ——
  const oms =
    factuur.omschrijving ||
    (offerte
      ? `Aanbetaling bij ${offerte.offerte_nummer}`
      : "Aanbetaling");
  const bedragEx = Number(factuur.bedrag_ex_btw);
  const bedragInc = Number(factuur.bedrag_inc_btw);
  const omsLines = doc.splitTextToSize(oms, 88);

  doc.setDrawColor(...LINE);
  doc.rect(margin, y, tableW, Math.max(10, omsLines.length * 4 + 6));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...CHARCOAL);
  doc.text(omsLines, col.oms + 2, y + 6);
  doc.text("1", col.aantal, y + 6.5, { align: "right" });
  doc.text(formatEuroPdf(bedragEx), col.prijs, y + 6.5, { align: "right" });
  doc.text("21%", col.btw, y + 6.5, { align: "right" });
  doc.text(formatEuroPdf(bedragEx), col.bedrag - 2, y + 6.5, {
    align: "right",
  });
  y += Math.max(14, omsLines.length * 4 + 10);

  if (offerte?.offerte_nummer) {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Betreft offerte ${offerte.offerte_nummer}`, margin, y);
    y += 10;
  }

  // —— Betaling links + totalen rechts ——
  const totalsX = pageW - margin - 72;
  const totalsW = 72;

  if (co.iban) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CHARCOAL);
    const pay = doc.splitTextToSize(
      `Mededeling betaling: ${factuur.factuur_nummer} op deze rekening ${co.iban}`,
      95
    );
    doc.text(pay, margin, y + 4);
  }

  // Excl
  doc.setFillColor(...GRAY);
  doc.rect(totalsX, y, totalsW, 7, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CHARCOAL);
  doc.text("Excl. btw", totalsX + 2, y + 4.8);
  doc.text(formatEuroPdf(Number(factuur.bedrag_ex_btw)), totalsX + totalsW - 2, y + 4.8, {
    align: "right",
  });
  y += 7;

  // BTW
  doc.setFillColor(...GRAY);
  doc.rect(totalsX, y, totalsW, 7, "F");
  doc.text("BTW 21%", totalsX + 2, y + 4.8);
  doc.text(formatEuroPdf(Number(factuur.btw_bedrag)), totalsX + totalsW - 2, y + 4.8, {
    align: "right",
  });
  y += 7;

  // Totaal groen
  doc.setFillColor(...DARK);
  doc.rect(totalsX, y, totalsW, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(255, 255, 255);
  doc.text("Totaal", totalsX + 2, y + 5.5);
  doc.text(formatEuroPdf(bedragInc), totalsX + totalsW - 2, y + 5.5, {
    align: "right",
  });
  y += 16;

  if (factuur.status === "concept") {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...ORANGE);
    doc.text(
      "Dit is een conceptfactuur ter controle — nog niet verzonden naar de klant.",
      margin,
      y
    );
  }

  // —— Footer ——
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.line(margin, pageH - 18, pageW - margin, pageH - 18);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  const footerParts = [
    `E-mail: ${co.factuurEmail}`,
    co.kvk ? `KVK nr: ${co.kvk}` : null,
    co.vestigingsnummer ? `Vestigingsnr: ${co.vestigingsnummer}` : null,
    co.iban ? `IBAN nr: ${co.iban}` : null,
    co.telefoon,
  ].filter(Boolean);
  doc.text(footerParts.join("  |  "), pageW / 2, pageH - 12, {
    align: "center",
  });
  doc.text("Pagina: 1 / 1", pageW - margin, pageH - 12, { align: "right" });

  return doc.output("blob");
}
