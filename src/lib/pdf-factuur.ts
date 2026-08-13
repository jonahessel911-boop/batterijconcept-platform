import { jsPDF } from "jspdf";
import type { Factuur, Lead, Offerte } from "@/types/database";
import { formatDateNl, formatDateShort, formatEuro, adresRegel } from "@/lib/format";

type PdfInput = {
  factuur: Factuur;
  lead?: Pick<
    Lead,
    "naam" | "email" | "telefoon" | "lead_number" | "straat" | "huisnummer" | "toevoeging" | "postcode" | "plaats"
  > | null;
  offerte?: Pick<Offerte, "offerte_nummer" | "subtotaal_ex_btw" | "btw_bedrag" | "totaal_inc_btw"> | null;
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
const CHARCOAL = hexToRgb("#2E3330");
const MUTED = hexToRgb("#5A635C");

export async function buildFactuurPdf(input: PdfInput): Promise<Blob> {
  const { factuur, lead, offerte } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  let y = 0;

  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageW, 36, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Batterijconcept", margin, 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("BTW-factuur", margin, 24);
  if (factuur.status === "concept") {
    doc.setFont("helvetica", "bold");
    doc.text("CONCEPT / DRAFT", pageW - margin, 16, { align: "right" });
  }

  y = 48;
  doc.setTextColor(...DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(factuur.factuur_nummer, margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...CHARCOAL);
  doc.text(`Factuurdatum: ${formatDateShort(factuur.factuurdatum)}`, margin, y);
  y += 6;
  if (factuur.vervaldatum) {
    doc.text(`Vervaldatum: ${formatDateShort(factuur.vervaldatum)}`, margin, y);
    y += 6;
  }
  if (offerte?.offerte_nummer) {
    doc.text(`Offerte: ${offerte.offerte_nummer}`, margin, y);
    y += 6;
  }

  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...DARK);
  doc.text("Factuur aan", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...CHARCOAL);
  doc.text(lead?.naam || "Klant", margin, y);
  y += 5;
  if (lead) {
    const adr = adresRegel(lead);
    if (adr && adr !== "—") {
      doc.text(adr, margin, y);
      y += 5;
    }
    if (lead.email) {
      doc.text(lead.email, margin, y);
      y += 5;
    }
  }

  y += 10;
  doc.setFillColor(244, 248, 245);
  doc.rect(margin, y - 4, pageW - margin * 2, 12, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Omschrijving", margin + 2, y + 3);
  doc.text("Bedrag", pageW - margin - 2, y + 3, { align: "right" });
  y += 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...CHARCOAL);
  const oms =
    factuur.omschrijving ||
    (offerte
      ? `BTW 21% over ${formatEuro(offerte.subtotaal_ex_btw)}`
      : "BTW-factuur");
  doc.text(oms, margin + 2, y);
  doc.text(formatEuro(factuur.bedrag_inc_btw), pageW - margin - 2, y, {
    align: "right",
  });
  y += 10;

  if (offerte) {
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(
      `Op basis van offerte ${offerte.offerte_nummer}: subtotaal excl. ${formatEuro(offerte.subtotaal_ex_btw)}, btw ${formatEuro(offerte.btw_bedrag)}, totaal incl. ${formatEuro(offerte.totaal_inc_btw)}.`,
      margin,
      y,
      { maxWidth: pageW - margin * 2 }
    );
    y += 12;
  }

  y += 4;
  doc.setDrawColor(200);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...CHARCOAL);
  doc.text("Excl. btw", margin, y);
  doc.text(formatEuro(factuur.bedrag_ex_btw), pageW - margin, y, {
    align: "right",
  });
  y += 6;
  doc.text("BTW", margin, y);
  doc.text(formatEuro(factuur.btw_bedrag), pageW - margin, y, {
    align: "right",
  });
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...DARK);
  doc.text("Totaal te betalen", margin, y);
  doc.text(formatEuro(factuur.bedrag_inc_btw), pageW - margin, y, {
    align: "right",
  });

  y += 16;
  if (factuur.status === "concept") {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(
      "Dit is een conceptfactuur ter controle — nog niet verzonden naar de klant.",
      margin,
      y,
      { maxWidth: pageW - margin * 2 }
    );
    y += 10;
  }

  if (factuur.notities) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(factuur.notities, margin, y, {
      maxWidth: pageW - margin * 2,
    });
  }

  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Batterijconcept.nl · info@batterijconcept.nl · 085 800 1645 · ${formatDateNl(new Date())}`,
    margin,
    285
  );

  return doc.output("blob");
}
