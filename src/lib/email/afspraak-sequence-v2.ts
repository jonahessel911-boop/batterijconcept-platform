/**
 * Intensieve afspraak-opvolging (A/B variant "intensief").
 * Live via planAfspraak + cron wanneer afspraak.opvolging_flow = intensief|rustig.
 * Rustig hergebruikt bevestiging + avond-SMS hieruit.
 */

import type { AfspraakMailVars } from "./afspraak-sequence";
import {
  emailIconSrc,
  type EmailIconFile,
} from "./email-icons";

export type AfspraakMailVarsV2 = AfspraakMailVars & {
  /** Link om afspraak in agenda te zetten (ICS / calendar). */
  calendarUrl: string;
  /** Optioneel: social proof voor 48u-mail (preview-defaults hieronder). */
  regioLabel?: string;
  regioAantalGeholpen?: number;
  regioGemiddeldeBesparingEuro?: number;
};

const GREEN_DARK = "#0D5C32";
const GREEN = "#1A8A3E";
const ORANGE = "#F37021";
const CREAM = "#f2ede8";
const INK = "#1e3a2f";
const BODY = "#3a4a44";
const MUTED = "#6b7570";
const WASH = "#f7f4ef";
const LINE = "#e5e0d8";

type IconKind = "calendar" | "clock" | "pin" | "person" | "checklist" | "check";

/**
 * Inline CID-PNG’s (meegeleverd via Postmark). Geen localhost/SVG data-URI —
 * die laden niet in Gmail.
 */
function iconFile(kind: IconKind, accent = GREEN_DARK): EmailIconFile {
  if (kind === "checklist") return "checklist-orange.png";
  if (kind === "check") return "check-green.png";
  const tone = accent === ORANGE ? "orange" : "green";
  return `${kind}-${tone}.png` as EmailIconFile;
}

function iconBadge(kind: IconKind, accent = GREEN_DARK, size = 18): string {
  const bg = accent === ORANGE ? "#fff4eb" : "#e8f5ed";
  const box = Math.max(36, size + 18);
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
  <td width="${box}" height="${box}" align="center" valign="middle" style="width:${box}px;height:${box}px;background-color:${bg};border-radius:8px;">
    <img src="${emailIconSrc(iconFile(kind, accent))}" width="${size}" height="${size}" alt="" style="display:block;border:0;outline:none;" />
  </td>
</tr></table>`;
}

function brandMark(size = 20): string {
  return `<span style="color:#ffffff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:${size}px;font-weight:700;letter-spacing:0.2px;">Batterij<span style="color:${ORANGE};">concept</span></span>`;
}

function wrapEmail(opts: {
  title: string;
  preheader: string;
  headerRight?: string;
  headerRightColor?: string;
  /** Vervangt de standaard groene header (bijv. avond-hero met merk erin). */
  customHeader?: string;
  bodyRows: string;
  footerExtra?: string;
}): string {
  const rightColor = opts.headerRightColor ?? GREEN;
  const headerRight = (opts.headerRight ?? "").trim();
  const defaultHeader = opts.customHeader
    ? opts.customHeader
    : `<tr>
          <td style="background-color:${GREEN_DARK};padding:22px 32px;" class="px">
            <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td class="stack-col" valign="middle">
                  ${brandMark(19)}
                </td>
                ${
                  headerRight
                    ? `<td class="stack-col header-right" align="right" valign="middle" style="color:${rightColor};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">
                  ${headerRight}
                </td>`
                    : ""
                }
              </tr>
            </table>
          </td>
        </tr>`;

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
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; max-width: 100% !important; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; min-width: 0 !important; background-color: ${CREAM}; }
  a { color: ${INK}; text-decoration: underline; word-break: break-word; }
  p, h1, h2, td { word-break: break-word; overflow-wrap: anywhere; }
  table { max-width: 100% !important; }
  .container { width: 100% !important; max-width: 600px !important; }
  .fluid { width: 100% !important; max-width: 100% !important; }
  @media screen and (max-width: 620px) {
    .outer-pad { padding: 8px 0 !important; }
    .container { width: 100% !important; max-width: 100% !important; border-radius: 0 !important; border-left: 0 !important; border-right: 0 !important; }
    .px { padding-left: 16px !important; padding-right: 16px !important; }
    .h1 { font-size: 22px !important; line-height: 30px !important; }
    .hero-time { font-size: 36px !important; line-height: 42px !important; }
    .hero-kicker { font-size: 11px !important; letter-spacing: 0.14em !important; }
    .stack { width: 100% !important; }
    .stack-col { display: block !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
    .header-right { display: block !important; width: 100% !important; text-align: left !important; padding-top: 6px !important; }
    .cta-link { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: center !important; }
    .meta-icon { width: 36px !important; }
    .meta-text { width: auto !important; }
  }
  @media screen and (max-width: 380px) {
    .px { padding-left: 12px !important; padding-right: 12px !important; }
    .h1 { font-size: 20px !important; line-height: 28px !important; }
    .hero-time { font-size: 32px !important; line-height: 38px !important; }
    .body-text { font-size: 15px !important; line-height: 23px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${CREAM};font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${CREAM};opacity:0;">${opts.preheader}</div>
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color:${CREAM};">
  <tr>
    <td align="center" class="outer-pad" style="padding:28px 12px;">
      <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="600" class="container" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${LINE};">
        ${defaultHeader}
        ${opts.bodyRows}
        <tr>
          <td style="background-color:${GREEN_DARK};padding:20px 32px;" class="px">
            <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#a8c4b5;text-align:center;word-break:break-word;">
              Batterijconcept · Opwekken · Opladen · Opslaan<br />
              info@batterijconcept.nl · 085 800 1645${opts.footerExtra ?? ""}
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function statusPill(label: string): string {
  return `<tr>
  <td align="center" style="background-color:#ffffff;padding:24px 32px 0 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
      <tr>
        <td style="background-color:#e8f5ed;border:1px solid #d5ebdd;border-radius:999px;padding:7px 14px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="middle" style="padding-right:8px;">
                <img src="${emailIconSrc(iconFile("check", GREEN))}" width="15" height="15" alt="" style="display:block;border:0;" />
              </td>
              <td valign="middle" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;letter-spacing:0.02em;color:${INK};">
                ${label}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function heading(text: string): string {
  return `<tr>
  <td style="padding:20px 32px 6px 32px;" class="px">
    <h1 class="h1" style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:26px;line-height:34px;color:${INK};font-weight:700;letter-spacing:-0.02em;">
      ${text}
    </h1>
  </td>
</tr>`;
}

function paragraph(html: string, top = 12): string {
  return `<p class="body-text" style="margin:${top}px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:26px;color:${BODY};word-break:break-word;overflow-wrap:anywhere;">${html}</p>`;
}

type MetaItem = { icon: IconKind; label: string; value: string; strong?: boolean };

function metaCard(items: MetaItem[], accent: string = GREEN): string {
  const rows = items
    .map((item, i) => {
      const pad = i === items.length - 1 ? "0" : "14px";
      const value = item.strong
        ? `<strong style="color:${INK};">${item.value}</strong>`
        : item.value;
      return `<tr>
  <td class="meta-icon" width="40" valign="top" style="width:40px;padding-bottom:${pad};">${iconBadge(item.icon, accent === ORANGE ? ORANGE : GREEN_DARK)}</td>
  <td class="meta-text" valign="middle" style="padding-bottom:${pad};padding-left:8px;min-width:0;">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${item.label}</p>
    <p style="margin:4px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};word-break:break-word;overflow-wrap:anywhere;">${value}</p>
  </td>
</tr>`;
    })
    .join("");

  return `<tr>
  <td style="padding:8px 32px 8px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="fluid" style="width:100%;background-color:${WASH};border:1px solid ${LINE};border-left:3px solid ${accent};border-radius:10px;">
      <tr>
        <td style="padding:16px 14px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="fluid" style="width:100%;">
            ${rows}
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function bulletList(items: string[]): string {
  const rows = items
    .map(
      (item) => `<tr>
  <td width="24" valign="top" style="padding:7px 0;">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr>
      <td width="8" height="8" style="width:8px;height:8px;background-color:${GREEN};border-radius:50%;font-size:0;line-height:0;">&nbsp;</td>
    </tr></table>
  </td>
  <td style="padding:5px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${BODY};word-break:break-word;overflow-wrap:anywhere;">${item}</td>
</tr>`
    )
    .join("");
  return `<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">${rows}</table>`;
}

function tipCard(title: string, body: string): string {
  // Altijd gestapeld (icoon + titel, dan body) — voorkomt overflow op smalle viewports.
  return `<tr>
  <td style="padding:12px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="fluid" style="width:100%;background-color:#fffaf3;border:1px solid #f0e2cf;border-left:3px solid ${ORANGE};border-radius:10px;">
      <tr>
        <td style="padding:14px 14px 0 14px;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td valign="middle" style="padding-right:10px;">${iconBadge("checklist", ORANGE)}</td>
              <td valign="middle" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:${INK};word-break:break-word;">
                ${title}
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:10px 14px 14px 14px;">
          <p class="body-text" style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:${BODY};word-break:break-word;overflow-wrap:anywhere;">${body}</p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function ctaButton(label: string, href: string): string {
  return `<tr>
  <td align="center" style="padding:24px 32px 8px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="fluid">
      <tr>
        <td align="center" style="background-color:${GREEN_DARK};border-radius:8px;">
          <a class="cta-link" href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">
            ${label}
          </a>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function storyCard(title: string, body: string): string {
  return `<tr>
  <td style="padding:0 32px 10px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="fluid" style="width:100%;background-color:${WASH};border:1px solid ${LINE};border-radius:10px;">
      <tr>
        <td style="padding:14px;">
          <p style="margin:0 0 6px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:${INK};word-break:break-word;">${title}</p>
          <p class="body-text" style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:21px;color:${BODY};word-break:break-word;overflow-wrap:anywhere;">${body}</p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function signOff(html: string): string {
  return `<tr>
  <td style="padding:20px 32px 32px 32px;" class="px">
    <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};">
      ${html}<br /><br />
      <strong style="color:${INK};">Het team van Batterijconcept</strong>
    </p>
  </td>
</tr>`;
}

/** 01 — SMS tegelijk met bevestigingsmail */
export function afspraakBevestigingSmsV2(v: AfspraakMailVarsV2): string {
  return [
    `Gefeliciteerd ${v.voornaam}!`,
    ``,
    `Het maken van je afspraak is gelukt.`,
    ``,
    `Op ${v.afspraakDatum} om ${v.afspraakTijd} komt adviseur ${v.adviseurNaam} bij je langs voor je kosteloze adviesgesprek.`,
    `Het gesprek duurt ongeveer 90 minuten.`,
    ``,
    `Zet het in je agenda:`,
    v.calendarUrl,
    ``,
    `Vragen? We zijn bereikbaar op werkdagen van 9:00 tot 17:00 via 085 800 1645.`,
    ``,
    `Tot dan!`,
    `Batterijconcept`,
  ].join("\n");
}

/** 01 — Bevestiging (nieuw concept) */
export function afspraakBevestigingSequenceEmailV2(v: AfspraakMailVarsV2): string {
  return wrapEmail({
    title: "Afspraak bevestigd",
    preheader:
      "Gefeliciteerd, het maken van je afspraak is gelukt. Onze adviseur komt langs.",
    headerRight: "Bevestiging",
    footerExtra: `<br /><a href="${v.manageUrl}" style="color:#a8c4b5;text-decoration:underline;">Afspraak beheren</a>`,
    bodyRows: [
      statusPill("Afspraak bevestigd"),
      heading("Gefeliciteerd, het maken van je afspraak is gelukt."),
      `<tr><td style="padding:8px 32px 16px 32px;" class="px">
        ${paragraph(`Hi ${v.voornaam},`, 0)}
        ${paragraph(
          `Je afspraak staat in onze agenda. Op <strong>${v.afspraakDatum} om ${v.afspraakTijd}</strong> komt adviseur <strong>${v.adviseurNaam}</strong> bij je langs voor een <strong>kosteloos adviesgesprek</strong>, om samen met jou te kijken of een thuisbatterij interessant kan zijn voor jouw situatie.`
        )}
        ${paragraph(
          "Als het de adviseur lukt om een passende oplossing te vinden kijkt hij samen met jou welke regelingen of subsidies er zijn en kan hij je helpen om deze aan te vragen."
        )}
        ${paragraph(
          "Het adviesgesprek is helemaal kosteloos en vrijblijvend."
        )}
      </td></tr>`,
      metaCard([
        { icon: "calendar", label: "Datum", value: v.afspraakDatum, strong: true },
        { icon: "clock", label: "Tijd", value: v.afspraakTijd, strong: true },
        { icon: "pin", label: "Adres", value: v.adres },
        {
          icon: "person",
          label: "Adviseur",
          value: v.adviseurNaam,
          strong: true,
        },
      ]),
      ctaButton("Zet in je agenda", v.calendarUrl),
      `<tr><td style="padding:28px 32px 8px 32px;" class="px">
        <h2 style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:26px;color:${INK};font-weight:700;">Wat kun je verwachten?</h2>
        <p style="margin:10px 0 14px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};">Het kosteloze gesprek duurt ongeveer 90 minuten. We bespreken:</p>
        ${bulletList([
          "Je huidige situatie (verbruik en zonnepanelen)",
          "Of een thuisbatterij de juiste oplossing is",
          "Wat het einde van de salderingsregeling voor jou betekent",
          "Welke subsidies en regelingen voor jou mogelijk zijn",
        ])}
      </td></tr>`,
      tipCard(
        "Handig voor het gesprek",
        "Heb je je laatste <strong>jaarafrekening</strong> van je energieleverancier bij de hand? En eventueel gegevens van je <strong>zonnepanelen</strong> (aantal panelen en totale vermogen)? Dan kunnen we tijdens het gesprek sneller kijken wat voor jou interessant is.<br /><br />Daarnaast is het belangrijk dat <strong>alle hoofdbewoners</strong> van de woning aanwezig zijn. Alleen dan kan de adviseur goed beoordelen of jullie echt in aanmerking komen voor de regeling."
      ),
      `<tr><td style="padding:20px 32px 8px 32px;" class="px">
        <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:${MUTED};">
          <strong style="color:${INK};">Verzetten of annuleren?</strong><br />
          <a href="${v.manageUrl}" style="color:${INK};">Beheer je afspraak online</a> of antwoord op deze mail.
        </p>
      </td></tr>`,
      signOff(
        `Onze adviseur komt langs op ${v.afspraakDatum} om ${v.afspraakTijd}.`
      ),
    ].join(""),
  });
}

/**
 * 02 — Social-proof tussenmail (eerste warmhoud).
 */
export function afspraakSocialProofEmailV2(v: AfspraakMailVarsV2): string {
  return wrapEmail({
    title: "Je afspraak staat klaar",
    preheader: `Je afspraak op ${v.afspraakDatum} staat klaar. Onze adviseur komt langs.`,
    headerRight: "Ter voorbereiding",
    footerExtra: `<br /><a href="${v.manageUrl}" style="color:#a8c4b5;text-decoration:underline;">Afspraak beheren</a>`,
    bodyRows: [
      heading(`Je afspraak op ${v.afspraakDatum} staat klaar`),
      `<tr><td style="padding:8px 32px 16px 32px;" class="px">
        ${paragraph(`Hi ${v.voornaam},`, 0)}
        ${paragraph(
          `Even een korte herinnering: op <strong>${v.afspraakDatum} om ${v.afspraakTijd}</strong> komt adviseur <strong>${v.adviseurNaam}</strong> bij je langs voor je <strong>kosteloze adviesgesprek</strong>. Samen kijken jullie of een thuisbatterij interessant is voor jouw situatie.`
        )}
        ${paragraph(
          "Het gesprek is helemaal kosteloos en vrijblijvend."
        )}
      </td></tr>`,
      `<tr><td style="padding:8px 32px 12px 32px;" class="px">
        <h2 style="margin:0 0 10px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:26px;color:${INK};font-weight:700;">Wat andere klanten hebben gedaan</h2>
        <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};">Hieronder een paar voorbeelden van situaties die we recent hebben bekeken:</p>
      </td></tr>`,
      storyCard(
        "Mark en Sandra uit Utrecht",
        "Na het advies goedgekeurd voor een regeling. Batterij zonder eigen investering geplaatst. Nu gemiddeld <strong>€85 per maand</strong> voordeliger uit."
      ),
      storyCard(
        "Peter en Linda uit Rotterdam",
        "Goede oplossing gevonden en goedgekeurd voor de regeling. Geen eigen investering nodig. Besparing van ongeveer <strong>€110 per maand</strong>."
      ),
      storyCard(
        "Anja uit Eindhoven",
        "Advies gekregen, goedgekeurd en batterij geplaatst zonder eigen investering. Nu <strong>€70 per maand</strong> goedkoper uit."
      ),
      `<tr><td style="padding:12px 32px 16px 32px;" class="px">
        ${paragraph(
          "Tijdens jullie afspraak kijkt de adviseur of iets vergelijkbaars ook voor jouw situatie mogelijk is.",
          0
        )}
        ${paragraph(
          "Heb je je laatste jaarafrekening (en eventueel gegevens van je zonnepanelen) bij de hand? Dan is dat handig tijdens het gesprek."
        )}
        ${paragraph(
          "Het is ook belangrijk dat alle hoofdbewoners van de woning aanwezig zijn. Dan kan de adviseur goed kijken of jullie echt in aanmerking komen voor de regeling."
        )}
      </td></tr>`,
      metaCard([
        { icon: "calendar", label: "Datum", value: v.afspraakDatum, strong: true },
        { icon: "clock", label: "Tijd", value: v.afspraakTijd, strong: true },
        {
          icon: "person",
          label: "Adviseur",
          value: v.adviseurNaam,
          strong: true,
        },
      ]),
      signOff(`Tot ${v.afspraakDatum}!`),
    ].join(""),
  });
}

/** 03 — SMS tegelijk met 48-uurs reminder */
export function afspraakReminder48uSmsV2(v: AfspraakMailVarsV2): string {
  return [
    `Herinnering: over 2 dagen (${v.afspraakDatum} om ${v.afspraakTijd}) komt adviseur ${v.adviseurNaam} bij je langs voor je kosteloze adviesgesprek.`,
    ``,
    `Tip: met je jaarafrekening erbij gaat het gesprek sneller.`,
    ``,
    `Vragen? Bel ons op 085 800 1645.`,
    ``,
    `Tot dan!`,
    `Batterijconcept`,
  ].join("\n");
}

/** 03 — 48-uurs reminder (mail). */
export function afspraakReminder48uEmailV2(v: AfspraakMailVarsV2): string {
  const regio = v.regioLabel ?? "jouw regio";
  const aantal = v.regioAantalGeholpen ?? 180;
  const besparing = v.regioGemiddeldeBesparingEuro ?? 90;

  return wrapEmail({
    title: "Over 2 dagen komt onze adviseur langs",
    preheader:
      "Over 2 dagen komt onze adviseur langs. Heb je je jaarafrekening bij de hand? Dat is handig.",
    headerRight: "Over 2 dagen",
    headerRightColor: ORANGE,
    bodyRows: [
      heading("Over 2 dagen komt onze adviseur langs"),
      `<tr><td style="padding:8px 32px 16px 32px;" class="px">
        ${paragraph(`Hi ${v.voornaam},`, 0)}
        ${paragraph(
          `Over 2 dagen, op <strong>${v.afspraakDatum} om ${v.afspraakTijd}</strong>, komt adviseur <strong>${v.adviseurNaam}</strong> bij je langs.`
        )}
        ${paragraph(
          "Samen kijken jullie of een thuisbatterij interessant is voor jouw situatie. Is dat het geval, dan kan hij gelijk checken of je in aanmerking komt voor regelingen om het bijvoorbeeld zonder eigen investering te doen."
        )}
      </td></tr>`,
      `<tr>
  <td style="padding:4px 32px 16px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="fluid" style="width:100%;background-color:#e8f5ed;border:1px solid #d5ebdd;border-radius:10px;">
      <tr>
        <td style="padding:14px;">
          <p style="margin:0 0 6px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${GREEN};">
            In ${regio}
          </p>
          <p class="body-text" style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:${INK};word-break:break-word;overflow-wrap:anywhere;">
            We hebben al <strong>meer dan ${aantal} mensen</strong> in ${regio} geholpen — met een gemiddelde besparing van <strong>€${besparing} per maand</strong>.
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>`,
      `<tr><td style="padding:4px 32px 8px 32px;" class="px">
        <h2 style="margin:0 0 10px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:18px;line-height:26px;color:${INK};font-weight:700;">Waarom dit nu relevant is</h2>
        <p class="body-text" style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};word-break:break-word;overflow-wrap:anywhere;">
          Op dit moment mag je de stroom die je zonnepanelen teruglevert nog 1-op-1 wegstrepen tegen wat je verbruikt. Per 1 januari 2027 stopt de salderingsregeling volledig. Daarna krijg je voor teruggeleverde stroom nog maar een fractie terug — vaak minder dan 30% van wat je nu ontvangt.
        </p>
        <p class="body-text" style="margin:10px 0 0 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;color:${BODY};word-break:break-word;overflow-wrap:anywhere;">
          Tijdens de afspraak legt de adviseur helder uit wat dit voor jouw situatie betekent.
        </p>
      </td></tr>`,
      metaCard(
        [
          {
            icon: "calendar",
            label: "Datum",
            value: v.afspraakDatum,
            strong: true,
          },
          { icon: "clock", label: "Tijd", value: v.afspraakTijd, strong: true },
          { icon: "pin", label: "Adres", value: v.adres },
          {
            icon: "person",
            label: "Adviseur",
            value: v.adviseurNaam,
            strong: true,
          },
        ],
        ORANGE
      ),
      `<tr><td style="padding:12px 32px;" class="px">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="fluid" style="width:100%;background-color:#fffaf3;border:1px solid #f0e2cf;border-radius:10px;">
          <tr>
            <td style="padding:14px;">
              <p class="body-text" style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:${INK};word-break:break-word;overflow-wrap:anywhere;">
                Op dit moment zijn er nog een beperkt aantal plekken beschikbaar voor de regelingen in jouw regio. Tijdens de afspraak kijkt de adviseur of er voor jou nog een mogelijkheid is.
              </p>
            </td>
          </tr>
        </table>
      </td></tr>`,
      tipCard(
        "Handig voor het gesprek",
        "Heb je je laatste <strong>jaarafrekening</strong> (en eventueel gegevens van je zonnepanelen) bij de hand? Dan kunnen we tijdens het gesprek sneller kijken wat voor jou interessant is.<br /><br />Zorg er ook voor dat <strong>alle hoofdbewoners</strong> van de woning erbij zijn. Alleen dan kan de adviseur goed beoordelen of jullie in aanmerking komen voor de regeling."
      ),
      signOff(`Tot ${v.afspraakDatum}!`),
    ].join(""),
  });
}

/** 04 — SMS avond van tevoren (intensief + rustig). */
export function afspraakAvondVoorafSmsV2(v: AfspraakMailVarsV2): string {
  return [
    `Morgen om ${v.afspraakTijd} komt adviseur ${v.adviseurNaam} bij je langs op ${v.adres}.`,
    ``,
    `Met je jaarafrekening kan de adviseur sneller een goed beeld krijgen van jouw situatie.`,
    ``,
    `Tot morgen!`,
    `Batterijconcept`,
  ].join("\n");
}

/**
 * 04 — Avond-van-tevoren mail (intensief, samen met SMS).
 * Altijd de avond vóór de afspraak (rond 18:00–20:00).
 * Geen schaarste-/“beperkte plekken”-copy.
 */
export function afspraakAvondVoorafEmailV2(v: AfspraakMailVarsV2): string {
  // Één groene top: merk + kicker + tijd — geen aparte "Morgen"-label ernaast.
  const customHeader = `<tr>
  <td style="background-color:${GREEN_DARK};padding:22px 32px 32px 32px;" class="px">
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td style="padding-bottom:22px;">
          ${brandMark(18)}
        </td>
      </tr>
      <tr>
        <td align="center" style="padding-top:4px;border-top:1px solid #1f6b3f;">
          <p class="hero-kicker" style="margin:18px 0 12px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;color:${ORANGE};text-transform:uppercase;letter-spacing:0.14em;">
            Morgen is het zover
          </p>
          <h1 class="hero-time" style="margin:0 0 8px 0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:44px;line-height:50px;color:#ffffff;font-weight:700;letter-spacing:-0.03em;">
            ${v.afspraakTijd}
          </h1>
          <p style="margin:0;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#a8c4b5;">
            ${v.afspraakDatum}
          </p>
        </td>
      </tr>
    </table>
  </td>
</tr>`;

  return wrapEmail({
    title: "Morgen komt onze adviseur langs",
    preheader:
      "Morgen komt onze adviseur langs. Heb je je jaarafrekening bij de hand? Dat is handig.",
    customHeader,
    bodyRows: [
      `<tr><td style="padding:28px 32px 16px 32px;" class="px">
        ${paragraph(`Hi ${v.voornaam},`, 0)}
        ${paragraph(
          `Om <strong>${v.afspraakTijd}</strong> komt adviseur <strong>${v.adviseurNaam}</strong> bij je langs op ${v.adres}.`
        )}
        ${paragraph(
          "Samen kijken jullie of een thuisbatterij interessant is voor jouw situatie. Is dat het geval, dan kan hij gelijk checken of je in aanmerking komt voor regelingen om het bijvoorbeeld zonder eigen investering te doen."
        )}
      </td></tr>`,
      metaCard(
        [
          {
            icon: "calendar",
            label: "Datum",
            value: v.afspraakDatum,
            strong: true,
          },
          { icon: "clock", label: "Tijd", value: v.afspraakTijd, strong: true },
          { icon: "pin", label: "Adres", value: v.adres },
          {
            icon: "person",
            label: "Adviseur",
            value: v.adviseurNaam,
            strong: true,
          },
        ],
        ORANGE
      ),
      tipCard(
        "Handig voor het gesprek",
        "Heb je je laatste <strong>jaarafrekening</strong> (en eventueel gegevens van je zonnepanelen) bij de hand? Dan kunnen we tijdens het gesprek sneller kijken wat voor jou interessant is.<br /><br />Graag met <strong>alle hoofdbewoners</strong> van de woning erbij. Dan kan de adviseur goed kijken of jullie echt in aanmerking komen voor de regeling."
      ),
      signOff("Tot morgen!"),
    ].join(""),
  });
}
