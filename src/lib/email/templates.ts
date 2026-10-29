import {
  emailBox,
  emailButton,
  emailH1,
  emailLayout,
  emailMuted,
  emailP,
} from "./layout";
import {
  formatDateNl,
  formatDateTimeLongNl,
  formatEuro,
  formatTimeNl,
} from "@/lib/format";
import { planningVensterNl } from "@/lib/planning-window";
import { FRANK_ENERGIE_OVERSTAP_URL } from "@/lib/frank-energie";
import { formatSchouwWeekLabel } from "@/lib/schouw-week";
import {
  RECRUITMENT_GESPREK_CONTACT,
  RECRUITMENT_GESPREK_LOCATIE,
  RECRUITMENT_GESPREK_TEL,
} from "@/lib/sollicitatie";
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

/** Eerste belpoging geen contact — we hebben je geprobeerd te bereiken. */
export function geenContactPoging1Email(opts: { naam: string }) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: "We hebben je geprobeerd te bereiken",
    preheader:
      "Thuisbatterij zonder eigen investering — reageer op deze mail voor een afspraak.",
    bodyHtml: [
      emailH1("We hebben je geprobeerd te bereiken"),
      emailP(`Hoi ${first},`),
      emailP(
        "We hebben je vandaag geprobeerd te bereiken in verband met een <strong>thuisbatterij zonder eigen investering</strong> — en de mogelijkheden die daarbij horen voor jouw situatie."
      ),
      emailP(
        "Met een thuisbatterij kun je meer van je eigen zonnestroom gebruiken, pieken afvlakken en je energiekosten verlagen. Of dit rendabel is — en of je in aanmerking komt zonder eigen investering — rekenen we graag samen met je door."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0D5C32;">Reageer op deze e-mail</p>
         <p style="margin:0;font-size:15px;line-height:1.55;color:#1A1F1C;">
           Antwoord kort onder deze mail (bijv. met een dagdeel dat je bereikbaar bent).
           Dan plannen we een afspraak in, zodat een adviseur berekent of een batterij rendabel is
           en of je in aanmerking komt voor een batterij <strong>zonder eigen investering</strong>.
         </p>`
      ),
      emailP(
        "Liever bellen? Bel ons op <strong>085 800 1645</strong> — we helpen je graag verder."
      ),
      emailMuted(
        "Geen interesse meer? Laat het ons even weten via een reply, dan nemen we je uit onze belplanning."
      ),
    ].join(""),
  });
}

/** Derde belpoging geen contact — nog interesse? */
export function geenContactPoging3Email(opts: { naam: string }) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: "Heeft u nog interesse in een batterij zonder eigen investering?",
    preheader:
      "Laatste check — reageer op deze mail voor een vrijblijvende berekening aan huis.",
    bodyHtml: [
      emailH1(
        "Heeft u nog interesse in een batterij zonder eigen investering?"
      ),
      emailP(`Hoi ${first},`),
      emailP(
        "We hebben je inmiddels een paar keer geprobeerd te bereiken. Misschien kwam het niet uit — daarom deze korte check."
      ),
      emailP(
        "<strong>Heeft u nog interesse in een thuisbatterij zonder eigen investering?</strong> Dan kijken we graag of dit in jouw situatie past en wat het oplevert."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0D5C32;">Reageer op deze e-mail</p>
         <p style="margin:0;font-size:15px;line-height:1.55;color:#1A1F1C;">
           Antwoord onder deze mail als je nog interesse hebt.
           Dan maken we een afspraak, zodat een adviseur berekent of een batterij rendabel is
           en of u in aanmerking komt voor een batterij <strong>zonder eigen investering</strong>.
         </p>`
      ),
      emailP(
        "Of bel direct: <strong>085 800 1645</strong>. Geen interesse meer? Een korte reply is genoeg — dan stoppen we met bellen."
      ),
      emailMuted("BatterijConcept · Vrijblijvend advies · Geen verplichtingen."),
    ].join(""),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Beluitkomst: telefoonnummer klopt niet — reageren voor afspraak. */
export function foutiefNummerEmail(opts: {
  naam: string;
  telefoon?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const tel = (opts.telefoon || "").trim();
  const telHtml = tel
    ? `<strong>${escapeHtml(tel)}</strong>`
    : "het bij ons bekende telefoonnummer";

  return emailLayout({
    title: "Het ingevulde telefoonnummer is onjuist",
    preheader:
      "We konden je niet bereiken op het opgegeven nummer — reageer op deze mail voor een afspraak.",
    bodyHtml: [
      emailH1("Het ingevulde telefoonnummer is onjuist"),
      emailP(`Hoi ${first},`),
      emailP(
        `We hebben geprobeerd je te bereiken, maar ${telHtml} blijkt <strong>onjuist of niet bereikbaar</strong>.`
      ),
      emailP(
        "Daardoor kunnen we je helaas niet telefonisch te woord staan over de mogelijkheden van een thuisbatterij zonder eigen investering."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0D5C32;">Wil je toch een afspraak inplannen?</p>
         <p style="margin:0;font-size:15px;line-height:1.55;color:#1A1F1C;">
           Reageer op deze e-mail met een <strong>juist telefoonnummer</strong> en/of een dagdeel waarop je bereikbaar bent.
           Dan plannen we graag een afspraak in, zodat een adviseur berekent of een batterij rendabel is
           en of je in aanmerking komt voor een batterij <strong>zonder eigen investering</strong>.
         </p>`
      ),
      emailP(
        "Je kunt ook bellen naar <strong>085 800 1645</strong> — we helpen je graag verder."
      ),
      emailMuted(
        "Geen interesse meer? Een korte reply is genoeg, dan nemen we je uit onze planning."
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

/** Bevestiging sollicitatiegesprek naar kandidaat. */
export function sollicitatieGesprekBevestigingEmail(opts: {
  naam: string;
  startAt: string | Date;
  soort: "fysiek" | "telefonisch";
  functie?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const datum = formatDateNl(opts.startAt);
  const tijd = formatTimeNl(opts.startAt);
  const isFysiek = opts.soort === "fysiek";
  const titel = isFysiek
    ? "Je gesprek bij Batterijconcept"
    : "Je telefonische gesprek met Batterijconcept";

  const detailsRows = [
    `<tr><td style="padding:6px 0;color:#5A635C;font-size:13px;">Datum</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1A1F1C;font-size:13px;">${datum}</td></tr>`,
    `<tr><td style="padding:6px 0;color:#5A635C;font-size:13px;">Tijd</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1A1F1C;font-size:13px;">${tijd}</td></tr>`,
    `<tr><td style="padding:6px 0;color:#5A635C;font-size:13px;">Soort</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1A1F1C;font-size:13px;">${isFysiek ? "Op locatie" : "Telefonisch"}</td></tr>`,
    isFysiek
      ? `<tr><td style="padding:6px 0;color:#5A635C;font-size:13px;vertical-align:top;">Adres</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1A1F1C;font-size:13px;">${RECRUITMENT_GESPREK_LOCATIE}</td></tr>`
      : "",
    opts.functie
      ? `<tr><td style="padding:6px 0;color:#5A635C;font-size:13px;">Functie</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1A1F1C;font-size:13px;">${opts.functie}</td></tr>`
      : "",
  ].join("");

  return emailLayout({
    title: titel,
    preheader: `${datum} om ${tijd}${isFysiek ? ` · ${RECRUITMENT_GESPREK_LOCATIE}` : ""}`,
    bodyHtml: [
      emailH1(titel),
      emailP(`Hoi ${first},`),
      emailP(
        isFysiek
          ? "Hierbij de bevestiging van je sollicitatiegesprek. We kijken ernaar uit je te ontmoeten."
          : "Hierbij de bevestiging van je telefonische sollicitatiegesprek. We bellen je op het doorgegeven nummer."
      ),
      emailBox(
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${detailsRows}</table>`
      ),
      isFysiek
        ? emailP(
            `We verwachten je op <strong>${RECRUITMENT_GESPREK_LOCATIE}</strong>.`
          )
        : "",
      emailP(
        `Bel of app als je moeite hebt met het vinden: <strong>${RECRUITMENT_GESPREK_TEL}</strong> (${RECRUITMENT_GESPREK_CONTACT}).`
      ),
      emailMuted(
        "Kun je niet? Laat het ons zo snel mogelijk weten via dezelfde nummers of info@batterijconcept.nl."
      ),
    ].join(""),
  });
}

/** Bevestiging trainingsplanning naar aangenomen kandidaat. */
export function sollicitatieTrainingBevestigingEmail(opts: {
  naam: string;
  trainingNaam: string;
  adres: string;
  inhoud: string;
  functie?: string | null;
  dagen: Array<{
    dag_nummer: number;
    datum: string;
    start_tijd: string;
    eind_tijd: string;
    planning: string;
  }>;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const titel = `Je training: ${opts.trainingNaam}`;

  const formatTijd = (t: string) => {
    const raw = (t || "").slice(0, 5);
    return raw || t;
  };

  const dagenHtml = opts.dagen
    .map((d) => {
      const datumLabel = formatDateNl(`${d.datum}T12:00:00`);
      const planning = (d.planning || "").trim();
      return `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #E6EBE8;vertical-align:top;">
            <div style="font-weight:700;color:#1A1F1C;font-size:13px;">Dag ${d.dag_nummer} · ${datumLabel}</div>
            <div style="color:#5A635C;font-size:13px;margin-top:2px;">${formatTijd(d.start_tijd)} – ${formatTijd(d.eind_tijd)}</div>
            ${
              planning
                ? `<div style="color:#1A1F1C;font-size:13px;margin-top:6px;white-space:pre-wrap;">${planning.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`
                : ""
            }
          </td>
        </tr>`;
    })
    .join("");

  const inhoudSafe = opts.inhoud
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  return emailLayout({
    title: titel,
    preheader: `${opts.trainingNaam} · ${opts.adres}`,
    bodyHtml: [
      emailH1(titel),
      emailP(`Hoi ${first},`),
      emailP(
        "Gefeliciteerd — je bent aangenomen en ingepland voor de training. Hieronder vind je alle details."
      ),
      emailBox(
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr><td style="padding:6px 0;color:#5A635C;font-size:13px;">Training</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1A1F1C;font-size:13px;">${opts.trainingNaam}</td></tr>
          <tr><td style="padding:6px 0;color:#5A635C;font-size:13px;vertical-align:top;">Adres</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1A1F1C;font-size:13px;">${opts.adres}</td></tr>
          ${
            opts.functie
              ? `<tr><td style="padding:6px 0;color:#5A635C;font-size:13px;">Functie</td><td style="padding:6px 0;text-align:right;font-weight:600;color:#1A1F1C;font-size:13px;">${opts.functie}</td></tr>`
              : ""
          }
        </table>`
      ),
      emailP("<strong>Wat gaan we doen?</strong>"),
      emailP(inhoudSafe),
      emailP("<strong>Planning</strong>"),
      emailBox(
        `<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${dagenHtml}</table>`
      ),
      emailP(
        "<strong>Lunch en drinken worden verzorgd</strong> — je hoeft zelf niets mee te nemen."
      ),
      emailP(
        `We verwachten je op <strong>${opts.adres}</strong>. Bel of app bij vragen: <strong>${RECRUITMENT_GESPREK_TEL}</strong> (${RECRUITMENT_GESPREK_CONTACT}).`
      ),
      emailMuted(
        "Kun je een dag niet? Laat het ons zo snel mogelijk weten via hetzelfde nummer of info@batterijconcept.nl."
      ),
    ].join(""),
  });
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

/** Kickoff Opstarten: intro track & trace met knop naar portaal */
export function trackAndTraceIntroEmail(opts: {
  naam: string;
  trackUrl: string;
  projectNummer?: string | null;
  offerteNummer?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const nr = opts.projectNummer || opts.offerteNummer;
  return emailLayout({
    title: "Volg je order — BatterijConcept",
    preheader:
      "Bekijk op elk moment de status van je thuisbatterij-order, schouw en facturen.",
    bodyHtml: [
      emailH1("Volg je order"),
      emailP(`Hoi ${first},`),
      emailP(
        "Goed nieuws: we zijn gestart met je thuisbatterij-order. Via je persoonlijke track &amp; trace-pagina zie je altijd waar we staan — zonder dat je ons hoeft te bellen."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0D5C32;">Wat je daar vindt</p>
         <p style="margin:0 0 6px;font-size:14px;line-height:1.55;">• Status van schouwweek en schouwdag</p>
         <p style="margin:0 0 6px;font-size:14px;line-height:1.55;">• Installatiedatum zodra die bekend is</p>
         <p style="margin:0 0 6px;font-size:14px;line-height:1.55;">• Getekende offerte en facturen (PDF)</p>
         <p style="margin:0;font-size:14px;line-height:1.55;">• BTW-teruggave en overstap dynamische energie</p>`
      ),
      nr
        ? emailP(`<strong>Order</strong><br />${nr}`)
        : "",
      emailButton("Open track &amp; trace", opts.trackUrl),
      emailP(
        "Bewaar deze mail — de knop blijft werken zolang je order loopt. Vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Tot snel, team BatterijConcept"),
    ]
      .filter(Boolean)
      .join(""),
  });
}

/** Interne ping: nieuwe getekende order. */
export function orderGetekendInternEmail(opts: {
  offerteNummer: string;
  klantNaam?: string | null;
  adviseurNaam: string;
  bedragExBtw: number;
  brutoMarge: number;
  ondertekendOp?: string | Date;
}) {
  const when = opts.ondertekendOp
    ? formatDateTimeLongNl(opts.ondertekendOp)
    : null;
  const klant = opts.klantNaam?.trim() || "—";
  return emailLayout({
    title: `Order getekend ${opts.offerteNummer}`,
    preheader: `${opts.adviseurNaam} · ${formatEuro(opts.bedragExBtw)} ex · marge ${formatEuro(opts.brutoMarge)}`,
    bodyHtml: [
      emailH1(`Order getekend — ${opts.offerteNummer}`),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Adviseur</strong><br />${opts.adviseurNaam}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Klant</strong><br />${klant}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Bedrag ex btw</strong><br />${formatEuro(opts.bedragExBtw)}</p>
         <p style="margin:0;font-size:15px;"><strong>Bruto marge</strong><br />${formatEuro(opts.brutoMarge)}</p>`
      ),
      when
        ? emailP(`Ondertekend op ${when}.`)
        : "",
      emailMuted("Interne melding · Batterijconcept CRM"),
    ]
      .filter(Boolean)
      .join(""),
  });
}

export function offerteOndertekendEmail(opts: {
  naam: string;
  offerteNummer: string;
  ondertekendOp?: string | Date;
  /** Klant track & trace URL */
  trackUrl?: string | null;
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
  reden?: string | null;
}) {
  const first = opts.adviseurNaam.split(" ")[0] || opts.adviseurNaam;
  const when = formatDateTimeLongNl(opts.startAt);
  const reden = opts.reden?.trim();
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
         <p style="margin:0 0 8px;font-size:15px;"><strong>Geplande tijd</strong><br />${when} <span style="color:#5A635C;">(Europe/Amsterdam)</span></p>
         ${
           reden
             ? `<p style="margin:0;font-size:15px;"><strong>Reden</strong><br />${reden.replace(/\n/g, "<br />")}</p>`
             : ""
         }`
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

/** Klant: project/bestelling definitief geannuleerd (AV art. 4A — 20%) */
export function projectGeannuleerdKlantEmail(opts: {
  naam: string;
  projectNummer?: string | null;
  offerteNummer?: string | null;
  /** Totaal orderbedrag incl. btw */
  orderTotaalIncBtw?: number | null;
  /** Berekende annuleringskosten (20% van order) */
  annuleringskostenIncBtw?: number | null;
  /** Bijv. "4A" */
  avArtikel?: string | null;
  /** Bijv. 20 */
  annuleringsPctLabel?: number | null;
  /**
   * Herroeping binnen wettelijke bedenktijd → geen annuleringskosten in de mail.
   * Default false (kosten wel noemen).
   */
  binnenBedenktijd?: boolean;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const nr = opts.projectNummer?.trim() || null;
  const offNr = opts.offerteNummer?.trim() || null;
  const artikel = (opts.avArtikel || "4A").trim() || "4A";
  const pct =
    opts.annuleringsPctLabel != null &&
    Number.isFinite(opts.annuleringsPctLabel)
      ? opts.annuleringsPctLabel
      : 20;
  const binnenBedenktijd = Boolean(opts.binnenBedenktijd);
  const orderTotaal = Number(opts.orderTotaalIncBtw);
  const kosten = Number(opts.annuleringskostenIncBtw);
  const hasBedragen =
    !binnenBedenktijd &&
    Number.isFinite(orderTotaal) &&
    orderTotaal > 0 &&
    Number.isFinite(kosten) &&
    kosten > 0;

  const orderRegels = [
    nr
      ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Order</strong><br />${nr}</p>`
      : "",
    offNr
      ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Offerte</strong><br />${offNr}</p>`
      : "",
    binnenBedenktijd
      ? Number.isFinite(orderTotaal) && orderTotaal > 0
        ? `<p style="margin:0;font-size:15px;"><strong>Orderbedrag</strong><br />${formatEuro(orderTotaal)} incl. btw</p>`
        : ""
      : hasBedragen
        ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Orderbedrag</strong><br />${formatEuro(orderTotaal)} incl. btw</p>
         <p style="margin:0;font-size:15px;"><strong>Annuleringskosten (${pct}%)</strong><br />${formatEuro(kosten)} incl. btw</p>`
        : `<p style="margin:0;font-size:15px;"><strong>Annuleringskosten</strong><br />${pct}% van het totale orderbedrag (art. ${artikel} AV)</p>`,
  ]
    .filter(Boolean)
    .join("");

  const kostenParagrafen = binnenBedenktijd
    ? [
        emailP(
          "Omdat je binnen de wettelijke bedenktijd hebt geannuleerd, brengen wij <strong>geen annuleringskosten</strong> in rekening."
        ),
        emailP(
          "Eventuele reeds betaalde bedragen verrekenen we volgens onze algemene voorwaarden — je hoort van ons als dat van toepassing is."
        ),
      ]
    : [
        emailP(
          `Op grond van <strong>artikel ${artikel}</strong> van onze algemene voorwaarden ben je bij annulering (na Definitieve Financieringsgoedkeuring) <strong>${pct}% annuleringskosten</strong> van het totale orderbedrag verschuldigd.`
        ),
        hasBedragen
          ? emailP(
              `Dat komt neer op <strong>${formatEuro(kosten)} inclusief btw</strong> (${pct}% van ${formatEuro(orderTotaal)}). Je ontvangt hiervoor een aparte factuur.`
            )
          : emailP(
              "Je ontvangt hiervoor een aparte factuur met het berekende bedrag."
            ),
        emailP(
          "Deze annuleringskosten gelden niet bij een rechtsgeldige herroeping binnen de wettelijke bedenktijd, bij afgewezen of ontoereikende financiering volgens artikel 4, of bij ontbinding wegens een toerekenbare tekortkoming van BatterijConcept."
        ),
      ];

  return emailLayout({
    title: "Bestelling geannuleerd — Batterijconcept",
    preheader: binnenBedenktijd
      ? "Bestelling geannuleerd binnen bedenktijd — geen annuleringskosten."
      : hasBedragen
        ? `Bestelling geannuleerd · annuleringskosten ${formatEuro(kosten)}.`
        : "Je bestelling is geannuleerd.",
    bodyHtml: [
      emailH1("Bestelling geannuleerd"),
      emailP(`Hoi ${first},`),
      emailP(
        "Hierbij bevestigen we dat je bestelling bij Batterijconcept is geannuleerd."
      ),
      orderRegels ? emailBox(orderRegels) : "",
      ...kostenParagrafen,
      emailP(
        "Heb je vragen? Mail ons op info@batterijconcept.nl of bel 085 800 1645 — we helpen je graag."
      ),
      emailMuted("Met vriendelijke groet, team BatterijConcept"),
    ]
      .filter(Boolean)
      .join(""),
  });
}

export function factuurVerzondenEmail(opts: {
  naam: string;
  factuurNummer: string;
  bedrag: string;
  vervaldatum?: string | null;
  /** Dagen betaaltermijn in de mail (default 3). */
  betaaltermijnDagen?: number | null;
  iban?: string | null;
  accountName?: string | null;
  betalingskenmerk?: string | null;
  /** Creditfactuur: andere tekst, geen betaalblok. */
  isCredit?: boolean;
  creditVanNummer?: string | null;
  trackUrl?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const kenmerk = opts.betalingskenmerk || opts.factuurNummer;
  const isCredit = Boolean(opts.isCredit);
  const creditLabel = opts.creditVanNummer
    ? `CREDIT FACTUUR (${opts.creditVanNummer})`
    : "CREDIT FACTUUR";

  if (isCredit) {
    return emailLayout({
      title: `Creditfactuur ${opts.factuurNummer}`,
      preheader: `Je creditfactuur ${opts.factuurNummer} van Batterijconcept.`,
      bodyHtml: [
        emailH1(`Creditfactuur ${opts.factuurNummer}`),
        emailP(`Hoi ${first},`),
        emailP(
          "Hierbij ontvang je een creditfactuur van Batterijconcept. In de bijlage vind je de PDF."
        ),
        emailBox(
          `<p style="margin:0 0 8px;font-size:15px;"><strong>${creditLabel}</strong></p>
           <p style="margin:0 0 8px;font-size:15px;"><strong>Creditfactuur</strong><br />${opts.factuurNummer}</p>
           <p style="margin:0 0 8px;font-size:15px;"><strong>Bedrag</strong><br />${opts.bedrag}</p>
           <p style="margin:0;font-size:14px;">Er hoeft niets te worden betaald op dit document.</p>`
        ),
        opts.trackUrl
          ? emailButton("Bekijk je order &amp; facturen", opts.trackUrl)
          : "",
        emailP(
          "Heb je vragen? Mail ons op info@batterijconcept.nl of bel 085 800 1645."
        ),
        emailMuted("Met vriendelijke groet, team Batterijconcept"),
      ].join(""),
    });
  }

  const termijnDagen =
    typeof opts.betaaltermijnDagen === "number" &&
    Number.isFinite(opts.betaaltermijnDagen) &&
    opts.betaaltermijnDagen >= 0
      ? Math.round(opts.betaaltermijnDagen)
      : 3;
  const termijnLabel =
    termijnDagen === 1 ? "1 dag" : `${termijnDagen} dagen`;
  const betalingHtml = opts.iban
    ? emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Betalen</strong></p>
         <p style="margin:0 0 6px;font-size:14px;">IBAN: <strong>${opts.iban}</strong></p>
         <p style="margin:0 0 6px;font-size:14px;">T.n.v. <strong>${opts.accountName || "BatterijConcept"}</strong></p>
         <p style="margin:0 0 6px;font-size:14px;">Omschrijving: <strong>${kenmerk}</strong></p>
         <p style="margin:0;font-size:14px;">Betaaltermijn: <strong>${termijnLabel}</strong>${
           opts.vervaldatum ? ` (uiterlijk ${opts.vervaldatum})` : ""
         }</p>`
      )
    : "";
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
      betalingHtml,
      opts.trackUrl
        ? emailButton("Bekijk je order &amp; facturen", opts.trackUrl)
        : "",
      emailP(
        "Heb je vragen over deze factuur? Mail ons op info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Met vriendelijke groet, team Batterijconcept"),
    ].join(""),
  });
}

/** Klant: vriendelijke herinnering aanbetaling (Warmtefonds-route). */
export function factuurWarmtefondsAanbetalingHerinneringEmail(opts: {
  naam: string;
  factuurNummer: string;
  bedrag: string;
  vervaldatum?: string | null;
  iban?: string | null;
  accountName?: string | null;
  betalingskenmerk?: string | null;
  projectNummer?: string | null;
  trackUrl?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const kenmerk = opts.betalingskenmerk || opts.factuurNummer;
  const betalingHtml = opts.iban
    ? emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Betalen</strong></p>
         <p style="margin:0 0 6px;font-size:14px;">IBAN: <strong>${opts.iban}</strong></p>
         <p style="margin:0 0 6px;font-size:14px;">T.n.v. <strong>${opts.accountName || "BatterijConcept"}</strong></p>
         <p style="margin:0 0 6px;font-size:14px;">Omschrijving: <strong>${kenmerk}</strong></p>
         ${
           opts.vervaldatum
             ? `<p style="margin:0;font-size:14px;">Uiterlijk: <strong>${opts.vervaldatum}</strong></p>`
             : ""
         }`
      )
    : "";

  return emailLayout({
    title: `Herinnering aanbetaling ${opts.factuurNummer}`,
    preheader:
      "Vriendelijke herinnering: je aanbetaling is nodig om Warmtefonds te kunnen aanvragen.",
    bodyHtml: [
      emailH1("Herinnering: aanbetaling voor Warmtefonds"),
      emailP(`Hoi ${first},`),
      emailP(
        "Dit is een vriendelijke herinnering aan je openstaande aanbetalingsfactuur. We hebben die nodig om de <strong>Warmtefonds-aanvraag</strong> voor je in te regelen — pas na ontvangst van de aanbetaling kunnen we die stap zetten."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Factuur</strong><br />${opts.factuurNummer}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Bedrag</strong><br />${opts.bedrag}</p>
         ${
           opts.projectNummer
             ? `<p style="margin:0;font-size:15px;"><strong>Project</strong><br />${opts.projectNummer}</p>`
             : ""
         }`
      ),
      betalingHtml,
      emailP(
        "In de bijlage vind je de factuur nog een keer als PDF. Zodra de betaling binnen is, gaan we verder met Warmtefonds."
      ),
      opts.trackUrl
        ? emailButton("Bekijk je order &amp; facturen", opts.trackUrl)
        : "",
      emailP(
        "Vragen? Mail info@batterijconcept.nl of bel 085 800 1645 — we helpen je graag."
      ),
      emailMuted("Met vriendelijke groet, team Batterijconcept"),
    ]
      .filter(Boolean)
      .join(""),
  });
}

/** Klant: factuur is als betaald gemarkeerd */
export function factuurBetaaldEmail(opts: {
  naam: string;
  factuurNummer: string;
  bedrag: string;
  trackUrl?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: `Betaling ontvangen — ${opts.factuurNummer}`,
    preheader: `Bedankt voor je betaling van factuur ${opts.factuurNummer}.`,
    bodyHtml: [
      emailH1("Bedankt voor je betaling"),
      emailP(`Hoi ${first},`),
      emailP(
        "We hebben je betaling ontvangen — dankjewel. Hieronder zie je de bevestiging."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Factuur</strong><br />${opts.factuurNummer}</p>
         <p style="margin:0;font-size:15px;"><strong>Bedrag</strong><br />${opts.bedrag}</p>`
      ),
      opts.trackUrl
        ? emailButton("Bekijk je order &amp; facturen", opts.trackUrl)
        : "",
      emailP(
        "Heb je vragen? Mail ons op info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Met vriendelijke groet, team Batterijconcept"),
    ].join(""),
  });
}

/** Klant: schouw is ingepland (week en/of exacte dag) */
export function schouwKlantEmail(opts: {
  naam: string;
  schouwJaar: number;
  schouwWeek: number;
  /** Exacte schouwdag/tijd — als gezet, bevestigen we die in de mail */
  schouwAt?: string | Date | null;
  adres?: string | null;
  projectNummer?: string | null;
  /** Warmtefonds / sale met financiering */
  warmtefonds?: boolean;
  trackUrl?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const weekLabel = formatSchouwWeekLabel(opts.schouwJaar, opts.schouwWeek);
  const exactAt = opts.schouwAt ? new Date(opts.schouwAt) : null;
  const hasExact =
    exactAt != null && !Number.isNaN(exactAt.getTime());
  const exactLabel = hasExact ? formatDateTimeLongNl(exactAt!) : null;

  return emailLayout({
    title: "Schouw gepland — Batterijconcept",
    preheader: hasExact
      ? `Je schouw staat gepland op ${exactLabel}.`
      : `Je schouw staat gepland in ${weekLabel}.`,
    bodyHtml: [
      emailH1("Schouw gepland"),
      emailP(`Hoi ${first},`),
      emailP(
        "Goed nieuws: de schouw voor je thuisbatterij is ingepland. Onze installatiepartner komt bij je langs om de situatie ter plaatse te bekijken."
      ),
      emailBox(
        hasExact
          ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Schouw</strong><br />${exactLabel}</p>
         ${opts.adres ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Adres</strong><br />${opts.adres}</p>` : ""}
         ${opts.projectNummer ? `<p style="margin:0;font-size:15px;"><strong>Project</strong><br />${opts.projectNummer}</p>` : ""}`
          : `<p style="margin:0 0 8px;font-size:15px;"><strong>Schouwweek</strong><br />${weekLabel}</p>
         ${opts.adres ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Adres</strong><br />${opts.adres}</p>` : ""}
         ${opts.projectNummer ? `<p style="margin:0;font-size:15px;"><strong>Project</strong><br />${opts.projectNummer}</p>` : ""}`
      ),
      hasExact
        ? emailP(
            "Noteer deze datum alvast. Mocht er iets wijzigen, dan nemen we contact met je op."
          )
        : emailP(
            "We plannen eerst een <strong>week</strong> in. De exacte dag in die week stemmen we ongeveer <strong>één week van tevoren</strong> met je af — dan nemen we contact op."
          ),
      opts.warmtefonds && !hasExact
        ? emailP(
            "Omdat je kiest voor financiering via het Warmtefonds, plannen we de schouw ongeveer <strong>5 weken vooruit</strong>. Zo hebben we voldoende tijd om de Warmtefonds-aanvraag te regelen. Hierover wordt apart contact met je opgenomen."
          )
        : "",
      opts.trackUrl
        ? [
            emailP(
              "Via onderstaande knop volg je je hele order: schouwweek, afspraken, facturen en voortgang."
            ),
            emailButton("Volg je order", opts.trackUrl),
          ].join("")
        : "",
      emailP(
        "Heb je vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Tot dan, team Batterijconcept"),
    ].join(""),
  });
}

/** Installatiepartner: nieuwe schouw / order */
export function schouwPartnerEmail(opts: {
  partnerNaam: string;
  klantNaam: string;
  schouwJaar: number;
  schouwWeek: number;
  schouwAt?: string | Date | null;
  adres?: string | null;
  telefoon?: string | null;
  email?: string | null;
  projectNummer?: string | null;
  notities?: string | null;
  fotoCount?: number;
  portalUrl: string;
}) {
  const first = opts.partnerNaam.split(" ")[0] || opts.partnerNaam;
  const weekLabel = formatSchouwWeekLabel(opts.schouwJaar, opts.schouwWeek);
  const exactAt = opts.schouwAt ? new Date(opts.schouwAt) : null;
  const hasExact =
    exactAt != null && !Number.isNaN(exactAt.getTime());
  const exactLabel = hasExact ? formatDateTimeLongNl(exactAt!) : null;
  const fotoCount = opts.fotoCount ?? 0;
  const fotoLabel =
    fotoCount === 0
      ? "Geen foto's"
      : fotoCount === 1
        ? "1 foto (zie bijlage / portaal)"
        : `${fotoCount} foto's (zie bijlagen / portaal)`;
  return emailLayout({
    title: "Nieuwe schouw ingepland",
    preheader: hasExact
      ? `Schouw bij ${opts.klantNaam} op ${exactLabel}.`
      : `Schouw bij ${opts.klantNaam} in ${weekLabel}.`,
    bodyHtml: [
      emailH1("Nieuwe schouw ingepland"),
      emailP(`Hoi ${first},`),
      emailP(
        hasExact
          ? "Er is een nieuwe schouw voor je ingepland met exacte datum/tijd. Hieronder vind je de klant- en schouwgegevens. In het installatieportaal zie je de volledige order."
          : "Er is een nieuwe schouw voor je ingepland. Exacte dag en tijd volgt ongeveer één week van tevoren na contact met de klant. Hieronder vind je de klant- en schouwgegevens. In het installatieportaal zie je de volledige order."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Klant</strong><br />${opts.klantNaam}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>${hasExact ? "Schouw" : "Schouwweek"}</strong><br />${hasExact ? exactLabel : weekLabel}</p>
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

/**
 * Klant: opleverformulier afgerond — installatie voltooid.
 * Volgende stap: overstap dynamische leverancier + BTW-terugvrage.
 * (Review/Trustpilot zit in reviewVerzoekKlantEmail — apart bij Review-checkbox.)
 */
export function installatieVoltooidKlantEmail(opts: {
  naam: string;
  projectNummer?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: "Gefeliciteerd — je installatie is voltooid!",
    preheader:
      "Je batterij staat er — we bellen over overstap & BTW-terugvrage.",
    bodyHtml: [
      emailH1("Gefeliciteerd — je installatie is voltooid!"),
      emailP(`Hoi ${first},`),
      emailP(
        "Goed nieuws: de installatie van je thuisbatterij is <strong>voltooid</strong>. Vanaf nu staat je batterij er en kan het besparen beginnen!"
      ),
      opts.projectNummer
        ? emailBox(
            `<p style="margin:0;font-size:15px;"><strong>Project</strong><br />${opts.projectNummer}</p>`
          )
        : "",
      emailP(
        "We nemen de <strong>eerstvolgende werkdag</strong> contact met je op om de overstap naar de dynamische energieleverancier en de BTW-terugvrage te starten."
      ),
      emailP(
        "Heb je tussentijds vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Met vriendelijke groet, team Batterijconcept"),
    ].join(""),
  });
}

/** Trustpilot Automatic Feedback Service (verified review invite via BCC). */
export const TRUSTPILOT_AFS_BCC =
  process.env.TRUSTPILOT_AFS_BCC?.trim() ||
  "batterijconcept.nl+fedfbf488b@invite.trustpilot.com";

export const TRUSTPILOT_EVALUATE_URL =
  process.env.TRUSTPILOT_EVALUATE_URL?.trim() ||
  "https://www.trustpilot.com/evaluate/batterijconcept.nl";

/**
 * Klant: apart reviewverzoek (bij afvinken Review).
 * BCC naar Trustpilot AFS → verified review invitation.
 */
export function reviewVerzoekKlantEmail(opts: {
  naam: string;
  email: string;
  projectNummer?: string | null;
  referenceId?: string | null;
  trustpilotUrl?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const trustpilotUrl = opts.trustpilotUrl || TRUSTPILOT_EVALUATE_URL;
  const referenceId =
    opts.referenceId?.trim() || opts.projectNummer?.trim() || null;
  // Structured data voor Trustpilot AFS (verified reviews)
  const afsPayload = JSON.stringify({
    recipientName: opts.naam.trim() || first,
    recipientEmail: opts.email.trim(),
    ...(referenceId ? { referenceId } : {}),
  });

  return emailLayout({
    title: "Hoe was jouw installatie? — Batterijconcept",
    preheader: "Deel kort je ervaring op Trustpilot — dat helpt andere klanten.",
    bodyHtml: [
      emailH1("Hoe was jouw installatie?"),
      emailP(`Hoi ${first},`),
      emailP(
        "Hopelijk ben je tevreden over je thuisbatterij en de installatie. Zou je ons een <strong>korte review op Trustpilot</strong> willen geven? Dat helpt andere huishoudens bij hun keuze."
      ),
      opts.projectNummer
        ? emailBox(
            `<p style="margin:0;font-size:15px;"><strong>Project</strong><br />${opts.projectNummer}</p>`
          )
        : "",
      emailButton("Beoordeel ons op Trustpilot", trustpilotUrl),
      emailP(
        "Je ontvangt mogelijk ook een aparte uitnodiging van Trustpilot om een <strong>geverifieerde review</strong> achter te laten."
      ),
      emailP(
        "Vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Met vriendelijke groet, team Batterijconcept"),
      // Trustpilot AFS leest dit blok uit de BCC-kopie
      `<script type="application/json+trustpilot">${afsPayload}</script>`,
    ].join(""),
  });
}

/** Klant: installatie is ingepland */
export function installatieKlantEmail(opts: {
  naam: string;
  installatieAt: string | Date;
  adres?: string | null;
  projectNummer?: string | null;
  trackUrl?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const when = formatDateTimeLongNl(opts.installatieAt);
  const venster = planningVensterNl(opts.installatieAt);
  return emailLayout({
    title: "Installatie gepland — Batterijconcept",
    preheader: `Je installatie staat gepland op ${when}.`,
    bodyHtml: [
      emailH1("Installatie gepland"),
      emailP(`Hoi ${first},`),
      emailP(
        "Goed nieuws: de installatie van je thuisbatterij is ingepland. Onze installateur komt bij je langs."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Datum &amp; tijd</strong><br />${when}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Tijdvenster</strong><br />${venster.label}</p>
         ${opts.adres ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Adres</strong><br />${opts.adres}</p>` : ""}
         ${opts.projectNummer ? `<p style="margin:0;font-size:15px;"><strong>Project</strong><br />${opts.projectNummer}</p>` : ""}`
      ),
      opts.trackUrl
        ? emailButton("Volg je order", opts.trackUrl)
        : "",
      emailP(
        "Zorg dat er iemand aanwezig is en dat de meterkast en installatieruimte bereikbaar zijn. Vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Tot dan, team Batterijconcept"),
    ].join(""),
  });
}

/** Installatiepartner: nieuwe installatie */
export function installatiePartnerEmail(opts: {
  partnerNaam: string;
  klantNaam: string;
  installatieAt: string | Date;
  adres?: string | null;
  telefoon?: string | null;
  email?: string | null;
  projectNummer?: string | null;
  notities?: string | null;
  portalUrl: string;
}) {
  const first = opts.partnerNaam.split(" ")[0] || opts.partnerNaam;
  const when = formatDateTimeLongNl(opts.installatieAt);
  const venster = planningVensterNl(opts.installatieAt);
  return emailLayout({
    title: "Nieuwe installatie ingepland",
    preheader: `Installatie ${opts.klantNaam} op ${when}.`,
    bodyHtml: [
      emailH1("Nieuwe installatie ingepland"),
      emailP(`Hoi ${first},`),
      emailP(
        "Er staat een installatie voor je ingepland. Bekijk de details in het installatieportaal."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Datum &amp; tijd</strong><br />${when}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Tijdvenster</strong><br />${venster.label}</p>
         ${opts.adres ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Adres</strong><br />${opts.adres}</p>` : ""}
         <p style="margin:0 0 8px;font-size:15px;"><strong>Klant</strong><br />${opts.klantNaam}</p>
         ${opts.telefoon ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Telefoon</strong><br />${opts.telefoon}</p>` : ""}
         ${opts.email ? `<p style="margin:0 0 8px;font-size:15px;"><strong>E-mail</strong><br />${opts.email}</p>` : ""}
         ${opts.projectNummer ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Order</strong><br />${opts.projectNummer}</p>` : ""}
         ${opts.notities ? `<p style="margin:0;font-size:15px;"><strong>Notities</strong><br />${opts.notities.replace(/\n/g, "<br />")}</p>` : ""}`
      ),
      emailButton("Ga naar portaal", opts.portalUrl),
      emailMuted("Dit is een mail van Batterijconcept voor installatiepartners."),
    ].join(""),
  });
}

function planningHerinneringEmail(opts: {
  naam: string;
  soort: "schouw" | "installatie";
  at: string | Date;
  adres?: string | null;
  belangrijkeInfo?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const label = opts.soort === "schouw" ? "schouw" : "installatie";
  const venster = planningVensterNl(opts.at);
  const when = formatDateTimeLongNl(opts.at);

  return emailLayout({
    title: `Morgen is je ${label} — Batterijconcept`,
    preheader: `Morgen is het zover! ${venster.label}`,
    bodyHtml: [
      emailH1("Morgen is het zover! 🎉"),
      emailP(`Hoi ${first},`),
      emailP(
        `Morgen is je ${label} voor je thuisbatterij. We kijken ernaar uit!`
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Wanneer</strong><br />${when}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Tijdvenster</strong><br />${venster.label}</p>
         ${opts.adres ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Adres</strong><br />${opts.adres}</p>` : ""}
         ${
           opts.belangrijkeInfo
             ? `<p style="margin:0;font-size:15px;"><strong>Belangrijke info</strong><br />${opts.belangrijkeInfo.replace(/\n/g, "<br />")}</p>`
             : ""
         }`
      ),
      emailP(
        "Zorg dat er iemand aanwezig is en dat de meterkast en installatieruimte bereikbaar zijn."
      ),
      emailMuted("Tot morgen, team Batterijconcept"),
    ].join(""),
  });
}

export function schouwHerinneringKlantEmail(opts: {
  naam: string;
  schouwJaar: number;
  schouwWeek: number;
  adres?: string | null;
  belangrijkeInfo?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const when = formatSchouwWeekLabel(opts.schouwJaar, opts.schouwWeek);
  return emailLayout({
    title: "Schouwweek nadert — Batterijconcept",
    preheader: `We nemen contact op over de exacte datum van je schouw (${when}).`,
    bodyHtml: [
      emailH1("Schouwweek nadert"),
      emailP(`Hoi ${first},`),
      emailP(
        "Je schouw staat gepland in onderstaande week. We nemen binnenkort contact met je op om de exacte datum en tijd af te stemmen."
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Schouwweek</strong><br />${when}</p>
         ${opts.adres ? `<p style="margin:0 0 8px;font-size:15px;"><strong>Adres</strong><br />${opts.adres}</p>` : ""}
         ${
           opts.belangrijkeInfo
             ? `<p style="margin:0;font-size:15px;"><strong>Belangrijke info</strong><br />${opts.belangrijkeInfo.replace(/\n/g, "<br />")}</p>`
             : ""
         }`
      ),
      emailP(
        "Heb je vragen of voorkeuren voor een dagdeel? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Tot snel, team Batterijconcept"),
    ].join(""),
  });
}

export function installatieHerinneringKlantEmail(opts: {
  naam: string;
  installatieAt: string | Date;
  adres?: string | null;
  belangrijkeInfo?: string | null;
}) {
  return planningHerinneringEmail({
    naam: opts.naam,
    soort: "installatie",
    at: opts.installatieAt,
    adres: opts.adres,
    belangrijkeInfo: opts.belangrijkeInfo,
  });
}

/** Vrije klantmail vanuit backoffice/projecten (bericht + vaste afsluiting). */
export function klantContactEmail(opts: {
  klantNaam: string;
  bericht: string;
  /** @deprecated niet meer in de afsluiting; blijft optioneel voor oude callers */
  afdelingLabel?: string;
  medewerkerNaam: string;
}) {
  const first = escapeHtml(
    opts.klantNaam.split(/\s+/)[0]?.trim() || opts.klantNaam || "daar"
  );
  const medewerker = escapeHtml(opts.medewerkerNaam);
  const body = opts.bericht
    .trim()
    .split(/\n+/)
    .filter(Boolean)
    .map((p) => emailP(escapeHtml(p)))
    .join("");
  return emailLayout({
    title: "Bericht van Batterijconcept",
    preheader: opts.bericht.trim().slice(0, 120),
    bodyHtml: [
      emailP(`Beste ${first},`),
      body || emailP(""),
      emailP("Met vriendelijke groet,"),
      `<p style="margin:0 0 4px;font-size:15px;line-height:1.5;color:#1A1F1C;font-weight:600;">${medewerker}</p>
       <p style="margin:0 0 14px;font-size:15px;line-height:1.5;color:#1A1F1C;">Batterijconcept</p>`,
      emailMuted("Batterijconcept · info@batterijconcept.nl · 085 800 1645"),
    ].join(""),
  });
}

/** Adviseur: backoffice heeft jouw actie-verzoek afgerond. */
export function backofficeActieVoltooidEmail(opts: {
  adviseurNaam: string;
  titel: string;
  notities?: string | null;
  projectNummer?: string | null;
  klantNaam?: string | null;
  projectHref?: string | null;
}) {
  const first =
    opts.adviseurNaam.split(" ")[0]?.trim() || opts.adviseurNaam || "daar";
  const projectLabel = [opts.projectNummer, opts.klantNaam]
    .filter(Boolean)
    .join(" · ");
  return emailLayout({
    title: "Backoffice-actie voltooid",
    preheader: `Afgerond: ${opts.titel}`,
    bodyHtml: [
      emailH1("Je actie is afgerond"),
      emailP(`Hoi ${first},`),
      emailP(
        "De backoffice heeft je actie-verzoek afgerond:"
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#0D5C32;">${opts.titel}</p>
         ${
           projectLabel
             ? `<p style="margin:0 0 8px;font-size:14px;color:#5A635C;">${projectLabel}</p>`
             : ""
         }
         ${
           opts.notities
             ? `<p style="margin:0;font-size:14px;line-height:1.5;color:#1A1F1C;">${opts.notities.replace(/\n/g, "<br />")}</p>`
             : ""
         }`
      ),
      opts.projectHref
        ? emailButton("Bekijk project", opts.projectHref)
        : "",
      emailMuted("Dit is een automatische mail vanuit het Batterijconcept-platform."),
    ].join(""),
  });
}

/** Factuur van adviseur/partner aan Batterijconcept (PDF bijlage). */
export function relatieFactuurAanBcEmail(opts: {
  naam: string;
  factuurNummer: string;
  bedrag: string;
  vervaldatum: string;
  iban?: string | null;
  rolLabel: "adviseur" | "installatiepartner";
  /** Na goedkeuring: bevestiging + PDF nogmaals. */
  variant?: "ter_goedkeuring" | "goedgekeurd";
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const rol =
    opts.rolLabel === "adviseur" ? "adviseur" : "installatiepartner";
  const goedgekeurd = opts.variant === "goedgekeurd";
  return emailLayout({
    title: goedgekeurd
      ? `Factuur ${opts.factuurNummer} goedgekeurd`
      : `Factuur ${opts.factuurNummer}`,
    preheader: goedgekeurd
      ? `Je hebt factuur ${opts.factuurNummer} goedgekeurd · uitbetaling binnen 7 dagen.`
      : `Factuur ${opts.factuurNummer} aan Batterijconcept · uitbetaling binnen 7 dagen.`,
    bodyHtml: [
      emailH1(
        goedgekeurd
          ? `Factuur ${opts.factuurNummer} goedgekeurd`
          : `Factuur ${opts.factuurNummer}`
      ),
      emailP(`Hoi ${first},`),
      emailP(
        goedgekeurd
          ? `Bedankt voor je goedkeuring. Hierbij nogmaals de factuur die uit jouw naam als ${rol} is opgesteld, gericht aan Batterijconcept (selfbilling). De PDF zit in de bijlage.`
          : `Hierbij ontvang je de factuur die uit jouw naam als ${rol} is opgesteld, gericht aan Batterijconcept (selfbilling). De PDF zit in de bijlage.`
      ),
      emailBox(
        `<p style="margin:0 0 8px;font-size:15px;"><strong>Factuur</strong><br />${opts.factuurNummer}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Bedrag</strong><br />${opts.bedrag}</p>
         <p style="margin:0 0 8px;font-size:15px;"><strong>Betaaltermijn</strong><br />7 dagen na goedkeuring (uiterlijk ${opts.vervaldatum})</p>
         ${
           opts.iban
             ? `<p style="margin:0;font-size:14px;">Uitbetaling op IBAN <strong>${opts.iban}</strong></p>`
             : ""
         }`
      ),
      goedgekeurd
        ? emailP(
            "Batterijconcept betaalt deze factuur binnen 7 dagen. Vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
          )
        : emailP(
            opts.rolLabel === "adviseur"
              ? "Controleer de factuur in het platform onder <strong>Facturen</strong> en klik op <strong>Goedkeuren</strong> als alles klopt."
              : "Controleer de factuur in het installatieportaal onder <strong>Facturen</strong> en klik op <strong>Goedkeuren</strong> als alles klopt."
          ),
      goedgekeurd
        ? ""
        : emailP(
            "Na goedkeuring betaalt Batterijconcept binnen 7 dagen. Vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
          ),
      emailMuted("Met vriendelijke groet, team Batterijconcept"),
    ]
      .filter(Boolean)
      .join(""),
  });
}

export function zzpContractTeOndertekenenEmail(opts: {
  naam: string;
  signUrl: string;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: "Samenwerkingsovereenkomst ondertekenen",
    preheader:
      "Bekijk en onderteken je ZZP-overeenkomst met BatterijConcept.",
    bodyHtml: [
      emailH1("Samenwerkingsovereenkomst"),
      emailP(`Hoi ${first},`),
      emailP(
        "Je samenwerkingsovereenkomst met BatterijConcept staat klaar. Je gegevens staan al ingevuld — open de link, bekijk de PDF en zet alleen je handtekening."
      ),
      emailButton("Bekijk &amp; onderteken overeenkomst", opts.signUrl),
      emailMuted(
        "Vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
    ].join(""),
  });
}

export function zzpContractOndertekendEmail(opts: { naam: string }) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return emailLayout({
    title: "Overeenkomst ondertekend",
    preheader: "Je samenwerkingsovereenkomst is digitaal ondertekend.",
    bodyHtml: [
      emailH1("Overeenkomst ondertekend"),
      emailP(`Hoi ${first},`),
      emailP(
        "Bedankt. Je samenwerkingsovereenkomst met BatterijConcept is digitaal ondertekend. In de bijlage vind je de ondertekende PDF."
      ),
      emailMuted("Met vriendelijke groet, team BatterijConcept"),
    ].join(""),
  });
}

/**
 * Na bevestigde overstap-datum (pas na kiezen): klaarzetten + knop Frank Energie.
 * Uitnodiging om te plannen = datumOptieKlantEmail (zonder Frank-knop).
 */
export function overstapFrankEnergieEmail(opts: {
  naam: string;
  afspraakAt: string;
  batterijMerk: string;
  frankUrl?: string;
  logoBcUrl: string;
  logoFrankUrl: string;
  projectNummer?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const when = formatDateTimeLongNl(opts.afspraakAt);
  const frankUrl = opts.frankUrl || FRANK_ENERGIE_OVERSTAP_URL;
  const logos = `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 18px;">
  <tr>
    <td style="padding:0 14px 0 0;vertical-align:middle;">
      <img src="${opts.logoBcUrl}" alt="BatterijConcept" width="72" height="72" style="display:block;border:0;border-radius:12px;background:#0a0a0a;" />
    </td>
    <td style="padding:0 10px;vertical-align:middle;font-size:12px;font-weight:600;color:#5A635C;letter-spacing:0.04em;text-transform:uppercase;">
      in samenwerking met
    </td>
    <td style="padding:0 0 0 10px;vertical-align:middle;">
      <img src="${opts.logoFrankUrl}" alt="Frank Energie" width="72" height="72" style="display:block;border:0;border-radius:12px;" />
    </td>
  </tr>
</table>`;

  return emailLayout({
    title: "Overstap dynamische energie — BatterijConcept × Frank",
    preheader: `We regelen je overstap samen op ${when}. Bewaar deze mail.`,
    bodyHtml: [
      logos,
      emailH1("Je overstap-moment staat vast"),
      emailP(`Hoi ${first},`),
      emailP(
        `We gaan de overstap samen met je inregelen op <strong>${when}</strong>.`
      ),
      emailP(
        "Bewaar deze mail voor als we je gaan helpen met overstappen — dat doen we door op de knop hieronder te klikken:"
      ),
      emailButton("Naar Frank Energie", frankUrl),
      emailBox(
        `<p style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0D5C32;">Leg alvast klaar</p>
         <p style="margin:0 0 10px;font-size:14px;line-height:1.55;">Leg je <strong>energiejaarrekening</strong> er weer bij — dan kunnen we de aanvraag makkelijker doorlopen. Alternatief: het <strong>groene boekje</strong> van de adviseur.</p>
         <p style="margin:0 0 6px;font-size:14px;line-height:1.55;"><strong>Die zijn nodig voor de overstap:</strong></p>
         <p style="margin:0;font-size:14px;line-height:1.55;">• Je stroomverbruik<br />• Je gasverbruik</p>`
      ),
      opts.projectNummer
        ? emailP(`<strong>Order</strong><br />${opts.projectNummer}`)
        : "",
      emailP(
        "Tot dan! Vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Team BatterijConcept · i.s.m. Frank Energie"),
    ]
      .filter(Boolean)
      .join(""),
  });
}

/** Klant: kies 1 van 3 datumopties (Service of Overstap) in Mijn portaal */
export function datumOptieKlantEmail(opts: {
  naam: string;
  soortLabel: string;
  slots: [string, string, string];
  portalUrl: string;
  projectNummer?: string | null;
}) {
  const first = opts.naam.split(" ")[0] || opts.naam;
  const slotLines = opts.slots
    .map((iso, i) => {
      const label = formatDateTimeLongNl(iso);
      return `<p style="margin:0 0 ${i < 2 ? "8" : "0"}px;font-size:14px;line-height:1.55;">${i + 1}. ${label}</p>`;
    })
    .join("");
  return emailLayout({
    title: `Kies een datum — ${opts.soortLabel}`,
    preheader: `Kies één van drie tijden voor je ${opts.soortLabel.toLowerCase()}-afspraak.`,
    bodyHtml: [
      emailH1(`Kies een datum voor ${opts.soortLabel.toLowerCase()}`),
      emailP(`Hoi ${first},`),
      emailP(
        opts.soortLabel.toLowerCase().includes("overstap")
          ? `We hebben drie mogelijke tijden voor je <strong>overstap</strong>. Open je portaal, kies het moment dat jou het best uitkomt en bevestig je gegevens. <strong>Daarna</strong> ontvang je een aparte mail met uitleg en de knop naar Frank Energie.`
          : `We hebben drie mogelijke tijden voor je <strong>${opts.soortLabel.toLowerCase()}</strong>-afspraak. Open je portaal, kies de tijd die jou het best uitkomt en bevestig je gegevens.`
      ),
      emailBox(
        `<p style="margin:0 0 10px;font-size:15px;font-weight:600;color:#0D5C32;">Voorgestelde tijden</p>${slotLines}`
      ),
      opts.projectNummer
        ? emailP(`<strong>Order</strong><br />${opts.projectNummer}`)
        : "",
      emailButton("Kies je datum in Mijn portaal", opts.portalUrl),
      emailP(
        "Vragen? Mail info@batterijconcept.nl of bel 085 800 1645."
      ),
      emailMuted("Tot snel, team BatterijConcept"),
    ]
      .filter(Boolean)
      .join(""),
  });
}
