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
    preheader: `Afspraak met ${opts.adviseurNaam} op ${when}`,
    bodyHtml: [
      emailH1("Afspraak bevestigd"),
      emailP(`Hoi ${first},`),
      emailP(
        `Je adviesafspraak met <strong>${opts.adviseurNaam}</strong> is ingepland. Hier zijn de details:`
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Datum &amp; tijd</strong><br />${when} <span style="color:#5A635C;">(Europe/Amsterdam)</span></p>
         <p style="margin:0;font-size:15px;"><strong>Je afspraak is met</strong><br />${opts.adviseurNaam}</p>`
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
    preheader: `Morgen met ${opts.adviseurNaam}: ${when}`,
    bodyHtml: [
      emailH1("Herinnering: je afspraak is morgen"),
      emailP(`Hoi ${first},`),
      emailP(
        `Morgen staat jouw vrijblijvende adviesafspraak met <strong>${opts.adviseurNaam}</strong> gepland:`
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Datum &amp; tijd</strong><br />${when} <span style="color:#5A635C;">(Europe/Amsterdam)</span></p>
         <p style="margin:0;font-size:15px;"><strong>Je afspraak is met</strong><br />${opts.adviseurNaam}</p>`
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
      emailBox(
        `<p style="margin:0;font-size:15px;"><strong>Offerte</strong><br />${opts.offerteNummer}</p>`
      ),
      emailP(
        "In de bijlage vind je de offerte als PDF. Via de knop hieronder open je ook de offerte-portal om digitaal te ondertekenen."
      ),
      emailButton("Bekijk &amp; onderteken offerte", opts.signUrl),
      emailMuted(
        "Vragen over de offerte? We helpen je graag — info@batterijconcept.nl of 085 800 1645."
      ),
    ].join(""),
  });
}

export function teamWelkomEmail(opts: {
  naam: string;
  email: string;
  password: string;
  loginUrl: string;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: `Welkom bij het team, ${opts.naam}`,
    preheader: "Je Batterijconcept CRM-account is klaar.",
    bodyHtml: [
      emailH1(`Welkom bij het team, ${opts.naam}`),
      emailP(`Hoi ${first},`),
      emailP(
        "Je bent toegevoegd aan het Batterijconcept-team. Met onderstaande gegevens kun je inloggen in de CRM."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>E-mail</strong><br />${opts.email}</p>
         <p style="margin:0;font-size:15px;"><strong>Wachtwoord</strong><br /><span style="font-family:ui-monospace,monospace;letter-spacing:0.04em;">${opts.password}</span></p>`
      ),
      emailP(
        "Bewaar dit wachtwoord op een veilige plek. Je kunt later vragen om een nieuw wachtwoord via Instellingen."
      ),
      emailButton("Naar de CRM inloggen", opts.loginUrl),
      emailMuted(
        "Dit is een interne mail van Batterijconcept. Niet doorsturen naar klanten."
      ),
    ].join(""),
  });
}

export function offerteOndertekendEmail(opts: {
  naam: string;
  offerteNummer: string;
  ondertekendOp?: string | Date;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const when = opts.ondertekendOp
    ? formatDateTimeLongNl(opts.ondertekendOp)
    : null;
  return emailLayout({
    title: `Ondertekende offerte ${opts.offerteNummer}`,
    preheader: `Bedankt voor je vertrouwen — offerte ${opts.offerteNummer} is ondertekend.`,
    bodyHtml: [
      emailH1(`Ondertekende offerte ${opts.offerteNummer}`),
      emailP(`Hoi ${first},`),
      emailP(
        "Bedankt voor je vertrouwen in Batterijconcept. We hebben je ondertekende offerte ontvangen en gaan er direct mee aan de slag."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Offerte</strong><br />${opts.offerteNummer}</p>
         ${when ? `<p style="margin:0;font-size:15px;"><strong>Ondertekend op</strong><br />${when}</p>` : ""}`
      ),
      emailP(
        "In de bijlage vind je de ondertekende offerte inclusief handtekening (PDF). Bewaar deze goed voor je administratie."
      ),
      emailP(
        "Heb je vragen over de planning of de installatie? We helpen je graag — mail ons op info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Tot snel, team Batterijconcept"),
    ].join(""),
  });
}

/** Interne mail naar adviseur bij annulering door klant */
export function afspraakGeannuleerdAdviseurEmail(opts: {
  adviseurNaam: string;
  klantNaam: string;
  leadNumber?: string | null;
  startAt: string | Date;
}) {
  const first = opts.adviseurNaam.split(" ")[0] || opts.adviseurNaam;
  const when = formatDateTimeLongNl(opts.startAt);
  return emailLayout({
    title: "Annulering afspraak",
    preheader: `${opts.klantNaam} heeft de afspraak op ${when} geannuleerd.`,
    bodyHtml: [
      emailH1("Annulering afspraak"),
      emailP(`Hoi ${first},`),
      emailP(
        "Een klant heeft zojuist een adviesafspraak geannuleerd. De afspraak blijft in de agenda staan met status <strong>Geannuleerd</strong>."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Klant</strong><br />${opts.klantNaam}${opts.leadNumber ? ` <span style="color:#5A635C;">(${opts.leadNumber})</span>` : ""}</p>
         <p style="margin:0;font-size:15px;"><strong>Geplande tijd</strong><br />${when} <span style="color:#5A635C;">(Europe/Amsterdam)</span></p>`
      ),
      emailMuted("Dit is een interne melding van het Batterijconcept CRM."),
    ].join(""),
  });
}
