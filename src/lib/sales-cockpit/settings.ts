/** Praktische startregels voor de cockpit. Geen statistisch bewijs. */

export type CockpitSettings = {
  convIndicatie: number;
  convStevig: number;
  uitvoeringIndicatie: number;
  uitvoeringStevig: number;
  dealIndicatie: number;
  dealStevig: number;
  niveauWeken: number;
  vergelijkWeken: number;
  trendWeken: number;
  conversieTrendPp: number;
  gesprekAfwijkingPp: number;
  gesprekOnderzoekPp: number;
  afboekHerhaling: number;
  afboekVensterWeken: number;
  uitvalPp: number;
  uitvalVensterDagen: number;
  dealsVanafWeek: number;
  dealsPerWeek: number;
  beschikbaarMin: number;
  aanbetalingDagen: number;
};

export const DEFAULT_COCKPIT_SETTINGS: CockpitSettings = {
  convIndicatie: 10,
  convStevig: 30,
  uitvoeringIndicatie: 15,
  uitvoeringStevig: 30,
  dealIndicatie: 10,
  dealStevig: 20,
  niveauWeken: 4,
  vergelijkWeken: 4,
  trendWeken: 12,
  conversieTrendPp: 10,
  gesprekAfwijkingPp: 10,
  gesprekOnderzoekPp: 15,
  afboekHerhaling: 2,
  afboekVensterWeken: 4,
  uitvalPp: 10,
  uitvalVensterDagen: 30,
  dealsVanafWeek: 3,
  dealsPerWeek: 3,
  beschikbaarMin: 15,
  aanbetalingDagen: 7,
};

const INT_KEYS = Object.keys(DEFAULT_COCKPIT_SETTINGS) as (keyof CockpitSettings)[];

export function parseCockpitSettings(raw: unknown): CockpitSettings {
  const out = { ...DEFAULT_COCKPIT_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const key of INT_KEYS) {
    const n = Number(src[key]);
    if (Number.isFinite(n) && n >= 0 && n <= 365) out[key] = Math.round(n);
  }
  return out;
}
