import type { SupabaseClient } from "@supabase/supabase-js";

/** Primaire bootstrap-admin (env of default) — catch-all voor ongekoppelde leads. */
export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL || "admin@batterijconcept.nl").toLowerCase();
}

/** E-mails die altijd CRM-rol admin krijgen (ook als DB-rol ontbreekt/verkeerd is). */
export function adminEmails(): string[] {
  const primary = adminEmail();
  const extras = ["jona@batterijconcept.nl"];
  return Array.from(new Set([primary, ...extras.map((e) => e.toLowerCase())]));
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase();
  return Boolean(e && adminEmails().includes(e));
}

/**
 * Systeem-account "Admin" (lead-sink / niet in planningslijst).
 * Niet hetzelfde als CRM-rol admin — jona@ mag admin-rechten hebben
 * zonder dit catch-all account te zijn.
 */
export function isAdminAdviseur(a: {
  id?: string;
  naam: string;
  email?: string | null;
}): boolean {
  if (a.naam.trim().toLowerCase() === "admin") return true;
  const email = a.email?.trim().toLowerCase();
  return Boolean(email && email === adminEmail());
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
