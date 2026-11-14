import type { SupabaseClient } from "@supabase/supabase-js";
import { isRikNaam } from "@/lib/ops-namen";
import {
  isSpareAdviseur,
  isWarmtefondsTeamAdviseur,
  normalizeRol,
  SPARE_ADVISEUR_EMAIL,
} from "@/lib/rollen";

export { isSpareAdviseur };

/** Primaire bootstrap-admin (env of default) — catch-all voor ongekoppelde leads. */
export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL || "admin@batterijconcept.nl").toLowerCase();
}

/** Bekende admin-e-mail (o.a. rechten / catch-all), geen UI-gate meer. */
export const CRM_SIDEBAR_EMAIL = "jona@batterijconcept.nl";

/** Today-tab: elke admin, sales manager, of jona@. */
export function magTodayDashboard(
  email: string | null | undefined,
  rol?: string | null
): boolean {
  const r = normalizeRol(rol);
  if (r === "admin" || r === "sales_manager") return true;
  return email?.trim().toLowerCase() === CRM_SIDEBAR_EMAIL;
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

/** E-mail van de SPARE-placeholder-agenda (geen login). */
export function spareEmail(): string {
  return (
    process.env.SPARE_ADVISEUR_EMAIL || SPARE_ADVISEUR_EMAIL
  ).toLowerCase();
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
 * Systeem-Admin, SPARE én CRM-admins (o.a. jona@) uit — die hebben lege
 * agenda's waardoor "vrije" slots ontstaan die in de echte adviseur-agenda
 * bezet zijn.
 */
export function isPlanbaarAdviseur(a: {
  naam: string;
  email?: string | null;
  actief?: boolean | null;
  rol?: string | null;
}): boolean {
  if (a.actief === false) return false;
  if (isAdminAdviseur(a)) return false;
  if (isSpareAdviseur(a)) return false;
  if (isAdminEmail(a.email)) return false;
  if (isWarmtefondsTeamAdviseur(a)) return false;
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

/** Zoekt of maakt de SPARE-adviseur (placeholder-agenda). */
export async function ensureSpareAdviseurId(
  sb: SupabaseClient
): Promise<string> {
  const email = spareEmail();
  const { data: byEmail } = await sb
    .from("adviseurs")
    .select("id")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (byEmail?.id) return byEmail.id as string;

  const { data: byName } = await sb
    .from("adviseurs")
    .select("id")
    .ilike("naam", "SPARE")
    .limit(1)
    .maybeSingle();
  if (byName?.id) return byName.id as string;

  const row: Record<string, unknown> = {
    naam: "SPARE",
    email,
    telefoon: null,
    actief: true,
    rol: "adviseur",
    bel_planning: false,
    commissie_pct: 0,
    geblokkeerd: true,
    werktijd_start: "10:00",
    werktijd_eind: "19:00",
    interne_notities:
      "Systeem-placeholder: tijdelijk afspraken parkeren zodat het slot bij de echte adviseur vrijkomt. Geen bel/rapportage/login.",
  };

  let insert = await sb.from("adviseurs").insert(row).select("id").single();
  if (insert.error) {
    // Compat: ontbrekende kolommen strippen en opnieuw
    const slim = { ...row };
    for (const col of [
      "bel_planning",
      "geblokkeerd",
      "commissie_pct",
      "interne_notities",
      "werktijd_start",
      "werktijd_eind",
    ]) {
      if (
        insert.error.message?.includes(col) ||
        insert.error.code === "42703" ||
        insert.error.code === "PGRST204"
      ) {
        delete slim[col];
      }
    }
    insert = await sb.from("adviseurs").insert(slim).select("id").single();
  }
  if (insert.error || !insert.data?.id) {
    throw new Error(
      insert.error?.message || "SPARE-adviseur aanmaken mislukt"
    );
  }
  return insert.data.id as string;
}

/** Client-side: SPARE-id uit geladen adviseurslijst. */
export function findSpareAdviseurId(
  adviseurs: { id: string; naam: string; email?: string | null }[]
): string | null {
  const email = spareEmail();
  const byEmail = adviseurs.find(
    (a) => a.email?.trim().toLowerCase() === email
  );
  if (byEmail) return byEmail.id;
  const byName = adviseurs.find(
    (a) => a.naam.trim().toLowerCase() === "spare"
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
  const rik = (rows || []).find((r) => isRikNaam(r.naam));
  return rik?.id ?? null;
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
  const rik = adviseurs.find((a) => a.actief !== false && isRikNaam(a.naam));
  return rik?.id ?? null;
}
