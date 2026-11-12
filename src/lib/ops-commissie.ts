/**
 * Commissie operationeel:
 * - Simon (voorheen Sharath): €10 per ingeplande (1e) huisbezoek-afspraak
 * - Rik/Tarik: vaste weekfee (€3.750/mnd) + €2,50 bonus per afspraak
 *   die Simon inplant (teamlead)
 */

import { formatInTimeZone } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isBelAfspraakUitvalLeadStatus } from "@/lib/labels";
import {
  isOpsManagerAdviseur as isOpsManagerNaam,
  isSimonBeller,
} from "@/lib/ops-namen";
import { normalizeRol } from "@/lib/rollen";

/** € per nieuw huisbezoek dat een beller inplant. */
export const BELLER_PER_INGEPLANDE_AFSPRAAK = 10;

/** Vast maandsalaris/commissie ops-manager (Rik/Tarik). */
export const OPS_MANAGER_FIXED_PER_MONTH = 3750;

/** Bonus ops-manager per huisbezoek dat Simon inplant. */
export const OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK = 2.5;

/** Weekdeel van het vaste maandbedrag (52 weken / jaar). */
export const OPS_MANAGER_FIXED_PER_WEEK =
  Math.round(((OPS_MANAGER_FIXED_PER_MONTH * 12) / 52) * 100) / 100;

export type OpsCommissieAfspraak = {
  id: string;
  lead_id: string;
  created_at: string | null;
  status: string | null;
  soort: string | null;
  ingepland_door_id?: string | null;
};

export type OpsCommissieAdviseur = {
  id: string;
  naam: string;
  rol?: string | null;
  actief?: boolean | null;
};

export type OpsCommissieBreakdown = {
  /** Totaal ops-commissie (bellers + ops-manager vast + bonus) */
  totaal: number;
  bellersBedrag: number;
  bellersAfspraken: number;
  /** Per beller (alleen > 0) */
  perBeller: { id: string; naam: string; afspraken: number; bedrag: number }[];
  tarikVast: number;
  tarikBonus: number;
  tarikAfspraken: number;
  tarikNaam: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isNieuwHuisbezoek(a: OpsCommissieAfspraak): boolean {
  return (a.soort || "").trim() === "nieuw" && a.status !== "geannuleerd";
}

/** Eerste actieve nieuw-huisbezoek per lead (op created_at). */
export function eersteNieuwHuisbezoekIdPerLead(
  afspraken: OpsCommissieAfspraak[]
): Map<string, string> {
  const best = new Map<string, { id: string; at: number }>();
  for (const a of afspraken) {
    if (!isNieuwHuisbezoek(a) || !a.created_at) continue;
    const at = new Date(a.created_at).getTime();
    if (!Number.isFinite(at)) continue;
    const prev = best.get(a.lead_id);
    if (!prev || at < prev.at) best.set(a.lead_id, { id: a.id, at });
  }
  const out = new Map<string, string>();
  for (const [leadId, v] of best) out.set(leadId, v.id);
  return out;
}

export function isSharathBeller(a: { naam?: string | null }): boolean {
  return isSimonBeller(a);
}

export function isOpsManagerAdviseur(a: {
  id: string;
  naam?: string | null;
  email?: string | null;
  rol?: string | null;
}): boolean {
  return isOpsManagerNaam(a);
}

export function isBellerRol(rol: string | null | undefined): boolean {
  return normalizeRol(rol) === "beller";
}

/**
 * Ops-commissie voor één weekvenster.
 * `includeVast` = weekdeel Tarik meenemen (true voor elke rapportage-week).
 */
export function computeOpsCommissieForWindow(opts: {
  afspraken: OpsCommissieAfspraak[];
  /** Volledige historie voor “1e huisbezoek” (default = afspraken). */
  historie?: OpsCommissieAfspraak[];
  adviseurs: OpsCommissieAdviseur[];
  startYmd: string;
  endYmd: string;
  /** Ops-manager (Rik/Tarik) id (null = geen vast/bonus). */
  tarikId?: string | null;
  tarikNaam?: string | null;
  includeVast?: boolean;
  /** Leadstatus: deur_niet_open / niet_gekwalificeerd tellen niet mee. */
  leadStatusById?: ReadonlyMap<string, string | null> | null;
}): OpsCommissieBreakdown {
  const historie = opts.historie ?? opts.afspraken;
  const eersteIds = eersteNieuwHuisbezoekIdPerLead(historie);
  const simonIds = new Set(
    opts.adviseurs.filter((a) => isSimonBeller(a)).map((a) => a.id)
  );
  const naamById = new Map(opts.adviseurs.map((a) => [a.id, a.naam] as const));
  const tarikId = (opts.tarikId || "").trim() || null;
  const leadStatuses = opts.leadStatusById ?? null;

  const perBellerCount = new Map<string, number>();
  let teamAfspraken = 0;

  for (const a of opts.afspraken) {
    if (!isNieuwHuisbezoek(a) || !a.created_at) continue;
    if (eersteIds.get(a.lead_id) !== a.id) continue;
    if (
      leadStatuses &&
      isBelAfspraakUitvalLeadStatus(leadStatuses.get(a.lead_id) ?? null)
    ) {
      continue;
    }
    // Amsterdam-dag (niet UTC-slice) — avondboekingen vallen in de juiste week
    const ymd = formatInTimeZone(
      new Date(a.created_at),
      AMSTERDAM_TZ,
      "yyyy-MM-dd"
    );
    if (ymd < opts.startYmd || ymd > opts.endYmd) continue;

    const door = (a.ingepland_door_id || "").trim();
    if (!door || !simonIds.has(door)) continue;

    // Alleen wat Simon inplant: zijn €10 én ops-manager €2,50 teamlead-bonus.
    teamAfspraken += 1;
    perBellerCount.set(door, (perBellerCount.get(door) || 0) + 1);
  }

  const perBeller = [...perBellerCount.entries()]
    .map(([id, afspraken]) => ({
      id,
      naam: naamById.get(id) || "Beller",
      afspraken,
      bedrag: round2(afspraken * BELLER_PER_INGEPLANDE_AFSPRAAK),
    }))
    .sort(
      (a, b) =>
        b.bedrag - a.bedrag || a.naam.localeCompare(b.naam, "nl")
    );

  const bellersAfspraken = perBeller.reduce((s, r) => s + r.afspraken, 0);
  const bellersBedrag = round2(
    perBeller.reduce((s, r) => s + r.bedrag, 0)
  );

  const tarikVast =
    tarikId && opts.includeVast !== false
      ? OPS_MANAGER_FIXED_PER_WEEK
      : 0;
  const tarikBonus = tarikId
    ? round2(teamAfspraken * OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK)
    : 0;

  return {
    totaal: round2(bellersBedrag + tarikVast + tarikBonus),
    bellersBedrag,
    bellersAfspraken,
    perBeller,
    tarikVast,
    tarikBonus,
    tarikAfspraken: teamAfspraken,
    tarikNaam: opts.tarikNaam?.trim() || "Rik",
  };
}

/** Korte labeltekst voor Team-UI. */
export function opsCommissieLabelVoorRol(opts: {
  rol: string | null | undefined;
  isOpsManager: boolean;
}): string | null {
  if (opts.isOpsManager) {
    return `€${OPS_MANAGER_FIXED_PER_MONTH.toLocaleString("nl-NL")}/mnd + €${OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per afspraak die Simon inplant (zelfde netto als Simon)`
  }
  if (isBellerRol(opts.rol)) {
    return `€${BELLER_PER_INGEPLANDE_AFSPRAAK}/afspraak`;
  }
  return null;
}
