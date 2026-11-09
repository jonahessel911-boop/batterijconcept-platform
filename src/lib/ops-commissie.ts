/**
 * Commissie operationeel:
 * - Sharath: €10 per ingeplande (1e) huisbezoek-afspraak
 * - Tarik: vaste weekfee (€3.750/mnd) + €2,50 bonus per afspraak
 *   die Sharath inplant (Tarik is zijn teamlead)
 */

import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isBelAfspraakUitvalLeadStatus } from "@/lib/labels";
import { isSimonBeller } from "@/lib/ops-namen";
import { normalizeRol } from "@/lib/rollen";

export {
  isOpsManagerAdviseur,
  isRikNaam,
  isSharathBeller,
  isSimonBeller,
} from "@/lib/ops-namen";

/** € per nieuw huisbezoek dat een beller inplant. */
export const BELLER_PER_INGEPLANDE_AFSPRAAK = 10;

/** Vast maandsalaris/commissie Tarik (ops manager). */
export const OPS_MANAGER_FIXED_PER_MONTH = 3750;

/** Bonus Tarik per huisbezoek dat Sharath inplant. */
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
  /** Totaal ops-commissie (bellers + Tarik vast + Tarik bonus) */
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
  /** Tarik / ops-manager id (null = geen vast/bonus). */
  tarikId?: string | null;
  tarikNaam?: string | null;
  includeVast?: boolean;
  /** Leadstatus: deur_niet_open / niet_gekwalificeerd tellen niet mee. */
  leadStatusById?: ReadonlyMap<string, string | null> | null;
}): OpsCommissieBreakdown {
  const naamById = new Map(opts.adviseurs.map((a) => [a.id, a.naam] as const));
  const tarikId = (opts.tarikId || "").trim() || null;
  const momenten = simonNettoPlanmomenten({
    afspraken: opts.afspraken,
    historie: opts.historie,
    adviseurs: opts.adviseurs,
    leadStatusById: opts.leadStatusById,
    startYmd: opts.startYmd,
    endYmd: opts.endYmd,
  });

  const perBellerCount = new Map<string, number>();
  for (const m of momenten) {
    perBellerCount.set(m.bellerId, (perBellerCount.get(m.bellerId) || 0) + 1);
  }
  const teamAfspraken = momenten.length;

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
    return `€${OPS_MANAGER_FIXED_PER_MONTH.toLocaleString("nl-NL")}/mnd + €${OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per afspraak die Simon inplant`;
  }
  if (isBellerRol(opts.rol)) {
    return `€${BELLER_PER_INGEPLANDE_AFSPRAAK}/afspraak`;
  }
  return null;
}

function amsterdamYmd(iso: string): string {
  const s = iso.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return formatInTimeZone(new Date(s), AMSTERDAM_TZ, "yyyy-MM-dd");
}

/**
 * Eerste huisbezoek dat Simon inplant, op de Amsterdamse plandag.
 * Zelfde regels als de weekcommissie (geen uitval, geen annulering).
 */
export function simonNettoPlanmomenten(opts: {
  afspraken: OpsCommissieAfspraak[];
  historie?: OpsCommissieAfspraak[];
  adviseurs: OpsCommissieAdviseur[];
  leadStatusById?: ReadonlyMap<string, string | null> | null;
  startYmd?: string;
  endYmd?: string;
}): { ymd: string; bellerId: string }[] {
  const historie = opts.historie ?? opts.afspraken;
  const eersteIds = eersteNieuwHuisbezoekIdPerLead(historie);
  const simonIds = new Set(
    opts.adviseurs.filter((a) => isSimonBeller(a)).map((a) => a.id)
  );
  const leadStatuses = opts.leadStatusById ?? null;
  const out: { ymd: string; bellerId: string }[] = [];

  for (const a of opts.afspraken) {
    if (!isNieuwHuisbezoek(a) || !a.created_at) continue;
    if (eersteIds.get(a.lead_id) !== a.id) continue;
    if (
      leadStatuses &&
      isBelAfspraakUitvalLeadStatus(leadStatuses.get(a.lead_id) ?? null)
    ) {
      continue;
    }
    const ymd = formatInTimeZone(
      new Date(a.created_at),
      AMSTERDAM_TZ,
      "yyyy-MM-dd"
    );
    if (opts.startYmd && ymd < opts.startYmd) continue;
    if (opts.endYmd && ymd > opts.endYmd) continue;
    const door = (a.ingepland_door_id || "").trim();
    if (!door || !simonIds.has(door)) continue;
    out.push({ ymd, bellerId: door });
  }
  return out;
}

export type BellerBetaling = {
  id: string;
  naam: string;
  bedragEx: number;
  ymd: string;
};

/** Betaalde belcommissie (creditfactuur status betaald), op betaaldatum. */
export async function loadBetaaldeBellerCommissie(
  sb: SupabaseClient,
  adviseurs: { id: string; naam: string; rol?: string | null }[],
  startYmd: string,
  endYmd: string
): Promise<BellerBetaling[]> {
  const bellers = adviseurs.filter(
    (a) => isBellerRol(a.rol) || isSimonBeller(a)
  );
  if (!bellers.length) return [];
  const naamById = new Map(bellers.map((a) => [a.id, a.naam] as const));
  const { data, error } = await sb
    .from("adviseur_creditfacturen")
    .select("id, adviseur_id, status, bedrag_ex_btw, betaald_op")
    .in(
      "adviseur_id",
      bellers.map((a) => a.id)
    )
    .eq("status", "betaald")
    .not("betaald_op", "is", null)
    .gte("betaald_op", startYmd)
    .lte("betaald_op", `${endYmd}T23:59:59.999Z`);
  if (error || !data) return [];

  const out: BellerBetaling[] = [];
  for (const row of data) {
    const betaald = (row.betaald_op as string | null) || "";
    if (!betaald) continue;
    const ymd = amsterdamYmd(betaald);
    if (ymd < startYmd || ymd > endYmd) continue;
    const bedrag = Number(row.bedrag_ex_btw) || 0;
    if (bedrag === 0) continue;
    out.push({
      id: row.adviseur_id as string,
      naam: naamById.get(row.adviseur_id as string) || "Beller",
      bedragEx: bedrag,
      ymd,
    });
  }
  return out;
}

type OpsWeekRef = { weekKey: string; startYmd: string; endYmd: string };

function monthsInRange(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  let y = Number(startYmd.slice(0, 4));
  let m = Number(startYmd.slice(5, 7));
  const end = endYmd.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function weekKeyForYmd(ymd: string, weeks: OpsWeekRef[]): string | null {
  for (const w of weeks) {
    if (ymd >= w.startYmd && ymd <= w.endYmd) return w.weekKey;
  }
  return null;
}

/**
 * P&L-boeking commissie ops:
 * - Rik: €3.750 in de kalendermaand (niet het weekdeel op de maandag)
 * - Beller: wat in die maand betaald is (betaaldatum)
 * - Bonus Rik: €2,50 op de dag dat Simon het huisbezoek inplande
 */
export function verdeelOpsInPeriode(opts: {
  startYmd: string;
  endYmd: string;
  weeks: OpsWeekRef[];
  tarikNaam: string;
  includeTarikVast: boolean;
  betalingen: BellerBetaling[];
  bonusYmds: string[];
}): {
  weekDetail: Map<string, OpsCommissieBreakdown>;
  weekTotaal: Map<string, number>;
  monthTotaal: Map<string, number>;
} {
  const tarikNaam = opts.tarikNaam.trim() || "Rik";
  const weekPaid = new Map<string, Map<string, { naam: string; bedrag: number }>>();
  const weekBonus = new Map<string, number>();
  const weekVast = new Map<string, number>();
  const monthTotaal = new Map<string, number>();

  const bumpMonth = (month: string, amount: number) => {
    monthTotaal.set(month, round2((monthTotaal.get(month) || 0) + amount));
  };

  for (const month of monthsInRange(opts.startYmd, opts.endYmd)) {
    if (!opts.includeTarikVast) continue;
    bumpMonth(month, OPS_MANAGER_FIXED_PER_MONTH);
    const anchor = opts.weeks
      .filter((w) => w.startYmd.slice(0, 7) === month)
      .sort((a, b) => a.startYmd.localeCompare(b.startYmd))[0];
    if (anchor) {
      weekVast.set(
        anchor.weekKey,
        round2((weekVast.get(anchor.weekKey) || 0) + OPS_MANAGER_FIXED_PER_MONTH)
      );
    }
  }

  for (const bet of opts.betalingen) {
    if (bet.ymd < opts.startYmd || bet.ymd > opts.endYmd) continue;
    bumpMonth(bet.ymd.slice(0, 7), bet.bedragEx);
    const wk = weekKeyForYmd(bet.ymd, opts.weeks);
    if (!wk) continue;
    let byId = weekPaid.get(wk);
    if (!byId) {
      byId = new Map();
      weekPaid.set(wk, byId);
    }
    const prev = byId.get(bet.id);
    byId.set(bet.id, {
      naam: bet.naam,
      bedrag: round2((prev?.bedrag || 0) + bet.bedragEx),
    });
  }

  for (const ymd of opts.bonusYmds) {
    if (ymd < opts.startYmd || ymd > opts.endYmd) continue;
    bumpMonth(ymd.slice(0, 7), OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK);
    const wk = weekKeyForYmd(ymd, opts.weeks);
    if (!wk) continue;
    weekBonus.set(wk, (weekBonus.get(wk) || 0) + 1);
  }

  const weekDetail = new Map<string, OpsCommissieBreakdown>();
  const weekTotaal = new Map<string, number>();
  const weekKeys = new Set<string>([
    ...weekPaid.keys(),
    ...weekBonus.keys(),
    ...weekVast.keys(),
  ]);
  for (const weekKey of weekKeys) {
    const paid = [...(weekPaid.get(weekKey)?.entries() || [])].map(
      ([id, v]) => ({
        id,
        naam: v.naam,
        afspraken: 0,
        bedrag: round2(v.bedrag),
      })
    );
    const bonusN = weekBonus.get(weekKey) || 0;
    const vast = weekVast.get(weekKey) || 0;
    const bellersBedrag = round2(paid.reduce((s, r) => s + r.bedrag, 0));
    const tarikBonus = round2(bonusN * OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK);
    const totaal = round2(bellersBedrag + vast + tarikBonus);
    weekTotaal.set(weekKey, totaal);
    weekDetail.set(weekKey, {
      totaal,
      bellersBedrag,
      bellersAfspraken: 0,
      perBeller: paid.sort(
        (a, b) => b.bedrag - a.bedrag || a.naam.localeCompare(b.naam, "nl")
      ),
      tarikVast: vast,
      tarikBonus,
      tarikAfspraken: bonusN,
      tarikNaam,
    });
  }

  return { weekDetail, weekTotaal, monthTotaal };
}
