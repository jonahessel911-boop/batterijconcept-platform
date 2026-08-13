import {
  adresRegel,
  formatDateNl,
  formatTimeNl,
} from "@/lib/format";

const GREEN_DARK = "#0D5C32";
const GREEN = "#1A8A3E";
const ORANGE = "#F37021";
const CREAM = "#f2ede8";
const INK = "#1e3a2f";
const BODY = "#3a4a44";
const MUTED = "#6b7570";
const WASH = "#f7f4ef";

export type AfspraakMailVars = {
  voornaam: string;
  afspraakDatum: string;
  afspraakTijd: string;
  adres: string;
  adviseurNaam: string;
  manageUrl: string;
};

export function afspraakMailVars(opts: {
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
}): AfspraakMailVars {
  const first = opts.naam.split(" ")[0] || opts.naam;
  return {
    voornaam: first,
    afspraakDatum: formatDateNl(opts.startAt),
    afspraakTijd: formatTimeNl(opts.startAt),
    adres: opts.lead ? adresRegel(opts.lead) : "Op locatie (zie afspraak)",
    adviseurNaam: opts.adviseurNaam,
    manageUrl: opts.manageUrl,
  };
}

function brandHeader(rightLabel: string, rightColor = GREEN) {
  return `<tr>
  <td style="background-color:${GREEN_DARK};padding:28px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;font-weight:700;letter-spacing:0.5px;">
          Batterij<span style="color:${ORANGE};">concept</span>
        </td>
        <td align="right" style="color:${rightColor};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;">
          ${rightLabel}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function brandFooter(manageUrl: string) {
  return `<tr>
  <td style="background-color:${GREEN_DARK};padding:20px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#a8c4b5;text-align:center;">
      Batterijconcept &middot; Opwekken · Opladen · Opslaan<br />
      info@batterijconcept.nl &middot; 085 800 1645<br />
      <a href="${manageUrl}" style="color:#a8c4b5;text-decoration:underline;">Afspraak beheren</a>
    </p>
  </td>
</tr>`;
}

function wrapEmail(opts: {
  title: string;
  preheader: string;
  bodyRows: string;
  manageUrl: string;
}) {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${opts.title}</title>
<style type="text/css">
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: ${CREAM}; }
  a { color: ${INK}; text-decoration: underline; }
  @media screen and (max-width: 600px) {
    .container { width: 100% !important; }
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 26px !important; line-height: 32px !important; }
    .table-cell { padding: 12px !important; font-size: 13px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${CREAM};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${CREAM};opacity:0;">${opts.preheader}</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${CREAM};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" class="container" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(13,92,50,0.08);">
        ${opts.bodyRows}
        ${brandFooter(opts.manageUrl)}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** 01 — Bevestiging (dag na inplannen) */
export function afspraakBevestigingSequenceEmail(v: AfspraakMailVars): string {
  const body = `
${brandHeader("Thuisbatterij-advies")}
<tr>
  <td align="center" style="background-color:#ffffff;padding:32px 32px 8px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background-color:#e8f5ed;border-radius:24px;padding:8px 18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:${INK};">
          ✓ Afspraak bevestigd
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:16px 32px 8px 32px;" class="px">
    <h1 class="h1" style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:30px;line-height:38px;color:${INK};font-weight:700;">
      Hi ${v.voornaam}, je afspraak staat in de agenda.
    </h1>
  </td>
</tr>
<tr>
  <td style="padding:12px 32px 20px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${BODY};">
      Bedankt voor je aanvraag. Onze thuisbatterij-adviseur komt bij je langs om de mogelijkheden van een thuisbatterij voor jouw situatie door te nemen.
    </p>
  </td>
</tr>
<tr>
  <td style="padding:0 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${WASH};border-left:4px solid ${GREEN};border-radius:6px;">
      <tr>
        <td style="padding:24px 24px 8px 24px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:1px;">
          Jouw afspraak
        </td>
      </tr>
      <tr>
        <td style="padding:8px 24px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="32" valign="top" style="font-size:18px;padding-bottom:10px;">📅</td>
              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};padding-bottom:10px;">
                <strong>${v.afspraakDatum}</strong>
              </td>
            </tr>
            <tr>
              <td width="32" valign="top" style="font-size:18px;padding-bottom:10px;">🕐</td>
              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};padding-bottom:10px;">
                <strong>${v.afspraakTijd}</strong>
              </td>
            </tr>
            <tr>
              <td width="32" valign="top" style="font-size:18px;padding-bottom:10px;">📍</td>
              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};padding-bottom:10px;">
                ${v.adres}
              </td>
            </tr>
            <tr>
              <td width="32" valign="top" style="font-size:18px;padding-bottom:20px;">👤</td>
              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};padding-bottom:20px;">
                Adviseur: <strong>${v.adviseurNaam}</strong>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:32px 32px 8px 32px;" class="px">
    <h2 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;line-height:28px;color:${INK};font-weight:700;">
      Wat kun je verwachten?
    </h2>
  </td>
</tr>
<tr>
  <td style="padding:8px 32px 0 32px;" class="px">
    <p style="margin:0 0 16px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};">
      Het gesprek duurt 45-60 minuten. We bespreken samen:
    </p>
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr><td style="padding:6px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${BODY};"><span style="color:${GREEN};font-weight:700;">→</span>&nbsp;&nbsp;Je huidige energieverbruik en zonnepanelen</td></tr>
      <tr><td style="padding:6px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${BODY};"><span style="color:${GREEN};font-weight:700;">→</span>&nbsp;&nbsp;Welke thuisbatterij past bij jouw situatie</td></tr>
      <tr><td style="padding:6px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${BODY};"><span style="color:${GREEN};font-weight:700;">→</span>&nbsp;&nbsp;Wat je concreet kunt besparen per maand</td></tr>
      <tr><td style="padding:6px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${BODY};"><span style="color:${GREEN};font-weight:700;">→</span>&nbsp;&nbsp;Impact van het wegvallen van de salderingsregeling in 2027</td></tr>
      <tr><td style="padding:6px 0 16px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${BODY};"><span style="color:${GREEN};font-weight:700;">→</span>&nbsp;&nbsp;Subsidie- en financieringsmogelijkheden</td></tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:16px 32px 8px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#fff8eb;border-radius:6px;">
      <tr>
        <td style="padding:20px 24px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="40" valign="top" style="font-size:22px;">📋</td>
              <td>
                <p style="margin:0 0 6px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:${INK};">
                  Handig om klaar te leggen
                </p>
                <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:${BODY};">
                  Je laatste <strong>jaarafrekening</strong> van je energieleverancier. Indien van toepassing: gegevens van je <strong>zonnepanelen</strong> (aantal panelen en het totale vermogen, dit staat meestal op de omvormer of in de offerte/aankoopbon).
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:24px 32px 8px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:${MUTED};">
      <strong style="color:${INK};">Verzetten of annuleren?</strong><br />
      <a href="${v.manageUrl}" style="color:${INK};">Beheer je afspraak online</a> of antwoord op deze mail.
    </p>
  </td>
</tr>
<tr>
  <td style="padding:24px 32px 32px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};">
      Tot binnenkort!<br /><br />
      <strong style="color:${INK};">Het team van Batterijconcept</strong>
    </p>
  </td>
</tr>`;

  return wrapEmail({
    title: "Afspraak bevestigd",
    preheader:
      "Hier vind je alle details van je afspraak + wat je kunt verwachten van het gesprek.",
    bodyRows: body,
    manageUrl: v.manageUrl,
  });
}

/** 02 — Opwarm saldering (halverwege tussen bevestiging en reminder) */
export function afspraakOpwarmSalderingEmail(v: AfspraakMailVars): string {
  const body = `
${brandHeader("Voor je afspraak")}
<tr>
  <td align="center" style="background-color:#ffffff;padding:32px 32px 8px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background-color:#fff1d6;border-radius:24px;padding:8px 18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:#b86e00;">
          ⚠ Belangrijke wetswijziging
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:16px 32px 8px 32px;" class="px">
    <h1 class="h1" style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:30px;line-height:38px;color:${INK};font-weight:700;">
      Per 1 januari 2027 stopt de salderingsregeling volledig.
    </h1>
  </td>
</tr>
<tr>
  <td style="padding:16px 32px 20px 32px;" class="px">
    <p style="margin:0 0 14px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${BODY};">
      Hi ${v.voornaam},
    </p>
    <p style="margin:0 0 14px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${BODY};">
      Binnenkort komt onze adviseur bij je langs. Voordat het zover is, willen we je iets belangrijks meegeven — iets wat in jouw situatie waarschijnlijk veel uitmaakt.
    </p>
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${BODY};">
      Op dit moment mag je de stroom die je zonnepanelen teruglevert <strong>1-op-1 wegstrepen</strong> tegen wat je verbruikt. Vanaf 2027 is dat voorbij. Je krijgt dan nog maar een fractie terug — vaak <strong>minder dan 30%</strong> van wat je nu ontvangt.
    </p>
  </td>
</tr>
<tr>
  <td style="padding:8px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:separate;border-radius:8px;overflow:hidden;border:1px solid #e5e0d8;">
      <tr style="background-color:${GREEN_DARK};">
        <td class="table-cell" style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:0.5px;">Situatie</td>
        <td class="table-cell" align="center" style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:0.5px;">Nu</td>
        <td class="table-cell" align="center" style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:0.5px;">Vanaf 2027</td>
      </tr>
      <tr style="background-color:#ffffff;">
        <td class="table-cell" style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:${BODY};border-bottom:1px solid #f0ebe3;">Teruglevering 2.500 kWh/jaar</td>
        <td class="table-cell" align="center" style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;color:${BODY};border-bottom:1px solid #f0ebe3;">± €875</td>
        <td class="table-cell" align="center" style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;color:${BODY};border-bottom:1px solid #f0ebe3;">± €150-250</td>
      </tr>
      <tr style="background-color:#fff1d6;">
        <td class="table-cell" style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;color:${INK};font-weight:700;">Verschil per jaar</td>
        <td class="table-cell" align="center" colspan="2" style="padding:14px 16px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;color:#b86e00;font-weight:700;">€625 - €725 minder</td>
      </tr>
    </table>
    <p style="margin:10px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#8a8074;font-style:italic;">
      Indicatieve cijfers voor een gemiddeld huishouden met zonnepanelen. Werkelijke besparing afhankelijk van verbruik en contract.
    </p>
  </td>
</tr>
<tr>
  <td style="padding:28px 32px 8px 32px;" class="px">
    <h2 style="margin:0 0 12px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:22px;line-height:30px;color:${INK};font-weight:700;">
      Een thuisbatterij draait dit verlies om.
    </h2>
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${BODY};">
      In plaats van je opgewekte stroom voor een schamel tarief terug te leveren, sla je hem op en gebruik je hem zelf — precies op de momenten dat stroom uit het net duur is (avonduren, winter).
    </p>
  </td>
</tr>
<tr>
  <td style="padding:24px 32px 8px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${GREEN_DARK};border-radius:8px;">
      <tr>
        <td style="padding:24px;">
          <p style="margin:0 0 10px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:${GREEN};text-transform:uppercase;letter-spacing:1px;">
            ⏳ Wacht niet te lang
          </p>
          <p style="margin:0 0 12px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#ffffff;">
            De drukte op de thuisbatterij-markt loopt hard op. Bij veel installateurs lopen de levertijden op tot <strong style="color:${ORANGE};">8-12 weken of langer</strong>, en dat wordt richting 2027 alleen maar erger.
          </p>
          <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:#ffffff;">
            <strong style="color:${GREEN};">Het goede nieuws:</strong> dankzij onze eigen voorraad en vaste installatiepartners kunnen wij <strong style="color:${ORANGE};">aanzienlijk sneller leveren en installeren</strong>. Voor de meeste klanten regelen we het binnen enkele weken — ruim vóór de spits van 2027.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:28px 32px 8px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${BODY};">
      Daar gaan we het tijdens je afspraak op <strong style="color:${INK};">${v.afspraakDatum}</strong> uitgebreid over hebben. Onze adviseur rekent het concreet voor jouw situatie door.
    </p>
  </td>
</tr>
<tr>
  <td style="padding:24px 32px 8px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};">
      Tot ${v.afspraakDatum}!<br /><br />
      <strong style="color:${INK};">Het team van Batterijconcept</strong>
    </p>
  </td>
</tr>
<tr>
  <td style="padding:16px 32px 32px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #f0ebe3;">
      <tr>
        <td style="padding-top:16px;">
          <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;line-height:20px;color:${MUTED};font-style:italic;">
            P.S. Vragen voordat onze adviseur langskomt? Antwoord gerust op deze mail of <a href="${v.manageUrl}" style="color:${INK};">beheer je afspraak</a>.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;

  return wrapEmail({
    title: "Salderingsregeling stopt in 2027",
    preheader:
      "Per 1 januari 2027 stopt de salderingsregeling volledig. Lees waarom dat tikt.",
    bodyRows: body,
    manageUrl: v.manageUrl,
  });
}

/** 04 — Reminder 24 uur van tevoren */
export function afspraakReminder24uEmail(v: AfspraakMailVars): string {
  const body = `
${brandHeader("⏰ Reminder", ORANGE)}
<tr>
  <td align="center" style="background-color:${GREEN_DARK};padding:40px 32px;" class="px">
    <p style="margin:0 0 8px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:${ORANGE};text-transform:uppercase;letter-spacing:2px;">
      Morgen is het zover
    </p>
    <h1 class="h1" style="margin:0 0 16px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:34px;line-height:42px;color:#ffffff;font-weight:700;">
      ${v.afspraakTijd}
    </h1>
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:24px;color:#a8c4b5;">
      ${v.afspraakDatum}
    </p>
  </td>
</tr>
<tr>
  <td style="padding:32px 32px 8px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${BODY};">
      Hi ${v.voornaam},
    </p>
  </td>
</tr>
<tr>
  <td style="padding:8px 32px 20px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${BODY};">
      Morgen is het zover — onze adviseur <strong style="color:${INK};">${v.adviseurNaam}</strong> komt bij je langs om de mogelijkheden voor een thuisbatterij te bespreken.
    </p>
  </td>
</tr>
<tr>
  <td style="padding:0 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${WASH};border-left:4px solid ${ORANGE};border-radius:6px;">
      <tr>
        <td style="padding:20px 24px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="32" valign="top" style="font-size:18px;padding-bottom:8px;">📅</td>
              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};padding-bottom:8px;">
                <strong>${v.afspraakDatum}</strong>
              </td>
            </tr>
            <tr>
              <td width="32" valign="top" style="font-size:18px;padding-bottom:8px;">🕐</td>
              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};padding-bottom:8px;">
                <strong>${v.afspraakTijd}</strong>
              </td>
            </tr>
            <tr>
              <td width="32" valign="top" style="font-size:18px;">📍</td>
              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};">
                ${v.adres}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:32px 32px 8px 32px;" class="px">
    <h2 style="margin:0 0 8px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:22px;line-height:30px;color:${INK};font-weight:700;">
      Leg deze 2 dingen even klaar
    </h2>
    <p style="margin:0 0 20px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:${MUTED};">
      Dat scheelt veel tijd tijdens het gesprek.
    </p>
  </td>
</tr>
<tr>
  <td style="padding:0 32px 12px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#e8f5ed;border-radius:8px;">
      <tr>
        <td style="padding:20px 24px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="36" valign="top" style="font-size:20px;color:${GREEN};font-weight:700;">✓</td>
              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};">
                Je laatste <strong>jaarafrekening</strong> van je energieleverancier
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:0 32px 24px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#e8f5ed;border-radius:8px;">
      <tr>
        <td style="padding:20px 24px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td width="36" valign="top" style="font-size:20px;color:${GREEN};font-weight:700;">✓</td>
              <td style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};">
                Indien van toepassing: gegevens van je <strong>zonnepanelen</strong> (aantal panelen en het totale vermogen, dit staat meestal op de omvormer of in de offerte/aankoopbon)
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:16px 32px 8px 32px;" class="px">
    <h2 style="margin:0 0 12px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:20px;line-height:28px;color:${INK};font-weight:700;">
      Wat je kunt verwachten
    </h2>
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};">
      ${v.adviseurNaam} neemt rustig de tijd om jouw situatie door te nemen. Geen verkooppraatje, wel een eerlijk advies op basis van jouw verbruik. Je krijgt aan het einde een <strong style="color:${INK};">concrete berekening</strong> mee — wat het kost, wat je bespaart en wanneer je het terugverdient.
    </p>
  </td>
</tr>
<tr>
  <td style="padding:32px 32px 8px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:#fff1d6;border-radius:8px;">
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 8px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:${INK};">
            Komt het toch niet uit?
          </p>
          <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:${BODY};">
            <a href="${v.manageUrl}" style="color:${INK};">Verzet of annuleer je afspraak online</a>, of antwoord op deze mail. We plannen dan een moment dat wél schikt.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td style="padding:28px 32px 32px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};">
      Tot morgen!<br /><br />
      <strong style="color:${INK};">Het team van Batterijconcept</strong>
    </p>
  </td>
</tr>`;

  return wrapEmail({
    title: "Morgen je afspraak",
    preheader:
      "Even alles op een rijtje + wat je kunt klaarleggen voor je afspraak.",
    bodyRows: body,
    manageUrl: v.manageUrl,
  });
}

/** Timing helpers for the sequence */
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export function shouldSendBevestigingNow(opts: {
  now: Date;
  createdAt: Date;
  startAt: Date;
  alreadySent: boolean;
}): boolean {
  if (opts.alreadySent) return false;
  const msUntilStart = opts.startAt.getTime() - opts.now.getTime();
  // Korte termijn: direct (geen dag wachten)
  if (msUntilStart <= 36 * HOUR) return true;
  // Dag na inplannen: ≥ 20 uur na created_at
  return opts.now.getTime() - opts.createdAt.getTime() >= 20 * HOUR;
}

export function shouldSendOpwarmNow(opts: {
  now: Date;
  createdAt: Date;
  startAt: Date;
  bevestigingSent: boolean;
  alreadySent: boolean;
}): boolean {
  if (opts.alreadySent || !opts.bevestigingSent) return false;
  const confirmAt = new Date(opts.createdAt.getTime() + DAY);
  const remindAt = new Date(opts.startAt.getTime() - DAY);
  // Te weinig ruimte tussen bevestiging en reminder → skip
  if (remindAt.getTime() - confirmAt.getTime() < 12 * HOUR) return false;
  const opwarmAt = new Date(
    (confirmAt.getTime() + remindAt.getTime()) / 2
  );
  // Cron uurlijks: ±1 uur rond midpoint, en nog vóór de reminder-window
  const delta = Math.abs(opts.now.getTime() - opwarmAt.getTime());
  if (delta > 75 * 60 * 1000) {
    // Ook inhalen als we het midpoint gemist hebben maar nog ruim vóór reminder zitten
    if (opts.now < opwarmAt) return false;
    if (opts.now.getTime() >= remindAt.getTime() - HOUR) return false;
    // Inhaal: stuur zodra we voorbij midpoint zijn (tot 1u voor reminder-window)
    return true;
  }
  return opts.now.getTime() < remindAt.getTime() - HOUR;
}

export function shouldSendReminderNow(opts: {
  now: Date;
  startAt: Date;
  alreadySent: boolean;
}): boolean {
  if (opts.alreadySent) return false;
  const msUntil = opts.startAt.getTime() - opts.now.getTime();
  return msUntil >= 23 * HOUR && msUntil <= 25 * HOUR;
}
