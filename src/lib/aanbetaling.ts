/** BTW-tarief op de aanbetalingsfactuur. */
export const AANBETALING_BTW_PERCENTAGE = 21;

/** Restant na aanbetaling is altijd dit bedrag (incl. btw), zolang de order minstens zo hoog is. */
export const RESTANT_VAST_INC_BTW = 8500;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type Aanbetaling = {
  btwPercentage: number;
  /** Aanbetaling excl. btw (totaal / 1,21) */
  bedragExBtw: number;
  /** 21% btw over de aanbetaling */
  btwBedrag: number;
  /** Te betalen op de aanbetalingsfactuur = order minus €8.500 */
  bedragIncBtw: number;
  /** Altijd €8.500 als de order minstens zo hoog is, anders het hele orderbedrag */
  restantIncBtw: number;
  orderExBtw: number;
  orderBtw: number;
  orderIncBtw: number;
};

/**
 * Aanbetaling = orderbedrag incl. minus €8.500 restant.
 * Over de aanbetaling wordt 21% btw berekend (bedrag is incl. btw).
 */
export function aanbetalingVanOrder(opts: {
  subtotaalExBtw: number;
  btwBedrag?: number;
  totaalIncBtw?: number;
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

  const restantIncBtw = round2(
    Math.min(RESTANT_VAST_INC_BTW, Math.max(0, orderIncBtw))
  );
  const bedragIncBtw = round2(Math.max(0, orderIncBtw - restantIncBtw));
  const bedragExBtw = round2(
    bedragIncBtw / (1 + AANBETALING_BTW_PERCENTAGE / 100)
  );
  const btwBedrag = round2(bedragIncBtw - bedragExBtw);

  return {
    btwPercentage: AANBETALING_BTW_PERCENTAGE,
    bedragExBtw,
    btwBedrag,
    bedragIncBtw,
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
