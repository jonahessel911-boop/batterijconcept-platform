/**
 * Eindafrekening: zodra de batterij staat, moet het volledige offertebedrag
 * gefactureerd én betaald zijn.
 *
 * Wat er in de praktijk blijft hangen:
 * - Warmtefonds dekt max € 8.500 (RESTANT_VAST_INC_BTW). Order − aanbetaling −
 *   8.500 blijft over en werd nooit gefactureerd. Dat zijn de bedragen van
 *   € 30 tot € 400 die na oplevering openstaan.
 * - Orders zonder aanbetaling (handmatig € 0): dan staat het hele bedrag open.
 *
 * Deze module rekent alleen; aanmaken gebeurt in ensure-btw-factuur.ts.
 * Pure functies — backoffice-acties.ts draait ook in de client.
 */

/** Onder dit bedrag is het afrondingsruis, geen restbetaling. */
export const EINDAFREKENING_MIN_INC = 1;

export type EindafrekeningFactuurLike = {
  status?: string | null;
  bedrag_inc_btw?: number | null;
  omschrijving?: string | null;
  credit_van_factuur_id?: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function isEindafrekeningFactuurOmschrijving(
  omschrijving: string | null | undefined
): boolean {
  return /eindafrekening/i.test(omschrijving || "");
}

/**
 * Batterij staat bij de klant — vanaf hier moet alles gefactureerd zijn.
 * `restfactuur_verstuurd` / `restfactuur_betaald` vallen hier bewust buiten:
 * die liggen vóór de installatie in de keten.
 */
export function isProjectOpgeleverd(
  status: string | null | undefined
): boolean {
  const s = (status || "").toLowerCase();
  return (
    s === "installatie_voltooid" ||
    s === "review_gevraagd" ||
    s === "afgerond" ||
    s === "service"
  );
}

/**
 * Facturen die meetellen als dekking van de order.
 * Creditfacturen staan met een positief bedrag in de database en zouden
 * anders als dekking meetellen; de gecrediteerde factuur staat op `vervallen`.
 */
export function dekkendeFacturen<T extends EindafrekeningFactuurLike>(
  facturen: T[]
): T[] {
  return facturen.filter(
    (f) => !f.credit_van_factuur_id && f.status !== "vervallen"
  );
}

export type EindafrekeningStand = {
  /** Offertebedrag incl. btw. */
  orderIncBtw: number;
  /** Staat op een factuur (ook concept). */
  gefactureerdInc: number;
  /** Daadwerkelijk ontvangen. */
  betaaldInc: number;
  /** Staat op geen enkele factuur — hiervoor is een conceptfactuur nodig. */
  teFacturerenInc: number;
  /** Nog niet ontvangen, gefactureerd of niet. */
  openInc: number;
  /** Order volledig gefactureerd én betaald. */
  compleet: boolean;
};

/**
 * @param excludeEindafrekening bestaande concept-eindafrekening niet meetellen
 *   (nodig bij herberekenen van datzelfde concept).
 */
export function eindafrekeningStand(opts: {
  orderIncBtw: number | null | undefined;
  facturen: EindafrekeningFactuurLike[];
  excludeEindafrekening?: boolean;
}): EindafrekeningStand {
  const orderIncBtw = round2(Number(opts.orderIncBtw) || 0);
  const facturen = dekkendeFacturen(opts.facturen);

  let gefactureerdInc = 0;
  let betaaldInc = 0;
  for (const f of facturen) {
    if (
      opts.excludeEindafrekening &&
      isEindafrekeningFactuurOmschrijving(f.omschrijving)
    ) {
      continue;
    }
    const bedrag = Number(f.bedrag_inc_btw) || 0;
    gefactureerdInc = round2(gefactureerdInc + bedrag);
    if (f.status === "betaald") {
      betaaldInc = round2(betaaldInc + bedrag);
    }
  }

  const teFacturerenInc =
    orderIncBtw > 0 ? round2(Math.max(0, orderIncBtw - gefactureerdInc)) : 0;
  const openInc =
    orderIncBtw > 0 ? round2(Math.max(0, orderIncBtw - betaaldInc)) : 0;

  return {
    orderIncBtw,
    gefactureerdInc,
    betaaldInc,
    teFacturerenInc,
    openInc,
    compleet: orderIncBtw > 0 && openInc < EINDAFREKENING_MIN_INC,
  };
}

/** Bedrag voor de conceptfactuur; 0 = niets te factureren. */
export function eindafrekeningBedrag(opts: {
  orderIncBtw: number | null | undefined;
  facturen: EindafrekeningFactuurLike[];
  excludeEindafrekening?: boolean;
}): number {
  const stand = eindafrekeningStand(opts);
  return stand.teFacturerenInc < EINDAFREKENING_MIN_INC
    ? 0
    : stand.teFacturerenInc;
}
