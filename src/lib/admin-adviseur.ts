import type { SupabaseClient } from "@supabase/supabase-js";

export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL || "admin@batterijconcept.nl").toLowerCase();
}

/** Zoekt de Admin-adviseur (via ADMIN_EMAIL, anders naam "Admin"). */
export async function getAdminAdviseurId(
  sb: SupabaseClient
): Promise<string | null> {
  const email = adminEmail();
  const { data: byEmail } = await sb
    .from("adviseurs")
    .select("id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (byEmail?.id) return byEmail.id;

  const { data: byName } = await sb
    .from("adviseurs")
    .select("id")
    .ilike("naam", "Admin")
    .limit(1)
    .maybeSingle();
  return byName?.id ?? null;
}

/** Client-side: admin-id uit geladen adviseurslijst. */
export function findAdminAdviseurId(
  adviseurs: { id: string; naam: string; email?: string | null }[]
): string | null {
  const email = adminEmail();
  const byEmail = adviseurs.find(
    (a) => a.email?.trim().toLowerCase() === email
  );
  if (byEmail) return byEmail.id;
  const byName = adviseurs.find(
    (a) => a.naam.trim().toLowerCase() === "admin"
  );
  return byName?.id ?? null;
}
