import {
  emailBox,
  emailButton,
  emailH1,
  emailLayout,
  emailMuted,
  emailP,
} from "./layout";
import { formatDateTimeLongNl } from "@/lib/format";
import {
  afspraakBevestigingSequenceEmail,
  afspraakMailVars,
  afspraakReminder24uEmail,
} from "./afspraak-sequence";

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
        "<strong>Wat we voor je doen:</strong> we kijken naar jouw situatie en maken een passend en logisch advies."
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
  lead?: {
    postcode?: string | null;
    huisnummer?: string | null;
    toevoeging?: string | null;
    straat?: string | null;
    plaats?: string | null;
  } | null;
}) {
  return afspraakBevestigingSequenceEmail(
    afspraakMailVars({
      naam: opts.naam,
      startAt: opts.startAt,
      adviseurNaam: opts.adviseurNaam,
      manageUrl: opts.manageUrl,
      lead: opts.lead,
    })
  );
}

export function afspraakHerinneringEmail(opts: {
  naam: string;
  startAt: string | Date;
  adviseurNaam: string;
  manageUrl: string;
  lead?: {
    postcode?: string | null;
    huisnummer?: string | null;
    toevoeging?: string | null;
    straat?: string | null;
    plaats?: string | null;
  } | null;
}) {
  return afspraakReminder24uEmail(
    afspraakMailVars({
      naam: opts.naam,
      startAt: opts.startAt,
      adviseurNaam: opts.adviseurNaam,
      manageUrl: opts.manageUrl,
      lead: opts.lead,
    })
  );
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
        "Een klant heeft zojuist een adviesafspraak geannuleerd. De afspraak is uit de agenda gehaald."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Klant</strong><br />${opts.klantNaam}${opts.leadNumber ? ` <span style="color:#5A635C;">(${opts.leadNumber})</span>` : ""}</p>
         <p style="margin:0;font-size:15px;"><strong>Geplande tijd</strong><br />${when} <span style="color:#5A635C;">(Europe/Amsterdam)</span></p>`
      ),
      emailMuted("Dit is een interne melding van het Batterijconcept CRM."),
    ].join(""),
  });
}

/** Klant: afspraak geannuleerd/verwijderd door backoffice */
export function afspraakGeannuleerdKlantEmail(opts: {
  naam: string;
  startAt: string | Date;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const when = formatDateTimeLongNl(opts.startAt);
  return emailLayout({
    title: "Afspraak geannuleerd — Batterijconcept",
    preheader: `Je afspraak op ${when} is geannuleerd.`,
    bodyHtml: [
      emailH1("Afspraak geannuleerd"),
      emailP(`Hoi ${first},`),
      emailP(
        "Je adviesafspraak bij Batterijconcept is geannuleerd. Hieronder de oorspronkelijke datum en tijd:"
      ),
      emailBox(
        `<p style="margin:0;font-size:15px;"><strong>Geplande tijd</strong><br />${when}</p>`
      ),
      emailP(
        "Wil je een nieuwe afspraak? Mail ons op info@batterijconcept.nl of bel 085 800 1645 — we helpen je graag."
      ),
      emailMuted("Tot snel, team Batterijconcept"),
    ].join(""),
  });
}

export function factuurVerzondenEmail(opts: {
  naam: string;
  factuurNummer: string;
  bedrag: string;
  vervaldatum?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: `Factuur ${opts.factuurNummer}`,
    preheader: `Je factuur ${opts.factuurNummer} van Batterijconcept.`,
    bodyHtml: [
      emailH1(`Factuur ${opts.factuurNummer}`),
      emailP(`Hoi ${first},`),
      emailP(
        "Hierbij ontvang je je factuur van Batterijconcept. In de bijlage vind je de PDF."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Factuur</strong><br />${opts.factuurNummer}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Bedrag</strong><br />${opts.bedrag}</p>
         ${opts.vervaldatum ? `<p style="margin:0;font-size:15px;"><strong>Vervaldatum</strong><br />${opts.vervaldatum}</p>` : ""}`
      ),
      emailP(
        "Heb je vragen over deze factuur? Mail ons op info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Met vriendelijke groet, team Batterijconcept"),
    ].join(""),
  });
}

/** Klant: schouw is ingepland */
export function schouwKlantEmail(opts: {
  naam: string;
  schouwAt: string | Date;
  adres?: string | null;
  projectNummer?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const when = formatDateTimeLongNl(opts.schouwAt);
  return emailLayout({
    title: "Schouw gepland — Batterijconcept",
    preheader: `Je schouw staat gepland op ${when}.`,
    bodyHtml: [
      emailH1("Schouw gepland"),
      emailP(`Hoi ${first},`),
      emailP(
        "Goed nieuws: de schouw voor je thuisbatterij is ingepland. Onze installatiepartner komt bij je langs om de situatie ter plaatse te bekijken."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Datum &amp; tijd</strong><br />${when}</p>
         ${opts.adres ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Adres</strong><br />${opts.adres}</p>` : ""}
         ${opts.projectNummer ? `<p style="margin:0;font-size:15px;"><strong>Project</strong><br />${opts.projectNummer}</p>` : ""}`
      ),
      emailP(
        "Zorg dat er iemand aanwezig is die toegang heeft tot de meterkast en de beoogde installatieruimte. Heb je vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Tot dan, team Batterijconcept"),
    ].join(""),
  });
}

/** Installatiepartner: nieuwe schouw / order */
export function schouwPartnerEmail(opts: {
  partnerNaam: string;
  klantNaam: string;
  schouwAt: string | Date;
  adres?: string | null;
  telefoon?: string | null;
  email?: string | null;
  projectNummer?: string | null;
  notities?: string | null;
  fotoCount?: number;
  portalUrl: string;
}) {
  const first = opts.partnerNaam.split(" ")[0] || opts.partnerNaam;
  const when = formatDateTimeLongNl(opts.schouwAt);
  const fotoCount = opts.fotoCount ?? 0;
  const fotoLabel =
    fotoCount === 0
      ? "Geen foto's"
      : fotoCount === 1
        ? "1 foto (zie bijlage / portaal)"
        : `${fotoCount} foto's (zie bijlagen / portaal)`;
  return emailLayout({
    title: "Nieuwe schouw ingepland",
    preheader: `Schouw bij ${opts.klantNaam} op ${when}.`,
    bodyHtml: [
      emailH1("Nieuwe schouw ingepland"),
      emailP(`Hoi ${first},`),
      emailP(
        "Er is een nieuwe schouw voor je ingepland. Hieronder vind je de klant- en schouwgegevens, inclusief notities en foto&apos;s van de adviseur. In het installatieportaal zie je de volledige order."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Klant</strong><br />${opts.klantNaam}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Schouw</strong><br />${when}</p>
         ${opts.adres ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Adres</strong><br />${opts.adres}</p>` : ""}
         ${opts.telefoon ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Telefoon</strong><br />${opts.telefoon}</p>` : ""}
         ${opts.email ? `<p style="margin:0 0 8px;font-size:15px;"><strong>E-mail</strong><br />${opts.email}</p>` : ""}
         ${opts.projectNummer ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Order</strong><br />${opts.projectNummer}</p>` : ""}
         ${opts.notities ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Notities</strong><br />${opts.notities.replace(/\n/g, "<br />")}</p>` : ""}
         <p style="margin:0;font-size:15px;"><strong>Foto's</strong><br />${fotoLabel}</p>`
      ),
      emailButton("Ga naar portaal", opts.portalUrl),
      emailMuted("Dit is een mail van Batterijconcept voor installatiepartners."),
    ].join(""),
  });
}
