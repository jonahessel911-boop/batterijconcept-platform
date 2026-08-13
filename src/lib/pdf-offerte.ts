import { jsPDF } from "jspdf";
import type { Offerte, OfferteRegel } from "@/types/database";
import { BEDRIJFSWAARDEN } from "@/types/database";
import { formatDateNl, formatEuro } from "@/lib/format";

type SignPayload = {
  naam: string;
  handtekeningDataUrl: string;
  ondertekendOp: Date;
};

type PdfInput = {
  offerte: Offerte;
  regels: OfferteRegel[];
  sign: SignPayload;
  adres?: string;
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const GREEN = hexToRgb("#1A8A3E");
const DARK = hexToRgb("#0D5C32");
const ORANGE = hexToRgb("#F37021");
const CHARCOAL = hexToRgb("#2E3330");
const MUTED = hexToRgb("#5A635C");

/**
 * Genereert ondertekende offerte-PDF:
 * pagina 1 = merk + waarden + handtekening
 * pagina 2 = producten / bedragen
 */
export async function buildSignedOffertePdf(input: PdfInput): Promise<Blob> {
  const { offerte, regels, sign, adres } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;

  // —— PAGINA 1: Merk + waarden + ondertekening ——
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageW, 42, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("Batterijconcept.nl", margin, 22);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Opwekken · Opladen · Opslaan", margin, 32);

  doc.setTextColor(...CHARCOAL);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Onze waarden", margin, 58);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  let y = 68;
  for (const w of BEDRIJFSWAARDEN) {
    doc.setTextColor(...ORANGE);
    doc.setFont("helvetica", "bold");
    doc.text(`●  ${w.titel}`, margin, y);
    y += 6;
    doc.setTextColor(...MUTED);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(w.tekst, pageW - margin * 2 - 6);
    doc.text(lines, margin + 6, y);
    y += lines.length * 5 + 6;
  }

  y = Math.max(y + 8, 150);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 12;

  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Ondertekening", margin, y);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...CHARCOAL);
  doc.text(`Naam: ${sign.naam}`, margin, y);
  y += 7;
  doc.text(`Datum: ${formatDateNl(sign.ondertekendOp)}`, margin, y);
  y += 7;
  doc.text(`Offerte: ${offerte.offerte_nummer}`, margin, y);
  y += 12;

  doc.setTextColor(...MUTED);
  doc.text("Handtekening:", margin, y);
  y += 4;

  try {
    const imgW = 70;
    const imgH = 28;
    doc.addImage(sign.handtekeningDataUrl, "PNG", margin, y, imgW, imgH);
    y += imgH + 6;
  } catch {
    doc.setTextColor(...MUTED);
    doc.text("(handtekening bijgevoegd)", margin, y + 8);
    y += 16;
  }

  doc.setDrawColor(200);
  doc.line(margin, y, margin + 70, y);

  if (offerte.financiering_voorbehoud) {
    y += 12;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...ORANGE);
    doc.text("Onder voorbehoud van financiering Warmtefonds", margin, y);
  }

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(
    "Door te ondertekenen ga je akkoord met deze offerte en de waarden van Batterijconcept.nl.",
    margin,
    285
  );

  // —— PAGINA 2: Offerte-inhoud ——
  doc.addPage();
  doc.setFillColor(...DARK);
  doc.rect(0, 0, pageW, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("Offerte", margin, 18);

  doc.setTextColor(...CHARCOAL);
  doc.setFontSize(11);
  y = 42;
  doc.setFont("helvetica", "bold");
  doc.text(offerte.titel || "Offerte thuisbatterij", margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(`Nummer: ${offerte.offerte_nummer}`, margin, y);
  y += 6;
  if (offerte.leads?.naam) {
    doc.text(`Klant: ${offerte.leads.naam}`, margin, y);
    y += 6;
  }
  if (adres) {
    doc.text(`Adres: ${adres}`, margin, y);
    y += 6;
  }
  if (offerte.geldig_tot) {
    doc.text(`Geldig tot: ${formatDateNl(offerte.geldig_tot)}`, margin, y);
    y += 6;
  }
  y += 6;

  if (offerte.intro_tekst) {
    doc.setTextColor(...CHARCOAL);
    const intro = doc.splitTextToSize(offerte.intro_tekst, pageW - margin * 2);
    doc.text(intro, margin, y);
    y += intro.length * 5 + 8;
  }

  // Tabelkop
  doc.setFillColor(...hexToRgb("#E8F6EC"));
  doc.rect(margin, y - 5, pageW - margin * 2, 9, "F");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...DARK);
  doc.text("Omschrijving", margin + 2, y);
  doc.text("Aantal", pageW - margin - 55, y);
  doc.text("Prijs", pageW - margin - 2, y, { align: "right" });
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(...CHARCOAL);
  for (const r of regels) {
    const desc = doc.splitTextToSize(r.omschrijving, 110);
    const lineInc =
      Math.round(
        r.aantal * r.prijs_ex_btw * (1 + (r.btw_percentage ?? 21) / 100) * 100
      ) / 100;
    doc.text(desc, margin + 2, y);
    doc.text(String(r.aantal), pageW - margin - 55, y);
    doc.text(formatEuro(lineInc), pageW - margin - 2, y, { align: "right" });
    y += Math.max(desc.length * 5, 8) + 2;
    if (y > 250) {
      doc.addPage();
      y = 30;
    }
  }

  y += 6;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...DARK);
  doc.setFontSize(12);
  doc.text("Totaal incl. btw", margin, y);
  doc.text(formatEuro(offerte.totaal_inc_btw), pageW - margin - 2, y, {
    align: "right",
  });

  y += 20;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(
    `Ondertekend door ${sign.naam} op ${formatDateNl(sign.ondertekendOp)} (Europe/Amsterdam)`,
    margin,
    y
  );

  if (offerte.financiering_voorbehoud) {
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...ORANGE);
    doc.setFontSize(10);
    doc.text("Onder voorbehoud van financiering Warmtefonds", margin, y);
  }

  return doc.output("blob");
}
