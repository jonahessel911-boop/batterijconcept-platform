import {
  emailBox,
  emailButton,
  emailH1,
  emailLayout,
  emailMuted,
  emailP,
} from "./layout";
import { formatDateTimeLongNl } from "@/lib/format";

export function leadThankYouEmail(opts: { naam: string }) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: "Bedankt voor je aanvraag!",
    preheader: "We nemen binnen 24 uur contact met je op.",
    bodyHtml: [
      emailH1("Bedankt voor je aanvraag!"),
      emailP(`Hoi ${first},`),
      emailP(
        "Super dat je interesse hebt in een thuisbatterij. We hebben je aanvraag ontvangen en gaan er direct mee aan de slag."
      ),
      emailP(
        "<strong>Wat we voor je doen:</strong> we kijken naar jouw situatie (verbruik, zonnepanelen, meterkast) en adviseren eerlijk welk systeem het beste past — zonder upsell om de upsell."
      ),
      emailP(
        "Binnen <strong>24 uur</strong> nemen we contact met je op om vrijblijvend een afspraak in te plannen voor het beste advies aan huis."
      ),
      emailMuted(
        "Heb je tussentijds vragen? Mail ons op info@batterijconcept.nl of bel 085 800 1645."
      ),
    ].join(""),
  });
}

export function afspraakBevestigingEmail(opts: {
  naam: string;
  startAt: string | Date;
  adviseurNaam: string;
  manageUrl: string;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const when = formatDateTimeLongNl(opts.startAt);
  return emailLayout({
    title: "Afspraak bevestigd",
    preheader: `Je afspraak staat gepland op ${when}`,
    bodyHtml: [
      emailH1("Afspraak bevestigd"),
      emailP(`Hoi ${first},`),
      emailP("Je adviesafspraak is ingepland. Hier zijn de details:"),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Datum &amp; tijd</strong><br />${when} <span style="color:#5A635C;">(Europe/Amsterdam)</span></p>
         <p style="margin:0;font-size:15px;"><strong>Adviseur</strong><br />${opts.adviseurNaam}</p>`
      ),
      emailP(
        "We kijken ernaar uit om samen te kijken welk batterijsysteem het beste bij jouw woning past."
      ),
      emailMuted("Liever afspraak verzetten of annuleren?"),
      emailButton("Afspraak beheren", opts.manageUrl),
    ].join(""),
  });
}

export function afspraakHerinneringEmail(opts: {
  naam: string;
  startAt: string | Date;
  adviseurNaam: string;
  manageUrl: string;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const when = formatDateTimeLongNl(opts.startAt);
  return emailLayout({
    title: "Herinnering: jouw adviesafspraak morgen",
    preheader: `Morgen: ${when}`,
    bodyHtml: [
      emailH1("Herinnering: je afspraak is morgen"),
      emailP(`Hoi ${first},`),
      emailP("Morgen staat jouw vrijblijvende adviesafspraak gepland:"),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Datum &amp; tijd</strong><br />${when} <span style="color:#5A635C;">(Europe/Amsterdam)</span></p>
         <p style="margin:0;font-size:15px;"><strong>Adviseur</strong><br />${opts.adviseurNaam}</p>`
      ),
      emailP("Tot morgen — we helpen je graag aan de juiste batterijkeuze."),
      emailMuted("Liever afspraak verzetten of annuleren?"),
      emailButton("Afspraak beheren", opts.manageUrl),
    ].join(""),
  });
}

export function offerteVerstuurdEmail(opts: {
  naam: string;
  offerteNummer: string;
  signUrl: string;
  totaalLabel?: string;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: `Offerte ${opts.offerteNummer} voor ${opts.naam}`,
    preheader: "Bekijk en onderteken je offerte online.",
    bodyHtml: [
      emailH1(`Offerte ${opts.offerteNummer} voor ${opts.naam}`),
      emailP(`Hoi ${first},`),
      emailP(
        "Bedankt voor je interesse in Batterijconcept. We hebben een offerte voor je klaargezet, afgestemd op jouw situatie."
      ),
      opts.totaalLabel
        ? emailBox(
            `<p style="margin:0;font-size:15px;"><strong>Offerte</strong> ${opts.offerteNummer}<br /><strong>Totaal</strong> ${opts.totaalLabel}</p>`
          )
        : "",
      emailP(
        "Via de knop hieronder open je de offerte-portal. Daar kun je onze waarden bekijken, de producten inzien en digitaal ondertekenen."
      ),
      emailButton("Bekijk &amp; onderteken offerte", opts.signUrl),
      emailMuted(
        "Vragen over de offerte? We helpen je graag — info@batterijconcept.nl of 085 800 1645."
      ),
    ].join(""),
  });
}
