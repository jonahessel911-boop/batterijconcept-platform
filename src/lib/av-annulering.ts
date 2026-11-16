/**
 * Algemene Voorwaarden BatterijConcept v4 — Artikel 4A.
 * Annuleringskosten na Definitieve Financieringsgoedkeuring.
 */
export const AV_ANNULERING_ARTIKEL =
  process.env.AV_ANNULERING_ARTIKEL?.trim() || "4A";

/** 20% van het totale orderbedrag (inc. btw). */
export const AV_ANNULERING_PCT = 0.2;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function annuleringskostenIncBtw(totaalIncBtw: number): number {
  const totaal = Number(totaalIncBtw);
  if (!Number.isFinite(totaal) || totaal <= 0) return 0;
  return round2(totaal * AV_ANNULERING_PCT);
}

export type AnnuleringAfrekeningFactuur = {
  status: string;
  bedrag_inc_btw: number | null;
  credit_van_factuur_id?: string | null;
  omschrijving?: string | null;
};

export type AnnuleringAfrekening = {
  orderInc: number;
  kostenInc: number;
  pct: number;
  /** Al door klant betaald (ex. annuleringsfacturen / credits). */
  alBetaaldInc: number;
  /**
   * >0: klant moet nog bijbetalen (extra factuur)
   * <0: terugbetalen aan klant
   *  0: vereffend
   */
  saldoInc: number;
  richting: "bijbetalen" | "terugbetalen" | "vereffend";
};

function isAnnuleringsOmschrijving(omschrijving: string | null | undefined) {
  return /annuleringskosten|annuleringsfactuur/i.test(omschrijving || "");
}

/** Som van betaalde klantfacturen die meetellen t.o.v. de 20%-afrekening. */
export function alBetaaldVoorAnnulering(
  facturen: AnnuleringAfrekeningFactuur[]
): number {
  let sum = 0;
  for (const f of facturen) {
    if (f.credit_van_factuur_id) continue;
    if (f.status === "vervallen" || f.status === "concept") continue;
    if (isAnnuleringsOmschrijving(f.omschrijving)) continue;
    if (f.status !== "betaald") continue;
    sum = round2(sum + (Number(f.bedrag_inc_btw) || 0));
  }
  return sum;
}

/**
 * Afrekening bij annulering ná bedenktijd:
 * 20% order − al betaald → bijbetalen of terugbetalen.
 */
export function annuleringAfrekening(opts: {
  orderIncBtw: number;
  facturen: AnnuleringAfrekeningFactuur[];
}): AnnuleringAfrekening {
  const orderInc = round2(Math.max(0, Number(opts.orderIncBtw) || 0));
  const kostenInc = annuleringskostenIncBtw(orderInc);
  const alBetaaldInc = alBetaaldVoorAnnulering(opts.facturen);
  const saldoInc = round2(kostenInc - alBetaaldInc);
  const richting =
    Math.abs(saldoInc) < 0.01
      ? "vereffend"
      : saldoInc > 0
        ? "bijbetalen"
        : "terugbetalen";

  return {
    orderInc,
    kostenInc,
    pct: Math.round(AV_ANNULERING_PCT * 100),
    alBetaaldInc,
    saldoInc: richting === "vereffend" ? 0 : saldoInc,
    richting,
  };
}
