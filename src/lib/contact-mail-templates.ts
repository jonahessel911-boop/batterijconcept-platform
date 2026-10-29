import { formatEuro } from "@/lib/format";
import {
  AV_ANNULERING_ARTIKEL,
  AV_ANNULERING_PCT,
  annuleringskostenIncBtw,
} from "@/lib/av-annulering";

export type ContactMailTemplateId = "annulering_of_installatie";

export const CONTACT_MAIL_TEMPLATES: {
  id: ContactMailTemplateId;
  label: string;
}[] = [
  {
    id: "annulering_of_installatie",
    label: "Annulering of installatie",
  },
];

export function contactMailAnnuleringOfInstallatie(opts: {
  orderTotaalIncBtw?: number | null;
  projectNummer?: string | null;
  offerteNummer?: string | null;
  /** Einddatum bedenktijd, bv. "14 oktober 2026". */
  bedenktijdEindLabel?: string | null;
  /** Startdatum bedenktijd (= ondertekening), optioneel. */
  bedenktijdStartLabel?: string | null;
}): { subject: string; bericht: string; kostenIncBtw: number | null } {
  const order = Number(opts.orderTotaalIncBtw);
  const hasOrder = Number.isFinite(order) && order > 0;
  const kosten = hasOrder ? annuleringskostenIncBtw(order) : null;
  const pct = Math.round(AV_ANNULERING_PCT * 100);
  const kostenLabel = kosten != null ? formatEuro(kosten) : "€ …";
  const orderLabel = hasOrder ? formatEuro(order) : null;
  const projectNr = opts.projectNummer?.trim() || null;
  const offNr = opts.offerteNummer?.trim() || null;
  const eindLabel = opts.bedenktijdEindLabel?.trim() || null;
  const startLabel = opts.bedenktijdStartLabel?.trim() || null;

  const subject = projectNr
    ? `Keuze: annulering of installatie — ${projectNr}`
    : "Keuze: annulering of installatie";

  const refs = [projectNr ? `project ${projectNr}` : null, offNr ? `offerte ${offNr}` : null]
    .filter(Boolean)
    .join(" / ");

  const bedenktijdZin = eindLabel
    ? `Je wettelijke herroepingsrecht (bedenktijd van 14 dagen${
        startLabel ? `, gestart op ${startLabel}` : ""
      }) is verlopen op ${eindLabel}. Daarom vragen we je nu te kiezen tussen één van de volgende opties:`
    : "Je wettelijke herroepingsrecht (bedenktijd van 14 dagen) is voorbij. Daarom vragen we je nu te kiezen tussen één van de volgende opties:";

  const bericht = [
    refs
      ? `We nemen contact met je op over ${refs}.`
      : "We nemen contact met je op over je bestelling.",
    bedenktijdZin,
    `1. Installatie doorzetten — je werkt mee in het verdere proces (documenten, planning en eventuele financiering), zodat we de installatie kunnen uitvoeren.`,
    `2. Annuleren — dan ben je op grond van artikel ${AV_ANNULERING_ARTIKEL} van onze algemene voorwaarden ${pct}% annuleringskosten verschuldigd${
      orderLabel
        ? ` van het orderbedrag (${orderLabel} incl. btw). Dat is ${kostenLabel} inclusief btw.`
        : `. Het exacte bedrag volgt op de factuur.`
    }`,
    `Reageer binnen 5 dagen op deze mail met je keuze. Zonder reactie gaan wij ervan uit dat je annuleert. Op dag 6 ontvang je dan de annuleringsfactuur van ${kostenLabel}.`,
  ].join("\n\n");

  return { subject, bericht, kostenIncBtw: kosten };
}
