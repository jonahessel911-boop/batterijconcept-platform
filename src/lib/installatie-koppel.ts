import { getSupabaseAdmin } from "@/lib/supabase";
import type { InstallatiePartnerKoppel } from "@/types/database";

const KOPPEL_SELECT =
  "id, partner_id, naam, monteur_1_id, monteur_2_id, actief, monteur_1:installatie_partner_teamgenoten!monteur_1_id(id, naam, email, actief), monteur_2:installatie_partner_teamgenoten!monteur_2_id(id, naam, email, actief)";
const KOPPEL_SELECT_FLAT =
  "id, partner_id, naam, monteur_1_id, monteur_2_id, actief";

function one<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export function koppelWeergaveNaam(
  k: Pick<
    InstallatiePartnerKoppel,
    "naam" | "monteur_1" | "monteur_2" | "monteur_1_id" | "monteur_2_id"
  > | null | undefined
): string {
  if (!k) return "Koppel";
  const a = one(k.monteur_1)?.naam?.trim() || "";
  const b = one(k.monteur_2)?.naam?.trim() || "";
  if (a && b) return `${a} · ${b}`;
  if (a || b) return a || b;
  return (k.naam || "").trim() || "Koppel";
}

/** Installatie-klus → koppel. Geen teamgenoot (dat is schouw). */
export function resolveInstallatieKoppelId(
  project: {
    installatie_koppel_id?: string | null;
    installatie_partner_id?: string | null;
  },
  koppels: Pick<
    InstallatiePartnerKoppel,
    "id" | "partner_id" | "actief"
  >[]
): string | null {
  if (project.installatie_koppel_id) return project.installatie_koppel_id;
  const partnerId = project.installatie_partner_id || null;
  const pool = koppels.filter((k) => {
    if (k.actief === false) return false;
    if (partnerId && k.partner_id !== partnerId) return false;
    return true;
  });
  if (pool.length === 1) return pool[0]!.id;
  return null;
}

export function koppelBevatMonteur(
  k: Pick<InstallatiePartnerKoppel, "monteur_1_id" | "monteur_2_id"> | null | undefined,
  monteurId: string | null | undefined
): boolean {
  if (!k || !monteurId) return false;
  return k.monteur_1_id === monteurId || k.monteur_2_id === monteurId;
}

export function koppelEmails(
  k: Pick<InstallatiePartnerKoppel, "monteur_1" | "monteur_2"> | null | undefined
): string[] {
  if (!k) return [];
  const a = one(k.monteur_1)?.email?.trim();
  const b = one(k.monteur_2)?.email?.trim();
  return [a, b].filter((e, i, arr): e is string => Boolean(e) && arr.indexOf(e) === i);
}

export async function resolveKoppelVanPartner(
  partnerId: string,
  koppelId: string
): Promise<InstallatiePartnerKoppel | null> {
  const sb = getSupabaseAdmin();
  let { data, error } = await sb
    .from("installatie_partner_koppels")
    .select(KOPPEL_SELECT)
    .eq("id", koppelId)
    .eq("partner_id", partnerId)
    .maybeSingle();
  if (error) {
    const flat = await sb
      .from("installatie_partner_koppels")
      .select(KOPPEL_SELECT_FLAT)
      .eq("id", koppelId)
      .eq("partner_id", partnerId)
      .maybeSingle();
    data = flat.data as typeof data;
    error = flat.error;
  }
  if (error || !data) return null;
  const row = data as unknown as InstallatiePartnerKoppel;
  if (row.actief === false) return null;
  return {
    ...row,
    monteur_1: one(row.monteur_1 as never) as InstallatiePartnerKoppel["monteur_1"],
    monteur_2: one(row.monteur_2 as never) as InstallatiePartnerKoppel["monteur_2"],
  };
}
