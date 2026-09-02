/** BTW-tarief op de aanbetalingsfactuur. */
export const AANBETALING_BTW_PERCENTAGE = 21;

/** Warmtefonds-plafond (incl. btw) bij modus `restant`. */
export const RESTANT_VAST_INC_BTW = 8500;

export type AanbetalingModus = "restant" | "btw" | "handmatig";

export const AANBETALING_MODUS_OPTIES: {
  value: AanbetalingModus;
  label: string;
  hint: string;
}[] = [
  {
    value: "restant",
    label: "Restant max. € 8.500",
    hint: "Aanbetaling = order incl. − Warmtefonds-deel (max. € 8.500, nooit meer dan order excl. btw).",
  },
  {
    value: "btw",
    label: "BTW-bedrag",
    hint: "Aanbetaling = 21% btw van de order.",
  },
  {
    value: "handmatig",
    label: "Handmatig bedrag",
    hint: "Stel zelf het aanbetalingsbedrag incl. btw in.",
  },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Warmtefonds-restant: vast plafond € 8.500, maar nooit hoger dan order excl. btw
 * (je kunt geen groter Warmtefonds-deel hebben dan de order zonder btw).
 */
export function warmtefondsRestantIncBtw(orderExBtw: number): number {
  return round2(
    Math.max(0, Math.min(RESTANT_VAST_INC_BTW, round2(orderExBtw)))
  );
}

export function parseEuroInput(raw: string): number {
  return Number(String(raw).replace(/\s/g, "").replace(",", ".")) || 0;
}

export function splitIncToExBtw(inc: number): {
  ex: number;
  btw: number;
  inc: number;
} {
  const bedragIncBtw = round2(Math.max(0, inc));
  const bedragExBtw = round2(
    bedragIncBtw / (1 + AANBETALING_BTW_PERCENTAGE / 100)
  );
  return {
    ex: bedragExBtw,
    btw: round2(bedragIncBtw - bedragExBtw),
    inc: bedragIncBtw,
  };
}

export function isAanbetalingFactuurOmschrijving(
  omschrijving: string | null | undefined
): boolean {
  return /aanbetaling|btw-factuur/i.test(omschrijving || "");
}

export function isRestantFactuurOmschrijving(
  omschrijving: string | null | undefined
): boolean {
  return /restantfactuur|eindfactuur|restant bij/i.test(omschrijving || "");
}

/** Order incl. − al gefactureerd (excl. vervallen). Optioneel: negeer restantregels (bij herberekenen concept). */
export function nogTeFacturerenRestant(opts: {
  orderIncBtw: number;
  facturen: {
    status: string;
    bedrag_inc_btw: number;
    omschrijving?: string | null;
  }[];
  /** true = bestaande restantfactuur niet meerekenen (voor bijwerken concept) */
  excludeRestant?: boolean;
}): number {
  const orderIncBtw = round2(opts.orderIncBtw);
  let gefactureerd = 0;
  for (const f of opts.facturen) {
    if (f.status === "vervallen") continue;
    if (opts.excludeRestant && isRestantFactuurOmschrijving(f.omschrijving)) {
      continue;
    }
    gefactureerd = round2(gefactureerd + (Number(f.bedrag_inc_btw) || 0));
  }
  return round2(Math.max(0, orderIncBtw - gefactureerd));
}

/**
 * Bedrag voor restantfactuur.
 * Warmtefonds: Warmtefonds-deel (max € 8.500, capped op order excl.),
 * nooit hoger dan wat nog open staat na bestaande facturen.
 */
export function restantFactuurBedrag(opts: {
  orderIncBtw: number;
  orderExBtw?: number | null;
  warmtefonds?: boolean | null;
  facturen: {
    status: string;
    bedrag_inc_btw: number;
    omschrijving?: string | null;
  }[];
  excludeRestant?: boolean;
}): number {
  const open = nogTeFacturerenRestant({
    orderIncBtw: opts.orderIncBtw,
    facturen: opts.facturen,
    excludeRestant: opts.excludeRestant,
  });
  if (!opts.warmtefonds) return open;
  const orderEx = round2(Number(opts.orderExBtw) || 0);
  if (orderEx <= 0) return open;
  return round2(Math.min(open, warmtefondsRestantIncBtw(orderEx)));
}

export type Aanbetaling = {
  modus: AanbetalingModus;
  btwPercentage: number;
  bedragExBtw: number;
  btwBedrag: number;
  /** Aanbetaling incl. btw = order − Warmtefonds-deel */
  bedragIncBtw: number;
  /** Wat na de aanbetaling overblijft (Warmtefonds of rest) */
  restantIncBtw: number;
  orderExBtw: number;
  orderBtw: number;
  orderIncBtw: number;
};

export function normalizeAanbetalingModus(
  value: string | null | undefined
): AanbetalingModus {
  if (value === "btw" || value === "handmatig" || value === "restant") {
    return value;
  }
  return "restant";
}

/**
 * Aanbetaling = totaal bedrijfs incl. btw − Warmtefonds-deel.
 * Alleen bij Warmtefonds (`financieringVoorbehoud`). Over de aanbetaling 21% btw.
 */
export function aanbetalingVanOrder(opts: {
  subtotaalExBtw: number;
  btwBedrag?: number;
  totaalIncBtw?: number;
  modus?: AanbetalingModus | string | null;
  handmatigIncBtw?: number | null;
  financieringVoorbehoud?: boolean | null;
}): Aanbetaling {
  const orderExBtw = round2(Number(opts.subtotaalExBtw) || 0);
  const orderBtw =
    opts.btwBedrag != null && Number.isFinite(Number(opts.btwBedrag))
      ? round2(Number(opts.btwBedrag))
      : round2(orderExBtw * (AANBETALING_BTW_PERCENTAGE / 100));
  const orderIncBtw =
    opts.totaalIncBtw != null && Number.isFinite(Number(opts.totaalIncBtw))
      ? round2(Number(opts.totaalIncBtw))
      : round2(orderExBtw + orderBtw);

  const modus = normalizeAanbetalingModus(opts.modus);
  const warmtefonds = Boolean(opts.financieringVoorbehoud);

  let bedragIncBtw = 0;
  if (warmtefonds) {
    if (modus === "btw") {
      bedragIncBtw = round2(Math.min(orderBtw, orderIncBtw));
    } else if (modus === "handmatig") {
      const raw = round2(Number(opts.handmatigIncBtw) || 0);
      bedragIncBtw = round2(Math.min(Math.max(0, raw), orderIncBtw));
    } else {
      const restant = warmtefondsRestantIncBtw(orderExBtw);
      bedragIncBtw = round2(Math.max(0, orderIncBtw - restant));
    }
  }

  const split = splitIncToExBtw(bedragIncBtw);
  const restantIncBtw = round2(Math.max(0, orderIncBtw - split.inc));

  return {
    modus,
    btwPercentage: AANBETALING_BTW_PERCENTAGE,
    bedragExBtw: split.ex,
    btwBedrag: split.btw,
    bedragIncBtw: split.inc,
    restantIncBtw,
    orderExBtw,
    orderBtw,
    orderIncBtw,
  };
}

export function factuurIsBetaald(status: string, betaaldOp?: string | null): boolean {
  if (status === "betaald") return true;
  return Boolean(betaaldOp);
}

/** Nog te innen = order incl. minus reeds ontvangen facturen. */
export function openstaandOpOrder(opts: {
  orderIncBtw: number;
  facturen: { status: string; bedrag_inc_btw: number; betaald_op?: string | null }[];
}): {
  orderIncBtw: number;
  reedsBetaald: number;
  openstaand: number;
  gefactureerdOpen: number;
} {
  const orderIncBtw = round2(opts.orderIncBtw);
  let reedsBetaald = 0;
  let gefactureerdOpen = 0;
  for (const f of opts.facturen) {
    const bedrag = round2(Number(f.bedrag_inc_btw) || 0);
    if (factuurIsBetaald(f.status, f.betaald_op)) {
      reedsBetaald = round2(reedsBetaald + bedrag);
    } else if (f.status !== "vervallen") {
      gefactureerdOpen = round2(gefactureerdOpen + bedrag);
    }
  }
  return {
    orderIncBtw,
    reedsBetaald,
    openstaand: round2(Math.max(0, orderIncBtw - reedsBetaald)),
    gefactureerdOpen,
  };
}
