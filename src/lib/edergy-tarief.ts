/**
 * Vergoeding per Warmtefonds-aanvraag.
 * Standaard €150 excl. btw (€181,50 incl.); per WF-adviseur kan een eigen tarief_inc.
 */
import { getSupabaseAdmin } from "@/lib/supabase";

/** Standaardtarief — €150 excl. btw. */
export const EDERGY_PER_AANVRAAG_EXCL = 150;
export const EDERGY_PER_AANVRAAG_BTW = 31.5;
export const EDERGY_PER_AANVRAAG_INC = 181.5;

/**
 * Oud standaard (€150 incl.) — behandelen als nieuw standaard bij exacte match,
 * zodat opgeslagen “150” / null-equivalent niet blijft hangen op 123,97 excl.
 */
const EDERGY_LEGACY_150_INC = 150;

/** Historische Edergy-factuursplit (Edwin) — behouden bij exact €375. */
const EDERGY_LEGACY_375_INC = 375;
const EDERGY_LEGACY_375_EXCL = 296.25;
const EDERGY_LEGACY_375_BTW = 78.75;

/**
 * Vanaf deze dag telt de Edergy-vergoeding mee in de winst.
 * Eerdere aanvragen blijven buiten de P&L (zijn factuur 2026.1101 staat al buiten het systeem).
 */
export const EDERGY_VANAF_YMD = "2026-11-04";

/** Thuisadres voor de rit aan het eind van de dag. Zelfde adres als op zijn factuur. */
export const EDERGY_THUIS_ADRES = "Zuidwenk 100, 3751CG Bunschoten-Spakenburg";

export type EdergyTarief = {
  perAanvraagInc: number;
  perAanvraagExcl: number;
  perAanvraagBtw: number;
};

const BUCKET = "crm-private";
const OBJECT = "warmtefonds/edergy-tarief.json";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function standaardTarief(): EdergyTarief {
  return {
    perAanvraagInc: EDERGY_PER_AANVRAAG_INC,
    perAanvraagExcl: EDERGY_PER_AANVRAAG_EXCL,
    perAanvraagBtw: EDERGY_PER_AANVRAAG_BTW,
  };
}

/** BTW 21%; excl. is leidend voor het standaardbedrag. */
export function edergyBedragenVanExcl(exclRaw: number): EdergyTarief {
  const excl = round2(Number(exclRaw));
  if (!Number.isFinite(excl) || excl <= 0) return standaardTarief();
  if (Math.abs(excl - EDERGY_PER_AANVRAAG_EXCL) < 0.005) {
    return standaardTarief();
  }
  const btw = round2(excl * 0.21);
  const inc = round2(excl + btw);
  return {
    perAanvraagInc: inc,
    perAanvraagExcl: excl,
    perAanvraagBtw: btw,
  };
}

/** Van opgeslagen incl. (DB / storage) naar split. */
export function edergyBedragenVanInc(incRaw: number): EdergyTarief {
  const inc = round2(Number(incRaw));
  if (!Number.isFinite(inc) || inc <= 0) return standaardTarief();
  // Exact nieuw standaard
  if (Math.abs(inc - EDERGY_PER_AANVRAAG_INC) < 0.005) {
    return standaardTarief();
  }
  // Oud standaard €150 incl. → nieuw €150 excl.
  if (Math.abs(inc - EDERGY_LEGACY_150_INC) < 0.005) {
    return standaardTarief();
  }
  // Historische Edergy-factuur €375
  if (Math.abs(inc - EDERGY_LEGACY_375_INC) < 0.005) {
    return {
      perAanvraagInc: EDERGY_LEGACY_375_INC,
      perAanvraagExcl: EDERGY_LEGACY_375_EXCL,
      perAanvraagBtw: EDERGY_LEGACY_375_BTW,
    };
  }
  const excl = round2(inc / 1.21);
  const btw = round2(inc - excl);
  return {
    perAanvraagInc: inc,
    perAanvraagExcl: excl,
    perAanvraagBtw: btw,
  };
}

function defaultTarief(): EdergyTarief {
  return standaardTarief();
}

/** Huidig standaardtarief (storage of default €150 excl.). */
export async function leesEdergyTarief(): Promise<EdergyTarief> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.storage.from(BUCKET).download(OBJECT);
    if (error || !data) return defaultTarief();
    const text = await data.text();
    const raw = JSON.parse(text) as { per_aanvraag_inc?: unknown };
    const inc = Number(raw.per_aanvraag_inc);
    if (!Number.isFinite(inc) || inc <= 0) return defaultTarief();
    return edergyBedragenVanInc(inc);
  } catch {
    return defaultTarief();
  }
}

/**
 * Tarief voor één Warmtefonds-operator.
 * Heeft die persoon een eigen `tarief_inc`, dan die; anders standaard (€150 excl.).
 */
export async function leesEdergyTariefVoorOperator(
  tariefInc: number | null | undefined
): Promise<EdergyTarief> {
  const inc = Number(tariefInc);
  if (Number.isFinite(inc) && inc > 0) {
    return edergyBedragenVanInc(inc);
  }
  return leesEdergyTarief();
}

/** Sla standaardtarief op (incl. btw in storage; input mag excl. zijn via helper). */
export async function schrijfEdergyTarief(
  perAanvraagInc: number
): Promise<EdergyTarief> {
  const tarief = edergyBedragenVanInc(perAanvraagInc);
  const sb = getSupabaseAdmin();
  const body = JSON.stringify(
    {
      per_aanvraag_inc: tarief.perAanvraagInc,
      updated_at: new Date().toISOString(),
    },
    null,
    2
  );
  const { error } = await sb.storage.from(BUCKET).upload(OBJECT, body, {
    contentType: "application/json",
    upsert: true,
  });
  if (error) throw error;
  return tarief;
}
