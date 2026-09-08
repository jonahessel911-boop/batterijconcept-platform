/**
 * Cash-logica per order bij BTW-aanbetaling:
 * - Eerste betaling (vaak alleen btw) → btw-reserve, niet vrij besteedbaar, inkoop geblokkeerd
 * - Pas bij 100% betaald → inkoop vrijgegeven; inkoop gereserveerd; marge = vrije cash
 *
 * Let op: definitieve btw-reserve hangt ook af van aftrekbare btw op inkoopfacturen
 * (boekhouder / aangifte-moment).
 */
import { factuurIsBetaald } from "@/lib/aanbetaling";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type FactuurBetalingInput = {
  status: string;
  bedrag_inc_btw: number;
  betaald_op?: string | null;
  credit_van_factuur_id?: string | null;
};

export type ProjectBetalingCash = {
  orderExBtw: number;
  orderBtw: number;
  orderIncBtw: number;
  /** Netto ontvangen van klant (betaalde facturen − betaalde credits). */
  ontvangenIncBtw: number;
  nogTeOntvangenIncBtw: number;
  /** 0–100, capped. */
  betaaldPct: number;
  volledigBetaald: boolean;
  /** Tot order-btw, zolang er ontvangen is. */
  btwReserve: number;
  /** Geschatte inkoop ex btw die gereserveerd wordt bij volledige betaling. */
  inkoopExBtw: number;
  /**
   * Niet volledig: max(0, ontvangen − btwReserve).
   * Volledig: max(0, orderEx − inkoop) = marge.
   */
  vrijBesteedbaar: number;
  /** Alleen bij 100% betaald. */
  inkoopGereserveerd: number;
  inkoopUnlocked: boolean;
};

export function nettoOntvangenIncBtw(
  facturen: FactuurBetalingInput[]
): number {
  let sum = 0;
  for (const f of facturen) {
    if (!factuurIsBetaald(f.status, f.betaald_op)) continue;
    const bedrag = round2(Math.abs(Number(f.bedrag_inc_btw) || 0));
    if (f.credit_van_factuur_id) sum = round2(sum - bedrag);
    else sum = round2(sum + bedrag);
  }
  return Math.max(0, sum);
}

export function buildProjectBetalingCash(opts: {
  orderExBtw: number;
  orderBtw?: number | null;
  orderIncBtw?: number | null;
  facturen: FactuurBetalingInput[];
  inkoopExBtw: number;
}): ProjectBetalingCash {
  const orderExBtw = round2(Math.max(0, Number(opts.orderExBtw) || 0));
  const orderBtw =
    opts.orderBtw != null && Number.isFinite(Number(opts.orderBtw))
      ? round2(Math.max(0, Number(opts.orderBtw)))
      : round2(orderExBtw * 0.21);
  const orderIncBtw =
    opts.orderIncBtw != null && Number(opts.orderIncBtw) > 0
      ? round2(Number(opts.orderIncBtw))
      : round2(orderExBtw + orderBtw);

  const ontvangenIncBtw = nettoOntvangenIncBtw(opts.facturen);
  const nogTeOntvangenIncBtw = round2(
    Math.max(0, orderIncBtw - ontvangenIncBtw)
  );
  const betaaldPct =
    orderIncBtw > 0
      ? round2(Math.min(100, (ontvangenIncBtw / orderIncBtw) * 100))
      : 0;
  const volledigBetaald =
    orderIncBtw <= 0 ? false : ontvangenIncBtw + 0.01 >= orderIncBtw;

  const btwReserve = round2(Math.min(ontvangenIncBtw, orderBtw));
  const inkoopExBtw = round2(Math.max(0, Number(opts.inkoopExBtw) || 0));

  const vrijBesteedbaar = volledigBetaald
    ? round2(Math.max(0, orderExBtw - inkoopExBtw))
    : round2(Math.max(0, ontvangenIncBtw - btwReserve));

  const inkoopGereserveerd = volledigBetaald ? inkoopExBtw : 0;

  return {
    orderExBtw,
    orderBtw,
    orderIncBtw,
    ontvangenIncBtw,
    nogTeOntvangenIncBtw,
    betaaldPct,
    volledigBetaald,
    btwReserve,
    inkoopExBtw,
    vrijBesteedbaar,
    inkoopGereserveerd,
    inkoopUnlocked: volledigBetaald,
  };
}
