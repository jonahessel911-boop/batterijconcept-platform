import { jsPDF } from "jspdf";
import {
  PDF_COLORS,
  companyInfo,
  loadLogoDataUrl,
} from "@/lib/pdf-brand";
import {
  OPLEVER_AKKOORD_TEKST,
  OPLEVER_PUNTEN,
  type OpleverFormulierData,
} from "@/lib/oplever-formulier";

const {
  green: GREEN,
  dark: DARK,
  orange: ORANGE,
  charcoal: CHARCOAL,
  muted: MUTED,
  line: LINE,
} = PDF_COLORS;

function dash(v: string | undefined | null): string {
  const t = (v || "").trim();
  return t || "—";
}

function formatDatumNl(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return dash(ymd);
  return `${m[3]}-${m[2]}-${m[1]}`;
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
  const formats = jpeg
    ? (["JPEG", "PNG"] as const)
    : (["PNG", "JPEG"] as const);
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
 * Opleverformulier-PDF: checklist + handtekening monteur.
 */
export async function buildOpleverFormulierPdf(
  data: OpleverFormulierData
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentW = pageW - margin * 2;
  const co = companyInfo();
  const nowLabel = new Date().toLocaleString("nl-NL", {
    timeZone: "Europe/Amsterdam",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const afgevinkt = new Set(data.afgevinkt);

  let y = 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(nowLabel, margin, y);

  y = 16;
  const logo = loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, y, 16, 16);
    } catch {
      /* ignore */
    }
  }
  const textX = margin + (logo ? 20 : 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...DARK);
  doc.text("Batterij", textX, y + 7);
  doc.setTextColor(...ORANGE);
  doc.text("concept", textX + doc.getTextWidth("Batterij"), y + 7);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("Opwekken · Opladen · Opslaan", textX, y + 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...CHARCOAL);
  const right = [
    co.adres,
    co.postcodePlaats,
    co.kvk ? `KVK ${co.kvk}` : null,
    co.email,
    co.telefoon,
  ].filter(Boolean) as string[];
  let ry = y + 2;
  for (const line of right) {
    doc.text(line, pageW - margin, ry, { align: "right" });
    ry += 3.4;
  }

  y = 38;
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...DARK);
  doc.text("Opleverformulier installatie", margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...CHARCOAL);
  const meta = [
    [`Klant`, dash(data.klantNaam)],
    [`Adres`, dash(data.adres)],
    [`Project`, dash(data.projectNummer)],
    [`Datum`, formatDatumNl(data.datum)],
    [`Installateur`, dash(data.monteurNaam)],
  ];
  for (const [label, value] of meta) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...MUTED);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...CHARCOAL);
    const lines = doc.splitTextToSize(value, contentW - 32);
    doc.text(lines, margin + 32, y);
    y += Math.max(5, lines.length * 4.2);
  }

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text("Opleverpunten", margin, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  for (const punt of OPLEVER_PUNTEN) {
    const checked = afgevinkt.has(punt.id);
    const box = 4.2;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.35);
    doc.rect(margin, y - 3.2, box, box);
    if (checked) {
      doc.setDrawColor(...GREEN);
      doc.setLineWidth(0.7);
      doc.line(margin + 0.8, y - 1.1, margin + 1.7, y + 0.4);
      doc.line(margin + 1.7, y + 0.4, margin + 3.4, y - 2.6);
    }
    doc.setTextColor(...CHARCOAL);
    const lines = doc.splitTextToSize(punt.label, contentW - 10);
    doc.text(lines, margin + 7, y);
    y += Math.max(7, lines.length * 4.2 + 2);
  }

  y += 3;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  // Akkoord-box
  const akkoordBox = 4.2;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.35);
  doc.rect(margin, y - 3.2, akkoordBox, akkoordBox);
  if (data.akkoord) {
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.7);
    doc.line(margin + 0.8, y - 1.1, margin + 1.7, y + 0.4);
    doc.line(margin + 1.7, y + 0.4, margin + 3.4, y - 2.6);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  const akkoordLines = doc.splitTextToSize(
    OPLEVER_AKKOORD_TEKST,
    contentW - 10
  );
  doc.text(akkoordLines, margin + 7, y);
  y += Math.max(8, akkoordLines.length * 4.5 + 2);

  if (data.opmerkingen.trim()) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text("Opmerkingen", margin, y);
    y += 4.5;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...CHARCOAL);
    const opm = doc.splitTextToSize(data.opmerkingen.trim(), contentW);
    doc.text(opm, margin, y);
    y += opm.length * 4.2 + 4;
  }

  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...DARK);
  doc.text("Handtekening installateur", margin, y);
  y += 3;

  const sigH = 28;
  const sigW = Math.min(90, contentW);
  doc.setDrawColor(...LINE);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.3);
  doc.rect(margin, y, sigW, sigH, "FD");
  try {
    embedSignature(doc, data.handtekeningDataUrl, margin + 2, y + 1, sigW - 4, sigH - 4);
  } catch {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("(handtekening ontbreekt)", margin + 4, y + 14);
  }
  y += sigH + 5;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `${dash(data.monteurNaam)} · ${formatDatumNl(data.datum)}`,
    margin,
    y
  );

  // Footer
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(
    `${co.website} · ${co.email} · ${co.telefoon}`,
    margin,
    pageH - 7
  );
  doc.text("1/1", pageW - margin, pageH - 7, { align: "right" });

  return doc.output("blob");
}
