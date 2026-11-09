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

/** Nummer + optionele toevoeging voor de lookup-API (bijv. 12A). */
export function postcodeApiNumber(
  huisnummer: string,
  toevoeging?: string | null
): string {
  const nr = normalizeHouseNumber(huisnummer);
  const toev = (toevoeging || "").trim().replace(/\s+/g, "");
  if (!toev) return nr;
  // Als huisnummer al de toevoeging bevat (12A), niet dubbel plakken
  if (huisnummer.trim().toUpperCase().endsWith(toev.toUpperCase())) {
    return huisnummer.trim().replace(/\s+/g, "");
  }
  return `${nr}${toev}`;
}

/**
 * Lookup via json.api-postcode.nl
 * Token: POSTCODE_API_TOKEN env
 */
export async function lookupPostcode(
  postcode: string,
  huisnummer: string,
  toevoeging?: string | null
): Promise<PostcodeLookupResult | null> {
  const token = process.env.POSTCODE_API_TOKEN;
  if (!token) return null;

  const pc = normalizePostcode(postcode);
  const nr = postcodeApiNumber(huisnummer, toevoeging);
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
    house_number: String(data.house_number ?? normalizeHouseNumber(huisnummer)),
    province: data.province,
  };
}

/**
 * Alleen postcode → plaats (+ straat als die uniek is voor de PC).
 * Via PDOK Locatieserver (geen token).
 */
export async function lookupPlaatsByPostcode(
  postcode: string
): Promise<{ plaats: string; straat: string | null; postcode: string } | null> {
  const pc = normalizePostcode(postcode);
  if (!/^\d{4}[A-Z]{2}$/.test(pc)) return null;

  const url = new URL(
    "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free"
  );
  url.searchParams.set("q", pc);
  url.searchParams.set("fq", "type:postcode");
  url.searchParams.set("rows", "5");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    response?: {
      docs?: Array<{
        woonplaatsnaam?: string;
        straatnaam?: string;
        postcode?: string;
        type?: string;
      }>;
    };
  };
  const docs = data.response?.docs || [];
  const hit =
    docs.find((d) => normalizePostcode(d.postcode || "") === pc) || docs[0];
  const plaats = hit?.woonplaatsnaam?.trim();
  if (!plaats) return null;

  const streets = Array.from(
    new Set(
      docs
        .map((d) => d.straatnaam?.trim())
        .filter((s): s is string => Boolean(s))
    )
  );

  return {
    plaats,
    straat: streets.length === 1 ? streets[0]! : null,
    postcode: hit?.postcode ? normalizePostcode(hit.postcode) : pc,
  };
}

/** Vul straat/plaats als die leeg zijn */
export async function enrichAddressFields(opts: {
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
}): Promise<{ straat: string | null; plaats: string | null }> {
  const straat = opts.straat?.trim() || null;
  const plaats = opts.plaats?.trim() || null;
  if (straat && plaats) {
    return { straat, plaats };
  }
  if (!opts.postcode?.trim()) {
    return { straat, plaats };
  }

  if (opts.huisnummer?.trim()) {
    try {
      const hit = await lookupPostcode(
        opts.postcode,
        opts.huisnummer,
        opts.toevoeging
      );
      if (!hit) return { straat, plaats };
      return {
        straat: straat || hit.street,
        plaats: plaats || hit.city,
      };
    } catch {
      return { straat, plaats };
    }
  }

  try {
    const hit = await lookupPlaatsByPostcode(opts.postcode);
    if (!hit) return { straat, plaats };
    return {
      straat: straat || hit.straat,
      plaats: plaats || hit.plaats,
    };
  } catch {
    return { straat, plaats };
  }
}
