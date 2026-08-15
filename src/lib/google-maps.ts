import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let ready: Promise<typeof google.maps> | null = null;

export function getGoogleMapsApiKey(): string | undefined {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || undefined;
}

/** Laadt Maps JS + Places één keer (client-only). */
export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps alleen in de browser"));
  }
  const key = getGoogleMapsApiKey();
  if (!key) {
    return Promise.reject(new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ontbreekt"));
  }
  if (!ready) {
    setOptions({
      key,
      v: "weekly",
      language: "nl",
      region: "NL",
    });
    ready = (async () => {
      await importLibrary("maps");
      await importLibrary("places");
      await importLibrary("geocoding");
      await importLibrary("marker");
      await importLibrary("streetView");
      await importLibrary("geometry");
      return google.maps;
    })();
  }
  return ready;
}

export type ParsedNlAddress = {
  straat: string;
  huisnummer: string;
  toevoeging: string;
  postcode: string;
  plaats: string;
  lat: number | null;
  lng: number | null;
  formatted: string;
};

export function parseGoogleAddressComponents(
  components: google.maps.GeocoderAddressComponent[],
  geometry?:
    | google.maps.places.PlaceGeometry
    | google.maps.GeocoderGeometry
    | null
    | undefined,
  formatted = ""
): ParsedNlAddress {
  let straat = "";
  let huisnummer = "";
  let toevoeging = "";
  let postcode = "";
  let plaats = "";

  for (const c of components) {
    const t = c.types;
    if (t.includes("route")) straat = c.long_name;
    if (t.includes("street_number")) {
      const m = c.long_name.match(/^(\d+)\s*(.*)$/);
      if (m) {
        huisnummer = m[1] || c.long_name;
        toevoeging = (m[2] || "").trim();
      } else {
        huisnummer = c.long_name;
      }
    }
    if (t.includes("postal_code")) postcode = c.long_name;
    if (t.includes("locality")) plaats = c.long_name;
    if (!plaats && t.includes("postal_town")) plaats = c.long_name;
    if (!plaats && t.includes("administrative_area_level_2")) {
      plaats = c.long_name;
    }
  }

  const loc = geometry?.location;
  return {
    straat,
    huisnummer,
    toevoeging,
    postcode,
    plaats,
    lat: loc ? loc.lat() : null,
    lng: loc ? loc.lng() : null,
    formatted,
  };
}
