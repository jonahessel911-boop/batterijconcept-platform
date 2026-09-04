/**
 * Postcode (NL) → provincie.
 * Op basis van PC4-ranges (CBS/postcode-indeling, voldoende accuraat voor rapportage).
 */

export const NL_PROVINCIES = [
  "Groningen",
  "Fryslân",
  "Drenthe",
  "Overijssel",
  "Flevoland",
  "Gelderland",
  "Utrecht",
  "Noord-Holland",
  "Zuid-Holland",
  "Zeeland",
  "Noord-Brabant",
  "Limburg",
] as const;

export type NlProvincie = (typeof NL_PROVINCIES)[number];

const GEEN_PROVINCIE = "(onbekend)";

/** PC4 start → provincie (aaneengesloten ranges). */
const PC4_RANGES: { from: number; to: number; provincie: NlProvincie }[] = [
  { from: 1000, to: 1299, provincie: "Noord-Holland" },
  { from: 1300, to: 1379, provincie: "Flevoland" },
  { from: 1380, to: 1384, provincie: "Noord-Holland" },
  { from: 1390, to: 1394, provincie: "Noord-Holland" },
  { from: 1395, to: 1397, provincie: "Utrecht" },
  { from: 1398, to: 1427, provincie: "Noord-Holland" },
  { from: 1428, to: 1429, provincie: "Utrecht" },
  { from: 1430, to: 2159, provincie: "Noord-Holland" },
  { from: 2160, to: 2162, provincie: "Zuid-Holland" },
  { from: 2163, to: 2165, provincie: "Noord-Holland" },
  { from: 2170, to: 3381, provincie: "Zuid-Holland" },
  { from: 3400, to: 3460, provincie: "Utrecht" },
  { from: 3461, to: 3461, provincie: "Zuid-Holland" },
  { from: 3462, to: 3769, provincie: "Utrecht" },
  { from: 3770, to: 3794, provincie: "Gelderland" },
  { from: 3795, to: 3795, provincie: "Utrecht" },
  { from: 3800, to: 3999, provincie: "Utrecht" },
  { from: 4000, to: 4199, provincie: "Gelderland" },
  { from: 4200, to: 4209, provincie: "Zuid-Holland" },
  { from: 4210, to: 4213, provincie: "Gelderland" },
  { from: 4214, to: 4214, provincie: "Zuid-Holland" },
  { from: 4220, to: 4225, provincie: "Zuid-Holland" },
  { from: 4230, to: 4233, provincie: "Zuid-Holland" },
  { from: 4240, to: 4249, provincie: "Zuid-Holland" },
  { from: 4250, to: 4269, provincie: "Noord-Brabant" },
  { from: 4270, to: 4299, provincie: "Zuid-Holland" },
  { from: 4300, to: 4599, provincie: "Zeeland" },
  { from: 4600, to: 4679, provincie: "Noord-Brabant" },
  { from: 4680, to: 4699, provincie: "Zeeland" },
  { from: 4700, to: 5799, provincie: "Noord-Brabant" },
  { from: 5800, to: 6019, provincie: "Limburg" },
  { from: 6020, to: 6029, provincie: "Noord-Brabant" },
  { from: 6030, to: 6499, provincie: "Limburg" },
  { from: 6500, to: 6583, provincie: "Gelderland" },
  { from: 6584, to: 6599, provincie: "Limburg" },
  { from: 6600, to: 7399, provincie: "Gelderland" },
  { from: 7400, to: 7739, provincie: "Overijssel" },
  { from: 7740, to: 7766, provincie: "Drenthe" },
  { from: 7767, to: 7767, provincie: "Overijssel" },
  { from: 7768, to: 7769, provincie: "Drenthe" },
  { from: 7770, to: 7799, provincie: "Overijssel" },
  { from: 7800, to: 7999, provincie: "Drenthe" },
  { from: 8000, to: 8049, provincie: "Overijssel" },
  { from: 8050, to: 8059, provincie: "Gelderland" },
  { from: 8060, to: 8099, provincie: "Overijssel" },
  { from: 8100, to: 8159, provincie: "Overijssel" },
  { from: 8160, to: 8199, provincie: "Gelderland" },
  { from: 8200, to: 8259, provincie: "Flevoland" },
  { from: 8260, to: 8299, provincie: "Overijssel" },
  { from: 8300, to: 8322, provincie: "Flevoland" },
  { from: 8323, to: 8323, provincie: "Overijssel" },
  { from: 8324, to: 8349, provincie: "Overijssel" },
  { from: 8350, to: 8399, provincie: "Fryslân" },
  { from: 8400, to: 9299, provincie: "Fryslân" },
  { from: 9300, to: 9349, provincie: "Drenthe" },
  { from: 9350, to: 9399, provincie: "Groningen" },
  { from: 9400, to: 9499, provincie: "Drenthe" },
  { from: 9500, to: 9999, provincie: "Groningen" },
];

export function parsePostcodeDigits(
  postcode: string | null | undefined
): number | null {
  if (!postcode) return null;
  const m = String(postcode).replace(/\s+/g, "").match(/^(\d{4})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1000 && n <= 9999 ? n : null;
}

export function provincieVanPostcode(
  postcode: string | null | undefined
): string {
  const pc = parsePostcodeDigits(postcode);
  if (pc == null) return GEEN_PROVINCIE;
  for (const r of PC4_RANGES) {
    if (pc >= r.from && pc <= r.to) return r.provincie;
  }
  return GEEN_PROVINCIE;
}

/** Normaliseer geojson-naam ↔ onze labels (Fryslân / Friesland). */
export function normalizeProvincieLabel(raw: string): string {
  const t = (raw || "").trim();
  if (!t) return GEEN_PROVINCIE;
  const lower = t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (lower === "friesland" || lower === "fryslan") return "Fryslân";
  const hit = NL_PROVINCIES.find(
    (p) =>
      p
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") === lower
  );
  return hit || t;
}

export const PROVINCIE_ONBEKEND = GEEN_PROVINCIE;
