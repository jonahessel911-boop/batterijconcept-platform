/**
 * Startadres-helpers voor reistijd / Fast Direction.
 * NL én BE moeten bruikbaar zijn (sommige adviseurs vertrekken vanuit België).
 */

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export type StartAdresLand = "NL" | "BE";

/**
 * Elke maandag ochtendmeeting — eerste afspraak die dag vertrekt hier vandaan
 * (niet vanaf het persoonlijke startadres van de adviseur).
 */
export const MAANDAG_MEETING_START_ADRES =
  "Daltonlaan 500, Utrecht, Nederland";

export const MAANDAG_MEETING_START_LABEL = "Ochtendmeeting Daltonlaan";

/**
 * Fallback vertrekpunt voor montagepartners zonder eigen start_adres
 * (Cabrondom 43, Utrecht).
 */
export const PARTNER_DEFAULT_START_ADRES =
  "Cabrondom 43, Utrecht, Nederland";

export const PARTNER_DEFAULT_START_LABEL = "Cabrondom 43 Utrecht";

/** Partner-startadres of Cabrondom-fallback (altijd bruikbaar voor reistijd). */
export function resolvePartnerStartAdres(
  startAdres: string | null | undefined
): { address: string; label: string | null; isFallback: boolean } {
  const t = (startAdres || "").trim();
  if (t && t !== "—" && isUsableStartAdres(t)) {
    return {
      address: ensureStartAdresCountry(t),
      label: null,
      isFallback: false,
    };
  }
  return {
    address: ensureStartAdresCountry(PARTNER_DEFAULT_START_ADRES, "NL"),
    label: PARTNER_DEFAULT_START_LABEL,
    isFallback: true,
  };
}

/**
 * Adviseurs die maandag níet naar de ochtendmeeting komen:
 * - startadres blijft hun persoonlijke adres (geen Daltonlaan)
 * - maandag 10:00 is open (niet hard geblokkeerd)
 */
export const SKIP_MAANDAG_OCHTENDMEETING_ADVISEUR_IDS = new Set<string>([
  "1925468e-5645-44a0-a6fc-962b95d0f46c", // Marcel Klaasman (Sluis)
]);

export function skipsMaandagOchtendmeeting(
  adviseurId: string | null | undefined
): boolean {
  return Boolean(
    adviseurId && SKIP_MAANDAG_OCHTENDMEETING_ADVISEUR_IDS.has(adviseurId)
  );
}

/** True als de kalenderdag (Amsterdam) een maandag is. */
export function isAmsterdamMonday(day: Date | string): boolean {
  let ymd: string;
  if (typeof day === "string" && /^\d{4}-\d{2}-\d{2}/.test(day.trim())) {
    ymd = day.trim().slice(0, 10);
  } else {
    const d = day instanceof Date ? day : new Date(day);
    if (Number.isNaN(d.getTime())) return false;
    ymd = formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
  }
  const [y, m, d] = ymd.split("-").map(Number);
  const noon = fromZonedTime(new Date(y, m - 1, d, 12, 0, 0, 0), AMSTERDAM_TZ);
  // ISO day: 1 = maandag
  return formatInTimeZone(noon, AMSTERDAM_TZ, "i") === "1";
}

/**
 * Land voor geocoding/reistijd.
 * Let op: 4 cijfers zonder letters is ambigu (NL PC4 óf BE).
 * Bekende NL-plaatsen (Sluis, Axel, …) winnen van een losse “België”-suffix.
 */
const NL_GRENS_PLAATSEN =
  /\b(sluis|breskens|oostburg|cadzand|aalst|axel|terneuzen|hulst|sas van gent|koewacht|philippine|biervliet|ijsendoorn|middelburg|vlissingen|goes|yerseke)\b/i;

export function detectStartAdresLand(
  address: string | null | undefined
): StartAdresLand | null {
  const t = (address || "").trim();
  if (!t) return null;

  // NL-postcode met letters = altijd NL
  if (/\b\d{4}\s*[A-Za-z]{2}\b/.test(t)) return "NL";

  // Zeeuws-Vlaanderen / bekende NL-grensplaatsen: niet per ongeluk BE
  if (NL_GRENS_PLAATSEN.test(t)) return "NL";

  if (/\b(nederland|netherlands)\b/i.test(t) || /,\s*NL\s*$/i.test(t)) {
    return "NL";
  }
  if (/\b(belgi[eë]|belgium)\b/i.test(t) || /,\s*BE\s*$/i.test(t)) {
    return "BE";
  }
  return null;
}

/**
 * Bruikbaar voor geocoding/reistijd: straat + huisnummer + postcode/plaats.
 * "Sint Annastraat Sluis" zonder nummer → niet ok.
 */
export function isUsableStartAdres(
  address: string | null | undefined
): boolean {
  const t = (address || "").trim();
  if (!t || t === "—") return false;
  if (t.length < 8) return false;
  if (!/\d/.test(t)) return false; // huisnummer of postcode
  const parts = t.split(/[,\s]+/).filter(Boolean);
  return parts.length >= 3;
}

/** Land toevoegen / corrigeren (helpt Google Geocoding). */
export function ensureStartAdresCountry(
  address: string,
  land?: StartAdresLand | null
): string {
  const t = address.trim();
  if (!t) return t;
  const detected = land || detectStartAdresLand(t);
  // Verkeerde land-suffix corrigeren (bijv. Sluis + “België”)
  if (detected === "NL" && /\b(belgi[eë]|belgium)\b/i.test(t)) {
    return t
      .replace(/,?\s*(belgi[eë]|belgium)\s*$/i, "")
      .replace(/,?\s*BE\s*$/i, "")
      .trim()
      .concat(", Nederland");
  }
  if (detected === "BE" && /\b(nederland|netherlands)\b/i.test(t)) {
    return t
      .replace(/,?\s*(nederland|netherlands)\s*$/i, "")
      .replace(/,?\s*NL\s*$/i, "")
      .trim()
      .concat(", België");
  }
  if (/\b(nederland|netherlands|belgi[eë]|belgium)\b/i.test(t)) return t;
  if (/,\s*(NL|BE)\s*$/i.test(t)) return t;
  if (detected === "BE") return `${t}, België`;
  if (detected === "NL") return `${t}, Nederland`;
  return t;
}

/**
 * Vertrekpunt voor de eerste afspraak die dag.
 * Maandag → Daltonlaan 500 (ochtendmeeting), tenzij adviseur de meeting overslaat;
 * anders persoonlijk startadres. Terugreis eind van de dag blijft persoonlijk.
 */
export function resolveDayStartAdres(
  homeStartAdres: string | null | undefined,
  day: Date | string,
  adviseurId?: string | null
): {
  address: string | null;
  label: string | null;
  isMondayMeeting: boolean;
} {
  if (isAmsterdamMonday(day) && !skipsMaandagOchtendmeeting(adviseurId)) {
    return {
      address: ensureStartAdresCountry(MAANDAG_MEETING_START_ADRES, "NL"),
      label: MAANDAG_MEETING_START_LABEL,
      isMondayMeeting: true,
    };
  }
  const t = (homeStartAdres || "").trim();
  if (!t || t === "—" || !isUsableStartAdres(t)) {
    return { address: null, label: null, isMondayMeeting: false };
  }
  return {
    address: ensureStartAdresCountry(t),
    label: null,
    isMondayMeeting: false,
  };
}
