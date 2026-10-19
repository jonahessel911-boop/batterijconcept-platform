import {
  lookupPostcode,
  normalizeHouseNumber,
  normalizePostcode,
} from "@/lib/postcode";

export type SollicitatieAdres = {
  postcode: string | null;
  huisnummer: string | null;
  toevoeging: string | null;
  straat: string | null;
  plaats: string | null;
};

function pickStr(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

/** Nested address-objecten uit o.a. Typeform / Make. */
function nestedAddress(
  body: Record<string, unknown>
): Record<string, unknown> | null {
  for (const key of ["address", "adres", "woonadres", "billing_address"]) {
    const v = body[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
  }
  return null;
}

/** Split "12A" / "12 a" → huisnummer + toevoeging. */
export function splitHuisnummer(raw: string | null | undefined): {
  huisnummer: string | null;
  toevoeging: string | null;
} {
  const t = (raw || "").trim();
  if (!t) return { huisnummer: null, toevoeging: null };
  const m = t.match(/^(\d+)\s*([A-Za-z0-9-]*)\s*$/);
  if (!m) return { huisnummer: t, toevoeging: null };
  return {
    huisnummer: m[1] || null,
    toevoeging: m[2]?.trim() || null,
  };
}

function pickFromSources(
  sources: Record<string, unknown>[],
  keys: string[]
): string | null {
  for (const src of sources) {
    for (const key of keys) {
      const hit = pickStr(src[key]);
      if (hit) return hit;
    }
  }
  return null;
}

/** Haal adresvelden uit webhook/CRM-payload (veel voorkomende aliases). */
export function pickAdresFromPayload(
  body: Record<string, unknown>
): SollicitatieAdres {
  const nested = nestedAddress(body);
  const sources = nested ? [body, nested] : [body];

  let postcode = pickFromSources(sources, [
    "postcode",
    "postal_code",
    "postalCode",
    "zip",
    "zipcode",
    "zip_code",
    "pc",
  ]);
  let huisnummer = pickFromSources(sources, [
    "huisnummer",
    "huisnr",
    "huis_nummer",
    "house_number",
    "houseNumber",
    "housenumber",
    "number",
    "nr",
  ]);
  let toevoeging = pickFromSources(sources, [
    "toevoeging",
    "huisnummer_toevoeging",
    "addition",
    "suffix",
    "unit",
  ]);
  let straat = pickFromSources(sources, [
    "straat",
    "street",
    "straatnaam",
    "address_street",
    "street_name",
    "address_line_1",
    "address1",
  ]);
  let plaats = pickFromSources(sources, [
    "plaats",
    "city",
    "woonplaats",
    "gemeente",
    "town",
  ]);

  // Soms komt "12A" als één veld
  if (huisnummer && !toevoeging) {
    const split = splitHuisnummer(huisnummer);
    huisnummer = split.huisnummer;
    toevoeging = split.toevoeging;
  }

  if (postcode) postcode = normalizePostcode(postcode);
  if (huisnummer) huisnummer = normalizeHouseNumber(huisnummer) || huisnummer;

  return {
    postcode,
    huisnummer,
    toevoeging,
    straat,
    plaats,
  };
}

/**
 * Vul/verrijk straat + plaats via api-postcode.nl wanneer postcode + huisnummer bekend zijn.
 * API-waarden winnen als de lookup slaagt (formulier stuurt soms alleen PC+nr).
 */
export async function resolveSollicitatieAdres(
  input: SollicitatieAdres
): Promise<SollicitatieAdres> {
  const postcode = input.postcode
    ? normalizePostcode(input.postcode)
    : null;
  const huisnummer = input.huisnummer
    ? normalizeHouseNumber(input.huisnummer) || input.huisnummer.trim()
    : null;
  const toevoeging = input.toevoeging?.trim() || null;

  let straat = input.straat?.trim() || null;
  let plaats = input.plaats?.trim() || null;

  if (postcode && huisnummer) {
    try {
      const found = await lookupPostcode(postcode, huisnummer, toevoeging);
      if (found) {
        straat = found.street || straat;
        plaats = found.city || plaats;
      }
    } catch {
      /* lookup optioneel — postcode/huisnummer blijven staan */
    }
  }

  return {
    postcode: postcode || null,
    huisnummer: huisnummer || null,
    toevoeging,
    straat,
    plaats,
  };
}

export function formatSollicitatieAdres(a: {
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
}): string {
  const nr = [a.huisnummer, a.toevoeging].filter(Boolean).join("");
  const line1 = [a.straat, nr].filter(Boolean).join(" ").trim();
  const line2 = [a.postcode, a.plaats].filter(Boolean).join(" ").trim();
  return [line1, line2].filter(Boolean).join(", ");
}
