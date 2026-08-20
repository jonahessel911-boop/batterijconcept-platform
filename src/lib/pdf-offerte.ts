import { jsPDF } from "jspdf";
import type { Offerte, OfferteRegel } from "@/types/database";
import { formatDateNl, formatEuro } from "@/lib/format";
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

function drawDiagonalHeader(doc: jsPDF, pageW: number) {
  // Donkere driehoek links-boven (diagonaal omhoog naar rechts)
  doc.setFillColor(...DEEPER);
  doc.triangle(0, 0, pageW, 0, 0, 72, "F");
  doc.setFillColor(...GREEN);
  doc.triangle(0, 0, pageW * 0.72, 0, 0, 58, "F");
  doc.setFillColor(...MINT);
  doc.triangle(pageW * 0.35, 0, pageW, 0, pageW, 38, "F");
}

function drawCornerAccent(doc: jsPDF, pageW: number, pageH: number) {
  doc.setFillColor(...GREEN);
  doc.triangle(pageW, pageH - 42, pageW, pageH, pageW - 55, pageH, "F");
  doc.setFillColor(...MINT);
  doc.triangle(pageW, pageH - 22, pageW, pageH, pageW - 28, pageH, "F");
}

function drawFooter(doc: jsPDF, pageW: number, margin: number) {
  const pageH = doc.internal.pageSize.getHeight();
  const co = companyInfo();
  drawCornerAccent(doc, pageW, pageH);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(
    `${co.legal} · ${co.adres}, ${co.postcodePlaats} · KVK ${co.kvk}`,
    margin,
    pageH - 8
  );
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
 * Offerte-PDF in referentiestijl: diagonale header, logo rechts,
 * datum/nummer, 4-koloms tabel, totalen in kaders, ondertekening.
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

  // OFFERTE links
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  doc.setTextColor(...INK);
  doc.text("OFFERTE", margin, 28);

  // Logo + bedrijf rechts
  const logo = loadLogoDataUrl();
  const rightX = pageW - margin;
  let brandY = 12;
  if (logo) {
    try {
      doc.addImage(logo, "PNG", rightX - 14, brandY, 14, 14);
    } catch {
      /* ignore */
    }
  }
  const brandTextEnd = rightX - (logo ? 16 : 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...ORANGE);
  doc.text("concept", brandTextEnd, brandY + 6, { align: "right" });
  const conceptW = doc.getTextWidth("concept");
  doc.setTextColor(...DEEPER);
  doc.text("Batterij", brandTextEnd - conceptW, brandY + 6, {
    align: "right",
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...INK);
  const rightLines = [
    (co.legal || co.naam).toUpperCase(),
    co.adres,
    co.postcodePlaats,
    co.telefoon || null,
    co.email || null,
    co.website || null,
    co.kvk ? `KvK ${co.kvk}` : null,
  ].filter(Boolean) as string[];
  let ry = brandY + 18;
  for (const line of rightLines) {
    doc.text(line, rightX, ry, { align: "right" });
    ry += 3.6;
  }

  let y = Math.max(58, ry + 6);

  // Datum-blok + offertenummer
  doc.setFillColor(...DATUM_BG);
  doc.rect(margin, y, 28, 6, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...INK);
  doc.text("DATUM", margin + 2.5, y + 4.2);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(formatDateNl(offerte.created_at), margin, y + 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("OFFERTENUMMER", margin + 48, y + 4.2);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(offerte.offerte_nummer, margin + 48, y + 12);

  y += 22;

  // Offerte aan
  const klant = offerte.leads?.naam || "Klant";
  const adresTxt = adres && adres !== "—" ? adres : "";
  const klantEmail = offerte.leads?.email?.trim() || "";
  const klantTel = offerte.leads?.telefoon?.trim() || "";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...INK);
  doc.text("OFFERTE AAN:", margin, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(klant, margin, y);
  y += 4.5;
  if (adresTxt) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(adresTxt, margin, y);
    y += 4.5;
  }
  if (klantEmail) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(klantEmail, margin, y);
    y += 4.5;
  }
  if (klantTel) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(klantTel, margin, y);
    y += 4.5;
  }
  y += 4;

  if (offerte.intro_tekst) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const intro = doc.splitTextToSize(offerte.intro_tekst, contentW);
    doc.text(intro, margin, y);
    y += intro.length * 4.5 + 6;
  }

  // Tabelkolommen: Aantal | Omschrijving (geen prijzen per regel)
  const colAantal = margin + 4;
  const colDesc = margin + 22;
  const descMaxW = pageW - margin - colDesc;
  const weergaveRegels = offerteRegelsVoorWeergave(regels, {
    financieringVoorbehoud: offerte.financiering_voorbehoud,
  });

  doc.setDrawColor(...DEEPER);
  doc.setLineWidth(0.6);
  doc.line(margin, y + 7, pageW - margin, y + 7);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...DEEPER);
  doc.text("AANTAL", colAantal, y + 5);
  doc.text("OMSCHRIJVING", colDesc, y + 5);
  y += 10;

  for (const r of weergaveRegels) {
    const desc = doc.splitTextToSize(r.omschrijving, descMaxW);
    const rowH = Math.max(9, desc.length * 4.2 + 4);
    y = ensureSpace(doc, y, rowH + 2, pageW, margin);

    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(margin, y + rowH - 1, pageW - margin, y + rowH - 1);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(String(r.aantal), colAantal, y + 4);
    doc.setFont("helvetica", "bold");
    doc.text(desc, colDesc, y + 4);
    y += rowH;
  }

  y += 8;
  y = ensureSpace(doc, y, 32, pageW, margin);

  // Totalen in kaders (rechts)
  const boxW = 72;
  const boxX = pageW - margin - boxW;
  const rows: { label: string; value: string; bold?: boolean }[] = [
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

  for (const row of rows) {
    doc.setDrawColor(200, 210, 204);
    doc.setLineWidth(0.3);
    if (row.bold) {
      doc.setFillColor(...WASH);
      doc.rect(boxX, y, boxW, 8, "FD");
    } else {
      doc.setFillColor(255, 255, 255);
      doc.rect(boxX, y, boxW, 8, "FD");
    }
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(8);
    doc.setTextColor(...(row.bold ? DEEPER : MUTED));
    doc.text(row.label, boxX + 2.5, y + 5.2);
    doc.setTextColor(...(row.bold ? DEEPER : INK));
    doc.text(row.value, boxX + boxW - 2.5, y + 5.2, { align: "right" });
    y += 8;
  }

  y += 10;
  y = ensureSpace(doc, y, 28, pageW, margin);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(
    "Deze offerte heeft een geldigheidstermijn van 30 dagen.",
    margin,
    y
  );
  y += 5;
  doc.text(
    "Graag vernemen we van je wat we voor je kunnen betekenen.",
    margin,
    y
  );
  y += 7;
  doc.setTextColor(...INK);
  doc.text("Met vriendelijke groet,", margin, y);
  y += 5;
  doc.setFont("helvetica", "bold");
  doc.text(co.legal || co.naam, margin, y);
  y += 10;

  const boxH = offerte.financiering_voorbehoud ? 94 : 86;
  y = ensureSpace(doc, y, boxH + 4, pageW, margin);
  doc.setFillColor(...WASH);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, y, contentW, boxH, 3, 3, "FD");

  let sy = y + 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text("Ondertekening", margin + 5, sy);
  sy += 6;
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

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text("Volledige naam", margin + 5, sy);
  sy += 2;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(213, 224, 216);
  doc.roundedRect(margin + 5, sy, contentW - 10, 8, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(sign?.naam || " ", margin + 8, sy + 5.5);
  sy += 12;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Datum", margin + 5, sy);
  sy += 2;
  doc.setFillColor(...SOFT);
  doc.roundedRect(margin + 5, sy, contentW - 10, 8, 1.5, 1.5, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...DEEPER);
  const datumLabel = sign
    ? formatDateNl(sign.ondertekendOp)
    : formatDateNl(new Date());
  doc.text(datumLabel, margin + 8, sy + 5.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(
    "(Europe/Amsterdam)",
    margin + 8 + doc.getTextWidth(datumLabel) + 3,
    sy + 5.5
  );
  sy += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(
    sign
      ? "☑  Ik ga akkoord met deze offerte."
      : "☐  Ik ga akkoord met deze offerte.",
    margin + 5,
    sy
  );
  sy += 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Handtekening", margin + 5, sy);
  sy += 2;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(213, 224, 216);
  doc.roundedRect(margin + 5, sy, 70, 22, 1.5, 1.5, "FD");
  if (sign) {
    embedSignature(doc, sign.handtekeningDataUrl, margin + 7, sy + 1, 66, 20);
  }

  if (offerte.financiering_voorbehoud) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...ORANGE);
    doc.text(
      "Onder voorbehoud van financiering Warmtefonds",
      margin + 5,
      y + boxH - 6
    );
  }

  drawFooter(doc, pageW, margin);
  return doc.output("blob");
}

export async function buildSignedOffertePdf(input: PdfInput): Promise<Blob> {
  return buildOffertePdf(input);
}
