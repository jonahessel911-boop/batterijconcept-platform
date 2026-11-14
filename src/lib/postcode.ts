export type PostcodeLookupResult = {
  street: string;
  city: string;
  postcode: string;
  house_number: string;
  province?: string;
};

/** Normaliseer NL-postcode naar 1234AB (spaties/streepjes eruit). */
export function normalizePostcode(raw: string): string {
  const cleaned = String(raw || "")
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase();
  const m = cleaned.match(/^(\d{4})([A-Z]{2})/);
  if (m) return `${m[1]}${m[2]}`;
  // Alleen PC4 of rommel eromheen → eerste 4 cijfers + letters indien aanwezig
  const loose = cleaned.match(/(\d{4})([A-Z]{0,2})/);
  if (!loose) return cleaned;
  return `${loose[1]}${loose[2] || ""}`;
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
  if (!toev) {
    // 12A / 12a in huisnummer-veld
    const m = huisnummer.trim().match(/^(\d+)\s*([A-Za-z0-9-]*)$/);
    if (m?.[2]) return `${m[1]}${m[2]}`;
    return nr;
  }
  // Als huisnummer al de toevoeging bevat (12A), niet dubbel plakken
  if (huisnummer.trim().toUpperCase().endsWith(toev.toUpperCase())) {
    return huisnummer.trim().replace(/\s+/g, "");
  }
  return `${nr}${toev}`;
}

function splitNrLetter(
  huisnummer: string,
  toevoeging?: string | null
): { nr: string; letter: string } {
  const toev = (toevoeging || "").trim();
  const m = huisnummer.trim().match(/^(\d+)\s*([A-Za-z]?)/);
  const nr = m?.[1] || normalizeHouseNumber(huisnummer);
  const letter = (toev || m?.[2] || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  return { nr, letter };
}

async function lookupViaApiPostcode(
  pc: string,
  nrCombined: string
): Promise<PostcodeLookupResult | null> {
  const token = process.env.POSTCODE_API_TOKEN;
  if (!token) return null;

  const url = new URL("https://json.api-postcode.nl/");
  url.searchParams.set("postcode", pc);
  url.searchParams.set("number", nrCombined);

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
    error?: string;
  };

  if (!data.street || !data.city) return null;

  return {
    street: data.street,
    city: data.city,
    postcode: data.postcode || pc,
    house_number: String(data.house_number ?? nrCombined),
    province: data.province,
  };
}

/** Gratis PDOK BAG Locatieserver — fallback als api-postcode faalt. */
async function lookupViaPdok(
  pc: string,
  huisnummer: string,
  toevoeging?: string | null
): Promise<PostcodeLookupResult | null> {
  const { nr, letter } = splitNrLetter(huisnummer, toevoeging);
  if (!/^\d+$/.test(nr)) return null;

  const q = `postcode:${pc} AND huisnummer:${nr}`;
  const url = new URL(
    "https://api.pdok.nl/bzk/locatieserver/search/v3_1/free"
  );
  url.searchParams.set("q", q);
  url.searchParams.set("fq", "type:adres");
  url.searchParams.set("rows", "10");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    response?: {
      docs?: Array<{
        straatnaam?: string;
        woonplaatsnaam?: string;
        postcode?: string;
        huisnummer?: number | string;
        huisletter?: string | null;
        provincienaam?: string;
      }>;
    };
  };

  const docs = data.response?.docs || [];
  if (!docs.length) return null;

  const match =
    docs.find((d) => {
      const hl = (d.huisletter || "").toUpperCase();
      if (letter) return hl === letter;
      return !hl;
    }) || docs[0];

  if (!match?.straatnaam || !match?.woonplaatsnaam) return null;

  return {
    street: match.straatnaam,
    city: match.woonplaatsnaam,
    postcode: match.postcode || pc,
    house_number: String(match.huisnummer ?? nr),
    province: match.provincienaam || undefined,
  };
}

/**
 * Lookup: api-postcode.nl (token) → PDOK BAG fallback.
 */
export async function lookupPostcode(
  postcode: string,
  huisnummer: string,
  toevoeging?: string | null
): Promise<PostcodeLookupResult | null> {
  const pc = normalizePostcode(postcode);
  const nrCombined = postcodeApiNumber(huisnummer, toevoeging);
  if (!/^\d{4}[A-Z]{2}$/.test(pc) || !nrCombined) return null;

  try {
    const primary = await lookupViaApiPostcode(pc, nrCombined);
    if (primary) return primary;
  } catch {
    /* fallback */
  }

  try {
    return await lookupViaPdok(pc, huisnummer, toevoeging);
  } catch {
    return null;
  }
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
