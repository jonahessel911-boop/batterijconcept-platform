import { jsPDF } from "jspdf";
import { addDays, parseISO } from "date-fns";
import { formatDateShort } from "@/lib/format";
import { companyInfo, formatEuroPdf } from "@/lib/pdf-brand";
import {
  RELATIE_BTW_PCT,
  bedragenMetBtw,
} from "@/lib/relatie-btw";

export { RELATIE_BTW_PCT, bedragenMetBtw } from "@/lib/relatie-btw";

export const RELATIE_FACTUUR_BETAALTERMIJN_DAGEN = 7;
/** Partner/monteur selfbilling: betaaltermijn 14 dagen. */
export const PARTNER_FACTUUR_BETAALTERMIJN_DAGEN = 14;

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
  /** Fallback als factuuradres incompleet is (bijv. adviseur startadres). */
  start_adres?: string | null;
  email?: string | null;
};

/** Adresregels voor PDF: factuuradres, anders startadres. */
export function resolveIssuerAdresRegels(
  issuer: RelatieFactuurIssuer
): string[] {
  const straat = issuer.factuur_adres?.trim() || "";
  const pc = issuer.factuur_postcode?.trim() || "";
  const plaats = issuer.factuur_plaats?.trim() || "";
  const pcPlaats = [pc, plaats].filter(Boolean).join(" ");

  if (straat && (pc || plaats)) {
    return [straat, pcPlaats].filter(Boolean);
  }
  if (straat) {
    return [straat, pcPlaats].filter(Boolean);
  }

  const start = issuer.start_adres?.trim() || "";
  if (start) {
    // "Straat 12, 5262AR Vught" of "Straat 12, 5262 AR Vught"
    const m = start.match(/^(.+?),\s*(\d{4}\s?[A-Za-z]{2})\s+(.+)$/);
    if (m) {
      return [m[1]!.trim(), `${m[2]!.replace(/\s+/g, "").toUpperCase()} ${m[3]!.trim()}`];
    }
    return [start];
  }

  // Alleen postcode (incompleet) — liever weglaten dan half adres
  if (pc && plaats) return [`${pc} ${plaats}`];
  return [];
}

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
  /** Override betaaltermijn (default 7; partner = 14) */
  betaaltermijnDagen?: number;
};

/** Strak zwart-wit (adviseur-/partner-selfbilling). */
const DARK: [number, number, number] = [22, 22, 22];
const CHARCOAL: [number, number, number] = [55, 55, 55];
const MUTED: [number, number, number] = [110, 110, 110];
const LINE: [number, number, number] = [210, 210, 210];
const WASH: [number, number, number] = [245, 245, 245];
const HEADER: [number, number, number] = [36, 36, 36];

export function relatieFactuurVervaldatum(
  factuurdatum: string,
  termijnDagen: number = RELATIE_FACTUUR_BETAALTERMIJN_DAGEN
): string {
  try {
    return addDays(parseISO(factuurdatum.slice(0, 10)), termijnDagen)
      .toISOString()
      .slice(0, 10);
  } catch {
    return factuurdatum.slice(0, 10);
  }
}

/** Interne tags / dump uit notities voor op de PDF. */
export function cleanRelatieFactuurNotities(
  raw: string | null | undefined
): string | null {
  if (!raw?.trim()) return null;
  const cleaned = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("REGELS_JSON:"))
    .filter((l) => !/^ref_offerte(_tranche_b)?:/i.test(l))
    .map((l) =>
      l
        .replace(/\bref_offerte_tranche_b:[^\s]+/gi, "")
        .replace(/\bref_offerte:[^\s]+/gi, "")
        .replace(/\bHandmatig concept\.?/gi, "")
        .replace(/\bFactuur van .+? aan Batterijconcept\.?/gi, "")
        .replace(/\bWeek \d+ \([^)]+\)\.?/gi, "")
        .replace(/\b€\d+ excl\. btw per betaalde klant-aanbetaling\.?/gi, "")
        .replace(/\bBetaaltermijn \d+ dagen\.?/gi, "")
        .replace(/\bBTW 21%\./gi, "")
        .replace(/\bKvK [^,]+, IBAN [^\s.]+\.?/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    )
    .filter((l) => l.length > 8)
    .join(" ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || null;
}

function regelSubtitle(r: RelatieFactuurRegel): string | null {
  const oms = (r.omschrijving || "").trim();
  // Partnerregel: projectnummer zit al in de titel → geen subtitel
  if (/^installatie en schouw\b/i.test(oms)) return null;

  const project = r.project_nummer?.trim();
  const projectLabel = !project
    ? null
    : project.includes(",")
      ? project
      : oms.toLowerCase().includes(project.toLowerCase())
        ? null
        : `Project ${project}`;
  const parts = [
    r.offerte_nummer ? `Offerte ${r.offerte_nummer}` : null,
    projectLabel,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function cleanRegelOmschrijving(r: RelatieFactuurRegel): string {
  let oms = (r.omschrijving || "Diensten").trim();
  // Partner: volledige titel behouden ("Installatie en schouw PRJ-…")
  if (/^installatie en schouw\b/i.test(oms)) {
    return oms.replace(/\s{2,}/g, " ").trim();
  }
  // Haal refs weg die al als subtitel staan
  oms = oms
    .replace(/\s*·?\s*Offerte\s+[A-Z0-9\-_/]+/gi, "")
    .replace(/\s*·?\s*Project\s+[A-Z0-9\-_/]+/gi, "")
    .replace(/\s*·?\s*klantfactuur\s+[A-Z0-9\-_/]+/gi, "")
    .replace(/\s*·?\s*betaald\s+\d{4}-\d{2}-\d{2}/gi, "");
  if (r.project_nummer && !r.project_nummer.includes(",")) {
    const esc = r.project_nummer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    oms = oms.replace(new RegExp(`\\s*${esc}\\s*`, "gi"), " ");
  }
  if (r.offerte_nummer) {
    const esc = r.offerte_nummer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    oms = oms.replace(new RegExp(`\\s*${esc}\\s*`, "gi"), " ");
  }
  oms = oms
    .replace(/\s*·\s*·+/g, " · ")
    .replace(/^\s*·\s*|\s*·\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return oms || "Diensten";
}

/**
 * Selfbilling-factuur: afzender = adviseur/partner → Batterijconcept.
 * Strak zwart-wit A4 (zelfde stijl adviseur & installatiepartner).
 */
export async function buildRelatieFactuurPdf(
  input: RelatieFactuurInput
): Promise<Blob> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const co = companyInfo();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  const rightX = pageW - margin;
  const termijn =
    input.betaaltermijnDagen ?? RELATIE_FACTUUR_BETAALTERMIJN_DAGEN;
  const verval = relatieFactuurVervaldatum(
    input.factuur.factuurdatum,
    termijn
  );
  const issuerName = input.issuer.bedrijfsnaam || input.issuer.naam;
  const isConcept = input.factuur.status === "concept";
  let y = 18;

  // —— Kop: afzender links · factuur rechts ——
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...DARK);
  doc.text(issuerName, margin, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(`Factuur ${input.factuur.factuur_nummer}`, rightX, y, {
    align: "right",
  });
  y += 5;

  if (isConcept) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("CONCEPT", rightX, y, { align: "right" });
  }

  let ly = y + 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...CHARCOAL);
  const fromLines = [
    input.issuer.bedrijfsnaam &&
    input.issuer.naam &&
    input.issuer.naam.trim() !== issuerName.trim()
      ? input.issuer.naam
      : null,
    ...resolveIssuerAdresRegels(input.issuer),
    input.issuer.kvk_nummer ? `KvK ${input.issuer.kvk_nummer}` : null,
    input.issuer.btw_nummer ? `BTW ${input.issuer.btw_nummer}` : null,
    input.issuer.iban ? `IBAN ${input.issuer.iban}` : null,
    input.issuer.email,
  ].filter(Boolean) as string[];
  for (const line of fromLines) {
    doc.text(line, margin, ly);
    ly += 3.8;
  }

  let ry = y + 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...CHARCOAL);
  const meta: [string, string][] = [
    ["Factuurdatum", formatDateShort(input.factuur.factuurdatum)],
    ["Vervaldatum", formatDateShort(verval)],
  ];
  if (input.factuur.week_nummer != null && input.factuur.week_jaar != null) {
    meta.push([
      "Week",
      `${input.factuur.week_nummer}-${input.factuur.week_jaar}`,
    ]);
  }
  if (input.factuur.periode_van && input.factuur.periode_tot) {
    meta.push([
      "Periode",
      `${formatDateShort(input.factuur.periode_van)} – ${formatDateShort(input.factuur.periode_tot)}`,
    ]);
  }
  for (const [label, value] of meta) {
    doc.setTextColor(...MUTED);
    doc.text(label, rightX - 52, ry);
    doc.setTextColor(...CHARCOAL);
    doc.text(value, rightX, ry, { align: "right" });
    ry += 4;
  }

  y = Math.max(ly, ry) + 8;

  // —— Factuur aan ——
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.35);
  doc.line(margin, y, rightX, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text("FACTUUR AAN", margin, y);
  y += 4.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text(co.legal || co.naam, margin, y);
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...CHARCOAL);
  for (const line of [
    [co.adres, co.postcodePlaats].filter(Boolean).join(", "),
    [co.kvk ? `KvK ${co.kvk}` : null, co.btw ? `BTW ${co.btw}` : null]
      .filter(Boolean)
      .join(" · "),
    co.factuurEmail || co.email,
  ].filter(Boolean) as string[]) {
    doc.text(line, margin, y);
    y += 3.8;
  }

  y += 8;

  // —— Tabel ——
  const colOms = margin + 1.5;
  const colBtw = pageW - margin - 46;
  const colBedrag = pageW - margin - 1.5;
  const omsMaxW = colBtw - colOms - 6;

  const drawHeader = (top: number) => {
    doc.setFillColor(...HEADER);
    doc.rect(margin, top, contentW, 7.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text("OMSCHRIJVING", colOms, top + 5);
    doc.text("BTW", colBtw, top + 5, { align: "right" });
    doc.text("BEDRAG EXCL.", colBedrag, top + 5, { align: "right" });
    return top + 7.5;
  };

  y = drawHeader(y);

  const regels =
    input.regels.length > 0
      ? input.regels
      : [
          {
            omschrijving: "Diensten",
            bedrag: input.factuur.bedrag_ex_btw,
          },
        ];

  for (let i = 0; i < regels.length; i++) {
    const r = regels[i]!;
    const title = cleanRegelOmschrijving(r);
    const sub = regelSubtitle(r);
    const titleLines = doc.splitTextToSize(title, omsMaxW) as string[];
    const subLines = sub
      ? (doc.splitTextToSize(sub, omsMaxW) as string[])
      : [];
    const pad = 3.2;
    const blockH =
      pad * 2 +
      titleLines.length * 4.2 +
      (subLines.length ? subLines.length * 3.3 + 0.6 : 0);

    if (y + blockH > pageH - 52) {
      doc.addPage();
      y = 18;
      y = drawHeader(y);
    }

    if (i % 2 === 1) {
      doc.setFillColor(...WASH);
      doc.rect(margin, y, contentW, blockH, "F");
    }

    let ty = y + pad + 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    for (const line of titleLines) {
      doc.text(line, colOms, ty);
      ty += 4.2;
    }
    if (subLines.length) {
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      ty += 0.3;
      for (const line of subLines) {
        doc.text(line, colOms, ty);
        ty += 3.3;
      }
    }

    const amountY = y + pad + 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`${Math.round(RELATIE_BTW_PCT * 100)}%`, colBtw, amountY, {
      align: "right",
    });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...DARK);
    doc.text(formatEuroPdf(r.bedrag), colBedrag, amountY, { align: "right" });

    y += blockH;
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.line(margin, y, rightX, y);
  }

  y += 8;

  // —— Totalen ——
  const amounts = normalizeRelatieFactuurBedragen(input.factuur);
  const totalsX = pageW - margin - 64;
  if (y + 30 > pageH - 36) {
    doc.addPage();
    y = 18;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...CHARCOAL);
  doc.text("Subtotaal excl. btw", totalsX, y);
  doc.text(formatEuroPdf(amounts.bedrag_ex_btw), rightX, y, {
    align: "right",
  });
  y += 5;
  doc.text(`BTW ${Math.round(RELATIE_BTW_PCT * 100)}%`, totalsX, y);
  doc.text(formatEuroPdf(amounts.btw_bedrag), rightX, y, { align: "right" });
  y += 3;
  doc.setDrawColor(...DARK);
  doc.setLineWidth(0.5);
  doc.line(totalsX, y, rightX, y);
  y += 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...DARK);
  doc.text("Totaal", totalsX, y);
  doc.text(formatEuroPdf(amounts.bedrag_inc_btw), rightX, y, {
    align: "right",
  });
  y += 12;

  // —— Betaling ——
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text(
    `Betaaltermijn ${termijn} dagen · uiterlijk ${formatDateShort(verval)}`,
    margin,
    y
  );
  y += 4;
  if (input.issuer.iban) {
    doc.setTextColor(...DARK);
    doc.text(`Gelieve te voldoen op IBAN ${input.issuer.iban}`, margin, y);
    y += 4;
  }

  const notes = cleanRelatieFactuurNotities(input.factuur.notities);
  if (notes) {
    y += 6;
    if (y + 16 > pageH - 14) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("Notities", margin, y);
    y += 3.8;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CHARCOAL);
    const noteLines = doc.splitTextToSize(notes, contentW) as string[];
    for (const line of noteLines.slice(0, 6)) {
      if (y > pageH - 14) break;
      doc.text(line, margin, y);
      y += 3.5;
    }
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text(
    `Selfbilling · ${issuerName} → ${co.naam}`,
    margin,
    pageH - 10
  );

  return doc.output("blob");
}
