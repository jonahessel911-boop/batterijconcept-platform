import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const NL_FALLBACK = { lat: 52.1326, lon: 5.2913, fallback: true as const };

function mapsKey(): string | undefined {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    undefined
  );
}

/** GET /api/geocode?q=... — Google Geocoding API (NL). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q verplicht" }, { status: 400 });
  }

  const key = mapsKey();
  if (!key) {
    return NextResponse.json(
      { error: "GOOGLE_MAPS_API_KEY ontbreekt", ...NL_FALLBACK },
      { status: 500 }
    );
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", q);
    url.searchParams.set("key", key);
    url.searchParams.set("language", "nl");
    url.searchParams.set("region", "nl");
    url.searchParams.set("components", "country:NL");

    const res = await fetch(url.toString(), { next: { revalidate: 86400 } });
    if (!res.ok) {
      return NextResponse.json(NL_FALLBACK, { status: 502 });
    }

    const data = (await res.json()) as {
      status: string;
      results?: {
        geometry: { location: { lat: number; lng: number } };
        formatted_address?: string;
        address_components?: {
          long_name: string;
          short_name: string;
          types: string[];
        }[];
      }[];
      error_message?: string;
    };

    if (data.status !== "OK" || !data.results?.[0]) {
      return NextResponse.json({
        ...NL_FALLBACK,
        status: data.status,
        detail: data.error_message,
      });
    }

    const first = data.results[0];
    const { lat, lng } = first.geometry.location;

    let straat = "";
    let huisnummer = "";
    let postcode = "";
    let plaats = "";
    for (const c of first.address_components || []) {
      if (c.types.includes("route")) straat = c.long_name;
      if (c.types.includes("street_number")) huisnummer = c.long_name;
      if (c.types.includes("postal_code")) postcode = c.long_name;
      if (c.types.includes("locality")) plaats = c.long_name;
      if (!plaats && c.types.includes("postal_town")) plaats = c.long_name;
    }

    return NextResponse.json({
      lat,
      lon: lng,
      lng,
      formatted: first.formatted_address || q,
      straat,
      huisnummer,
      postcode,
      plaats,
      provider: "google",
    });
  } catch {
    return NextResponse.json(NL_FALLBACK);
  }
}
