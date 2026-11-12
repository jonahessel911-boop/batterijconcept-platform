import fs from "fs";
import path from "path";
import { jsPDF } from "jspdf";
import { companyInfo } from "@/lib/pdf-brand";
import {
  EDERGY_PER_AANVRAAG_BTW,
  EDERGY_PER_AANVRAAG_EXCL,
  EDERGY_PER_AANVRAAG_INC,
} from "@/lib/edergy-tarief";

export type EdergyFactuurRegel = {
  /** Tweede regel, bijv. "Dhr. Soutou - Halsteren (verkoopadviseur Winny)". */
  klant: string;
};

export type EdergyFactuurPdfInput = {
  nummer: string;
  /** 03-november-2026 */
  datumLabel: string;
  regels: EdergyFactuurRegel[];
  /** Per regel; default = ingesteld Edergy-tarief. */
  bedragExcl?: number;
  bedragBtw?: number;
  bedragInc?: number;
};

const WERK =
  "Afhandeling en persoonlijke begeleiding warmtefondsaanvraag";

function euroPunt(n: number): string {
  return `€${n.toFixed(2)}`;
}

function baseline(top: number, size: number): number {
  return top + size * 0.78;
}

let fontCache: { regular: string; bold: string } | null = null;

function carlito(): { regular: string; bold: string } {
  if (fontCache) return fontCache;
  const dir = path.join(process.cwd(), "src/lib/fonts");
  fontCache = {
    regular: fs.readFileSync(path.join(dir, "Carlito-Regular.ttf")).toString("base64"),
    bold: fs.readFileSync(path.join(dir, "Carlito-Bold.ttf")).toString("base64"),
  };
  return fontCache;
}

function useCarlito(doc: jsPDF) {
  const fonts = carlito();
  doc.addFileToVFS("Carlito-Regular.ttf", fonts.regular);
  doc.addFileToVFS("Carlito-Bold.ttf", fonts.bold);
  doc.addFont("Carlito-Regular.ttf", "Carlito", "normal");
  doc.addFont("Carlito-Bold.ttf", "Carlito", "bold");
  doc.setFont("Carlito", "normal");
}

function loadLogo(): string | null {
  try {
    const full = path.join(process.cwd(), "public", "edergy-logo.png");
    if (!fs.existsSync(full)) return null;
    return `data:image/png;base64,${fs.readFileSync(full).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Factuur in de layout van Edergy (logo, kolommen, betaaltekst).
 * Alleen de klantgegevens links zijn de huidige BatterijConcept-factuurgegevens.
 */
export function buildEdergyFactuurPdf(input: EdergyFactuurPdfInput): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4", compress: true });
  useCarlito(doc);
  const co = companyInfo();
  const klantNaam = co.naam.includes(" ")
    ? co.naam
    : co.naam.replace(/Concept/i, " Concept");

  doc.setTextColor(0, 0, 0);
  doc.setFont("Carlito", "bold");
  doc.setFontSize(20);
  doc.text("FACTUUR", 36, baseline(39, 20));

  const logo = loadLogo();
  if (logo) {
    doc.addImage(logo, "PNG", 438.36, 59.28, 146.04, 146.16);
  }

  doc.setFontSize(11);
  doc.setFont("Carlito", "bold");
  doc.text("Klantgegevens:", 36, baseline(72.3, 11));
  doc.text("Onze gegevens:", 283.8, baseline(72.3, 11));
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.7);
  doc.line(36, 81.6, 104, 81.6);
  doc.line(283.8, 81.6, 353.6, 81.6);

  doc.setFont("Carlito", "normal");
  const links = [
    [99.2, klantNaam],
    [112.6, co.adres],
    [126.1, co.postcodePlaats],
    [139.5, `KVK nummer ${co.kvk}`],
  ] as const;
  for (const [top, text] of links) {
    doc.text(text, 36, baseline(top, 11));
  }

  const mailTop = baseline(152.8, 11);
  doc.setTextColor(5, 99, 193);
  doc.textWithLink(co.email, 36, mailTop, {
    url: `mailto:${co.email}`,
  });
  const mailW = doc.getTextWidth(co.email);
  doc.setDrawColor(5, 99, 193);
  doc.setLineWidth(0.6);
  doc.line(36, 162.1, 36 + Math.max(mailW, 105.8), 162.1);

  doc.setTextColor(0, 0, 0);
  const rechts: [number, string][] = [
    [99.2, "Edergy"],
    [112.6, "Zuidwenk 100"],
    [126.1, "3751CG Bunschoten-Spakenburg"],
    [139.5, "06-58824298"],
    [152.8, "KVK nummer 42079675"],
    [166.3, "BTW nummer NL005480363B45"],
  ];
  for (const [top, text] of rechts) {
    doc.text(text, 283.8, baseline(top, 11));
  }

  doc.setFont("Carlito", "bold");
  doc.text("Factuurgegevens:", 36, baseline(206.6, 11));
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.7);
  doc.line(36, 215.9, 115, 215.9);

  doc.setFont("Carlito", "normal");
  doc.text("Factuurnummer:", 36, baseline(233.5, 11));
  doc.text(input.nummer, 142.2, baseline(233.5, 11));
  doc.text("Factuurdatum:", 36, baseline(246.9, 11));
  doc.text(input.datumLabel, 142.2, baseline(246.9, 11));

  const x0 = 36;
  const x1 = 379;
  const x2 = 445.4;
  const x3 = 510.8;
  const x4 = 565;
  const headTop = 270.1;
  const headBot = 298.7;
  const bodyBot = 738.6;
  const totalBot = 757.4;

  doc.setLineWidth(0.5);
  doc.setDrawColor(0, 0, 0);
  doc.line(x0, headTop, x4, headTop);
  doc.line(x0, headBot, x4, headBot);
  doc.line(x0, bodyBot, x4, bodyBot);
  doc.line(x0, totalBot, x4, totalBot);
  for (const x of [x0, x1, x2, x3, x4]) {
    doc.line(x, headTop, x, bodyBot);
  }
  doc.line(x0, bodyBot, x0, totalBot);
  doc.line(x3, bodyBot, x3, totalBot);
  doc.line(x4, bodyBot, x4, totalBot);

  doc.setFont("Carlito", "bold");
  doc.setFontSize(11);
  doc.text("Uitgevoerde werkzaamheden:", 41.6, baseline(273.1, 11));
  doc.setFontSize(10);
  doc.text("Bedrag excl.", 384.6, baseline(273.1, 10));
  doc.text("BTW", 401.6, baseline(286.4, 10));
  doc.text("BTW (21%)", 451.1, baseline(273.1, 10));
  doc.text("Bedrag:", 520.4, baseline(273.1, 10));

  doc.setFont("Carlito", "normal");
  doc.setFontSize(10);
  const bedragEx =
    input.bedragExcl != null && Number.isFinite(input.bedragExcl)
      ? input.bedragExcl
      : EDERGY_PER_AANVRAAG_EXCL;
  const bedragBtw =
    input.bedragBtw != null && Number.isFinite(input.bedragBtw)
      ? input.bedragBtw
      : EDERGY_PER_AANVRAAG_BTW;
  const bedragInc =
    input.bedragInc != null && Number.isFinite(input.bedragInc)
      ? input.bedragInc
      : EDERGY_PER_AANVRAAG_INC;
  const excl = euroPunt(bedragEx);
  const btw = euroPunt(bedragBtw);
  const incl = euroPunt(bedragInc);
  const rightExcl = 445.4 - 8;
  const rightBtw = 510.8 - 8;
  const rightIncl = 565 - 8;

  input.regels.slice(0, 12).forEach((regel, i) => {
    const top = 313.6 + i * 36.6;
    doc.text(WERK, 41.6, baseline(top, 10));
    doc.text(regel.klant, 41.6, baseline(top + 12.2, 10));
    const y = baseline(top, 10);
    doc.text(excl, rightExcl - doc.getTextWidth(excl), y);
    doc.text(btw, rightBtw - doc.getTextWidth(btw), y);
    doc.text(incl, rightIncl - doc.getTextWidth(incl), y);
  });

  const totaal = euroPunt(bedragInc * input.regels.length);
  doc.setFont("Carlito", "bold");
  doc.setFontSize(10);
  const totaalLabel = "Totaal bedrag";
  doc.text(
    totaalLabel,
    rightIncl - doc.getTextWidth(totaal) - 8 - doc.getTextWidth(totaalLabel),
    baseline(741.4, 10)
  );
  doc.text(totaal, rightIncl - doc.getTextWidth(totaal), baseline(741.4, 10));

  doc.setFont("Carlito", "normal");
  doc.setFontSize(11);
  doc.text(
    "Gaarne per omgaande het bovengenoemde bedrag overmaken op NL13INGB0119293684 t.n.v. Edergy onder",
    36,
    baseline(773.7, 11)
  );
  doc.text("vermelding van uw factuurnummer.", 36, baseline(787.2, 11));

  return new Uint8Array(doc.output("arraybuffer"));
}
