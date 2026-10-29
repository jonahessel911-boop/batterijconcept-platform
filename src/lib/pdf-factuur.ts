import { jsPDF } from "jspdf";
import type { Factuur, Lead, Offerte } from "@/types/database";
import { formatDateShort } from "@/lib/format";
import {
  FACTUUR_ADRES_OP_PDF_MARKER,
  FACTUUR_BEDRIJFSADRES_OP_PDF,
  factuurBetaaltermijnDagen,
  factuurHeeftAdresGegevensOpPdf,
} from "@/lib/factuur-betaling";
import {
  PDF_COLORS,
  companyInfo,
  formatEuroPdf,
  loadLogoDataUrl,
} from "@/lib/pdf-brand";
import {
  parseFactuurRegels,
  stripFactuurRegelsBlock,
  type FactuurPdfRegel,
} from "@/lib/factuur-regels";

export type { FactuurPdfRegel } from "@/lib/factuur-regels";
export {
  encodeFactuurRegels,
  parseFactuurRegels,
} from "@/lib/factuur-regels";

/** Helvetica-veilige tekst: fancy dashes/quotes → ASCII (wrap-breedte klopt dan). */
function sanitizePdfText(text: string): string {
  return text
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/\u00A0/g, " ")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Wrap met behoud van harde regeleinden. */
function wrapPdfLines(
  doc: jsPDF,
  text: string,
  maxWidth: number
): string[] {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const lines: string[] = [];
  for (const p of paragraphs) {
    const wrapped = doc.splitTextToSize(p, maxWidth) as string[];
    lines.push(...wrapped);
  }
  return lines.length > 0 ? lines : [""];
}

/**
 * Klantgerichte notities voor op de PDF.
 * Standaard "Betreft offerte… Betaal op…" weglaten — dat staat al in Betalen.
 */
function customerFacingFactuurNotities(notities?: string | null): string {
  if (!notities?.trim()) return "";
  const cleaned = stripFactuurRegelsBlock(notities)
    .replaceAll(FACTUUR_ADRES_OP_PDF_MARKER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const lines = cleaned
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => {
      if (/^betreft offerte\b/i.test(l)) return false;
      if (/^betaal op\b/i.test(l)) return false;
      if (/betreft offerte.+\bbetaal op\b/i.test(l)) return false;
      return true;
    });
  return lines.join("\n").trim();
}

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
  /** Factuurnummer van de oorspronkelijke factuur (bij credit). */
  creditVanNummer?: string | null;
};

const { green: GREEN, dark: DARK, orange: ORANGE, charcoal: CHARCOAL, muted: MUTED, line: LINE, grayRow: GRAY } =
  PDF_COLORS;

/**
 * Factuur-PDF in strakke layout:
 * logo linksboven · bedrijfsgegevens rechts · titel · tabel · totalen.
 */
export async function buildFactuurPdf(input: PdfInput): Promise<Blob> {
  const { factuur, lead, offerte } = input;
  const creditVan =
    input.creditVanNummer?.trim() ||
    factuur.credit_van?.factuur_nummer?.trim() ||
    null;
  const isCredit = Boolean(factuur.credit_van_factuur_id || creditVan);
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const co = companyInfo();
  if (factuurHeeftAdresGegevensOpPdf(factuur.notities)) {
    co.adres = FACTUUR_BEDRIJFSADRES_OP_PDF.straat;
    co.postcodePlaats = FACTUUR_BEDRIJFSADRES_OP_PDF.postcodePlaats;
  } else {
    // Adresregels alleen als aangekruist bij aanmaken
    co.adres = "";
    co.postcodePlaats = "";
  }
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
  if (isCredit) {
    doc.text(`Creditfactuur ${factuur.factuur_nummer}`, margin, y);
    y += 7;
    doc.setFontSize(10);
    doc.setTextColor(...ORANGE);
    doc.text(
      creditVan
        ? `CREDIT FACTUUR (${creditVan})`
        : "CREDIT FACTUUR",
      margin,
      y
    );
    y += 3;
  } else {
    doc.text(`Factuur ${factuur.factuur_nummer}`, margin, y);
  }
  if (factuur.status === "concept") {
    doc.setFontSize(9);
    doc.setTextColor(...ORANGE);
    doc.text("CONCEPT", pageW - margin, isCredit ? y - 3 : y, {
      align: "right",
    });
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
  // Numerieke kolommen vast vanaf rechts, zodat AANTAL/PRIJS/BTW/BEDRAG
  // niet overlappen bij lange bedragen of omschrijvingen.
  const contentRight = pageW - margin;
  const col = {
    oms: margin,
    aantal: contentRight - 88,
    prijs: contentRight - 58,
    btw: contentRight - 34,
    bedrag: contentRight - 2,
  };
  const tableW = pageW - margin * 2;
  /** Ruimte voor omschrijving vóór AANTAL (padding meegerekend). */
  const omsMaxW = col.aantal - col.oms - 10;

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
  doc.text("BEDRAG", col.bedrag, y + 5.5, { align: "right" });
  y += 8;

  // —— Regel(s) ——
  const bedragExAbs = Math.abs(Number(factuur.bedrag_ex_btw) || 0);
  const bedragBtwAbs = Math.abs(Number(factuur.btw_bedrag) || 0);
  const bedragIncAbs = Math.abs(Number(factuur.bedrag_inc_btw) || 0);
  const sign = isCredit ? -1 : 1;
  const bedragEx = sign * bedragExAbs;
  const bedragBtw = sign * bedragBtwAbs;
  const bedragInc = sign * bedragIncAbs;

  const parsedRegels = parseFactuurRegels(factuur.notities);
  const regels: FactuurPdfRegel[] =
    parsedRegels.length > 0
      ? parsedRegels
      : [
          {
            omschrijving:
              factuur.omschrijving ||
              (isCredit && creditVan
                ? `Creditfactuur bij ${creditVan}`
                : offerte
                  ? `Aanbetaling bij ${offerte.offerte_nummer}`
                  : "Aanbetaling"),
            bedrag_ex_btw: bedragEx,
            btw_percentage: 21,
          },
        ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  for (const regel of regels) {
    const oms = sanitizePdfText(regel.omschrijving);
    const omsLines = wrapPdfLines(doc, oms, omsMaxW);
    const rowH = Math.max(10, omsLines.length * 4.2 + 6);
    const ex = Math.round(Number(regel.bedrag_ex_btw) * 100) / 100;
    const pct = regel.btw_percentage ?? 21;

    doc.setDrawColor(...LINE);
    doc.rect(margin, y, tableW, rowH);
    doc.setTextColor(...CHARCOAL);
    doc.text(omsLines, col.oms + 2, y + 6);
    doc.text("1", col.aantal, y + 6.5, { align: "right" });
    doc.text(formatEuroPdf(ex), col.prijs, y + 6.5, { align: "right" });
    doc.text(`${pct}%`, col.btw, y + 6.5, { align: "right" });
    doc.text(formatEuroPdf(ex), col.bedrag, y + 6.5, {
      align: "right",
    });
    y += Math.max(12, rowH + 2);
  }
  y += 2;

  if (offerte?.offerte_nummer) {
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Betreft offerte ${offerte.offerte_nummer}`, margin, y);
    y += 6;
  }

  const notitieTekst = customerFacingFactuurNotities(factuur.notities);
  if (notitieTekst) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const noteLines = wrapPdfLines(doc, sanitizePdfText(notitieTekst), tableW);
    for (const line of noteLines) {
      if (y > pageH - 56) break;
      doc.text(line, margin, y);
      y += 3.6;
    }
    y += 6;
  } else if (offerte?.offerte_nummer) {
    y += 4;
  }

  // —— Betaling links + totalen rechts ——
  const totalsW = 78;
  const totalsX = pageW - margin - totalsW;

  if (isCredit) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Credit", margin, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CHARCOAL);
    const creditLines = [
      creditVan
        ? `Deze creditfactuur hoort bij factuur ${creditVan}.`
        : "Dit is een creditfactuur.",
      "Er hoeft niets te worden betaald op dit document.",
    ];
    let py = y + 9;
    for (const line of creditLines) {
      doc.text(line, margin, py);
      py += 4;
    }
  } else if (co.iban) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Betalen", margin, y + 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CHARCOAL);
    const ref =
      offerte?.offerte_nummer?.trim() ||
      factuur.factuur_nummer;
    const dagen = factuurBetaaltermijnDagen({
      factuurdatum: factuur.factuurdatum,
      vervaldatum: factuur.vervaldatum,
    });
    const payLines = [
      `IBAN: ${co.iban}`,
      `T.n.v. ${co.accountName || "BatterijConcept"}`,
      `Omschrijving: ${ref}`,
      `Betaaltermijn: ${dagen} ${dagen === 1 ? "dag" : "dagen"} (uiterlijk ${formatDateShort(factuur.vervaldatum) || "—"})`,
    ];
    let py = y + 9;
    for (const line of payLines) {
      doc.text(line, margin, py);
      py += 4;
    }
  }

  // Excl
  doc.setFillColor(...GRAY);
  doc.rect(totalsX, y, totalsW, 7, "F");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CHARCOAL);
  doc.text("Excl. btw", totalsX + 2, y + 4.8);
  doc.text(formatEuroPdf(bedragEx), totalsX + totalsW - 2, y + 4.8, {
    align: "right",
  });
  y += 7;

  // BTW
  doc.setFillColor(...GRAY);
  doc.rect(totalsX, y, totalsW, 7, "F");
  doc.text("BTW 21%", totalsX + 2, y + 4.8);
  doc.text(formatEuroPdf(bedragBtw), totalsX + totalsW - 2, y + 4.8, {
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
  ].filter(Boolean) as string[];
  const pageLabel = "Pagina: 1 / 1";
  const pageLabelW = doc.getTextWidth(pageLabel);
  const footerMaxW = pageW - margin * 2 - pageLabelW - 6;
  const footerLines = doc.splitTextToSize(
    footerParts.join("  |  "),
    footerMaxW
  ) as string[];
  let fy = pageH - 12 - Math.max(0, footerLines.length - 1) * 3.2;
  doc.text(footerLines, margin, fy);
  doc.text(pageLabel, pageW - margin, pageH - 12, { align: "right" });

  return doc.output("blob");
}
