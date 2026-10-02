import { jsPDF } from "jspdf";
import { formatDateShort, formatEuro } from "@/lib/format";
import { PDF_COLORS, companyInfo, loadLogoDataUrl } from "@/lib/pdf-brand";

type Regel = {
  lead_naam: string | null;
  offerte_nummer: string | null;
  klant_factuur_nummer: string | null;
  fee: number;
  betaald_op: string | null;
  omschrijving?: string | null;
};

type Input = {
  factuur: {
    factuur_nummer: string;
    factuurdatum: string;
    status: string;
    week_jaar: number;
    week_nummer: number;
    periode_van: string;
    periode_tot: string;
    bedrag_ex_btw: number;
    bedrag_inc_btw: number;
    btw_bedrag: number;
    notities: string | null;
  };
  adviseur: {
    naam: string;
    bedrijfsnaam: string | null;
    kvk_nummer: string | null;
    iban: string | null;
    factuur_adres?: string | null;
    factuur_postcode?: string | null;
    factuur_plaats?: string | null;
  };
  regels: Regel[];
};

const { green: GREEN, charcoal: CHARCOAL, muted: MUTED, line: LINE } =
  PDF_COLORS;

export async function buildAdviseurCreditfactuurPdf(
  input: Input
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const co = companyInfo();
  const pageW = doc.internal.pageSize.getWidth();
  let y = 18;

  const logo = loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", 14, 12, 28, 10);
    } catch {
      /* ignore */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...GREEN);
  doc.text("Creditfactuur verkoper", pageW - 14, 18, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(co.naam, pageW - 14, 24, { align: "right" });
  doc.text(`${co.adres}, ${co.postcodePlaats}`, pageW - 14, 28, {
    align: "right",
  });

  y = 40;
  doc.setDrawColor(...LINE);
  doc.line(14, y, pageW - 14, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...CHARCOAL);
  doc.text(input.factuur.factuur_nummer, 14, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(
    `Datum ${formatDateShort(input.factuur.factuurdatum)} · Week ${input.factuur.week_nummer}-${input.factuur.week_jaar} · ${input.factuur.status}`,
    14,
    y + 5
  );
  doc.text(
    `Periode ${formatDateShort(input.factuur.periode_van)} – ${formatDateShort(input.factuur.periode_tot)}`,
    14,
    y + 10
  );

  y += 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...CHARCOAL);
  doc.text("Aan", 14, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(input.adviseur.bedrijfsnaam || input.adviseur.naam, 14, y);
  y += 4;
  if (input.adviseur.bedrijfsnaam) {
    doc.text(`t.a.v. ${input.adviseur.naam}`, 14, y);
    y += 4;
  }
  if (input.adviseur.factuur_adres) {
    doc.text(input.adviseur.factuur_adres, 14, y);
    y += 4;
  }
  if (input.adviseur.factuur_postcode || input.adviseur.factuur_plaats) {
    doc.text(
      [input.adviseur.factuur_postcode, input.adviseur.factuur_plaats]
        .filter(Boolean)
        .join(" "),
      14,
      y
    );
    y += 4;
  }
  if (input.adviseur.kvk_nummer) {
    doc.setTextColor(...MUTED);
    doc.text(`KvK ${input.adviseur.kvk_nummer}`, 14, y);
    y += 4;
  }
  if (input.adviseur.iban) {
    doc.text(`IBAN ${input.adviseur.iban}`, 14, y);
    y += 4;
  }

  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("OMSCHRIJVING", 14, y);
  doc.text("BEDRAG", pageW - 14, y, { align: "right" });
  y += 2;
  doc.setDrawColor(...LINE);
  doc.line(14, y, pageW - 14, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...CHARCOAL);

  if (input.regels.length === 0) {
    doc.text("Commissie aanbetaling (tranche A)", 14, y);
    doc.text(formatEuro(input.factuur.bedrag_ex_btw), pageW - 14, y, {
      align: "right",
    });
    y += 6;
  } else {
    for (const r of input.regels) {
      const label =
        r.omschrijving?.trim() ||
        [
          "Tranche A · aanbetaling",
          r.lead_naam,
          r.offerte_nummer ? `offerte ${r.offerte_nummer}` : null,
          r.klant_factuur_nummer ? `factuur ${r.klant_factuur_nummer}` : null,
          r.betaald_op ? `betaald ${formatDateShort(r.betaald_op)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
      const lines = doc.splitTextToSize(label, pageW - 50);
      doc.text(lines, 14, y);
      doc.text(formatEuro(r.fee), pageW - 14, y, { align: "right" });
      y += Math.max(6, lines.length * 4 + 2);
      if (y > 270) {
        doc.addPage();
        y = 20;
      }
    }
  }

  y += 4;
  doc.line(14, y, pageW - 14, y);
  y += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...GREEN);
  doc.text("Totaal", 14, y);
  doc.text(formatEuro(input.factuur.bedrag_inc_btw), pageW - 14, y, {
    align: "right",
  });
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Excl. btw ${formatEuro(input.factuur.bedrag_ex_btw)} · BTW ${formatEuro(input.factuur.btw_bedrag)}`,
    14,
    y
  );

  if (input.factuur.notities) {
    y += 10;
    doc.setFontSize(8);
    doc.text(input.factuur.notities, 14, y);
  }

  y = Math.max(y + 16, 260);
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `${co.naam} · KvK ${co.kvk} · ${co.iban}`,
    14,
    y
  );

  return doc.output("blob");
}
