import { jsPDF } from "jspdf";
import {
  PDF_COLORS,
  companyInfo,
  loadLogoDataUrl,
} from "@/lib/pdf-brand";
import {
  SCHOUW_AKKOORD_TEKST,
  type SchouwFormulierData,
} from "@/lib/schouw-formulier";

function embedSignature(
  doc: jsPDF,
  dataUrl: string,
  x: number,
  y: number,
  w: number,
  h: number
) {
  if (!dataUrl.startsWith("data:image")) return;
  const jpeg = /image\/jpe?g/i.test(dataUrl);
  const formats = jpeg
    ? (["JPEG", "PNG"] as const)
    : (["PNG", "JPEG"] as const);
  const alias = `schouw-sig-${Math.random().toString(36).slice(2, 8)}`;
  for (const format of formats) {
    try {
      doc.addImage(dataUrl, format, x, y, w, h, alias, "FAST");
      return;
    } catch {
      /* try next */
    }
    try {
      const b64 = dataUrl.split(",")[1];
      if (b64) {
        doc.addImage(b64, format, x, y, w, h, alias, "FAST");
        return;
      }
    } catch {
      /* try next */
    }
  }
}

const { green: GREEN, dark: DARK, orange: ORANGE, charcoal: CHARCOAL, muted: MUTED, line: LINE, wash: WASH, grayRow: GRAY } =
  PDF_COLORS;

function dash(v: string | undefined | null): string {
  const t = (v || "").trim();
  return t || "—";
}

function jaNee(v: string): string {
  if (v === "ja") return "Ja";
  if (v === "nee") return "Nee";
  return "—";
}

function formatDatumNl(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return dash(ymd);
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Schouwformulier-PDF in BatterijConcept-branding (2 pagina's).
 */
export async function buildSchouwFormulierPdf(
  data: SchouwFormulierData
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

  function drawHeader(pageTitle: string) {
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
      co.btw ? `BTW ${co.btw}` : null,
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
    y += 7;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...DARK);
    doc.text(pageTitle, margin, y);
    return y + 6;
  }

  function drawFooter(pageNum: number, total: number) {
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
    doc.text(`${pageNum}/${total}`, pageW - margin, pageH - 7, {
      align: "right",
    });
  }

  function sectionTitle(label: string, y: number): number {
    doc.setFillColor(...WASH);
    doc.rect(margin, y - 4, contentW, 7, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...DARK);
    doc.text(label.toUpperCase(), margin + 2, y);
    return y + 6;
  }

  /** Twee-koloms rij: label+waarde | label+waarde */
  function fieldRow(
    y: number,
    left: { label: string; value: string },
    right?: { label: string; value: string },
    opts?: { zebra?: boolean; tall?: boolean }
  ): number {
    const rowH = opts?.tall ? 11 : 8;
    if (opts?.zebra) {
      doc.setFillColor(...GRAY);
      doc.rect(margin, y - 3.5, contentW, rowH, "F");
    }
    const colW = (contentW - 4) / 2;
    drawField(margin + 1, y, colW - 2, left.label, left.value, opts?.tall);
    if (right) {
      drawField(
        margin + colW + 4,
        y,
        colW - 2,
        right.label,
        right.value,
        opts?.tall
      );
    }
    return y + rowH;
  }

  function drawField(
    x: number,
    y: number,
    w: number,
    label: string,
    value: string,
    tall?: boolean
  ) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(label, x, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...CHARCOAL);
    const lines = doc.splitTextToSize(dash(value), w);
    const maxLines = tall ? 2 : 1;
    doc.text(lines.slice(0, maxLines), x, y + 3.5);
  }

  function fullWidthField(
    y: number,
    label: string,
    value: string,
    height = 14
  ): number {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text(label, margin + 1, y);
    doc.setDrawColor(...LINE);
    doc.setFillColor(255, 255, 255);
    doc.rect(margin, y + 1.5, contentW, height - 3, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...CHARCOAL);
    const lines = doc.splitTextToSize(dash(value), contentW - 4);
    doc.text(lines.slice(0, Math.floor((height - 4) / 3.5)), margin + 2, y + 5);
    return y + height;
  }

  // ——— Pagina 1 ———
  let y = drawHeader("INSTALLATIE-SCHOUW THUISBATTERIJ");

  y = fieldRow(
    y,
    { label: "Klant", value: data.klantNaam },
    { label: "Datum", value: formatDatumNl(data.datum) },
    { zebra: true }
  );
  y = fieldRow(
    y,
    { label: "Adres", value: data.adres },
    { label: "Rapportnr.", value: data.rapportNr }
  );
  y = fieldRow(
    y,
    { label: "Telefoon", value: data.telefoon },
    { label: "Opnemer", value: data.opnemer },
    { zebra: true }
  );
  y = fieldRow(
    y,
    { label: "E-mail", value: data.email },
    { label: "Klusnr.", value: data.klusNr }
  );

  y += 3;
  y = sectionTitle("1. Installatie-object (AlphaESS)", y);
  y = fieldRow(
    y,
    { label: "Model / omvormer", value: data.modelOmvormer },
    { label: "Totale capaciteit", value: data.capaciteitKwh ? `${data.capaciteitKwh} kWh` : "" },
    { zebra: true }
  );
  y = fieldRow(
    y,
    {
      label: "Aantal batterijmodules",
      value: data.aantalModules ? `${data.aantalModules} st` : "",
    },
    { label: "", value: "" }
  );
  y = fullWidthField(y, "Serienummers (omvormer + modules)", data.serienummers, 16);

  y += 2;
  y = sectionTitle("2. Meterkast & aansluiting", y);
  y = fieldRow(
    y,
    { label: "Type aansluiting", value: data.typeAansluiting },
    { label: "Hoofdzekering", value: data.hoofdzekering },
    { zebra: true }
  );
  y = fieldRow(
    y,
    {
      label: "Vrije groepen in kast",
      value: data.vrijeGroepen !== "" ? `${data.vrijeGroepen} st` : "",
    },
    { label: "Ruimte extra groep + aardlek", value: data.ruimteExtraGroep }
  );
  y = fieldRow(
    y,
    { label: "Aardlek te plaatsen", value: data.aardlekTePlaatsen },
    { label: "Deugdelijke aarding aanwezig", value: jaNee(data.deugdelijkeAarding) },
    { zebra: true }
  );
  y = fieldRow(
    y,
    {
      label: "CT-klem plaatsbaar om hoofdaansluiting",
      value: jaNee(data.ctKlemPlaatsbaar),
    },
    { label: "Foto meterkast gemaakt", value: jaNee(data.fotoMeterkast) }
  );

  y += 2;
  y = sectionTitle("3. Opstelling batterij & omvormer", y);
  y = fieldRow(
    y,
    { label: "Plek batterij + omvormer", value: data.plekBatterij },
    { label: "Binnen of buiten", value: data.binnenBuiten },
    { zebra: true }
  );
  y = fieldRow(
    y,
    { label: "Montagewijze", value: data.montagewijze },
    { label: "Wandtype (montagewand)", value: data.wandtype }
  );
  y = fieldRow(
    y,
    { label: "Beschikbare ruimte (bxhxd)", value: data.beschikbareRuimte },
    { label: "Locatie vorstvrij", value: jaNee(data.vorstvrij) },
    { zebra: true }
  );
  y = fieldRow(
    y,
    { label: "Voldoende ventilatie", value: jaNee(data.ventilatie) },
    {
      label: "Brandveilige vrije afstand",
      value: jaNee(data.brandveiligeAfstand),
    }
  );

  drawFooter(1, 2);

  // ——— Pagina 2 ———
  doc.addPage();
  y = drawHeader("Schouwlijst thuisbatterij — BatterijConcept");

  y = sectionTitle("4. Kabeltracé & boren", y);
  y = fieldRow(
    y,
    {
      label: "Afstand batterij ↔ meterkast",
      value: data.afstandMeterkastM ? `${data.afstandMeterkastM} m` : "",
    },
    { label: "Kabelroute", value: data.kabelroute },
    { zebra: true }
  );
  y = fullWidthField(
    y,
    "Door welke muren/vloeren boren",
    data.doorMurenVloeren,
    12
  );
  y = fieldRow(
    y,
    { label: "Materiaal om te boren", value: data.boormateriaal },
    {
      label: "Aantal doorvoeren",
      value: data.aantalDoorvoeren ? `${data.aantalDoorvoeren} st` : "",
    },
    { zebra: true }
  );
  y = fieldRow(
    y,
    { label: "Benodigde boordiameter", value: data.boordiameter },
    { label: "Kabelgoot/buis nodig", value: data.kabelgootNodig }
  );
  y = fieldRow(
    y,
    {
      label: "Lengte kabelgoot/buis",
      value: data.kabelgootLengteM ? `${data.kabelgootLengteM} m` : "",
    },
    { label: "Kabeldoorsnede", value: data.kabeldoorsnede },
    { zebra: true }
  );
  y = fieldRow(
    y,
    { label: "Hak-/graafwerk nodig", value: data.hakGraafwerk },
    { label: "Wifi-bereik op locatie", value: data.wifiBereik }
  );

  y += 2;
  y = sectionTitle("5. Praktisch & mee te nemen", y);
  y = fieldRow(
    y,
    { label: "Ladder/steiger nodig", value: data.ladderNodig },
    { label: "Aanvoer / parkeren bij locatie", value: data.aanvoerParkeren },
    { zebra: true }
  );
  y = fieldRow(
    y,
    {
      label: "Geschatte installatietijd",
      value: data.installatietijdDagdelen
        ? `${data.installatietijdDagdelen} dagdelen`
        : "",
    },
    { label: "", value: "" }
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...MUTED);
  doc.text("Mee te nemen materiaal", margin + 1, y);
  y += 3;
  const items = data.meeTeNemen || [];
  const allOpts = [
    "Kernboor",
    "Installatiebuis",
    "Kabelgoot",
    "Aardlek type A",
    "Aardlek type B",
    "Montagebeugel",
    "CT-klem/meettrafo",
    "Extra kabel 6mm²",
    "Extra kabel 10mm²",
    "UTP/repeater",
  ];
  const colCount = 2;
  const itemW = contentW / colCount;
  let ix = 0;
  for (const opt of allOpts) {
    const col = ix % colCount;
    const row = Math.floor(ix / colCount);
    const checked = items.includes(opt);
    const cx = margin + col * itemW;
    const cy = y + row * 5;
    doc.setDrawColor(...LINE);
    doc.setFillColor(checked ? GREEN[0] : 255, checked ? GREEN[1] : 255, checked ? GREEN[2] : 255);
    doc.rect(cx, cy - 2.2, 3.2, 3.2, checked ? "F" : "S");
    if (checked) {
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.text("✓", cx + 0.6, cy + 0.4);
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...CHARCOAL);
    doc.text(opt, cx + 5, cy);
    ix++;
  }
  y += Math.ceil(allOpts.length / colCount) * 5 + 3;

  y = fullWidthField(
    y,
    "Verwacht meerwerk / obstakels",
    data.meerwerkObstakels,
    16
  );

  y += 1;
  y = sectionTitle("Aanvullende opmerkingen & afspraken", y);
  y = fullWidthField(y, "", data.aanvullendeOpmerkingen, 22);

  y += 4;
  // Akkoord monteur
  const akkoordBox = 4.2;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.35);
  doc.rect(margin, y - 3.2, akkoordBox, akkoordBox);
  if (data.akkoordInstallatie) {
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.7);
    doc.line(margin + 0.8, y - 1.1, margin + 1.7, y + 0.4);
    doc.line(margin + 1.7, y + 0.4, margin + 3.4, y - 2.6);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...DARK);
  const akkoordLines = doc.splitTextToSize(
    SCHOUW_AKKOORD_TEKST,
    contentW - 10
  );
  doc.text(akkoordLines, margin + 7, y);
  y += Math.max(8, akkoordLines.length * 4.5 + 3);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...DARK);
  doc.text("HANDTEKENING MONTEUR / OPNEMER", margin, y);
  y += 3;

  const sigH = 26;
  const sigW = Math.min(95, contentW);
  doc.setDrawColor(...LINE);
  doc.setFillColor(255, 255, 255);
  doc.setLineWidth(0.3);
  doc.rect(margin, y, sigW, sigH, "FD");
  if (data.handtekeningDataUrl) {
    embedSignature(
      doc,
      data.handtekeningDataUrl,
      margin + 2,
      y + 1,
      sigW - 4,
      sigH - 4
    );
  }
  y += sigH + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...CHARCOAL);
  doc.text(
    `${dash(data.handtekeningOpnemerNaam || data.opnemer)} · ${formatDatumNl(data.datum)}`,
    margin,
    y
  );

  drawFooter(2, 2);

  return doc.output("blob");
}
