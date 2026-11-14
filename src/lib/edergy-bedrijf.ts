/**
 * Bedrijfsgegevens Edergy (Edwin) — bron voor factuur-PDF + WF-instellingen.
 * Opgeslagen op de Edwin-adviseur-rij (zelfde velden als CRM Instellingen).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase";
import { EDERGY_THUIS_ADRES } from "@/lib/edergy-tarief";

export type EdergyBedrijf = {
  contact_naam: string;
  bedrijfsnaam: string;
  email: string;
  telefoon: string;
  factuur_adres: string;
  factuur_postcode: string;
  factuur_plaats: string;
  kvk_nummer: string;
  btw_nummer: string;
  iban: string;
};

/** Defaults zoals op de Edergy-factuur. */
export const EDERGY_BEDRIJF_DEFAULT: EdergyBedrijf = {
  contact_naam: "Edwin Veenendaal",
  bedrijfsnaam: "Edergy",
  email: "edwin@edergy.nl",
  telefoon: "06-58824298",
  factuur_adres: "Zuidwenk 100",
  factuur_postcode: "3751CG",
  factuur_plaats: "Bunschoten-Spakenburg",
  kvk_nummer: "42079675",
  btw_nummer: "NL005480363B45",
  iban: "NL13INGB0119293684",
};

export function edergyThuisAdresVan(b: EdergyBedrijf): string {
  const pc = `${b.factuur_postcode} ${b.factuur_plaats}`.trim();
  if (b.factuur_adres && pc) return `${b.factuur_adres}, ${pc}`;
  if (b.factuur_adres) return b.factuur_adres;
  return EDERGY_THUIS_ADRES;
}

function trimOr(
  value: string | null | undefined,
  fallback: string
): string {
  const t = (value || "").trim();
  return t || fallback;
}

function telefoonWeergave(value: string | null | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return EDERGY_BEDRIJF_DEFAULT.telefoon;
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("316") && digits.length === 11) {
    return `06-${digits.slice(3, 5)}${digits.slice(5, 7)}${digits.slice(7)}`;
  }
  if (digits.startsWith("06") && digits.length === 10) {
    return `06-${digits.slice(2)}`;
  }
  return raw;
}

export function normaliseerEdergyBedrijf(
  raw: Partial<EdergyBedrijf> | null | undefined
): EdergyBedrijf {
  const d = EDERGY_BEDRIJF_DEFAULT;
  return {
    contact_naam: trimOr(raw?.contact_naam, d.contact_naam),
    bedrijfsnaam: trimOr(raw?.bedrijfsnaam, d.bedrijfsnaam),
    email: trimOr(raw?.email, d.email).toLowerCase(),
    telefoon: telefoonWeergave(raw?.telefoon || d.telefoon),
    factuur_adres: trimOr(raw?.factuur_adres, d.factuur_adres),
    factuur_postcode: trimOr(raw?.factuur_postcode, d.factuur_postcode),
    factuur_plaats: trimOr(raw?.factuur_plaats, d.factuur_plaats),
    kvk_nummer: trimOr(raw?.kvk_nummer, d.kvk_nummer).replace(/\s+/g, ""),
    btw_nummer: trimOr(raw?.btw_nummer, d.btw_nummer).replace(/\s+/g, ""),
    iban: trimOr(raw?.iban, d.iban).replace(/\s+/g, "").toUpperCase(),
  };
}

async function vindEdwinId(sb: SupabaseClient): Promise<string | null> {
  const { data: byEmail } = await sb
    .from("adviseurs")
    .select("id")
    .ilike("email", EDERGY_BEDRIJF_DEFAULT.email)
    .maybeSingle();
  if (byEmail?.id) return byEmail.id;

  const { data: byNaam } = await sb
    .from("adviseurs")
    .select("id, naam")
    .ilike("naam", "%veenendaal%")
    .limit(5);
  const hit = (byNaam || []).find((r) => /edwin/i.test(String(r.naam || "")));
  return hit?.id || null;
}

export async function leesEdergyBedrijf(
  sb?: SupabaseClient
): Promise<EdergyBedrijf> {
  const client = sb || getSupabaseAdmin();
  const id = await vindEdwinId(client);
  if (!id) return { ...EDERGY_BEDRIJF_DEFAULT };

  const { data } = await client
    .from("adviseurs")
    .select(
      "naam, email, telefoon, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban"
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) return { ...EDERGY_BEDRIJF_DEFAULT };

  return normaliseerEdergyBedrijf({
    contact_naam: data.naam,
    email: data.email,
    telefoon: data.telefoon,
    bedrijfsnaam: data.bedrijfsnaam,
    kvk_nummer: data.kvk_nummer,
    btw_nummer: data.btw_nummer,
    factuur_adres: data.factuur_adres,
    factuur_postcode: data.factuur_postcode,
    factuur_plaats: data.factuur_plaats,
    iban: data.iban,
  });
}

/** Schrijf naar Edwin-adviseur (CRM Instellingen + factuurbron). */
export async function schrijfEdergyBedrijf(
  input: Partial<EdergyBedrijf>,
  sb?: SupabaseClient
): Promise<EdergyBedrijf> {
  const client = sb || getSupabaseAdmin();
  const next = normaliseerEdergyBedrijf({
    ...(await leesEdergyBedrijf(client)),
    ...input,
  });
  const id = await vindEdwinId(client);
  if (!id) return next;

  const patch = {
    naam: next.contact_naam,
    email: next.email,
    telefoon: next.telefoon.replace(/\s+/g, ""),
    bedrijfsnaam: next.bedrijfsnaam,
    kvk_nummer: next.kvk_nummer,
    btw_nummer: next.btw_nummer,
    factuur_adres: next.factuur_adres,
    factuur_postcode: next.factuur_postcode,
    factuur_plaats: next.factuur_plaats,
    iban: next.iban,
    bel_planning: false,
  };

  const { error } = await client.from("adviseurs").update(patch).eq("id", id);
  if (error) {
    // bel_planning kan ontbreken
    const { bel_planning: _b, ...slim } = patch;
    await client.from("adviseurs").update(slim).eq("id", id);
  }
  return next;
}

/** Eenmalig: vul ontbrekende velden met defaults. */
export async function zorgEdergyBedrijfGevuld(
  sb?: SupabaseClient
): Promise<EdergyBedrijf> {
  const client = sb || getSupabaseAdmin();
  const huidig = await leesEdergyBedrijf(client);
  // Altijd normaliseren + terugschrijven zodat CRM Instellingen klopt
  return schrijfEdergyBedrijf(huidig, client);
}
