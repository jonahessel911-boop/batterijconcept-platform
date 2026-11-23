import { jsPDF } from "jspdf";
import { PDFDocument } from "pdf-lib";
import { formatDateNl, formatDateShort } from "@/lib/format";
import { companyInfo } from "@/lib/pdf-brand";

const INK: [number, number, number] = [26, 31, 28];
const MUTED: [number, number, number] = [90, 99, 92];
const LINE: [number, number, number] = [213, 221, 216];
const WASH: [number, number, number] = [245, 247, 245];
const HEADER: [number, number, number] = [26, 31, 28];

export const NIET_GELOPEN_BOETE_EX = 100;

const CLAUSULE_33 =
  "Valt een afspraak aantoonbaar uit door aan Adviseur toerekenbare nalatigheid, dan is Adviseur een contractuele boete van €100 per uitgevallen afspraak verschuldigd. Hieronder vallen zonder geldige reden niet verschijnen of de afspraak niet controleren ondanks tijdige correcte planning. Alleen een teleurstellend verkoopresultaat is geen grond voor deze boete.";

export type OffboardingOrder = {
  offerteNummer: string;
  klantNaam: string;
  plaats: string | null;
  ondertekendOp: string | null;
  bedragEx: number;
  commissieEx: number;
};

export type OffboardingNietGelopen = {
  startAt: string;
  klantNaam: string;
  plaats: string | null;
};

export type OffboardingInput = {
  adviseurNaam: string;
  bedrijfsnaam: string | null;
  email: string | null;
  telefoon: string | null;
  adres: string | null;
  postcodePlaats: string | null;
  kvk: string | null;
  ingangsdatum: string;
  slotdatum: string;
  overeenkomstIngangsdatum: string | null;
  contractGetekendOp: string | null;
  orders: OffboardingOrder[];
  nietGelopen: OffboardingNietGelopen[];
  totaleCommissieEx: number;
  overeenkomstBytes?: Uint8Array | null;
};

type Col = {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right";
};

/** jsPDF Helvetica heeft geen NBSP/minteken uit Intl. */
function euroPdf(amount: number): string {
  const n = Math.round(Number(amount || 0) * 100) / 100;
  const neg = n < 0;
  const abs = Math.abs(n).toFixed(2);
  const [eur, cents] = abs.split(".");
  const grouped = (eur || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "- " : ""}€ ${grouped},${cents}`;
}

function wrap(doc: jsPDF, text: string, maxW: number): string[] {
  return (doc.splitTextToSize(text, maxW) as string[]) || [];
}

function wrapAt(
  doc: jsPDF,
  text: string,
  maxW: number,
  size: number,
  style: "normal" | "italic" | "bold" = "normal"
): string[] {
  doc.setFont("helvetica", style);
  doc.setFontSize(size);
  return wrap(doc, text, maxW);
}

function ensureY(doc: jsPDF, y: number, need: number, margin: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need < pageH - 16) return y;
  doc.addPage();
  return margin;
}

function ellipsize(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  let t = text;
  while (t.length > 1 && doc.getTextWidth(`${t}…`) > maxW) t = t.slice(0, -1);
  return `${t}…`;
}

function drawTable(
  doc: jsPDF,
  y: number,
  margin: number,
  cols: Col[],
  rows: Record<string, string>[],
  emptyLabel: string
): number {
  const rowH = 7;
  const headerH = 7.5;
  const tableW = cols.reduce((s, c) => s + c.width, 0);

  y = ensureY(doc, y, headerH + rowH + 4, margin);

  const drawHeader = (top: number) => {
    doc.setFillColor(...HEADER);
    doc.rect(margin, top, tableW, headerH, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    let x = margin;
    for (const col of cols) {
      const pad = 1.5;
      const label = ellipsize(doc, col.label, col.width - pad * 2);
      if (col.align === "right") {
        doc.text(label, x + col.width - pad, top + 5, { align: "right" });
      } else {
        doc.text(label, x + pad, top + 5);
      }
      x += col.width;
    }
    return top + headerH;
  };

  y = drawHeader(y);

  if (rows.length === 0) {
    y = ensureY(doc, y, rowH + 2, margin);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.rect(margin, y, tableW, rowH, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(emptyLabel, margin + 1.5, y + 4.8);
    return y + rowH + 4;
  }

  rows.forEach((row, i) => {
    y = ensureY(doc, y, rowH + 2, margin);
    if (y === margin) y = drawHeader(y);
    if (i % 2 === 1) {
      doc.setFillColor(...WASH);
      doc.rect(margin, y, tableW, rowH, "F");
    } else {
      doc.setFillColor(255, 255, 255);
      doc.rect(margin, y, tableW, rowH, "F");
    }
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.rect(margin, y, tableW, rowH, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    let x = margin;
    for (const col of cols) {
      const pad = 1.5;
      const cell = ellipsize(doc, row[col.key] || "—", col.width - pad * 2);
      if (col.align === "right") {
        doc.text(cell, x + col.width - pad, y + 4.8, { align: "right" });
      } else {
        doc.text(cell, x + pad, y + 4.8);
      }
      x += col.width;
    }
    y += rowH;
  });

  return y + 4;
}

export async function buildOffboardingPdf(
  input: OffboardingInput
): Promise<Uint8Array> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 18;
  const maxW = pageW - margin * 2;
  const co = companyInfo();
  let y = 22;

  const titel = `Offboarding ${input.adviseurNaam}${
    input.bedrijfsnaam ? ` - ${input.bedrijfsnaam}` : ""
  }`;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  const titelLines = wrap(doc, titel, maxW);
  doc.text(titelLines, margin, y);
  y += titelLines.length * 6 + 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("Contact- en adresgegevens", margin, y);
  y += 6;
  doc.setTextColor(...MUTED);
  const contact = [
    input.adviseurNaam,
    input.bedrijfsnaam,
    input.adres,
    input.postcodePlaats,
    input.kvk ? `KVK ${input.kvk}` : null,
    input.email,
    input.telefoon,
  ].filter(Boolean) as string[];
  for (const line of contact) {
    doc.setTextColor(...INK);
    doc.text(line, margin, y);
    y += 5;
  }
  y += 4;
  doc.setTextColor(...MUTED);
  doc.text(
    `${co.naam} · ${co.adres} · ${co.postcodePlaats} · ${co.email}`,
    margin,
    y
  );
  y += 10;

  doc.setTextColor(...INK);
  if (input.overeenkomstIngangsdatum) {
    doc.text(
      `Ingangsdatum overeenkomst: ${input.overeenkomstIngangsdatum}`,
      margin,
      y
    );
    y += 5;
  }
  doc.text("Officiële beëindiging contract", margin, y);
  y += 6;
  doc.text(
    `Ingangsdatum beëindiging: ${formatDateNl(`${input.ingangsdatum}T12:00:00`)}`,
    margin,
    y
  );
  y += 5;
  doc.text(
    `Slotdatum: ${formatDateNl(`${input.slotdatum}T12:00:00`)}`,
    margin,
    y
  );
  y += 8;

  const stopTekst =
    "Vanaf de ingangsdatum van deze beëindiging mag Adviseur geen contact meer opnemen met klanten van BatterijConcept, hen niet benaderen en geen eigen proposities, diensten of offertes aanbieden aan klanten, leads of relaties die via BatterijConcept tot stand zijn gekomen.";
  const stopLines = wrap(doc, stopTekst, maxW);
  y = ensureY(doc, y, stopLines.length * 5 + 4, margin);
  doc.text(stopLines, margin, y);
  y += stopLines.length * 5 + 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text("Orders", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const orderNote = wrap(
    doc,
    "Alleen netto orders (geen HOLD sales actie en geen annulering). Deze orders worden uitbetaald na installatie.",
    maxW
  );
  doc.text(orderNote, margin, y);
  y += orderNote.length * 4.2 + 3;

  const orderCols: Col[] = [
    { key: "nr", label: "Offerte", width: 28 },
    { key: "klant", label: "Klant", width: 42 },
    { key: "plaats", label: "Plaats", width: 28 },
    { key: "datum", label: "Getekend", width: 24 },
    { key: "omzet", label: "Omzet ex", width: 26, align: "right" },
    { key: "comm", label: "Commissie ex", width: 26, align: "right" },
  ];
  y = drawTable(
    doc,
    y,
    margin,
    orderCols,
    input.orders.map((o) => ({
      nr: o.offerteNummer || "—",
      klant: o.klantNaam,
      plaats: o.plaats || "—",
      datum: o.ondertekendOp ? formatDateShort(o.ondertekendOp) : "—",
      omzet: euroPdf(o.bedragEx),
      comm: euroPdf(o.commissieEx),
    })),
    "Geen netto orders."
  );

  y = ensureY(doc, y, 16, margin);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text("Niet gelopen afspraken", margin, y);
  y += 6;

  const ngCols: Col[] = [
    { key: "datum", label: "Datum", width: 36 },
    { key: "klant", label: "Klant", width: 62 },
    { key: "plaats", label: "Plaats", width: 48 },
    { key: "boete", label: "Boete ex", width: 28, align: "right" },
  ];
  const n = input.nietGelopen.length;
  const boeteTotaal = Math.round(n * NIET_GELOPEN_BOETE_EX * 100) / 100;
  y = drawTable(
    doc,
    y,
    margin,
    ngCols,
    input.nietGelopen.map((a) => ({
      datum: formatDateShort(a.startAt),
      klant: a.klantNaam,
      plaats: a.plaats || "—",
      boete: euroPdf(NIET_GELOPEN_BOETE_EX),
    })),
    "Geen afspraken gemarkeerd als niet gelopen door adviseur."
  );

  const datumTekst = input.contractGetekendOp
    ? formatDateNl(input.contractGetekendOp)
    : "de datum van ondertekening van de samenwerkingsovereenkomst";

  const boeteTekst = `Deze afspraken zijn express niet gelopen. Beroep op artikel 3.3 (EUR 100 per afspraak; advertentiekosten, planning en misgelopen kans). Ondertekend op ${datumTekst}. Volledige tekst: kopie overeenkomst hierna.`;
  const boeteLines = wrapAt(doc, boeteTekst, maxW, 9);
  y = ensureY(doc, y, boeteLines.length * 4.4 + 18, margin);
  doc.setTextColor(...INK);
  doc.text(boeteLines, margin, y);
  y += boeteLines.length * 4.4 + 3;

  const quoteW = maxW - 8;
  const clauseLines = wrapAt(doc, `Art. 3.3  ${CLAUSULE_33}`, quoteW, 6.5, "italic");
  const quoteH = 3.5 + clauseLines.length * 3.2 + 2.5;
  y = ensureY(doc, y, quoteH + 6, margin);
  doc.setFillColor(...WASH);
  doc.rect(margin, y, maxW, quoteH, "F");
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin, y + quoteH);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text(clauseLines, margin + 4, y + 4.5);
  y += quoteH + 10;

  const commissie = Math.round(input.totaleCommissieEx * 100) / 100;
  const rest = Math.round((commissie - boeteTotaal) * 100) / 100;
  const restRichting =
    rest > 0
      ? "te ontvangen / te factureren"
      : rest < 0
        ? "terug te betalen"
        : "nihil";

  y = ensureY(doc, y, 40, margin);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text("Eindafrekening", margin, y);
  y += 7;

  const settle: { label: string; value: string; bold?: boolean }[] = [
    { label: "Totale commissie excl. btw", value: euroPdf(commissie) },
    {
      label: `Niet gelopen (${n} x EUR ${NIET_GELOPEN_BOETE_EX})`,
      value: `- ${euroPdf(boeteTotaal)}`,
    },
    {
      label: `Restbedrag (${restRichting})`,
      value: euroPdf(Math.abs(rest)),
      bold: true,
    },
  ];
  for (const row of settle) {
    const h = row.bold ? 10 : 8.5;
    y = ensureY(doc, y, h + 1, margin);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.25);
    if (row.bold) {
      doc.setFillColor(...WASH);
      doc.rect(margin, y, maxW, h, "FD");
    } else {
      doc.setFillColor(255, 255, 255);
      doc.rect(margin, y, maxW, h, "S");
    }
    doc.setFont("helvetica", row.bold ? "bold" : "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(row.label, margin + 3, y + h / 2 + 1.1);
    doc.text(row.value, margin + maxW - 3, y + h / 2 + 1.1, {
      align: "right",
    });
    y += h;
  }
  y += 10;

  y = ensureY(doc, y, 10, margin);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("Hierna volgt een kopie van de samenwerkingsovereenkomst.", margin, y);

  const mainBytes = new Uint8Array(doc.output("arraybuffer"));
  const merged = await PDFDocument.create();
  const mainDoc = await PDFDocument.load(mainBytes);
  const mainPages = await merged.copyPages(mainDoc, mainDoc.getPageIndices());
  for (const p of mainPages) merged.addPage(p);

  if (input.overeenkomstBytes && input.overeenkomstBytes.byteLength > 0) {
    try {
      const kopie = await PDFDocument.load(input.overeenkomstBytes);
      const kopiePages = await merged.copyPages(kopie, kopie.getPageIndices());
      for (const p of kopiePages) merged.addPage(p);
    } catch {
      const note = merged.addPage();
      const { height } = note.getSize();
      note.drawText(
        "Kopie overeenkomst kon niet worden toegevoegd (bestand onleesbaar).",
        { x: 50, y: height - 80, size: 10 }
      );
    }
  }

  return merged.save();
}
