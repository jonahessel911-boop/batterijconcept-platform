"use client";

import { useEffect, useRef } from "react";
import {
  loadGoogleMaps,
  parseGoogleAddressComponents,
  type ParsedNlAddress,
} from "@/lib/google-maps";
import { fieldInput, fieldLabel } from "./ui";

/** Google Places Autocomplete — NL adressen. */
export function PlacesAddressSearch({
  defaultValue = "",
  onPlace,
}: {
  defaultValue?: string;
  onPlace: (addr: ParsedNlAddress) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onPlaceRef = useRef(onPlace);

  useEffect(() => {
    onPlaceRef.current = onPlace;
  }, [onPlace]);

  useEffect(() => {
    let autocomplete: google.maps.places.Autocomplete | null = null;
    let listener: google.maps.MapsEventListener | null = null;
    let cancelled = false;

    async function setup() {
      if (!inputRef.current) return;
      try {
        await loadGoogleMaps();
        if (cancelled || !inputRef.current) return;

        autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: "nl" },
          fields: ["address_components", "geometry", "formatted_address"],
          types: ["address"],
        });

        listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete?.getPlace();
          if (!place?.address_components) return;
          const parsed = parseGoogleAddressComponents(
            place.address_components,
            place.geometry,
            place.formatted_address || ""
          );
          onPlaceRef.current(parsed);
        });
      } catch {
        /* handmatig invullen blijft werken */
      }
    }

    void setup();
    return () => {
      cancelled = true;
      if (listener) listener.remove();
    };
  }, []);

  return (
    <label className="block">
      <span className={fieldLabel}>Zoek adres</span>
      <input
        ref={inputRef}
        type="text"
        defaultValue={defaultValue}
        placeholder="Typ straat, huisnummer of postcode…"
        className={fieldInput}
        autoComplete="off"
      />
    </label>
  );
}
