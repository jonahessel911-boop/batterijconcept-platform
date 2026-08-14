export type PostcodeLookupResult = {
  street: string;
  city: string;
  postcode: string;
  house_number: string;
  province?: string;
};

/** Normaliseer NL-postcode naar 1234AB */
export function normalizePostcode(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** Haal huisnummer-cijfers eruit (12A → 12) voor de API */
export function normalizeHouseNumber(raw: string): string {
  const m = raw.trim().match(/^(\d+)/);
  return m ? m[1] : raw.trim();
}

/**
 * Lookup via json.api-postcode.nl
 * Token: POSTCODE_API_TOKEN env
 */
export async function lookupPostcode(
  postcode: string,
  huisnummer: string
): Promise<PostcodeLookupResult | null> {
  const token = process.env.POSTCODE_API_TOKEN;
  if (!token) return null;

  const pc = normalizePostcode(postcode);
  const nr = normalizeHouseNumber(huisnummer);
  if (!/^\d{4}[A-Z]{2}$/.test(pc) || !nr) return null;

  const url = new URL("https://json.api-postcode.nl/");
  url.searchParams.set("postcode", pc);
  url.searchParams.set("number", nr);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      token,
    },
    cache: "no-store",
  });

  if (!res.ok) return null;

  const data = (await res.json()) as {
    street?: string;
    city?: string;
    postcode?: string;
    house_number?: string | number;
    province?: string;
  };

  if (!data.street || !data.city) return null;

  return {
    street: data.street,
    city: data.city,
    postcode: data.postcode || pc,
    house_number: String(data.house_number ?? nr),
    province: data.province,
  };
}

/** Vul straat/plaats als die leeg zijn */
export async function enrichAddressFields(opts: {
  postcode?: string | null;
  huisnummer?: string | null;
  straat?: string | null;
  plaats?: string | null;
}): Promise<{ straat: string | null; plaats: string | null }> {
  const straat = opts.straat?.trim() || null;
  const plaats = opts.plaats?.trim() || null;
  if (straat && plaats) {
    return { straat, plaats };
  }
  if (!opts.postcode?.trim() || !opts.huisnummer?.trim()) {
    return { straat, plaats };
  }

  try {
    const hit = await lookupPostcode(opts.postcode, opts.huisnummer);
    if (!hit) return { straat, plaats };
    return {
      straat: straat || hit.street,
      plaats: plaats || hit.city,
    };
  } catch {
    return { straat, plaats };
  }
}
