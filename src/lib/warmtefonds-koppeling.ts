/**
 * Warmtefonds-project: koppel Edwin Veenendaal + zet Rik als
 * project-verantwoordelijke (backoffice).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDefaultBackofficeMedewerkerId } from "@/lib/admin-adviseur";
import { FINANCIERINGSMAN_TEL } from "@/lib/backoffice-acties";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeFinancieringStatus } from "@/lib/financiering-status";

const BUCKET = "crm-private";
const OBJECT = "warmtefonds/aanvraag-koppelingen.json";

/** Portaal / koppeling: zonder 'van', zoals gevraagd. */
export const EDWIN_VEENENDAAL_NAAM = "Edwin Veenendaal";

type Koppeling = {
  project_id: string;
  operator_id: string | null;
  edwin_adviseur_id: string | null;
  verantwoordelijke_id: string | null;
  gekoppeld_at: string;
};

type Store = { koppelingen: Record<string, Koppeling> };

function leeg(): Store {
  return { koppelingen: {} };
}

async function lees(): Promise<Store> {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb.storage.from(BUCKET).download(OBJECT);
    if (error || !data) return leeg();
    const raw = JSON.parse(await data.text()) as { koppelingen?: Record<string, Koppeling> };
    return { koppelingen: raw.koppelingen && typeof raw.koppelingen === "object" ? raw.koppelingen : {} };
  } catch {
    return leeg();
  }
}

async function schrijf(store: Store): Promise<void> {
  const sb = getSupabaseAdmin();
  const up = await sb.storage.from(BUCKET).upload(OBJECT, JSON.stringify(store), {
    upsert: true,
    contentType: "application/json",
  });
  if (up.error) throw new Error(up.error.message);
}

/** Zorg dat Edwin als adviseur bestaat (voor koppeling op het project). */
export async function ensureEdwinVeenendaalAdviseur(
  sb: SupabaseClient
): Promise<string | null> {
  let id: string | null = null;

  const { data: byNaam } = await sb
    .from("adviseurs")
    .select("id, naam")
    .ilike("naam", "%veenendaal%")
    .limit(5);
  const hit = (byNaam || []).find((r) =>
    /edwin/i.test(String(r.naam || ""))
  );
  if (hit?.id) id = hit.id;

  if (!id) {
    const { data: byTel } = await sb
      .from("adviseurs")
      .select("id")
      .eq("telefoon", FINANCIERINGSMAN_TEL.replace(/\s+/g, ""))
      .maybeSingle();
    if (byTel?.id) id = byTel.id;
  }

  const email = "edwin@edergy.nl";
  if (!id) {
    const { data: byEmail } = await sb
      .from("adviseurs")
      .select("id")
      .ilike("email", email)
      .maybeSingle();
    if (byEmail?.id) id = byEmail.id;
  }

  if (!id) {
    const { data: created, error } = await sb
      .from("adviseurs")
      .insert({
        naam: EDWIN_VEENENDAAL_NAAM,
        email,
        telefoon: FINANCIERINGSMAN_TEL.replace(/\s+/g, ""),
        rol: "warmtefonds",
        actief: true,
        bel_planning: false,
      })
      .select("id")
      .maybeSingle();
    if (error || !created?.id) {
      const retry = await sb
        .from("adviseurs")
        .insert({
          naam: EDWIN_VEENENDAAL_NAAM,
          email,
          telefoon: FINANCIERINGSMAN_TEL.replace(/\s+/g, ""),
          rol: "warmtefonds",
          actief: true,
        })
        .select("id")
        .maybeSingle();
      if (retry.error || !retry.data?.id) return null;
      id = retry.data.id;
    } else {
      id = created.id;
    }
  } else {
    // Bestaande rij: altijd Warmtefonds-rol, nooit sales-adviseur.
    await sb
      .from("adviseurs")
      .update({
        rol: "warmtefonds",
        bel_planning: false,
        naam: EDWIN_VEENENDAAL_NAAM,
      })
      .eq("id", id);
  }

  try {
    const { zorgEdergyBedrijfGevuld } = await import("@/lib/edergy-bedrijf");
    await zorgEdergyBedrijfGevuld(sb);
  } catch {
    /* bedrijfsgegevens mogen koppeling niet blokkeren */
  }
  return id;
}

/** Operator-naam in het portaal: Edwin Veenendaal. */
export async function ensureWarmtefondsOperatorNaam(
  sb: SupabaseClient,
  operatorId: string | null | undefined
): Promise<void> {
  if (!operatorId) return;
  await sb
    .from("warmtefonds_operators")
    .update({ naam: EDWIN_VEENENDAAL_NAAM })
    .eq("id", operatorId)
    .neq("naam", EDWIN_VEENENDAAL_NAAM);
}

/**
 * Zodra een project Warmtefonds is (of wordt): Rik als backoffice-
 * verantwoordelijke + Edwin Veenendaal gekoppeld (zichtbaar als EV).
 */
export async function zorgWarmtefondsProjectKoppeling(opts: {
  projectId: string;
  operatorId?: string | null;
  /** true = verantwoordelijke altijd op Rik zetten (bij doorgestuurd). */
  forceRik?: boolean;
}): Promise<{
  verantwoordelijke_id: string | null;
  edwin_adviseur_id: string | null;
} | null> {
  if (!opts.projectId) return null;

  const sb = getSupabaseAdmin();
  const [rikId, edwinId] = await Promise.all([
    getDefaultBackofficeMedewerkerId(sb),
    ensureEdwinVeenendaalAdviseur(sb),
  ]);

  if (opts.operatorId) {
    await ensureWarmtefondsOperatorNaam(sb, opts.operatorId);
  }

  const { data: before } = await sb
    .from("projecten")
    .select("id, verantwoordelijke_id, betaalwijze")
    .eq("id", opts.projectId)
    .maybeSingle();
  if (!before?.id) return null;

  const patch: Record<string, unknown> = {};
  if (
    rikId &&
    (opts.forceRik
      ? before.verantwoordelijke_id !== rikId
      : !before.verantwoordelijke_id)
  ) {
    patch.verantwoordelijke_id = rikId;
  }
  if (Object.keys(patch).length > 0) {
    await sb.from("projecten").update(patch).eq("id", opts.projectId);
  }

  try {
    const store = await lees();
    store.koppelingen[opts.projectId] = {
      project_id: opts.projectId,
      operator_id: opts.operatorId || null,
      edwin_adviseur_id: edwinId,
      verantwoordelijke_id:
        (patch.verantwoordelijke_id as string | undefined) ||
        before.verantwoordelijke_id ||
        rikId,
      gekoppeld_at: new Date().toISOString(),
    };
    await schrijf(store);
  } catch {
    /* opslag mag de flow niet blokkeren */
  }

  return {
    verantwoordelijke_id:
      (patch.verantwoordelijke_id as string | undefined) ||
      before.verantwoordelijke_id ||
      rikId,
    edwin_adviseur_id: edwinId,
  };
}

/**
 * Bij financiering_status → doorgestuurd_naar_edwin: zelfde teamkoppeling,
 * Rik altijd als verantwoordelijke.
 */
export async function zorgWarmtefondsDoorgestuurdKoppeling(opts: {
  projectId: string;
  van: string | null | undefined;
  naar: string | null | undefined;
  operatorId?: string | null;
}): Promise<{
  verantwoordelijke_id: string | null;
  edwin_adviseur_id: string | null;
} | null> {
  const naar = normalizeFinancieringStatus(opts.naar) || opts.naar;
  if (naar !== "doorgestuurd_naar_edwin") return null;
  const van = normalizeFinancieringStatus(opts.van) || opts.van;
  if (van === "doorgestuurd_naar_edwin") return null;

  return zorgWarmtefondsProjectKoppeling({
    projectId: opts.projectId,
    operatorId: opts.operatorId,
    forceRik: true,
  });
}
