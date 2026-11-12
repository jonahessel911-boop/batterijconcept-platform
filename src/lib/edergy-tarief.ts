/**
 * Edergy (Edwin Veenendaal) per Warmtefonds-aanvraag.
 * Standaardbedragen als op zijn factuur; admin kan het incl.-bedrag wijzigen.
 */
import { getSupabaseAdmin } from "@/lib/supabase";

/** Defaults (exact als originele Edergy-factuur). */
export const EDERGY_PER_AANVRAAG_INC = 375;
export const EDERGY_PER_AANVRAAG_EXCL = 296.25;
export const EDERGY_PER_AANVRAAG_BTW = 78.75;

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

/** BTW 21% over excl.; incl. is leidend. */
export function edergyBedragenVanInc(incRaw: number): EdergyTarief {
  const inc = Math.round(Number(incRaw) * 100) / 100;
  if (!Number.isFinite(inc) || inc <= 0) {
    return {
      perAanvraagInc: EDERGY_PER_AANVRAAG_INC,
      perAanvraagExcl: EDERGY_PER_AANVRAAG_EXCL,
      perAanvraagBtw: EDERGY_PER_AANVRAAG_BTW,
    };
  }
  // Behoud exacte default-split bij €375 (zoals zijn factuur).
  if (Math.abs(inc - EDERGY_PER_AANVRAAG_INC) < 0.005) {
    return {
      perAanvraagInc: EDERGY_PER_AANVRAAG_INC,
      perAanvraagExcl: EDERGY_PER_AANVRAAG_EXCL,
      perAanvraagBtw: EDERGY_PER_AANVRAAG_BTW,
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
  return edergyBedragenVanInc(EDERGY_PER_AANVRAAG_INC);
}

/** Huidig tarief (admin-instelling of default). */
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
 * Heeft die persoon een eigen `tarief_inc`, dan die; anders globaal.
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

/** Sla admin-tarief op (incl. btw). */
export async function schrijfEdergyTarief(perAanvraagInc: number): Promise<EdergyTarief> {
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
