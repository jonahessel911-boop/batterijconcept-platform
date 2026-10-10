import type { CrmTab } from "@/types/database";

export const GEBRUIKER_ROLLEN = [
  "adviseur",
  "beller",
  "backoffice",
  "admin",
  "installateur",
] as const;

export type GebruikerRol = (typeof GEBRUIKER_ROLLEN)[number];

/** Login-accounts in Partners → Team (geen installateur-portaalrol). */
export const TEAM_ROLLEN = [
  "admin",
  "adviseur",
  "beller",
  "backoffice",
] as const;

export type TeamRol = (typeof TEAM_ROLLEN)[number];

export const gebruikerRolLabel: Record<GebruikerRol, string> = {
  adviseur: "Adviseur",
  beller: "Beller",
  backoffice: "Backoffice",
  admin: "Admin",
  installateur: "Installateur",
};

export const teamRolUitleg: Record<TeamRol, string> = {
  admin: "Alles: leads, bellen, agenda, backoffice, rapportage, partners",
  adviseur: "Sales: eigen leads, agenda, offertes, netto, facturen",
  beller: "Callcenter: leads + bellen (gedeelde bellijst met claim)",
  backoffice: "Leads, bellen (terugbel), projecten, facturen, inkomend, purchasing",
};

export function normalizeRol(value: string | null | undefined): GebruikerRol {
  if (
    value === "adviseur" ||
    value === "beller" ||
    value === "backoffice" ||
    value === "admin" ||
    value === "installateur"
  ) {
    return value;
  }
  return "adviseur";
}

/** Tabs die deze rol mag zien (volgorde = menuvvolgorde). */
export function tabsVoorRol(rol: GebruikerRol): CrmTab[] {
  switch (rol) {
    case "adviseur":
      return ["leads", "agenda", "offertes", "netto", "facturen"];
    case "beller":
      return ["leads", "bellen"];
    case "backoffice":
      return ["leads", "bellen", "projecten", "facturen", "inkomend", "purchasing"];
    case "installateur":
      return [];
    case "admin":
    default:
      return [
        "taken",
        "leads",
        "bellen",
        "agenda",
        "offertes",
        "netto",
        "leaderboard",
        "instroom",
        "projecten",
        "facturen",
        "inkomend",
        "purchasing",
        "rapportage",
        "admin",
        "partners",
      ];
  }
}

export function magTab(rol: GebruikerRol, tab: CrmTab): boolean {
  return tabsVoorRol(rol).includes(tab);
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
  return rol === "admin";
}

/**
 * Backoffice-rol: agenda = installatie-agenda (schouw/installatie),
 * niet de adviseur-afsprakenagenda. (Agenda-tab zelf is voor backoffice uit.)
 */
export function agendaIsInstallatie(rol: GebruikerRol): boolean {
  return rol === "backoffice";
}

/** Mag inkomende facturen bekijken/bewerken. */
export function magInkomend(rol: GebruikerRol): boolean {
  return rol === "admin" || rol === "backoffice";
}

/** Sales-adviseurs die afspraken kunnen krijgen. Inactief = niet inplannen. */
export function isPlanbareAdviseur(a: {
  actief?: boolean;
  rol?: string | null;
  naam: string;
  email?: string | null;
}): boolean {
  if (a.actief === false) return false;
  return normalizeRol(a.rol) === "adviseur";
}

/**
 * Planbaar via bel-systeem / beste slots (fysieke afspraken).
 * Inactief (`actief === false`) → niet automatisch inplannen.
 */
export function isBelPlanAdviseur(a: {
  actief?: boolean;
  rol?: string | null;
  naam: string;
  email?: string | null;
}): boolean {
  return isPlanbareAdviseur(a);
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
