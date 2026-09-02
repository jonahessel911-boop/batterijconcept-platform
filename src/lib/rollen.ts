import type { CrmTab } from "@/types/database";

export const GEBRUIKER_ROLLEN = [
  "adviseur",
  "backoffice",
  "admin",
  "installateur",
] as const;

export type GebruikerRol = (typeof GEBRUIKER_ROLLEN)[number];

export const gebruikerRolLabel: Record<GebruikerRol, string> = {
  adviseur: "Adviseur",
  backoffice: "Backoffice",
  admin: "Admin",
  installateur: "Installateur",
};

export function normalizeRol(value: string | null | undefined): GebruikerRol {
  if (
    value === "adviseur" ||
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
      return ["leads", "agenda", "offertes"];
    case "backoffice":
      return ["leads", "agenda", "projecten", "facturen"];
    case "installateur":
      return [];
    case "admin":
    default:
      return [
        "leads",
        "bellen",
        "agenda",
        "offertes",
        "instroom",
        "projecten",
        "facturen",
        "rapportage",
        "instellingen",
      ];
  }
}

export function magTab(rol: GebruikerRol, tab: CrmTab): boolean {
  return tabsVoorRol(rol).includes(tab);
}

/** Alleen eigen leads (geen “Bekijk als”). */
export function alleenEigenLeads(rol: GebruikerRol): boolean {
  return rol === "adviseur";
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
 * niet de adviseur-afsprakenagenda.
 */
export function agendaIsInstallatie(rol: GebruikerRol): boolean {
  return rol === "backoffice";
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
  // +31 6 … ↔ 06 …
  const asLocal = phone.startsWith("31") ? `0${phone.slice(2)}` : phone;
  const asIntl = phone.startsWith("0") ? `31${phone.slice(1)}` : phone;
  return asLocal.includes(q) || asIntl.includes(q);
}
