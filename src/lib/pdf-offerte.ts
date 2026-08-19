import { jsPDF } from "jspdf";
import type { Offerte, OfferteRegel } from "@/types/database";
import { formatDateNl, formatEuro } from "@/lib/format";
import { companyInfo } from "@/lib/pdf-brand";

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
const ORANGE: [number, number, number] = [196, 90, 18];
const INK: [number, number, number] = [26, 31, 28];
const MUTED: [number, number, number] = [90, 99, 92];
const LINE: [number, number, number] = [226, 232, 228];
const WASH: [number, number, number] = [244, 248, 245];
const SOFT: [number, number, number] = [232, 246, 236];

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
    `${co.legal} · ${co.adres}, ${co.postcodePlaats}`,
    pageW / 2,
    pageH - 10.5,
    { align: "center" }
  );
  doc.text(
    `${co.website} · ${co.email} · ${co.telefoon} · KVK ${co.kvk}`,
    pageW / 2,
    pageH - 7,
    { align: "center" }
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
 * Zelfde layout als de ondertekenpagina: prijstabel + ondertekening.
 * Geen productfoto's. Bij `sign` zijn naam, datum en handtekening ingevuld.
 */
export async function buildOffertePdf(input: PdfInput): Promise<Blob> {
  const { offerte, regels, sign, adres } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 16;
  const contentW = pageW - margin * 2;

  doc.setFillColor(...DEEPER);
  doc.rect(0, 0, pageW, 38, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("OFFERTE", margin, 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(offerte.titel || "Offerte thuisbatterij", margin, 22);

  doc.setFont("courier", "normal");
  doc.setFontSize(8);
  doc.setTextColor(220, 230, 224);
  doc.text(offerte.offerte_nummer, margin, 30);

  if (offerte.geldig_tot) {
    const pill = `Geldig tot ${formatDateNl(offerte.geldig_tot)}`;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    const pillW = doc.getTextWidth(pill) + 8;
    doc.setFillColor(20, 90, 50);
    doc.roundedRect(pageW - margin - pillW, 14, pillW, 8, 4, 4, "F");
    doc.setTextColor(255, 255, 255);
    doc.text(pill, pageW - margin - pillW + 4, 19.2);
  }

  let y = 48;

  const klant = offerte.leads?.naam || "Klant";
  const adresTxt = adres && adres !== "—" ? ` · ${adres}` : "";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text("Voor ", margin, y);
  const voorW = doc.getTextWidth("Voor ");
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  doc.text(klant, margin + voorW, y);
  if (adresTxt) {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...MUTED);
    doc.text(adresTxt, margin + voorW + doc.getTextWidth(klant), y);
  }
  y += 8;

  if (offerte.intro_tekst) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const intro = doc.splitTextToSize(offerte.intro_tekst, contentW);
    doc.text(intro, margin, y);
    y += intro.length * 4.5 + 6;
  }

  const colAantal = pageW - margin - 42;
  const colPrijs = pageW - margin - 4;

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.setFillColor(250, 251, 250);
  doc.rect(margin, y, contentW, 9, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("OMSCHRIJVING", margin + 4, y + 6);
  doc.text("AANTAL", colAantal, y + 6, { align: "right" });
  doc.text("PRIJS", colPrijs, y + 6, { align: "right" });
  y += 9;

  for (const r of regels) {
    const lineInc =
      Math.round(
        r.aantal * r.prijs_ex_btw * (1 + (r.btw_percentage ?? 21) / 100) * 100
      ) / 100;
    const desc = doc.splitTextToSize(r.omschrijving, colAantal - margin - 16);
    const rowH = Math.max(11, desc.length * 4.2 + 6);
    y = ensureSpace(doc, y, rowH + 2, pageW, margin);

    doc.setDrawColor(...LINE);
    doc.setFillColor(255, 255, 255);
    doc.rect(margin, y, contentW, rowH, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(desc, margin + 4, y + 6.5);
    doc.setFont("helvetica", "normal");
    doc.text(String(r.aantal), colAantal, y + 6.5, { align: "right" });
    doc.text(formatEuro(lineInc), colPrijs, y + 6.5, { align: "right" });
    y += rowH;
  }

  y += 8;
  y = ensureSpace(doc, y, 28, pageW, margin);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.7);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  const labelX = pageW - margin - 55;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Subtotaal excl. btw", labelX, y, { align: "right" });
  doc.setTextColor(...INK);
  doc.text(formatEuro(Number(offerte.subtotaal_ex_btw)), colPrijs, y, {
    align: "right",
  });
  y += 6;
  doc.setTextColor(...MUTED);
  doc.text("BTW", labelX, y, { align: "right" });
  doc.setTextColor(...INK);
  doc.text(formatEuro(Number(offerte.btw_bedrag)), colPrijs, y, {
    align: "right",
  });
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...DEEPER);
  doc.text("Totaal incl. btw", labelX, y, { align: "right" });
  doc.text(formatEuro(Number(offerte.totaal_inc_btw)), colPrijs, y, {
    align: "right",
  });
  y += 12;

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
  doc.text("(Europe/Amsterdam)", margin + 8 + doc.getTextWidth(datumLabel) + 3, sy + 5.5);
  sy += 12;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(
    sign ? "☑  Ik ga akkoord met deze offerte." : "☐  Ik ga akkoord met deze offerte.",
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
