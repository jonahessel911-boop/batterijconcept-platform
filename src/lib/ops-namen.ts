/**
 * Naam-checks voor beller en ops. Geen andere imports: admin-adviseur
 * gebruikt dit, en ops-commissie importeert labels. Die cirkel liet
 * /api/auth/login crashen, waardoor Leads op "Laden…" bleef staan.
 */

function firstNameToken(naam: string | null | undefined): string {
  return String(naam || "").trim().toLowerCase().split(/\s+/)[0] || "";
}

/** Simon (voorheen Sharath): de beller met €10 per ingepland huisbezoek. */
export function isSimonBeller(a: { naam?: string | null }): boolean {
  const n = String(a.naam || "").trim().toLowerCase();
  const first = firstNameToken(n);
  return (
    first === "simon" ||
    first === "sharath" ||
    first === "sharet" ||
    n.includes("sharath")
  );
}

export function isSharathBeller(a: { naam?: string | null }): boolean {
  return isSimonBeller(a);
}

/** Rik (voorheen Tarik): ops-manager / standaard backoffice. */
export function isRikNaam(naam: string | null | undefined): boolean {
  const first = firstNameToken(naam);
  return first === "rik" || first === "tarik";
}

export function isOpsManagerAdviseur(a: {
  id: string;
  naam?: string | null;
  email?: string | null;
  rol?: string | null;
}): boolean {
  return isRikNaam(a.naam);
}
