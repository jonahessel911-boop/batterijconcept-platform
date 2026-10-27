import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRol } from "@/lib/rollen";

/** Primaire bootstrap-admin (env of default) — catch-all voor ongekoppelde leads. */
export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL || "admin@batterijconcept.nl").toLowerCase();
}

/** Bekende admin-e-mail (o.a. rechten / catch-all), geen UI-gate meer. */
export const CRM_SIDEBAR_EMAIL = "jona@batterijconcept.nl";

/** Today-tab: jona@ of sales_manager-rol. */
export function magTodayDashboard(
  email: string | null | undefined,
  rol?: string | null
): boolean {
  if (email?.trim().toLowerCase() === CRM_SIDEBAR_EMAIL) return true;
  return normalizeRol(rol) === "sales_manager";
}

/** CRM gebruikt overal de sidebar i.p.v. de oude tab-balk. */
export function usesCrmSidebar(
  _email?: string | null,
  _rol?: string | null
): boolean {
  return true;
}

/**
 * Bekende admin-e-mails (rechten-fallback als DB-rol ontbreekt).
 * Expliciete DB-rol (beller/adviseur/…) wint altijd in de login-sessie.
 */
export function adminEmails(): string[] {
  const primary = adminEmail();
  const extras = [CRM_SIDEBAR_EMAIL];
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

/**
 * Tijdelijk: niet als bel/best-slot-optie (blijven actief: login, offertes, agenda).
 * Harald + Stijn — verwijder uit deze set om weer mee te plannen.
 */
const TIJDELIJK_NIET_PLANBAAR_EMAILS = new Set([
  "harald@batterijconcept.nl",
  "stijn@batterijconcept.nl",
]);

/**
 * Mag in klantgerichte slot-planning (Bel best-slots / capaciteit).
 * Alleen actieve sales-adviseurs. Inactief = niet automatisch inplannen.
 * Systeem-Admin én CRM-admins (o.a. jona@) uit — die hebben lege agenda's
 * waardoor "vrije" slots ontstaan die in de echte adviseur-agenda bezet zijn.
 */
export function isPlanbaarAdviseur(a: {
  naam: string;
  email?: string | null;
  actief?: boolean | null;
  rol?: string | null;
}): boolean {
  if (a.actief === false) return false;
  if (isAdminAdviseur(a)) return false;
  if (isAdminEmail(a.email)) return false;
  const email = a.email?.trim().toLowerCase();
  if (email && TIJDELIJK_NIET_PLANBAAR_EMAILS.has(email)) return false;
  if (a.rol != null && a.rol !== "" && normalizeRol(a.rol) !== "adviseur") {
    return false;
  }
  return true;
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

/**
 * Standaard backoffice-medewerker op nieuwe projecten.
 * Override via DEFAULT_BACKOFFICE_EMAIL; anders Tarik (naam-match).
 */
export function defaultBackofficeEmail(): string | null {
  const raw = process.env.DEFAULT_BACKOFFICE_EMAIL?.trim();
  return raw ? raw.toLowerCase() : null;
}

/** Zoekt Tarik (of DEFAULT_BACKOFFICE_EMAIL) als project-verantwoordelijke. */
export async function getDefaultBackofficeMedewerkerId(
  sb: SupabaseClient
): Promise<string | null> {
  const email = defaultBackofficeEmail();
  if (email) {
    const { data: byEmail } = await sb
      .from("adviseurs")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (byEmail?.id) return byEmail.id;
  }

  const { data: rows } = await sb
    .from("adviseurs")
    .select("id, naam")
    .eq("actief", true);
  const tarik = (rows || []).find((r) => {
    const n = String(r.naam || "")
      .trim()
      .toLowerCase();
    return n === "tarik" || n.startsWith("tarik ");
  });
  return tarik?.id ?? null;
}

/** Client-side: Tarik (of DEFAULT_BACKOFFICE_EMAIL) uit geladen adviseurslijst. */
export function findDefaultBackofficeMedewerkerId(
  adviseurs: { id: string; naam: string; email?: string | null; actief?: boolean | null }[]
): string | null {
  const email = defaultBackofficeEmail();
  if (email) {
    const byEmail = adviseurs.find(
      (a) => a.email?.trim().toLowerCase() === email
    );
    if (byEmail) return byEmail.id;
  }
  const tarik = adviseurs.find((a) => {
    if (a.actief === false) return false;
    const n = a.naam.trim().toLowerCase();
    return n === "tarik" || n.startsWith("tarik ");
  });
  return tarik?.id ?? null;
}
