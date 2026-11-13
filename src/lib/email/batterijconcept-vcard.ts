/**
 * vCard voor BatterijConcept — knop/link in klantmails (o.a. schouwweek)
 * naar /BatterijConcept.vcf zodat klanten ons nummer opslaan.
 *
 * Geen imports van Node-only modules (fs) — templates.ts wordt ook
 * vanuit client components geladen.
 */

/** Weergave in mailtekst (spaties). */
export const BATTERIJCONCEPT_TEL_DISPLAY = "085 800 1645";

/**
 * Publieke URL van de .vcf (snelkoppeling in e-mail).
 * Altijd productiedomein — lokale/preview-URL’s openen niet op de telefoon.
 */
export function batterijconceptVcardUrl(): string {
  return "https://platform.batterijconcept.nl/BatterijConcept.vcf";
}

/** E.164 voor vCard / tel:-links. */
export function batterijconceptTelE164(): string {
  return "+31858001645";
}

/** RFC 6350 / vCard 3.0 — BatterijConcept contact (bron voor public/.vcf). */
export function batterijconceptVcardContent(): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "FN:BatterijConcept",
    "ORG:BatterijConcept",
    `TEL;TYPE=WORK,VOICE:${batterijconceptTelE164()}`,
    "EMAIL;TYPE=INTERNET:info@batterijconcept.nl",
    "URL:https://batterijconcept.nl",
    "ADR;TYPE=WORK:;;Daltonlaan 500;Utrecht;;3584 BK;Nederland",
    "END:VCARD",
  ];
  return `${lines.join("\r\n")}\r\n`;
}
