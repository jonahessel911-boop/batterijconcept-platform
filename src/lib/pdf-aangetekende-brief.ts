import { jsPDF } from "jspdf";
import { addDays, endOfISOWeek } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { nl } from "date-fns/locale";
import { companyInfo, loadLogoDataUrl, formatEuroPdf } from "@/lib/pdf-brand";
import { AMSTERDAM_TZ, formatDateNl, formatDateShort } from "@/lib/format";
import {
  formatSchouwWeekLabel,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";

export const AV_ANNULERING_ARTIKEL =
  process.env.AV_ANNULERING_ARTIKEL?.trim() || "8";

export const ANNULERING_PCT = 0.5;

export type AangetekendeBriefInput = {
  klantNaam: string;
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
  offerteNummer: string;
  ondertekendOp: string | Date;
  productOmschrijving: string;
  totaalIncBtw: number;
  schouwJaar?: number | null;
  schouwWeek?: number | null;
  briefDatum?: Date;
  reactieUiterlijk?: Date;
};

function splitNaam(naam: string): {
  achternaam: string;
  initiaal: string;
} {
  const parts = naam.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { achternaam: "klant", initiaal: "K" };
  }
  if (parts.length === 1) {
    return {
      achternaam: parts[0],
      initiaal: parts[0].charAt(0).toUpperCase(),
    };
  }
  return {
    achternaam: parts.slice(1).join(" "),
    initiaal: parts[0].charAt(0).toUpperCase(),
  };
}

function adresRegels(opts: AangetekendeBriefInput): string[] {
  const nr = [opts.huisnummer, opts.toevoeging].filter(Boolean).join("");
  const line1 = [opts.straat, nr].filter(Boolean).join(" ");
  const line2 = [opts.postcode, opts.plaats].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean);
}

function schouwZin(jaar?: number | null, week?: number | null): string | null {
  if (!jaar || !week) return null;
  try {
    const mondayIso = schouwWeekToMondayIso(jaar, week);
    const monday = toZonedTime(new Date(mondayIso), AMSTERDAM_TZ);
    const sunday = endOfISOWeek(monday);
    const van = formatInTimeZone(monday, AMSTERDAM_TZ, "d", { locale: nl });
    const tot = formatInTimeZone(sunday, AMSTERDAM_TZ, "d MMMM yyyy", {
      locale: nl,
    });
    return `De schouw staat gepland in week ${week} (${van} tot en met ${tot}).`;
  } catch {
    return `De schouw staat gepland in ${formatSchouwWeekLabel(jaar, week)}.`;
  }
}

function wrapParagraph(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number
): number {
  const lines = doc.splitTextToSize(text, maxW) as string[];
  doc.text(lines, x, y);
  return y + lines.length * lineH;
}

/**
 * Formele aangetekende brief: medewerking Warmtefonds of annuleringskosten 50%.
 */
export async function buildAangetekendeBriefPdf(
  input: AangetekendeBriefInput
): Promise<Blob> {
  const co = companyInfo();
  const briefDatum = input.briefDatum || new Date();
  const reactie = input.reactieUiterlijk || addDays(briefDatum, 7);
  const { achternaam, initiaal } = splitNaam(input.klantNaam);
  const annuleringsBedrag =
    Math.round(input.totaalIncBtw * ANNULERING_PCT * 100) / 100;
  const totaalLabel = formatEuroPdf(input.totaalIncBtw).replace(" €", "");
  const annuleringLabel = formatEuroPdf(annuleringsBedrag).replace(" €", "");

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 22;
  const maxW = pageW - margin * 2;
  let y = 18;

  const logo = loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, y, 16, 16);
    } catch {
      /* skip */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(13, 92, 50);
  doc.text(co.naam, margin + (logo ? 20 : 0), y + 6);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(90, 99, 92);
  let cy = y + 11;
  for (const line of [
    co.adres,
    co.postcodePlaats,
    co.kvk ? `KvK-nummer: ${co.kvk}` : null,
  ].filter(Boolean) as string[]) {
    doc.text(line, margin + (logo ? 20 : 0), cy);
    cy += 4;
  }

  y = Math.max(cy, y + 22) + 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(196, 90, 18);
  doc.text("AANGETEKEND", margin, y);
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(26, 31, 28);
  doc.text(`${initiaal}. ${achternaam}`, margin, y);
  y += 5;
  for (const line of adresRegels(input)) {
    doc.text(line, margin, y);
    y += 5;
  }
  y += 8;

  doc.text(`Utrecht, ${formatDateNl(briefDatum)}`, margin, y);
  y += 10;

  doc.setFont("helvetica", "bold");
  y = wrapParagraph(
    doc,
    `Betreft: offerte ${input.offerteNummer} – medewerking aanvraag Warmtefonds of annulering`,
    margin,
    y,
    maxW,
    5
  );
  y += 3;
  doc.setFont("helvetica", "normal");
  doc.text(`Klantnaam: ${input.klantNaam}`, margin, y);
  y += 10;

  doc.text(`Geachte heer/mevrouw ${achternaam},`, margin, y);
  y += 8;

  const schouw = schouwZin(input.schouwJaar, input.schouwWeek);
  const p1 = [
    `Op ${formatDateShort(input.ondertekendOp)} heeft u akkoord gegeven op onze offerte met kenmerk ${input.offerteNummer} voor de levering en installatie van een thuisbatterij (${input.productOmschrijving}).`,
    "De offerte omvat ook de installatie, de installatieopname, de btw-subsidieaanvraag en de aanvraagservice voor het Warmtefonds.",
    `Het totaalbedrag van deze overeenkomst is € ${totaalLabel} inclusief btw.`,
    schouw,
  ]
    .filter(Boolean)
    .join(" ");
  y = wrapParagraph(doc, p1, margin, y, maxW, 5);
  y += 5;

  y = wrapParagraph(
    doc,
    "De financiering via het Warmtefonds is onderdeel van deze overeenkomst. Om de aanvraag af te ronden hebben wij uw medewerking nodig. Ondanks eerdere verzoeken hebben wij die tot nu toe niet ontvangen. Daardoor kan de aanvraag niet worden afgerond en kan de installatie niet doorgaan, terwijl de batterij juist bedoeld is om u te laten besparen op uw energiekosten.",
    margin,
    y,
    maxW,
    5
  );
  y += 5;

  y = wrapParagraph(
    doc,
    `Wij verzoeken u daarom vriendelijk maar dringend om uiterlijk ${formatDateNl(reactie)} één van de volgende twee keuzes te maken.`,
    margin,
    y,
    maxW,
    5
  );
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("1. Medewerking aan de aanvraag bij het Warmtefonds", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  y = wrapParagraph(
    doc,
    "U werkt mee aan de aanvraag en dient de door ons aangeleverde documentatie in bij het Warmtefonds. Zodra de aanvraag is ingediend, plannen wij de installatie in. Zo kunt u zo snel mogelijk besparen met uw thuisbatterij.",
    margin,
    y,
    maxW,
    5
  );
  y += 6;

  doc.setFont("helvetica", "bold");
  doc.text("2. Annulering van de overeenkomst", margin, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  y = wrapParagraph(
    doc,
    `Als u niet wilt meewerken, beschouwen wij dit als annulering van de overeenkomst. In dat geval bent u op grond van artikel ${AV_ANNULERING_ARTIKEL} van onze algemene voorwaarden annuleringskosten verschuldigd van 50% van het totaalbedrag. Dat is € ${annuleringLabel} inclusief btw. U ontvangt hiervoor een aparte factuur.`,
    margin,
    y,
    maxW,
    5
  );
  y += 5;

  y = wrapParagraph(
    doc,
    `Als wij uiterlijk ${formatDateNl(reactie)} geen reactie van u hebben ontvangen en de documentatie niet bij het Warmtefonds is ingediend, gaan wij ervan uit dat u de overeenkomst annuleert. Wij brengen dan de annuleringskosten bij u in rekening.`,
    margin,
    y,
    maxW,
    5
  );
  y += 5;

  y = wrapParagraph(
    doc,
    "Wij hopen natuurlijk dat u kiest voor de eerste optie, zodat wij de installatie kunnen uitvoeren zoals afgesproken. Heeft u vragen of hulp nodig bij het indienen van de documenten? Neem dan gerust contact met ons op via 085 - 800 1645 of info@batterijconcept.nl.",
    margin,
    y,
    maxW,
    5
  );
  y += 10;

  doc.text("Met vriendelijke groet,", margin, y);
  y += 12;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(13, 92, 50);
  doc.text(co.naam, margin, y);

  return doc.output("blob");
}
