/** Merken waarvoor monteur-ervaring kan worden aangevinkt. */
export const INSTALLATIE_MERKEN = [
  "Alpha ESS",
  "Signenergy",
  "FoxESS",
  "Tesla",
  "BYD",
  "Solaredge",
  "Enphase",
  "Marstek",
  "Dyness",
] as const;

export type InstallatieMerk = (typeof INSTALLATIE_MERKEN)[number];

export function normalizeMerkenErvaring(
  raw: unknown
): InstallatieMerk[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(INSTALLATIE_MERKEN);
  const out: InstallatieMerk[] = [];
  for (const item of raw) {
    const s = String(item || "").trim();
    if (allowed.has(s) && !out.includes(s as InstallatieMerk)) {
      out.push(s as InstallatieMerk);
    }
  }
  return out;
}
