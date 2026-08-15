import { ALPHA_ESS_93, type AdviesAnswers } from "./types";

export interface KostenBerekening {
  terugleverKwhJaar: number;
  huidigeKostenJaar: number;
  huidigeKostenMaand: number;
  kosten2027Jaar: number;
  kosten2027Maand: number;
  verschilMaand: number;
  besparingMetBatterijMaand: number;
  verdienenMetBatterijMaand: number;
  nieuweSituatieMaand: number;
}

export function calcTerugleverKwh(a: AdviesAnswers): number {
  const verbruik = a.jaarverbruikKwh ?? 0;
  const terug = a.teruglevering ?? 0;
  if (a.terugleveringIsProcent) {
    return Math.round((verbruik * Math.min(100, Math.max(0, terug))) / 100);
  }
  return Math.max(0, terug);
}

/**
 * Vereenvoudigde sales-berekening:
 * - Nu (met saldering): nettokosten ≈ (verbruik - teruglever) * prijs + teruglever * kleine fee
 * - Vanaf 2027: teruglever waard weinig; terugleverkosten + inkoop volledig
 */
export function berekenKosten(a: AdviesAnswers): KostenBerekening {
  const verbruik = a.jaarverbruikKwh ?? 0;
  const prijs = a.prijsPerKwh ?? 0.28;
  const terugFee = a.terugleverkostenPerKwh ?? 0.11;
  const terugKwh = calcTerugleverKwh(a);

  // Met saldering: afname na saldering + milde terugleverkosten
  const nettoAfnameNu = Math.max(0, verbruik - terugKwh);
  const huidigeKostenJaar =
    nettoAfnameNu * prijs + terugKwh * Math.min(terugFee, 0.02);
  const huidigeKostenMaand = huidigeKostenJaar / 12;

  // Zonder saldering 2027: volledige afname + terugleverkosten, teruglever ~€0,05
  const terugWaarde2027 = 0.05;
  const kosten2027Jaar =
    verbruik * prijs + terugKwh * terugFee - terugKwh * terugWaarde2027;
  const kosten2027Maand = kosten2027Jaar / 12;

  const verschilMaand = kosten2027Maand - huidigeKostenMaand;

  // Batterij + EMS: ~70% van teruglever zelf gebruiken of handelen
  const nuttigKwh = terugKwh * 0.7;
  const besparingZelf = (nuttigKwh * prijs) / 12;
  const handelWinst = (nuttigKwh * 0.08) / 12; // EMS spread
  const terugFeeBesparing = (terugKwh * terugFee * 0.85) / 12;
  const verdienenMetBatterijMaand = besparingZelf + handelWinst + terugFeeBesparing;
  const nieuweSituatieMaand = Math.max(
    0,
    kosten2027Maand - verdienenMetBatterijMaand
  );
  const besparingMetBatterijMaand = kosten2027Maand - nieuweSituatieMaand;

  return {
    terugleverKwhJaar: terugKwh,
    huidigeKostenJaar,
    huidigeKostenMaand,
    kosten2027Jaar,
    kosten2027Maand,
    verschilMaand,
    besparingMetBatterijMaand,
    verdienenMetBatterijMaand,
    nieuweSituatieMaand,
  };
}

export function productPrijs() {
  const prijsEx = ALPHA_ESS_93.prijsExBtw;
  const btw = (prijsEx * ALPHA_ESS_93.btwPercentage) / 100;
  const prijsInc = prijsEx + btw;
  return { prijsEx, btw, prijsInc };
}

export function maandprijsNaSubsidie(looptijdMaanden: number): number {
  const { prijsEx } = productPrijs();
  const maanden = Math.max(1, looptijdMaanden || 15);
  return prijsEx / maanden;
}

export function formatEuroNl(n: number, digits = 2): string {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}
