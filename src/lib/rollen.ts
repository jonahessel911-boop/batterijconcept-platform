import type { CrmTab } from "@/types/database";

export const GEBRUIKER_ROLLEN = [
  "adviseur",
  "beller",
  "backoffice",
  "sales_manager",
  "admin",
  "installateur",
] as const;

export type GebruikerRol = (typeof GEBRUIKER_ROLLEN)[number];

/** Login-accounts in Team (geen monteur-/portaalrol). */
export const TEAM_ROLLEN = [
  "admin",
  "sales_manager",
  "adviseur",
  "beller",
  "backoffice",
] as const;

export type TeamRol = (typeof TEAM_ROLLEN)[number];

export const gebruikerRolLabel: Record<GebruikerRol, string> = {
  adviseur: "Adviseur",
  beller: "Beller",
  backoffice: "Backoffice",
  sales_manager: "Sales manager",
  admin: "Admin",
  installateur: "Installateur",
};

export const teamRolUitleg: Record<TeamRol, string> = {
  admin: "Alles: leads, bellen, agenda, backoffice, rapportage, team",
  sales_manager:
    "Sales sturen: Today, weekmeeting, leads, offertes, netto, rapportage",
  adviseur:
    "Sales: leaderboard, eigen leads, agenda, offertes, netto, facturen, instellingen",
  beller:
    "Callcenter: leads, bellen, agenda alle adviseurs, eigen bel-rapportage",
  backoffice:
    "Leads, bellen (terugbel), agenda adviseurs, projecten, facturen, purchasing, adviseurs-contact",
};

export function normalizeRol(value: string | null | undefined): GebruikerRol {
  if (
    value === "adviseur" ||
    value === "beller" ||
    value === "backoffice" ||
    value === "sales_manager" ||
    value === "admin" ||
    value === "installateur"
  ) {
    return value;
  }
  return "adviseur";
}

/** Geen sales-commissie (admins, Huub, enz.). */
export function isUitgeslotenVanSalesCommissie(person: {
  naam?: string | null;
  rol?: string | null;
}): boolean {
  const naam = (person.naam || "").trim().toLowerCase();
  if (naam.includes("huub") && naam.includes("veldman")) return true;
  return normalizeRol(person.rol) !== "adviseur";
}

/** Tabs die deze rol mag zien (volgorde = menuvvolgorde). */
export function tabsVoorRol(
  rol: GebruikerRol,
  opts?: { email?: string | null }
): CrmTab[] {
  let tabs: CrmTab[];
  switch (rol) {
    case "adviseur":
      tabs = [
        "leaderboard",
        "leads",
        "agenda",
        "offertes",
        "netto",
        "facturen",
        "instellingen",
      ];
      break;
    case "beller":
      tabs = ["leads", "bellen", "agenda", "rapportage"];
      break;
    case "backoffice":
      tabs = [
        "leads",
        "bellen",
        "agenda",
        "projecten",
        "inbox",
        "facturen",
        "purchasing",
        "adviseurs",
      ];
      break;
    case "sales_manager":
      tabs = [
        "today",
        "weekmeeting",
        "leads",
        "offertes",
        "netto",
        "rapportage",
        "voice_ai",
        "adviseurs",
      ];
      break;
    case "installateur":
      tabs = [];
      break;
    case "admin":
    default:
      tabs = [
        "taken",
        "weekmeeting",
        "leads",
        "bellen",
        "agenda",
        "offertes",
        "netto",
        "leaderboard",
        "instroom",
        "projecten",
        "inbox",
        "facturen",
        "purchasing",
        "rapportage",
        "voice_ai",
        "adviseurs",
        "partners",
      ];
      break;
  }
  // Today: jona@ of sales_manager-rol
  if (
    opts?.email?.trim().toLowerCase() === "jona@batterijconcept.nl" ||
    rol === "sales_manager"
  ) {
    tabs = ["today", ...tabs.filter((t) => t !== "today")];
  }
  return tabs;
}

export function magTab(
  rol: GebruikerRol,
  tab: CrmTab,
  opts?: { email?: string | null }
): boolean {
  return tabsVoorRol(rol, opts).includes(tab);
}

/**
 * Alleen eigen leads (geen “Bekijk als”).
 * Beller deelt de team-bellijst (soft claim) — geen vaste beller_id-split.
 */
export function alleenEigenLeads(rol: GebruikerRol): boolean {
  return rol === "adviseur";
}

export function isBellerRol(rol: GebruikerRol | string | null | undefined): boolean {
  return normalizeRol(rol) === "beller";
}

/** Mag team / rollen beheren. */
export function magInstellingen(rol: GebruikerRol): boolean {
  return rol === "admin";
}

/** Mag “Bekijk als”-filter gebruiken. */
export function magBekijkAls(rol: GebruikerRol): boolean {
  return rol === "admin" || rol === "sales_manager";
}

/** Mag Sales Manager / weekmeeting sturen. */
export function magSalesSturing(rol: GebruikerRol): boolean {
  return rol === "admin" || rol === "sales_manager";
}

/**
 * Installatie-/schouw-agenda i.p.v. adviseur-huisbezoeken.
 * Backoffice gebruikt Planbord onder Backoffice; Agenda-tab = adviseurs.
 */
export function agendaIsInstallatie(_rol: GebruikerRol): boolean {
  return false;
}

/** Mag inkomende facturen bekijken/bewerken. */
export function magInkomend(rol: GebruikerRol): boolean {
  return rol === "admin" || rol === "backoffice";
}

/** Sales-adviseurs die afspraken kunnen krijgen. Inactief = niet inplannen. */
export function isPlanbareAdviseur(a: {
  actief?: boolean | null;
  rol?: string | null;
  naam: string;
  email?: string | null;
}): boolean {
  if (a.actief === false) return false;
  return normalizeRol(a.rol) === "adviseur";
}

/**
 * Zichtbaar in Agenda (eigen rooster, afblokken).
 * Inactief mag wél — alleen bel/auto-planning sluit hen uit.
 */
export function isAgendaAdviseur(a: {
  actief?: boolean | null;
  rol?: string | null;
  naam: string;
  email?: string | null;
}): boolean {
  return normalizeRol(a.rol) === "adviseur";
}

/**
 * Tijdelijk uit bel-opties (blijven actief voor login/offertes/agenda).
 * Sync met TIJDELIJK_NIET_PLANBAAR_EMAILS in admin-adviseur.ts.
 */
const TIJDELIJK_NIET_IN_BEL_EMAILS = new Set([
  "harald@batterijconcept.nl",
  "stijn@batterijconcept.nl",
]);

/**
 * Planbaar via bel-systeem / beste slots (fysieke afspraken).
 * Inactief (`actief === false`) → niet automatisch inplannen.
 */
export function isBelPlanAdviseur(a: {
  actief?: boolean | null;
  rol?: string | null;
  naam: string;
  email?: string | null;
}): boolean {
  if (!isPlanbareAdviseur(a)) return false;
  const email = a.email?.trim().toLowerCase();
  if (email && TIJDELIJK_NIET_IN_BEL_EMAILS.has(email)) return false;
  return true;
}

/**
 * Mag een terugbel / warme terugbel toegewezen krijgen:
 * sales-adviseur, callcenter (beller), backoffice of admin.
 */
export function isTerugbelPlanbaar(a: {
  actief?: boolean;
  rol?: string | null;
}): boolean {
  if (a.actief === false) return false;
  const rol = normalizeRol(a.rol);
  return (
    rol === "adviseur" ||
    rol === "beller" ||
    rol === "backoffice" ||
    rol === "admin"
  );
}

/** Alleen cijfers — voor telefoonzoek. */
export function digitsOnly(value: string | null | undefined): string {
  return (value || "").replace(/\D/g, "");
}

/**
 * Match telefoon op (deel van) cijfers — bijv. laatste 3 cijfers.
 * NL-varianten: 06… / +316… / 316…
 */
export function telefoonMatch(
  telefoon: string | null | undefined,
  query: string
): boolean {
  const q = digitsOnly(query);
  if (q.length < 2) return false;
  const phone = digitsOnly(telefoon);
  if (!phone) return false;
  if (phone.includes(q)) return true;
  const asLocal = phone.startsWith("31") ? `0${phone.slice(2)}` : phone;
  const asIntl = phone.startsWith("0") ? `31${phone.slice(1)}` : phone;
  return asLocal.includes(q) || asIntl.includes(q);
}
