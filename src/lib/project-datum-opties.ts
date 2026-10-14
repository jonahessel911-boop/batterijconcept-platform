/**
 * Datum-opties: Service / Overstap — klant kiest 1 van 3 tijden in Mijn portaal.
 */

export const DATUM_OPTIE_SOORTEN = ["service", "overstap"] as const;
export type DatumOptieSoort = (typeof DATUM_OPTIE_SOORTEN)[number];

export const DATUM_OPTIE_STATUS = ["open", "gekozen", "geannuleerd"] as const;
export type DatumOptieStatus = (typeof DATUM_OPTIE_STATUS)[number];

export type ProjectDatumOptie = {
  id: string;
  project_id: string;
  soort: DatumOptieSoort;
  slot_1: string;
  slot_2: string;
  slot_3: string;
  status: DatumOptieStatus;
  gekozen_slot: string | null;
  bevestigd_naam: string | null;
  bevestigd_email: string | null;
  bevestigd_telefoon: string | null;
  verstuurd_at: string | null;
  gekozen_at: string | null;
  /** Notitie voor installateur (service) */
  service_notitie: string | null;
  created_by: string | null;
  created_at: string;
};

/** Voor klantportaal-payload */
export type KlantDatumOptie = {
  id: string;
  soort: DatumOptieSoort;
  status: DatumOptieStatus;
  slots: [string, string, string];
  gekozen_slot: string | null;
};

export function isDatumOptieSoort(v: unknown): v is DatumOptieSoort {
  return v === "service" || v === "overstap";
}

export function datumOptieSoortLabel(soort: DatumOptieSoort): string {
  return soort === "service" ? "Service" : "Overstap";
}

export function slotsFromRow(row: {
  slot_1: string;
  slot_2: string;
  slot_3: string;
}): [string, string, string] {
  return [row.slot_1, row.slot_2, row.slot_3];
}

export function toKlantDatumOptie(row: ProjectDatumOptie): KlantDatumOptie {
  return {
    id: row.id,
    soort: row.soort,
    status: row.status,
    slots: slotsFromRow(row),
    gekozen_slot: row.gekozen_slot,
  };
}

export function parseSlotIso(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
