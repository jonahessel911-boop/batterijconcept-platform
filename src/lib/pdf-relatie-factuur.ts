import { jsPDF } from "jspdf";
import { addDays, parseISO } from "date-fns";
import { formatDateShort } from "@/lib/format";
import {
  PDF_COLORS,
  companyInfo,
  formatEuroPdf,
  loadLogoDataUrl,
} from "@/lib/pdf-brand";

export const RELATIE_FACTUUR_BETAALTERMIJN_DAGEN = 7;
/** NL BTW-tarief op selfbilling-facturen (commissie/vergoeding). */
export const RELATIE_BTW_PCT = 0.21;

/**
 * Selfbilling adviseur/partner → Batterijconcept.
 * Commissie/vergoeding is exclusief btw; hierop komt 21% btw (niet verlegd).
 */
export function bedragenMetBtw(exBtw: number): {
  bedrag_ex_btw: number;
  btw_bedrag: number;
  bedrag_inc_btw: number;
} {
  const bedrag_ex_btw = Math.round(exBtw * 100) / 100;
  const btw_bedrag = Math.round(bedrag_ex_btw * RELATIE_BTW_PCT * 100) / 100;
  const bedrag_inc_btw = Math.round((bedrag_ex_btw + btw_bedrag) * 100) / 100;
  return { bedrag_ex_btw, btw_bedrag, bedrag_inc_btw };
}

/** Herbereken BTW vanuit bedrag_ex_btw (corrigeert oude verlegd-facturen). */
export function normalizeRelatieFactuurBedragen(fac: {
  bedrag_ex_btw?: number | null;
  btw_bedrag?: number | null;
  bedrag_inc_btw?: number | null;
}): {
  bedrag_ex_btw: number;
  btw_bedrag: number;
  bedrag_inc_btw: number;
} {
  return bedragenMetBtw(Number(fac.bedrag_ex_btw) || 0);
}

export type RelatieFactuurRegel = {
  omschrijving: string;
  bedrag: number;
  offerte_nummer?: string | null;
  project_nummer?: string | null;
};

export type RelatieFactuurIssuer = {
  naam: string;
  bedrijfsnaam: string | null;
  kvk_nummer: string | null;
  btw_nummer?: string | null;
  iban: string | null;
  factuur_adres?: string | null;
  factuur_postcode?: string | null;
  factuur_plaats?: string | null;
  email?: string | null;
};

export type RelatieFactuurInput = {
  factuur: {
    factuur_nummer: string;
    factuurdatum: string;
    bedrag_ex_btw: number;
    bedrag_inc_btw: number;
    btw_bedrag: number;
    notities?: string | null;
    week_jaar?: number | null;
    week_nummer?: number | null;
    periode_van?: string | null;
    periode_tot?: string | null;
    status?: string | null;
  };
  issuer: RelatieFactuurIssuer;
  /** "adviseur" | "installatiepartner" — voor titelregel */
  issuerLabel: string;
  regels: RelatieFactuurRegel[];
};

const {
  green: GREEN,
  dark: DARK,
  orange: ORANGE,
  charcoal: CHARCOAL,
  muted: MUTED,
  line: LINE,
  wash: WASH,
} = PDF_COLORS;

export function relatieFactuurVervaldatum(factuurdatum: string): string {
  try {
    return addDays(
      parseISO(factuurdatum.slice(0, 10)),
      RELATIE_FACTUUR_BETAALTERMIJN_DAGEN
    )
      .toISOString()
      .slice(0, 10);
  } catch {
    return factuurdatum.slice(0, 10);
  }
}

/**
 * Selfbilling-factuur: uit naam van adviseur/partner, gericht aan Batterijconcept.
 */
export async function buildRelatieFactuurPdf(
  input: RelatieFactuurInput
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const co = companyInfo();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const verval = relatieFactuurVervaldatum(input.factuur.factuurdatum);
  const issuerName = input.issuer.bedrijfsnaam || input.issuer.naam;
  let y = 14;

  // —— Header: logo + merk · issuer rechts ——
  const logo = loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, y, 18, 18);
    } catch {
      /* ignore */
    }
  }
  const brandX = margin + (logo ? 22 : 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...DARK);
  doc.text("Batterij", brandX, y + 8);
  doc.setTextColor(...ORANGE);
  doc.text(
    "concept",
    brandX + doc.getTextWidth("Batterij"),
    y + 8
  );
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("Selfbilling · factuur aan Batterijconcept", brandX, y + 13);

  // Issuer (afzender) rechtsboven
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...CHARCOAL);
  let ry = y + 3;
  doc.text(issuerName, pageW - margin, ry, { align: "right" });
  ry += 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  const issuerLines = [
    input.issuer.bedrijfsnaam ? `t.a.v. ${input.issuer.naam}` : null,
    input.issuer.factuur_adres,
    [input.issuer.factuur_postcode, input.issuer.factuur_plaats]
      .filter(Boolean)
      .join(" ") || null,
    input.issuer.kvk_nummer ? `KvK ${input.issuer.kvk_nummer}` : null,
    input.issuer.btw_nummer ? `BTW ${input.issuer.btw_nummer}` : null,
    input.issuer.iban ? `IBAN ${input.issuer.iban}` : null,
    input.issuer.email,
  ].filter(Boolean) as string[];
  for (const line of issuerLines) {
    doc.text(line, pageW - margin, ry, { align: "right" });
    ry += 3.6;
  }

  y = Math.max(38, ry + 4);

  // Accentbalk
  doc.setFillColor(...GREEN);
  doc.rect(margin, y, pageW - margin * 2, 1.2, "F");
  y += 10;

  // Titel + meta
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...DARK);
  doc.text(`Factuur ${input.factuur.factuur_nummer}`, margin, y);
  if (input.factuur.status === "concept") {
    doc.setFontSize(9);
    doc.setTextColor(...ORANGE);
    doc.text("CONCEPT", pageW - margin, y, { align: "right" });
  }
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(input.issuerLabel, margin, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...ORANGE);
  doc.text("Factuurdatum", margin, y);
  doc.text("Vervaldatum", margin + 52, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...CHARCOAL);
  doc.text(formatDateShort(input.factuur.factuurdatum), margin, y + 5);
  doc.text(formatDateShort(verval), margin + 52, y + 5);
  if (input.factuur.week_nummer != null && input.factuur.week_jaar != null) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...ORANGE);
    doc.text("Week", margin + 104, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...CHARCOAL);
    doc.text(
      `${input.factuur.week_nummer}-${input.factuur.week_jaar}`,
      margin + 104,
      y + 5
    );
  }
  y += 14;

  // Aan-blok (Batterijconcept)
  doc.setFillColor(...WASH);
  doc.rect(margin, y, pageW - margin * 2, 28, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("FACTUUR AAN", margin + 4, y + 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text(co.legal || co.naam, margin + 4, y + 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CHARCOAL);
  const aanLines = [
    [co.adres, co.postcodePlaats].filter(Boolean).join(", "),
    [
      co.kvk ? `KvK ${co.kvk}` : null,
      co.btw ? `BTW ${co.btw}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    co.factuurEmail || co.email,
  ].filter(Boolean) as string[];
  let ay = y + 17;
  for (const line of aanLines) {
    doc.text(line, margin + 4, ay);
    ay += 3.8;
  }
  y += 34;

  // Tabel
  const col = {
    oms: margin,
    btw: pageW - margin - 55,
    bedrag: pageW - margin,
  };
  const tableW = pageW - margin * 2;

  doc.setFillColor(...DARK);
  doc.rect(margin, y, tableW, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text("OMSCHRIJVING", col.oms + 3, y + 5.5);
  doc.text("BTW", col.btw, y + 5.5, { align: "right" });
  doc.text("BEDRAG EXCL.", col.bedrag - 3, y + 5.5, { align: "right" });
  y += 8;

  const regels =
    input.regels.length > 0
      ? input.regels
      : [
          {
            omschrijving: "Diensten",
            bedrag: input.factuur.bedrag_ex_btw,
          },
        ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  for (const r of regels) {
    const refs = [
      r.offerte_nummer ? `Offerte ${r.offerte_nummer}` : null,
      r.project_nummer ? `Project ${r.project_nummer}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const label = refs ? `${r.omschrijving}\n${refs}` : r.omschrijving;
    const lines = doc.splitTextToSize(label, col.btw - col.oms - 10) as string[];
    const rowH = Math.max(10, lines.length * 4.2 + 5);

    if (y + rowH > pageH - 55) {
      doc.addPage();
      y = 20;
    }

    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    doc.line(margin, y + rowH, pageW - margin, y + rowH);
    doc.setTextColor(...CHARCOAL);
    doc.text(lines, col.oms + 3, y + 5.5);
    doc.setTextColor(...MUTED);
    doc.text(`${Math.round(RELATIE_BTW_PCT * 100)}%`, col.btw, y + 5.5, {
      align: "right",
    });
    doc.setTextColor(...CHARCOAL);
    doc.text(formatEuroPdf(r.bedrag), col.bedrag - 3, y + 5.5, {
      align: "right",
    });
    y += rowH;
  }

  y += 8;

  const amounts = normalizeRelatieFactuurBedragen(input.factuur);

  // Totalen
  const totalsX = pageW - margin - 70;
  const row = (label: string, value: string, bold = false, green = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(bold ? 11 : 9);
    doc.setTextColor(...(green ? GREEN : CHARCOAL));
    doc.text(label, totalsX, y);
    doc.text(value, pageW - margin, y, { align: "right" });
    y += bold ? 7 : 5.5;
  };

  row("Subtotaal excl. btw", formatEuroPdf(amounts.bedrag_ex_btw));
  row(
    `BTW ${Math.round(RELATIE_BTW_PCT * 100)}%`,
    formatEuroPdf(amounts.btw_bedrag)
  );
  doc.setDrawColor(...LINE);
  doc.line(totalsX, y - 1, pageW - margin, y - 1);
  y += 4;
  row("Totaal te ontvangen", formatEuroPdf(amounts.bedrag_inc_btw), true, true);

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Betaaltermijn ${RELATIE_FACTUUR_BETAALTERMIJN_DAGEN} dagen · uiterlijk ${formatDateShort(verval)}`,
    margin,
    y
  );
  y += 4;
  if (input.issuer.iban) {
    doc.text(
      `Uitbetaling door ${co.naam} op IBAN ${input.issuer.iban}`,
      margin,
      y
    );
    y += 4;
  }

  if (input.factuur.notities) {
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Notities", margin, y);
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...CHARCOAL);
    const noteLines = doc.splitTextToSize(
      input.factuur.notities,
      pageW - margin * 2
    ) as string[];
    doc.text(noteLines, margin, y);
    y += noteLines.length * 3.8;
  }

  // Footer
  doc.setDrawColor(...LINE);
  doc.line(margin, pageH - 14, pageW - margin, pageH - 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `Factuur van ${issuerName} aan ${co.naam} · KvK ${co.kvk || "—"} · ${co.website}`,
    margin,
    pageH - 9
  );

  return doc.output("blob");
}
