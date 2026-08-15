"use client";

import { useCallback, useState } from "react";
import { MapZoom } from "../MapZoom";
import { PlacesAddressSearch } from "../PlacesAddressSearch";
import type { ParsedNlAddress } from "@/lib/google-maps";
import {
  btnPrimary,
  card,
  fieldInput,
  fieldLabel,
  stepEyebrow,
  stepLead,
  stepTitle,
} from "../ui";

export function StepAdres({
  leadNaam,
  adres,
  straat,
  postcode,
  huisnummer,
  toevoeging,
  plaats,
  onChange,
  confirmed,
  onConfirm,
}: {
  leadNaam: string;
  adres: string;
  straat: string;
  postcode: string;
  huisnummer: string;
  toevoeging: string;
  plaats: string;
  onChange: (patch: {
    straat?: string;
    postcode?: string;
    huisnummer?: string;
    toevoeging?: string;
    plaats?: string;
  }) => void;
  confirmed: boolean;
  onConfirm: () => void;
}) {
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [scanned, setScanned] = useState(false);

  const mapQuery = [straat, huisnummer, postcode, plaats, "Nederland"]
    .filter(Boolean)
    .join(" ");

  const onPlace = useCallback(
    (addr: ParsedNlAddress) => {
      onChange({
        straat: addr.straat || undefined,
        huisnummer: addr.huisnummer || undefined,
        toevoeging: addr.toevoeging || undefined,
        postcode: addr.postcode || undefined,
        plaats: addr.plaats || undefined,
      });
      if (addr.lat != null && addr.lng != null) {
        setCoords({ lat: addr.lat, lng: addr.lng });
      }
      setScanned(false);
    },
    [onChange]
  );

  return (
    <div className="space-y-6">
      <div>
        <p className={stepEyebrow}>Stap 1 · Woning checken</p>
        <h1 className={stepTitle}>Is dit het adres van {leadNaam}?</h1>
        <p className={stepLead}>
          Controleer de woning. Daarna kun je er in Street View omheen kijken —
          precies zoals bij Google Maps.
        </p>
      </div>

      <div className={card}>
        <div className="mb-4">
          <PlacesAddressSearch
            defaultValue={adres !== "—" ? adres : ""}
            onPlace={onPlace}
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
          <label className="col-span-2 sm:col-span-3">
            <span className={fieldLabel}>Straat</span>
            <input
              value={straat}
              onChange={(e) => {
                setCoords(null);
                setScanned(false);
                onChange({ straat: e.target.value });
              }}
              placeholder="Straatnaam"
              className={fieldInput}
            />
          </label>
          <label className="col-span-1 sm:col-span-2">
            <span className={fieldLabel}>
              Postcode<span className="text-green">*</span>
            </span>
            <input
              value={postcode}
              onChange={(e) => {
                setCoords(null);
                setScanned(false);
                onChange({ postcode: e.target.value });
              }}
              placeholder="1234 AB"
              className={fieldInput}
            />
          </label>
          <label className="col-span-1">
            <span className={fieldLabel}>
              Huisnr.<span className="text-green">*</span>
            </span>
            <input
              value={huisnummer}
              onChange={(e) => {
                setCoords(null);
                setScanned(false);
                onChange({ huisnummer: e.target.value });
              }}
              placeholder="12"
              className={fieldInput}
            />
          </label>
          <label className="col-span-1">
            <span className={fieldLabel}>Toev.</span>
            <input
              value={toevoeging}
              onChange={(e) => {
                setCoords(null);
                setScanned(false);
                onChange({ toevoeging: e.target.value });
              }}
              placeholder="A"
              className={fieldInput}
            />
          </label>
          <label className="col-span-2 sm:col-span-2">
            <span className={fieldLabel}>Plaats</span>
            <input
              value={plaats}
              onChange={(e) => {
                setCoords(null);
                setScanned(false);
                onChange({ plaats: e.target.value });
              }}
              placeholder="Plaats"
              className={fieldInput}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5 font-medium text-green-dark">
            <span className="text-green">✓</span> Adres controleren
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-green">✓</span> Gecertificeerde monteurs
          </span>
        </div>
      </div>

      <MapZoom
        query={mapQuery || adres || "Nederland"}
        lat={coords?.lat}
        lng={coords?.lng}
        confirmed={confirmed}
        onScanned={() => setScanned(true)}
      />

      <button
        type="button"
        onClick={onConfirm}
        disabled={!scanned && !confirmed}
        className={`${btnPrimary} w-full disabled:opacity-45`}
      >
        {scanned || confirmed
          ? `Ja, dit is de woning van ${leadNaam} →`
          : "Scan eerst de woning"}
      </button>
      {!scanned && !confirmed && (
        <p className="text-center text-xs text-muted">
          Gebruik <strong>Scan woning</strong> op de kaart om de gevel uit te
          lijnen.
        </p>
      )}
    </div>
  );
}
