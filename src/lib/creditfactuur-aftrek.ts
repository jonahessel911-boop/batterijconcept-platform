/**
 * Aftrek / correctie op concept-creditfacturen (adviseur of partner).
 * Schrijft een negatieve REGELS_JSON-regel en herberekent het bedrag excl. btw.
 */

import { bedragenMetBtw } from "@/lib/relatie-btw";

export const REGELS_JSON_PREFIX = "REGELS_JSON:";

export type CreditRegel = {
  omschrijving: string;
  bedrag: number;
};

export function parseCreditRegels(
  notities: string | null | undefined
): CreditRegel[] | null {
  if (!notities) return null;
  const line = notities
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith(REGELS_JSON_PREFIX));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(REGELS_JSON_PREFIX.length));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed.map((r: { omschrijving?: string; bedrag?: number }) => ({
      omschrijving: String(r.omschrijving || "Regel"),
      bedrag: Math.round((Number(r.bedrag) || 0) * 100) / 100,
    }));
  } catch {
    return null;
  }
}

function humanNotesWithoutRegels(notities: string | null | undefined): string {
  if (!notities) return "";
  return notities
    .split("\n")
    .filter((l) => !l.trim().startsWith(REGELS_JSON_PREFIX))
    .join("\n")
    .trim();
}

export function encodeCreditRegels(regels: CreditRegel[]): string {
  return `${REGELS_JSON_PREFIX}${JSON.stringify(regels)}`;
}

/**
 * Voeg een aftrekregel toe (aftrekEx > 0 = bedrag dat eraf gaat).
 */
export function applyAftrekToCreditfactuur(opts: {
  notities: string | null | undefined;
  currentEx: number;
  aftrekEx: number;
  omschrijving?: string | null;
  basisOmschrijving?: string | null;
}): {
  notities: string;
  regels: CreditRegel[];
  bedrag_ex_btw: number;
  btw_bedrag: number;
  bedrag_inc_btw: number;
} {
  const aftrek = Math.round(Math.abs(Number(opts.aftrekEx) || 0) * 100) / 100;
  if (!(aftrek > 0)) {
    throw new Error("Aftrekbedrag moet groter dan 0 zijn");
  }

  const current = Math.round((Number(opts.currentEx) || 0) * 100) / 100;
  let regels = parseCreditRegels(opts.notities);
  if (!regels || regels.length === 0) {
    regels = [
      {
        omschrijving:
          opts.basisOmschrijving?.trim() || "Vergoeding / commissie",
        bedrag: current,
      },
    ];
  }

  const label =
    opts.omschrijving?.trim() ||
    `Aftrek / correctie (−${aftrek.toLocaleString("nl-NL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })})`;

  regels = [
    ...regels,
    {
      omschrijving: label.startsWith("Aftrek") ? label : `Aftrek · ${label}`,
      bedrag: -aftrek,
    },
  ];

  const bedragEx =
    Math.round(regels.reduce((s, r) => s + (Number(r.bedrag) || 0), 0) * 100) /
    100;
  if (bedragEx < 0) {
    throw new Error("Factuurbedrag mag niet onder €0 komen");
  }

  const human = humanNotesWithoutRegels(opts.notities);
  const noteLine = `Aftrek €${aftrek.toLocaleString("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}: ${label}.`;
  const notities = `${encodeCreditRegels(regels)}\n${[human, noteLine]
    .filter(Boolean)
    .join("\n")
    .trim()}`;

  const withBtw = bedragenMetBtw(bedragEx);
  return {
    notities,
    regels,
    ...withBtw,
  };
}

/**
 * Vervang alle regels van een concept (bewerken / regel verwijderen).
 */
export function replaceCreditRegels(opts: {
  notities: string | null | undefined;
  regels: CreditRegel[];
}): {
  notities: string;
  regels: CreditRegel[];
  bedrag_ex_btw: number;
  btw_bedrag: number;
  bedrag_inc_btw: number;
} {
  const regels = (opts.regels || [])
    .map((r) => ({
      omschrijving: String(r.omschrijving || "").trim() || "Regel",
      bedrag: Math.round((Number(r.bedrag) || 0) * 100) / 100,
    }))
    .filter((r) => r.omschrijving.length > 0);

  if (regels.length === 0) {
    throw new Error("Minstens één regel is verplicht");
  }

  const bedragEx =
    Math.round(regels.reduce((s, r) => s + (Number(r.bedrag) || 0), 0) * 100) /
    100;
  if (bedragEx < 0) {
    throw new Error("Factuurbedrag mag niet onder €0 komen");
  }

  const human = humanNotesWithoutRegels(opts.notities);
  const notities = `${encodeCreditRegels(regels)}\n${human}`.trim();
  const withBtw = bedragenMetBtw(bedragEx);
  return {
    notities,
    regels,
    ...withBtw,
  };
}
