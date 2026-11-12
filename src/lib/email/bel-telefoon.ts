/**
 * Uitgaand belnummer voor bel-/herplan-mails (missed call, herplannen).
 * Algemeen company-nummer in overige mails blijft 085 800 1645.
 */

export const BATTERIJCONCEPT_BEL_TEL_DISPLAY = "085 800 2409";

export function batterijconceptBelTelE164(): string {
  return "+31858002409";
}

export function batterijconceptBelTelHref(): string {
  return `tel:${batterijconceptBelTelE164()}`;
}
