import { addDays, differenceInCalendarDays } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

/** Standaard betaaltermijn na verzenden factuur. */
export const FACTUUR_BETAALTERMIJN_DAGEN = 3;

/** Restantfactuur via Warmtefonds — altijd 14 dagen. */
export const FACTUUR_BETAALTERMIJN_WARMTEFONDS_RESTANT_DAGEN = 14;

export const COMPANY_IBAN_DISPLAY = "NL48 BUNQ 2209 5579 33";
export const COMPANY_IBAN_COMPACT = "NL48BUNQ2209557933";
export const COMPANY_ACCOUNT_NAME = "BatterijConcept";

/** Parse gebruikersinvoer (dagen); fallback bij leeg/ongeldig. */
export function parseBetaaltermijnDagen(
  raw: unknown,
  fallback = FACTUUR_BETAALTERMIJN_DAGEN
): number {
  if (raw == null || raw === "") return fallback;
  const n =
    typeof raw === "string"
      ? Number(raw.trim().replace(",", "."))
      : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  const days = Math.round(n);
  if (days < 0 || days > 365) return fallback;
  return days;
}

/**
 * Betaaltermijn in dagen afleiden uit factuurdatum → vervaldatum.
 * Gebruikt voor PDF-tekst en herberekenen bij versturen.
 */
export function factuurBetaaltermijnDagen(opts: {
  factuurdatum?: string | null;
  vervaldatum?: string | null;
  fallback?: number;
}): number {
  const fallback = opts.fallback ?? FACTUUR_BETAALTERMIJN_DAGEN;
  if (!opts.factuurdatum || !opts.vervaldatum) return fallback;
  const start = toZonedTime(
    new Date(`${opts.factuurdatum.slice(0, 10)}T12:00:00`),
    AMSTERDAM_TZ
  );
  const end = toZonedTime(
    new Date(`${opts.vervaldatum.slice(0, 10)}T12:00:00`),
    AMSTERDAM_TZ
  );
  const days = differenceInCalendarDays(end, start);
  if (!Number.isFinite(days) || days < 0 || days > 365) return fallback;
  return days;
}

/** Vandaag (Amsterdam) + N dagen als YYYY-MM-DD. */
export function amsterdamDatePlusDays(
  from: Date | string,
  days: number
): string {
  const base = typeof from === "string" ? new Date(from) : from;
  const local = toZonedTime(base, AMSTERDAM_TZ);
  const next = addDays(local, days);
  return formatInTimeZone(next, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/** Einde van vervaldag 23:59:59 Amsterdam. */
export function vervaldatumEndOfDay(vervaldatum: string): Date {
  const local = toZonedTime(new Date(`${vervaldatum}T12:00:00`), AMSTERDAM_TZ);
  local.setHours(23, 59, 59, 999);
  return fromZonedTime(local, AMSTERDAM_TZ);
}

export function factuurIsOpenstaand(status: string): boolean {
  return status === "verzonden" || status === "deels_betaald";
}

/**
 * Weergavestatus: als er een creditfactuur bij hoort (of dit ís een credit),
 * toon "credit" i.p.v. verzonden/betaald/vervallen — duidelijkheid in de lijst.
 */
export function factuurDisplayStatus(
  factuur: { status: string; credit_van_factuur_id?: string | null },
  opts?: { heeftCredit?: boolean }
): string {
  if (factuur.credit_van_factuur_id) return "credit";
  if (opts?.heeftCredit) return "credit";
  return factuur.status;
}

/** BTW-teken: creditfacturen verminderen af te dragen BTW. */
export function factuurBtwSigned(factuur: {
  btw_bedrag?: number | null;
  credit_van_factuur_id?: string | null;
}): number {
  const btw = Number(factuur.btw_bedrag) || 0;
  return factuur.credit_van_factuur_id ? -Math.abs(btw) : btw;
}

/**
 * Bijdrage aan af-te-dragen / openstaande BTW.
 * Credits (niet-concept) verlagen altijd de af te dragen BTW.
 */
export function factuurBtwBuckets(factuur: {
  status: string;
  btw_bedrag?: number | null;
  bedrag_inc_btw?: number | null;
  credit_van_factuur_id?: string | null;
}): {
  ontvangenBtw: number;
  openstaandeBtw: number;
  betaaldInc: number;
  openstaandInc: number;
  betaald: boolean;
  open: boolean;
} {
  const empty = {
    ontvangenBtw: 0,
    openstaandeBtw: 0,
    betaaldInc: 0,
    openstaandInc: 0,
    betaald: false,
    open: false,
  };
  if (factuur.status === "concept") return empty;

  const isCredit = Boolean(factuur.credit_van_factuur_id);
  const btw = factuurBtwSigned(factuur);
  const inc = isCredit
    ? -Math.abs(Number(factuur.bedrag_inc_btw) || 0)
    : Number(factuur.bedrag_inc_btw) || 0;

  // Credit: zodra verstuurd/betaald → BTW aftrekken van af te dragen
  if (isCredit) {
    if (
      factuur.status === "verzonden" ||
      factuur.status === "deels_betaald" ||
      factuur.status === "betaald"
    ) {
      return {
        ontvangenBtw: btw,
        openstaandeBtw: 0,
        betaaldInc: factuur.status === "betaald" ? inc : 0,
        openstaandInc: 0,
        betaald: factuur.status === "betaald",
        open: false,
      };
    }
    return empty;
  }

  if (factuur.status === "vervallen") return empty;

  if (factuur.status === "betaald") {
    return {
      ontvangenBtw: btw,
      openstaandeBtw: 0,
      betaaldInc: inc,
      openstaandInc: 0,
      betaald: true,
      open: false,
    };
  }

  if (factuur.status === "verzonden" || factuur.status === "deels_betaald") {
    return {
      ontvangenBtw: 0,
      openstaandeBtw: btw,
      betaaldInc: 0,
      openstaandInc: inc,
      betaald: false,
      open: true,
    };
  }

  return empty;
}

/**
 * Effectieve deadline voor “verlopen” / nabellen:
 * later van vervaldatum en afgesproken_betaaldatum (als gezet).
 * Zo blijft een klantbelofte (bijv. 20ste i.p.v. verval 19de) rustig tot die dag.
 */
export function factuurEffectieveDeadline(opts: {
  vervaldatum?: string | null;
  afgesproken_betaaldatum?: string | null;
}): string | null {
  const verval = opts.vervaldatum?.slice(0, 10) || null;
  const afspraak = opts.afgesproken_betaaldatum?.slice(0, 10) || null;
  if (verval && afspraak) return afspraak > verval ? afspraak : verval;
  return afspraak || verval;
}

/** Verzonden + na effectieve deadline + niet betaald → rood / nabellen. */
export function factuurIsOverdue(opts: {
  status: string;
  vervaldatum?: string | null;
  afgesproken_betaaldatum?: string | null;
  betaald_op?: string | null;
  credit_van_factuur_id?: string | null;
  /** Origineel met creditnota: geen verlopen/nabellen (CREDIT-status). */
  heeftCredit?: boolean;
  now?: Date;
}): boolean {
  if (opts.credit_van_factuur_id) return false;
  if (opts.heeftCredit) return false;
  if (opts.status === "betaald" || opts.betaald_op) return false;
  if (!factuurIsOpenstaand(opts.status)) return false;
  const deadline = factuurEffectieveDeadline(opts);
  if (!deadline) return false;
  const end = vervaldatumEndOfDay(deadline);
  return end.getTime() < (opts.now || new Date()).getTime();
}

/**
 * Backoffice-actie voor openstaande (niet-credit) facturen:
 * - `controleren`: klant gaf een betaaldatum door en die dag is bereikt
 * - `opvolgen`: >1 kalenderdag na vervaldatum, nog geen afgesproken betaaldatum
 */
export function factuurOpvolgActie(opts: {
  status: string;
  vervaldatum?: string | null;
  afgesproken_betaaldatum?: string | null;
  betaald_op?: string | null;
  credit_van_factuur_id?: string | null;
  heeftCredit?: boolean;
  now?: Date;
}): "opvolgen" | "controleren" | null {
  if (opts.credit_van_factuur_id) return null;
  if (opts.heeftCredit) return null;
  if (opts.status === "betaald" || opts.betaald_op) return null;
  if (!factuurIsOpenstaand(opts.status)) return null;

  const now = opts.now || new Date();
  const today = formatInTimeZone(now, AMSTERDAM_TZ, "yyyy-MM-dd");
  const afspraak = opts.afgesproken_betaaldatum?.slice(0, 10) || null;

  if (afspraak) {
    // Vanaf de afgesproken dag: betaling controleren
    if (today >= afspraak) return "controleren";
    return null;
  }

  const verval = opts.vervaldatum?.slice(0, 10) || null;
  if (!verval) return null;

  const daysLate = differenceInCalendarDays(
    toZonedTime(new Date(`${today}T12:00:00`), AMSTERDAM_TZ),
    toZonedTime(new Date(`${verval}T12:00:00`), AMSTERDAM_TZ)
  );
  // Langer dan 1 dag te laat
  if (daysLate > 1) return "opvolgen";
  return null;
}

export function betalingsOmschrijving(offerteNummer?: string | null): string {
  return (offerteNummer || "").trim() || "";
}

/** Marker in factuur.notities: toon bedrijfsadres op PDF. */
export const FACTUUR_ADRES_OP_PDF_MARKER = "[[adres_gegevens_op_factuur]]";

export const FACTUUR_BEDRIJFSADRES_OP_PDF = {
  straat: "Daltonlaan 500",
  postcodePlaats: "3584 BK Utrecht",
} as const;

export function factuurHeeftAdresGegevensOpPdf(
  notities?: string | null
): boolean {
  return Boolean(notities?.includes(FACTUUR_ADRES_OP_PDF_MARKER));
}

export function withFactuurAdresOpPdfMarker(
  notities: string,
  enabled: boolean
): string {
  const cleaned = notities
    .replaceAll(FACTUUR_ADRES_OP_PDF_MARKER, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!enabled) return cleaned;
  return cleaned
    ? `${cleaned}\n${FACTUUR_ADRES_OP_PDF_MARKER}`
    : FACTUUR_ADRES_OP_PDF_MARKER;
}

