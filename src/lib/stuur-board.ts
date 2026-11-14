/**
 * Action Board: per business-unit simpele rijen met status OK / Tekort.
 * Leads-unit = per provincie (adviseur-thuiscapaciteit vs lead-instroom).
 */

import { addDays, getISOWeekYear } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  dayKeyAmsterdam,
  loadAfblokkingen,
  loadSlotVrijgaven,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import {
  buildDashboardV2Capacity,
  type DashboardV2Capacity,
} from "@/lib/dashboard-v2/capacity";
import {
  NL_PROVINCIES,
  postcodeFromAdres,
  provincieVanPostcode,
  type NlProvincie,
} from "@/lib/postcode-provincie";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

export type StuurUnitId =
  | "leads"
  | "callcenter"
  | "sales"
  | "backoffice";

export const STUUR_UNITS: { id: StuurUnitId; label: string }[] = [
  { id: "leads", label: "Leads" },
  { id: "callcenter", label: "Callcenter" },
  { id: "sales", label: "Sales" },
  { id: "backoffice", label: "Backoffice" },
];

export type StuurStatus = "ok" | "tekort";

export type StuurRow = {
  key: string;
  label: string;
  /** Primair getal (bijv. leads 7d) */
  actual: number;
  /** Doel / nodig */
  needed: number;
  status: StuurStatus;
  detail: string;
};

export type StuurActie = {
  id: string;
  unit: StuurUnitId;
  row_key: string;
  row_label: string | null;
  titel: string;
  notitie: string | null;
  status: "open" | "done";
  created_at: string;
};

/** Maand-horizon ≈ 5 ISO-weken (~35d slots). */
export const STUUR_MONTH_WEEKS = 5;
/** Lead-/L2A-sample voor maandschatting. */
export const STUUR_MONTH_DAYS = 30;

export type StuurBoard = {
  /** ISO-weken capaciteit (standaard 5 ≈ maand) */
  weeksAhead: number;
  /** Lead-sample in dagen (standaard 30) */
  monthDays: number;
  l2aPct: number;
  units: Record<
    StuurUnitId,
    {
      label: string;
      rows: StuurRow[];
    }
  >;
};

type AdvRow = {
  id: string;
  naam: string;
  actief: boolean;
  rol: string | null;
  email?: string | null;
  startdatum?: string | null;
  start_adres?: string | null;
  start_vanaf_huis_maandag?: boolean | null;
};

async function loadUnavailableByAdviseur(
  sb: SupabaseClient,
  adviseurIds: string[],
  jaren: number[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (!adviseurIds.length || !jaren.length) return map;
  const { data, error } = await sb
    .from("adviseur_beschikbaarheid")
    .select("adviseur_id, jaar, week, beschikbaar")
    .in("adviseur_id", adviseurIds)
    .in("jaar", jaren)
    .eq("beschikbaar", false);
  if (error) {
    if (
      error.code === "42703" ||
      error.code === "42P01" ||
      /adviseur_beschikbaarheid|schema cache/i.test(error.message || "")
    ) {
      return map;
    }
    throw error;
  }
  for (const row of data || []) {
    const id = row.adviseur_id as string;
    const set = map.get(id) || new Set<string>();
    set.add(weekKeyString(Number(row.jaar), Number(row.week)));
    map.set(id, set);
  }
  return map;
}

function statusFor(needed: number, actual: number): StuurStatus {
  if (needed <= 0) return "ok";
  return actual >= needed ? "ok" : "tekort";
}

function startProvincie(adv: AdvRow): NlProvincie | null {
  const pc = postcodeFromAdres(adv.start_adres || "");
  if (!pc) return null;
  const p = provincieVanPostcode(pc);
  return p && NL_PROVINCIES.includes(p as NlProvincie)
    ? (p as NlProvincie)
    : null;
}

export async function buildStuurBoard(
  sb: SupabaseClient,
  opts?: { weeksAhead?: number; monthDays?: number; now?: Date }
): Promise<StuurBoard> {
  const now = opts?.now ?? new Date();
  const weeksAhead = Math.min(
    Math.max(opts?.weeksAhead ?? STUUR_MONTH_WEEKS, 1),
    6
  );
  const monthDays = Math.min(
    Math.max(opts?.monthDays ?? STUUR_MONTH_DAYS, 7),
    45
  );
  const van = dayKeyAmsterdam(now);
  const tot = dayKeyAmsterdam(addDays(now, weeksAhead * 7 + 2));
  const y = getISOWeekYear(now);
  const sinceMonth = addDays(now, -monthDays).toISOString();

  const [adviseursRes, afsprakenRes, leadsRes] = await Promise.all([
    sb
      .from("adviseurs")
      .select(
        "id, naam, actief, rol, email, startdatum, start_adres, start_vanaf_huis_maandag"
      ),
    sb
      .from("afspraken")
      .select("adviseur_id, start_at, end_at, status, soort")
      .gte("start_at", addDays(now, -3).toISOString())
      .lte("start_at", addDays(now, weeksAhead * 7 + 3).toISOString()),
    fetchAllRows((from, to) =>
      sb
        .from("leads")
        .select("id, postcode, created_at")
        .gte("created_at", sinceMonth)
        .order("created_at", { ascending: false })
        .range(from, to)
    ),
  ]);

  if (adviseursRes.error) throw adviseursRes.error;
  if (afsprakenRes.error) throw afsprakenRes.error;

  const adviseurs = ((adviseursRes.data || []) as AdvRow[]).filter((a) =>
    isPlanbaarAdviseur(a)
  );
  const afspraken = (afsprakenRes.data || []) as {
    adviseur_id: string | null;
    start_at: string;
    end_at?: string | null;
    status: string;
    soort: string | null;
  }[];
  const leadsMonth = (leadsRes || []) as {
    id: string;
    postcode: string | null;
    created_at: string;
  }[];

  const ids = adviseurs.map((a) => a.id);
  const [unavailableByAdviseur, afblokkingen, vrijgaven] = await Promise.all([
    loadUnavailableByAdviseur(sb, ids, [y - 1, y, y + 1]),
    loadAfblokkingen(sb, { adviseurIds: ids, van, tot }),
    loadSlotVrijgaven(sb, { adviseurIds: ids, van, tot }),
  ]);

  // Nationale L2A (laatste maand): nieuw-huisbezoek / leads
  const { data: nieuwAfs } = await sb
    .from("afspraken")
    .select("lead_id")
    .eq("soort", "nieuw")
    .gte("created_at", sinceMonth)
    .not("status", "eq", "geannuleerd");
  const uniqueApptLeads = new Set(
    (nieuwAfs || []).map((a) => a.lead_id as string)
  ).size;
  const l2aFractie =
    leadsMonth.length > 0
      ? Math.min(1, uniqueApptLeads / leadsMonth.length)
      : null;

  const afspraakIn = afspraken.map((a) => ({
    adviseur_id: a.adviseur_id,
    start_at: a.start_at,
    end_at: a.end_at ?? null,
    status: a.status,
    soort: a.soort,
  }));

  function capacityFor(subset: AdvRow[]): DashboardV2Capacity {
    const subsetIds = new Set(subset.map((a) => a.id));
    return buildDashboardV2Capacity({
      adviseurs: subset,
      afspraken: afspraakIn.filter(
        (a) => a.adviseur_id && subsetIds.has(a.adviseur_id)
      ),
      unavailableByAdviseur,
      afblokkingen,
      vrijgaven,
      weeksAhead,
      now,
      targetLeadToAppt: l2aFractie,
      l2aSampleLeads: leadsMonth.length,
      l2aSampleAfspraken: uniqueApptLeads,
      leadsGegenereerd7d: 0,
    });
  }

  const leadsByProv = new Map<string, number>();
  for (const l of leadsMonth) {
    const p = provincieVanPostcode(l.postcode) || "(onbekend)";
    leadsByProv.set(p, (leadsByProv.get(p) || 0) + 1);
  }

  const advByProv = new Map<NlProvincie, AdvRow[]>();
  for (const a of adviseurs) {
    const p = startProvincie(a);
    if (!p) continue;
    const list = advByProv.get(p) || [];
    list.push(a);
    advByProv.set(p, list);
  }

  const leadRows: StuurRow[] = NL_PROVINCIES.map((prov) => {
    const advs = advByProv.get(prov) || [];
    const cap =
      advs.length > 0
        ? capacityFor(advs)
        : ({
            slotsVrij: 0,
            leadsNodig: 0,
            leadsNodigPerWeek: 0,
          } as Pick<
            DashboardV2Capacity,
            "slotsVrij" | "leadsNodig" | "leadsNodigPerWeek"
          >);
    const actual = leadsByProv.get(prov) || 0;
    // Maand: leads/30d vs leadsNodig voor vrije slots komende maand
    const needed = Math.ceil(cap.leadsNodig || 0);
    return {
      key: prov,
      label: prov,
      actual,
      needed,
      status: statusFor(needed, actual),
      detail:
        advs.length === 0
          ? `${actual} leads/${monthDays}d · geen lokale adviseur`
          : `${cap.slotsVrij} vrij · ${needed} leads/maand nodig · ${actual} leads/${monthDays}d · ${advs.length} adv`,
    };
  })
    // Alleen rijen die ertoe doen: lokale capaciteit of recente leads
    .filter((r) => r.needed > 0 || r.actual > 0)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "tekort" ? -1 : 1;
      return b.needed - a.needed || a.label.localeCompare(b.label, "nl");
    });

  // Callcenter: open bel-leads (geen afspraak) + inbox open
  let belOpen = 0;
  let inboxOpen = 0;
  try {
    const bel = await sb
      .from("leads")
      .select("id", { count: "exact", head: true })
      .in("status", ["nieuw", "geen_contact"])
      .not("telefoon", "is", null);
    belOpen = bel.count || 0;
  } catch {
    /* ignore */
  }
  try {
    const inbox = await sb
      .from("inbox_mails")
      .select("id", { count: "exact", head: true })
      .not("folder", "in", "(archief,verzonden)")
      .not("status", "in", "(afgehandeld,gearchiveerd)");
    inboxOpen = inbox.count || 0;
  } catch {
    /* ignore */
  }

  const callcenterRows: StuurRow[] = [
    {
      key: "bel_queue",
      label: "Bellijst (open)",
      actual: belOpen || 0,
      needed: 0,
      status: "ok",
      detail: `${belOpen || 0} belbare leads — actie als backlog te hoog voelt`,
    },
    {
      key: "inbox_open",
      label: "Inbox zonder reactie",
      actual: inboxOpen || 0,
      needed: 0,
      // Soft: >10 = tekort (achterstand)
      status: (inboxOpen || 0) > 10 ? "tekort" : "ok",
      detail:
        (inboxOpen || 0) > 10
          ? `${inboxOpen} open mails — reageer of archiveer`
          : `${inboxOpen || 0} open`,
    },
  ];

  const national = capacityFor(adviseurs);
  const leadsNodigMaand = Math.ceil(national.leadsNodig || 0);
  const salesRows: StuurRow[] = [
    {
      key: "agenda_vrij",
      label: "Agenda vrij (maand)",
      actual: national.slotsVrij,
      needed: national.slotsOpen,
      status:
        national.slotsOpen > 0 &&
        national.slotsVrij / Math.max(national.slotsOpen, 1) > 0.35
          ? "tekort"
          : "ok",
      detail: `${national.slotsVrij} vrij van ${national.slotsOpen} open · ${national.slotsGepland} gepland`,
    },
    {
      key: "leads_tempo",
      label: "Leads vs agenda (maand)",
      actual: leadsMonth.length,
      needed: leadsNodigMaand,
      status: statusFor(leadsNodigMaand, leadsMonth.length),
      detail: `${leadsMonth.length}/${monthDays}d · nodig ≈ ${leadsNodigMaand}/maand @ ${Math.round((l2aFractie ?? 0.25) * 1000) / 10}% L2A`,
    },
  ];

  let boOpen = 0;
  try {
    const bo = await sb
      .from("project_taken")
      .select("id", { count: "exact", head: true })
      .neq("status", "done");
    boOpen = bo.count || 0;
  } catch {
    /* ignore */
  }

  const backofficeRows: StuurRow[] = [
    {
      key: "bo_taken",
      label: "Open backoffice-taken",
      actual: boOpen,
      needed: 0,
      status: boOpen > 40 ? "tekort" : "ok",
      detail: `${boOpen} open taken`,
    },
  ];

  return {
    weeksAhead,
    monthDays,
    l2aPct: Math.round((l2aFractie ?? 0.25) * 1000) / 10,
    units: {
      leads: { label: "Leads", rows: leadRows },
      callcenter: { label: "Callcenter", rows: callcenterRows },
      sales: { label: "Sales", rows: salesRows },
      backoffice: { label: "Backoffice", rows: backofficeRows },
    },
  };
}
