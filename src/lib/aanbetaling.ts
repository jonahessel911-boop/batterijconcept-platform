import { financieringMagRestantFactuur } from "@/lib/financiering-status";

/** BTW-tarief op de aanbetalingsfactuur. */
export const AANBETALING_BTW_PERCENTAGE = 21;

/** Warmtefonds-plafond bij de aanvraag (max. wat WF dekt). */
export const RESTANT_VAST_INC_BTW = 8500;

export type AanbetalingModus = "restant" | "btw" | "handmatig" | "helft";

/** Standaard bij Warmtefonds: klant betaalt de BTW. */
export const DEFAULT_AANBETALING_MODUS: AanbetalingModus = "btw";

/** Eigen middelen: 50% vooraf, 50% na installatie. */
export const EIGEN_MIDDELEN_AANBETALING_MODUS: AanbetalingModus = "helft";

export const AANBETALING_MODUS_OPTIES: {
  value: AanbetalingModus;
  label: string;
  hint: string;
}[] = [
  {
    value: "btw",
    label: "BTW-bedrag (standaard)",
    hint: "Aanbetaling = 21% btw van de order. Warmtefonds-aanvraag max. € 8.500.",
  },
  {
    value: "restant",
    label: "Restant max. € 8.500",
    hint: "Aanbetaling = order incl. − Warmtefonds-deel (max. € 8.500).",
  },
  {
    value: "handmatig",
    label: "Handmatig bedrag",
    hint: "Stel zelf het aanbetalingsbedrag incl. btw in.",
  },
];

/** Eigen middelen: saler kiest 50%, 100% of custom eerste aanbetaling. */
export const EIGEN_MIDDELEN_AANBETALING_OPTIES: {
  value: "helft" | "volledig" | "handmatig";
  label: string;
  hint: string;
}[] = [
  {
    value: "helft",
    label: "50% vooraf / 50% na installatie",
    hint: "Standaard eigen middelen.",
  },
  {
    value: "volledig",
    label: "100% vooraf",
    hint: "Hele orderbedrag als aanbetaling; geen restant na installatie.",
  },
  {
    value: "handmatig",
    label: "Ander bedrag / percentage",
    hint: "Bijv. 25% voor schouw. Meerfasenplan noteer je bij backoffice-notitie.",
  },
];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Warmtefonds-plafond voor de aanvraag: max € 8.500,
 * nooit hoger dan wat na de aanbetaling nog openstaat.
 */
export function warmtefondsAanvraagIncBtw(naAanbetalingInc: number): number {
  return round2(
    Math.max(0, Math.min(RESTANT_VAST_INC_BTW, round2(naAanbetalingInc)))
  );
}

/**
 * @deprecated gebruik warmtefondsAanvraagIncBtw — zelfde plafond op order excl.
 */
export function warmtefondsRestantIncBtw(orderExBtw: number): number {
  return warmtefondsAanvraagIncBtw(orderExBtw);
}

/** Restantfactuur (Warmtefonds) mag pas na goedkeuring. */
export function magWarmtefondsRestantFactuur(
  financieringStatus: string | null | undefined
): boolean {
  return financieringMagRestantFactuur(
    financieringStatus as Parameters<typeof financieringMagRestantFactuur>[0]
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
  return /restantfactuur|restbetaling|eindfactuur|restant bij/i.test(
    omschrijving || ""
  );
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
 * Order volledig betaald = som van betaalde klantfacturen dekt het
 * offertebedrag (incl. btw), én geen openstaande facturen.
 * Creditfacturen en concepten tellen niet mee als dekking.
 */
export function isOrderVolledigBetaald(opts: {
  facturen: {
    status: string;
    bedrag_inc_btw: number | null;
    omschrijving?: string | null;
    credit_van_factuur_id?: string | null;
  }[];
  orderIncBtw?: number | null;
}): boolean {
  const progress = orderBetalingProgress(opts);
  return progress.volledig;
}

/** Klant-betalingsvoortgang t.o.v. offertebedrag (incl. btw). */
export function orderBetalingProgress(opts: {
  facturen: {
    status: string;
    bedrag_inc_btw: number | null;
    omschrijving?: string | null;
    credit_van_factuur_id?: string | null;
  }[];
  orderIncBtw?: number | null;
}): {
  orderInc: number;
  betaaldInc: number;
  pct: number;
  volledig: boolean;
} {
  const orderInc = round2(Number(opts.orderIncBtw) || 0);
  const facs = opts.facturen.filter(
    (f) => !f.credit_van_factuur_id && f.status !== "vervallen"
  );

  const betaaldInc = round2(
    facs
      .filter((f) => f.status === "betaald")
      .reduce((s, f) => s + (Number(f.bedrag_inc_btw) || 0), 0)
  );

  const open = facs.filter(
    (f) => f.status === "verzonden" || f.status === "deels_betaald"
  );

  let volledig = false;
  if (orderInc > 0 && open.length === 0 && betaaldInc > 0) {
    const teFactureren = nogTeFacturerenRestant({
      orderIncBtw: orderInc,
      facturen: facs.map((f) => ({
        status: f.status,
        bedrag_inc_btw: Number(f.bedrag_inc_btw) || 0,
        omschrijving: f.omschrijving,
      })),
    });
    volledig = teFactureren <= 1 && betaaldInc + 1 >= orderInc;
  }

  const pct =
    orderInc > 0
      ? Math.min(100, Math.round((betaaldInc / orderInc) * 100))
      : 0;

  return {
    orderInc,
    betaaldInc,
    pct: volledig ? 100 : pct,
    volledig,
  };
}

/**
 * Bedrag voor restantfactuur.
 * Warmtefonds: aanvraagdeel max € 8.500, nooit hoger dan wat nog openstaat.
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
  return warmtefondsAanvraagIncBtw(open);
}

export type Aanbetaling = {
  modus: AanbetalingModus;
  btwPercentage: number;
  bedragExBtw: number;
  btwBedrag: number;
  /** Aanbetaling incl. btw (klant) */
  bedragIncBtw: number;
  /** Alles na de aanbetaling (vóór WF-plafond) */
  restantIncBtw: number;
  /** Warmtefonds-aanvraag: max € 8.500 van het restant */
  warmtefondsIncBtw: number;
  /** Wat na aanbetaling + WF-plafond nog open kan blijven */
  overigNaWarmtefondsIncBtw: number;
  orderExBtw: number;
  orderBtw: number;
  orderIncBtw: number;
};

export function normalizeAanbetalingModus(
  value: string | null | undefined
): AanbetalingModus {
  if (
    value === "btw" ||
    value === "handmatig" ||
    value === "restant" ||
    value === "helft"
  ) {
    return value;
  }
  // Legacy / UI-alias: 100% vooraf → handmatig (bedrag = order)
  if (value === "volledig") return "handmatig";
  return DEFAULT_AANBETALING_MODUS;
}

/** UI-keuze eigen middelen (volledig = 100% via handmatig + orderbedrag). */
export function eigenMiddelenUiKeuze(
  modus: AanbetalingModus,
  handmatigIncBtw: number,
  orderIncBtw: number
): "helft" | "volledig" | "handmatig" {
  if (modus === "helft") return "helft";
  if (modus !== "handmatig") return "helft";
  const order = round2(orderIncBtw);
  const hand = round2(handmatigIncBtw);
  if (order > 0 && Math.abs(hand - order) < 0.02) return "volledig";
  return "handmatig";
}

/**
 * Aanbetaling berekenen.
 * Warmtefonds: BTW / restant / handmatig (/ helft).
 * Eigen middelen: helft (50%), handmatig (custom / 100% via bedrag = order).
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

  const warmtefonds = Boolean(opts.financieringVoorbehoud);
  const rawModus = normalizeAanbetalingModus(opts.modus);
  // Eigen middelen: alleen helft of handmatig (btw/restant → helft)
  const modus = warmtefonds
    ? rawModus
    : rawModus === "handmatig"
      ? "handmatig"
      : EIGEN_MIDDELEN_AANBETALING_MODUS;

  let bedragIncBtw = 0;
  if (modus === "handmatig") {
    const raw = round2(Number(opts.handmatigIncBtw) || 0);
    bedragIncBtw = round2(Math.min(Math.max(0, raw), orderIncBtw));
  } else if (modus === "helft") {
    bedragIncBtw = round2(orderIncBtw / 2);
  } else if (modus === "btw" && warmtefonds) {
    bedragIncBtw = round2(Math.min(orderBtw, orderIncBtw));
  } else if (warmtefonds) {
    const restant = warmtefondsRestantIncBtw(orderExBtw);
    bedragIncBtw = round2(Math.max(0, orderIncBtw - restant));
  } else {
    bedragIncBtw = round2(orderIncBtw / 2);
  }

  const split = splitIncToExBtw(bedragIncBtw);
  const restantIncBtw = round2(Math.max(0, orderIncBtw - split.inc));
  const warmtefondsIncBtw = warmtefonds
    ? warmtefondsAanvraagIncBtw(restantIncBtw)
    : 0;
  const overigNaWarmtefondsIncBtw = warmtefonds
    ? round2(Math.max(0, restantIncBtw - warmtefondsIncBtw))
    : restantIncBtw;

  return {
    modus,
    btwPercentage: AANBETALING_BTW_PERCENTAGE,
    bedragExBtw: split.ex,
    btwBedrag: split.btw,
    bedragIncBtw: split.inc,
    restantIncBtw,
    warmtefondsIncBtw,
    overigNaWarmtefondsIncBtw,
    orderExBtw,
    orderBtw,
    orderIncBtw,
  };
}

/**
 * Geen aanbetalingsfactuur / geen opstart-aanbetaling-taak.
 * Bron: expliciet `te_innen = 0` (na Actie afronden), of berekend bedrag ≤ 0
 * (handmatig €0).
 */
export function heeftGeenAanbetalingNodig(opts: {
  aanbetalingTeInnenInc?: number | null;
  aanbetalingModus?: AanbetalingModus | string | null;
  aanbetalingBedragInc?: number | null;
  subtotaalExBtw?: number | null;
  btwBedrag?: number | null;
  totaalIncBtw?: number | null;
  financieringVoorbehoud?: boolean | null;
}): boolean {
  if (
    opts.aanbetalingTeInnenInc != null &&
    Number.isFinite(Number(opts.aanbetalingTeInnenInc))
  ) {
    return Number(opts.aanbetalingTeInnenInc) <= 0;
  }
  if (
    opts.subtotaalExBtw == null &&
    opts.totaalIncBtw == null &&
    opts.aanbetalingBedragInc == null
  ) {
    return false;
  }
  const a = aanbetalingVanOrder({
    subtotaalExBtw: Number(opts.subtotaalExBtw) || 0,
    btwBedrag: opts.btwBedrag ?? undefined,
    totaalIncBtw: opts.totaalIncBtw ?? undefined,
    modus: opts.aanbetalingModus,
    handmatigIncBtw: opts.aanbetalingBedragInc,
    financieringVoorbehoud: opts.financieringVoorbehoud,
  });
  return a.bedragIncBtw <= 0;
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
