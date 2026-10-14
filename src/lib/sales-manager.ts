/**
 * Sales Manager dashboard: metrics + conversiedoelen per maand.
 */

import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isPlanbaarAdviseur } from "@/lib/admin-adviseur";
import {
  afspraakBlokkeertAgenda,
  needsVervolgPunt,
} from "@/lib/afspraak-soort";
import type { Afspraak } from "@/types/database";

export type SalesManagerGoalsStore = Record<
  string,
  Record<string, number>
>;

export type SalesManagerRow = {
  adviseur_id: string;
  naam: string;
  /** Fysieke afspraken vandaag (Amsterdam) */
  afspraken_vandaag: number;
  /** true als er vandaag ≥1 fysieke afspraak staat */
  heeft_afspraak_vandaag: boolean;
  /** Geplande fysieke afspraken in komende 14 dagen */
  afspraken_2w: number;
  /** Afgelopen fysieke afspraken nog niet afgeboekt */
  niet_afgeboekt: number;
  /** Gelopen huisbezoeken in geselecteerde maand */
  gelopen: number;
  /** Deals (ondertekend) uit die gelopen leads */
  deals: number;
  /** Conversie % (gelopen → deal) in maand = afspraak→sale */
  conversie_pct: number | null;
  /** Doel % voor deze maand (null = niet gezet) */
  conversie_doel_pct: number | null;
  /** Omzet ondertekende offertes in maand (inc. btw) */
  omzet_inc: number;
  /** Gem. orderwaarde inc. btw (omzet / # ondertekende offertes in maand) */
  avg_order_value: number | null;
};

export type SalesManagerMonthConversie = {
  monthKey: string;
  label: string;
  gelopen: number;
  deals: number;
  conversie_pct: number | null;
  conversie_doel_pct: number | null;
  omzet_inc: number;
};

export type SalesManagerTotals = {
  adviseurs: number;
  met_afspraak_vandaag: number;
  afspraken_2w: number;
  niet_afgeboekt: number;
  gelopen: number;
  deals: number;
  omzet_inc: number;
  conversie_pct: number | null;
};

export type SalesManagerActiepunt = {
  adviseur_id: string;
  naam: string;
  reden: "niet_afgeboekt" | "onder_doel" | "lege_agenda";
  detail: string;
};

export type SalesManagerTimelineKind =
  | "sollicitatie"
  | "contract"
  | "eerste_afspraak"
  | "startdatum"
  | "deal";

export type SalesManagerTimelineEvent = {
  kind: SalesManagerTimelineKind;
  at: string;
  titel: string;
  detail: string | null;
  /** Bij deal: lead/offerte refs */
  lead_id?: string | null;
  offerte_id?: string | null;
  bedrag_inc?: number | null;
};

export type SalesManagerMapPin = {
  kind: "home" | "afspraak";
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** Hover / detail */
  subtitel: string | null;
  notitie: string | null;
  start_at: string | null;
  status: string | null;
  lead_id: string | null;
  lead_naam: string | null;
  lead_telefoon: string | null;
  lead_email: string | null;
  adres: string | null;
};

export type SalesManagerDetail = {
  adviseur_id: string;
  naam: string;
  email: string | null;
  start_adres: string | null;
  startdatum: string | null;
  contract_signed_at: string | null;
  contract_sign_status: string | null;
  /** Maand-KPIs (zelfde als rij) */
  row: SalesManagerRow;
  /** Afspraak → sale ratio (alias conversie_pct) */
  afspraak_sale_ratio: number | null;
  avg_order_value: number | null;
  /** Conversie per maand (oud → nieuw), incl. doelen */
  conversie_maanden: SalesManagerMonthConversie[];
  /** Activiteiten + deals chronologisch */
  timeline: SalesManagerTimelineEvent[];
  /** Kaart: huis + afspraken (±14d / maand) */
  map_pins: SalesManagerMapPin[];
};

export function monthKeyAmsterdam(d = new Date()): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM");
}

/** Maandgrenzen Amsterdam als ISO (start inclusief, end exclusief). */
export function monthRangeAmsterdam(monthKey: string): {
  startIso: string;
  endIso: string;
  label: string;
} {
  const m = monthKey.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    const now = monthKeyAmsterdam();
    return monthRangeAmsterdam(now);
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const startLocal = fromZonedTime(
    new Date(y, mo - 1, 1, 0, 0, 0, 0),
    AMSTERDAM_TZ
  );
  const endLocal = fromZonedTime(
    new Date(y, mo, 1, 0, 0, 0, 0),
    AMSTERDAM_TZ
  );
  const label = formatInTimeZone(startLocal, AMSTERDAM_TZ, "MMMM yyyy");
  return {
    startIso: startLocal.toISOString(),
    endIso: endLocal.toISOString(),
    label: label.charAt(0).toUpperCase() + label.slice(1),
  };
}

export function parseSalesManagerGoals(raw: unknown): SalesManagerGoalsStore {
  if (!raw || typeof raw !== "object") return {};
  const out: SalesManagerGoalsStore = {};
  for (const [mk, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(mk) || !v || typeof v !== "object") continue;
    const month: Record<string, number> = {};
    for (const [aid, pct] of Object.entries(v as Record<string, unknown>)) {
      const n = typeof pct === "number" ? pct : Number(pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) continue;
      month[aid] = Math.round(n * 10) / 10;
    }
    if (Object.keys(month).length > 0) out[mk] = month;
  }
  return out;
}

export async function loadSalesManagerGoals(
  sb: SupabaseClient
): Promise<{ id: string | null; goals: SalesManagerGoalsStore }> {
  const { data, error } = await sb
    .from("dashboard_instellingen")
    .select("id, sales_manager_doelen")
    .eq("actief", true)
    .limit(1)
    .maybeSingle();

  if (
    error &&
    (error.code === "42703" ||
      error.message?.includes("sales_manager_doelen"))
  ) {
    return { id: null, goals: {} };
  }
  if (error) throw error;
  return {
    id: (data?.id as string) || null,
    goals: parseSalesManagerGoals(data?.sales_manager_doelen),
  };
}

export async function saveSalesManagerGoal(
  sb: SupabaseClient,
  opts: {
    monthKey: string;
    adviseurId: string;
    doelPct: number | null;
  }
): Promise<SalesManagerGoalsStore> {
  const { id, goals } = await loadSalesManagerGoals(sb);
  const mk = opts.monthKey.trim();
  if (!/^\d{4}-\d{2}$/.test(mk)) {
    throw new Error("Ongeldige maand (verwacht yyyy-MM)");
  }
  const month = { ...(goals[mk] || {}) };
  if (opts.doelPct == null || opts.doelPct < 0) {
    delete month[opts.adviseurId];
  } else {
    month[opts.adviseurId] =
      Math.round(Math.min(100, opts.doelPct) * 10) / 10;
  }
  const next: SalesManagerGoalsStore = { ...goals };
  if (Object.keys(month).length === 0) delete next[mk];
  else next[mk] = month;

  if (id) {
    const { error } = await sb
      .from("dashboard_instellingen")
      .update({ sales_manager_doelen: next })
      .eq("id", id);
    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("sales_manager_doelen"))
    ) {
      throw new Error(
        "Kolom sales_manager_doelen ontbreekt — voer migrate-sales-manager-doelen.sql uit"
      );
    }
    if (error) throw error;
  } else {
    const { error } = await sb.from("dashboard_instellingen").insert({
      sales_manager_doelen: next,
      actief: true,
    });
    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("sales_manager_doelen"))
    ) {
      throw new Error(
        "Kolom sales_manager_doelen ontbreekt — voer migrate-sales-manager-doelen.sql uit"
      );
    }
    if (error) throw error;
  }
  return next;
}

export async function buildSalesManagerDashboard(
  sb: SupabaseClient,
  monthKey: string
): Promise<{
  monthKey: string;
  monthLabel: string;
  rows: SalesManagerRow[];
  actiepunten: SalesManagerActiepunt[];
  totals: SalesManagerTotals;
}> {
  const { startIso, endIso, label } = monthRangeAmsterdam(monthKey);
  const now = new Date();
  const twoWeeksEnd = addDays(now, 14).toISOString();
  const { goals } = await loadSalesManagerGoals(sb);
  const monthGoals = goals[monthKey] || {};

  const { data: adviseursRaw, error: advErr } = await sb
    .from("adviseurs")
    .select("id, naam, email, actief, rol")
    .eq("actief", true)
    .order("naam");
  if (advErr) throw advErr;

  const adviseurs = ((adviseursRaw || []) as {
    id: string;
    naam: string;
    email?: string | null;
    actief?: boolean | null;
    rol?: string | null;
  }[]).filter((a) => isPlanbaarAdviseur(a));

  const ids = adviseurs.map((a) => a.id);
  if (ids.length === 0) {
    return {
      monthKey,
      monthLabel: label,
      rows: [],
      actiepunten: [],
      totals: {
        adviseurs: 0,
        met_afspraak_vandaag: 0,
        afspraken_2w: 0,
        niet_afgeboekt: 0,
        gelopen: 0,
        deals: 0,
        omzet_inc: 0,
        conversie_pct: null,
      },
    };
  }

  // Afspraken: ruim genoeg venster (verleden voor niet-afgeboekt + 2 wkn vooruit)
  const pastFrom = addDays(now, -120).toISOString();
  const todayYmd = formatInTimeZone(now, AMSTERDAM_TZ, "yyyy-MM-dd");
  const { data: afsprakenRaw } = await sb
    .from("afspraken")
    .select(
      "id, adviseur_id, lead_id, status, soort, start_at, end_at, leads(status)"
    )
    .in("adviseur_id", ids)
    .gte("start_at", pastFrom)
    .lte("start_at", twoWeeksEnd)
    .neq("status", "geannuleerd")
    .order("start_at");

  type AfspraakRow = {
    id: string;
    adviseur_id: string | null;
    lead_id: string;
    status: string;
    soort: string | null;
    start_at: string;
    end_at: string | null;
    leads?:
      | { status?: string | null }
      | { status?: string | null }[]
      | null;
  };

  const afspraken = (afsprakenRaw || []) as AfspraakRow[];
  const allForNeeds = afspraken.map((a) => ({
    id: a.id,
    lead_id: a.lead_id,
    status: a.status,
    soort: a.soort,
    start_at: a.start_at,
    end_at: a.end_at,
  })) as Afspraak[];

  const afspraken2w = new Map<string, number>();
  const afsprakenVandaag = new Map<string, number>();
  const nietAfgeboekt = new Map<string, number>();
  const gelopenLeads = new Map<string, Set<string>>();

  for (const a of afspraken) {
    if (!a.adviseur_id || !afspraakBlokkeertAgenda(a.soort)) continue;
    const leadJoin = Array.isArray(a.leads) ? a.leads[0] : a.leads;
    const leadStatus = leadJoin?.status ?? null;

    const startMs = new Date(a.start_at).getTime();
    const dayKey = formatInTimeZone(a.start_at, AMSTERDAM_TZ, "yyyy-MM-dd");
    if (dayKey === todayYmd) {
      afsprakenVandaag.set(
        a.adviseur_id,
        (afsprakenVandaag.get(a.adviseur_id) || 0) + 1
      );
    }
    const inNext2w =
      startMs >= now.getTime() && startMs <= new Date(twoWeeksEnd).getTime();
    if (inNext2w && a.status !== "voltooid") {
      afspraken2w.set(
        a.adviseur_id,
        (afspraken2w.get(a.adviseur_id) || 0) + 1
      );
    }

    const shape = {
      id: a.id,
      lead_id: a.lead_id,
      status: a.status,
      soort: a.soort,
      start_at: a.start_at,
      end_at: a.end_at,
    } as Afspraak;

    if (needsVervolgPunt(shape, allForNeeds, now, leadStatus)) {
      nietAfgeboekt.set(
        a.adviseur_id,
        (nietAfgeboekt.get(a.adviseur_id) || 0) + 1
      );
    }

    // Conversie-venster: voltooid + in maand
    if (
      a.status === "voltooid" &&
      a.start_at >= startIso &&
      a.start_at < endIso
    ) {
      let set = gelopenLeads.get(a.adviseur_id);
      if (!set) {
        set = new Set();
        gelopenLeads.set(a.adviseur_id, set);
      }
      set.add(a.lead_id);
    }
  }

  // Deals + omzet in maand via ondertekende offertes
  const { data: offertesRaw } = await sb
    .from("offertes")
    .select(
      "id, lead_id, status, totaal_inc_btw, ondertekend_op, leads(adviseur_id)"
    )
    .eq("status", "ondertekend")
    .not("ondertekend_op", "is", null)
    .gte("ondertekend_op", startIso)
    .lt("ondertekend_op", endIso);

  const dealLeadsByAdv = new Map<string, Set<string>>();
  const omzetByAdv = new Map<string, number>();
  const offerteCountByAdv = new Map<string, number>();

  for (const o of offertesRaw || []) {
    const leadJoin = Array.isArray(o.leads) ? o.leads[0] : o.leads;
    const aid = (leadJoin as { adviseur_id?: string | null } | null)
      ?.adviseur_id;
    if (!aid || !ids.includes(aid)) continue;
    const leadId = o.lead_id as string;
    let set = dealLeadsByAdv.get(aid);
    if (!set) {
      set = new Set();
      dealLeadsByAdv.set(aid, set);
    }
    set.add(leadId);
    omzetByAdv.set(
      aid,
      (omzetByAdv.get(aid) || 0) + (Number(o.totaal_inc_btw) || 0)
    );
    offerteCountByAdv.set(aid, (offerteCountByAdv.get(aid) || 0) + 1);
  }

  const rows: SalesManagerRow[] = adviseurs.map((a) => {
    const visited = gelopenLeads.get(a.id) || new Set();
    const gelopen = visited.size;
    let deals = 0;
    const dealSet = dealLeadsByAdv.get(a.id);
    if (dealSet) {
      for (const lid of visited) {
        if (dealSet.has(lid)) deals += 1;
      }
    }
    // Ook deals tellen die wel getekend zijn maar waarvan huisbezoek
    // buiten venster viel? Nee — conversie = deals/gelopen in periode.
    const conversie_pct =
      gelopen > 0 ? Math.round((deals / gelopen) * 1000) / 10 : null;
    const doel =
      monthGoals[a.id] != null && Number.isFinite(monthGoals[a.id])
        ? monthGoals[a.id]
        : null;
    const omzet = Math.round((omzetByAdv.get(a.id) || 0) * 100) / 100;
    const nOffertes = offerteCountByAdv.get(a.id) || 0;
    const avg_order_value =
      nOffertes > 0
        ? Math.round((omzet / nOffertes) * 100) / 100
        : null;

    const vandaag = afsprakenVandaag.get(a.id) || 0;
    return {
      adviseur_id: a.id,
      naam: a.naam,
      afspraken_vandaag: vandaag,
      heeft_afspraak_vandaag: vandaag > 0,
      afspraken_2w: afspraken2w.get(a.id) || 0,
      niet_afgeboekt: nietAfgeboekt.get(a.id) || 0,
      gelopen,
      deals,
      conversie_pct,
      conversie_doel_pct: doel,
      omzet_inc: omzet,
      avg_order_value,
    };
  });

  const actiepunten: SalesManagerActiepunt[] = [];
  for (const r of rows) {
    if (r.afspraken_2w === 0) {
      actiepunten.push({
        adviseur_id: r.adviseur_id,
        naam: r.naam,
        reden: "lege_agenda",
        detail: "Geen afspraken komende 2 weken — bij bellen vooraanschrijven",
      });
    }
    if (r.niet_afgeboekt > 0) {
      actiepunten.push({
        adviseur_id: r.adviseur_id,
        naam: r.naam,
        reden: "niet_afgeboekt",
        detail: `${r.niet_afgeboekt} afspraak${r.niet_afgeboekt === 1 ? "" : "en"} niet afgeboekt`,
      });
    }
    if (
      r.conversie_doel_pct != null &&
      r.conversie_pct != null &&
      r.conversie_pct < r.conversie_doel_pct
    ) {
      actiepunten.push({
        adviseur_id: r.adviseur_id,
        naam: r.naam,
        reden: "onder_doel",
        detail: `${r.conversie_pct}% / ${r.conversie_doel_pct}% conversie`,
      });
    } else if (
      r.conversie_doel_pct != null &&
      r.conversie_pct == null &&
      r.gelopen === 0
    ) {
      // Doel gezet maar nog geen gelopen — geen "onder doel" schreeuwen
    }
  }

  const sumGelopen = rows.reduce((s, r) => s + r.gelopen, 0);
  const sumDeals = rows.reduce((s, r) => s + r.deals, 0);
  const totals: SalesManagerTotals = {
    adviseurs: rows.length,
    met_afspraak_vandaag: rows.filter((r) => r.heeft_afspraak_vandaag).length,
    afspraken_2w: rows.reduce((s, r) => s + r.afspraken_2w, 0),
    niet_afgeboekt: rows.reduce((s, r) => s + r.niet_afgeboekt, 0),
    gelopen: sumGelopen,
    deals: sumDeals,
    omzet_inc:
      Math.round(rows.reduce((s, r) => s + r.omzet_inc, 0) * 100) / 100,
    conversie_pct:
      sumGelopen > 0
        ? Math.round((sumDeals / sumGelopen) * 1000) / 10
        : null,
  };

  return { monthKey, monthLabel: label, rows, actiepunten, totals };
}

function composeLeadAdres(lead: {
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
}): string | null {
  const street = [lead.straat, lead.huisnummer, lead.toevoeging]
    .filter(Boolean)
    .join(" ")
    .trim();
  const city = [lead.postcode, lead.plaats].filter(Boolean).join(" ").trim();
  const full = [street, city].filter(Boolean).join(", ").trim();
  return full || null;
}

async function geocodeMany(
  queries: { key: string; q: string }[]
): Promise<Map<string, { lat: number; lng: number }>> {
  const { geocodeAddress } = await import("@/lib/travel-time");
  const out = new Map<string, { lat: number; lng: number }>();
  const unique = new Map<string, string>();
  for (const item of queries) {
    const q = item.q.trim();
    if (!q || unique.has(item.key)) continue;
    unique.set(item.key, q);
  }
  const entries = [...unique.entries()];
  const concurrency = 4;
  for (let i = 0; i < entries.length; i += concurrency) {
    const slice = entries.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map(async ([key, q]) => {
        try {
          const loc = await geocodeAddress(q);
          return loc ? ([key, loc] as const) : null;
        } catch {
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) out.set(r[0], { lat: r[1].lat, lng: r[1].lon });
    }
  }
  return out;
}

/**
 * Individueel Sales Manager-dashboard voor één adviseur:
 * tijdlijn, AOV, afspraak→sale, kaart met startadres + afspraken.
 */
export async function buildSalesManagerDetail(
  sb: SupabaseClient,
  adviseurId: string,
  monthKey: string
): Promise<SalesManagerDetail | null> {
  const dash = await buildSalesManagerDashboard(sb, monthKey);
  const row = dash.rows.find((r) => r.adviseur_id === adviseurId);
  if (!row) return null;

  const { data: adv, error: advErr } = await sb
    .from("adviseurs")
    .select(
      "id, naam, email, start_adres, startdatum, contract_signed_at, contract_sign_status, created_at"
    )
    .eq("id", adviseurId)
    .maybeSingle();
  if (advErr) throw advErr;
  if (!adv) return null;

  const email = ((adv.email as string | null) || "").trim().toLowerCase() || null;
  const startAdres =
    ((adv.start_adres as string | null) || "").trim() || null;
  const startdatum =
    ((adv.startdatum as string | null) || "").trim() || null;
  const contractSignedAt =
    ((adv.contract_signed_at as string | null) || "").trim() || null;
  const contractStatus =
    ((adv.contract_sign_status as string | null) || "").trim() || null;

  // Sollicitatie via e-mailmatch
  let sollicitatieAt: string | null = null;
  if (email) {
    const { data: sol } = await sb
      .from("sollicitaties")
      .select("id, created_at, email, functie")
      .ilike("email", email)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (sol?.created_at) sollicitatieAt = sol.created_at as string;
  }

  // Eerste gelopen fysieke afspraak (all-time)
  const { data: eersteAfs } = await sb
    .from("afspraken")
    .select("id, start_at, soort, status")
    .eq("adviseur_id", adviseurId)
    .eq("status", "voltooid")
    .neq("status", "geannuleerd")
    .order("start_at", { ascending: true })
    .limit(80);

  let eersteAfspraakAt: string | null = null;
  for (const a of eersteAfs || []) {
    if (!afspraakBlokkeertAgenda(a.soort as string | null)) continue;
    eersteAfspraakAt = a.start_at as string;
    break;
  }

  // Alle deals (ondertekend) voor tijdlijn — recent eerst, max 40
  const { data: dealsRaw } = await sb
    .from("offertes")
    .select(
      "id, lead_id, totaal_inc_btw, ondertekend_op, leads(id, naam, adviseur_id)"
    )
    .eq("status", "ondertekend")
    .not("ondertekend_op", "is", null)
    .order("ondertekend_op", { ascending: false })
    .limit(200);

  const dealEvents: SalesManagerTimelineEvent[] = [];
  for (const o of dealsRaw || []) {
    const leadJoin = Array.isArray(o.leads) ? o.leads[0] : o.leads;
    const lead = leadJoin as {
      id?: string;
      naam?: string | null;
      adviseur_id?: string | null;
    } | null;
    if (!lead || lead.adviseur_id !== adviseurId) continue;
    const at = o.ondertekend_op as string;
    if (!at) continue;
    const bedrag = Number(o.totaal_inc_btw) || 0;
    dealEvents.push({
      kind: "deal",
      at,
      titel: `Deal · ${lead.naam?.trim() || "Lead"}`,
      detail: bedrag > 0 ? `€ ${bedrag.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}` : null,
      lead_id: (o.lead_id as string) || lead.id || null,
      offerte_id: o.id as string,
      bedrag_inc: bedrag || null,
    });
    if (dealEvents.length >= 40) break;
  }

  const timeline: SalesManagerTimelineEvent[] = [];
  if (sollicitatieAt) {
    timeline.push({
      kind: "sollicitatie",
      at: sollicitatieAt,
      titel: "Aangemeld sales-vacature",
      detail: "Sollicitatie binnengekomen",
    });
  }
  if (startdatum) {
    const atIso = /^\d{4}-\d{2}-\d{2}$/.test(startdatum)
      ? fromZonedTime(
          new Date(
            Number(startdatum.slice(0, 4)),
            Number(startdatum.slice(5, 7)) - 1,
            Number(startdatum.slice(8, 10)),
            9,
            0,
            0
          ),
          AMSTERDAM_TZ
        ).toISOString()
      : startdatum;
    timeline.push({
      kind: "startdatum",
      at: atIso,
      titel: "Startdatum",
      detail: "Eerste werkdag",
    });
  }
  if (contractSignedAt) {
    timeline.push({
      kind: "contract",
      at: contractSignedAt,
      titel: "Samenwerkingsovereenkomst getekend",
      detail:
        contractStatus === "ondertekend"
          ? "ZZP-contract ondertekend"
          : contractStatus || null,
    });
  }
  if (eersteAfspraakAt) {
    timeline.push({
      kind: "eerste_afspraak",
      at: eersteAfspraakAt,
      titel: "Eerste afspraak gelopen",
      detail: "Eerste voltooide huisbezoek",
    });
  }
  timeline.push(...dealEvents);
  timeline.sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  // Kaart: afspraken rondom nu (verleden 21d + vooruit 21d) + maand gelopen
  const now = new Date();
  const mapFrom = addDays(now, -21).toISOString();
  const mapTo = addDays(now, 21).toISOString();
  const { data: mapAfs } = await sb
    .from("afspraken")
    .select(
      "id, start_at, status, soort, notities, lead_id, leads(id, naam, telefoon, email, straat, huisnummer, toevoeging, postcode, plaats)"
    )
    .eq("adviseur_id", adviseurId)
    .gte("start_at", mapFrom)
    .lte("start_at", mapTo)
    .neq("status", "geannuleerd")
    .order("start_at", { ascending: true })
    .limit(60);

  type MapAfspraak = {
    id: string;
    start_at: string;
    status: string | null;
    soort: string | null;
    notities: string | null;
    lead_id: string;
    leads?:
      | {
          id?: string;
          naam?: string | null;
          telefoon?: string | null;
          email?: string | null;
          straat?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          postcode?: string | null;
          plaats?: string | null;
        }
      | {
          id?: string;
          naam?: string | null;
          telefoon?: string | null;
          email?: string | null;
          straat?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          postcode?: string | null;
          plaats?: string | null;
        }[]
      | null;
  };

  const geoQueries: { key: string; q: string }[] = [];
  if (startAdres) {
    geoQueries.push({ key: "home", q: startAdres });
  }

  const afspraakMeta: {
    a: MapAfspraak;
    lead: NonNullable<Exclude<MapAfspraak["leads"], unknown[]>>;
    adres: string;
  }[] = [];

  for (const raw of (mapAfs || []) as MapAfspraak[]) {
    if (!afspraakBlokkeertAgenda(raw.soort)) continue;
    const leadJoin = Array.isArray(raw.leads) ? raw.leads[0] : raw.leads;
    if (!leadJoin) continue;
    const adres = composeLeadAdres(leadJoin);
    if (!adres) continue;
    afspraakMeta.push({ a: raw, lead: leadJoin, adres });
    geoQueries.push({ key: `afs:${raw.id}`, q: adres });
  }

  const geo = await geocodeMany(geoQueries);
  const map_pins: SalesManagerMapPin[] = [];

  const homeLoc = geo.get("home");
  if (homeLoc && startAdres) {
    map_pins.push({
      kind: "home",
      id: "home",
      lat: homeLoc.lat,
      lng: homeLoc.lng,
      label: "Startadres",
      subtitel: (adv.naam as string) || row.naam,
      notitie: null,
      start_at: null,
      status: null,
      lead_id: null,
      lead_naam: null,
      lead_telefoon: null,
      lead_email: null,
      adres: startAdres,
    });
  }

  for (const { a, lead, adres } of afspraakMeta) {
    const loc = geo.get(`afs:${a.id}`);
    if (!loc) continue;
    map_pins.push({
      kind: "afspraak",
      id: a.id,
      lat: loc.lat,
      lng: loc.lng,
      label: lead.naam?.trim() || "Afspraak",
      subtitel: a.status || null,
      notitie: (a.notities || "").trim() || null,
      start_at: a.start_at,
      status: a.status,
      lead_id: a.lead_id || lead.id || null,
      lead_naam: lead.naam?.trim() || null,
      lead_telefoon: lead.telefoon?.trim() || null,
      lead_email: lead.email?.trim() || null,
      adres,
    });
  }

  // Conversie per maand (6 maanden, oud → nieuw)
  const { goals } = await loadSalesManagerGoals(sb);
  const monthKeys: string[] = [];
  {
    const [y0, m0] = monthKey.split("-").map(Number);
    for (let i = 5; i >= 0; i--) {
      const d = new Date(y0, m0 - 1 - i, 1);
      monthKeys.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      );
    }
  }
  const histFrom = monthRangeAmsterdam(monthKeys[0]).startIso;
  const histTo = monthRangeAmsterdam(monthKeys[monthKeys.length - 1]).endIso;

  const [{ data: histAfs }, { data: histOff }] = await Promise.all([
    sb
      .from("afspraken")
      .select("lead_id, start_at, status, soort")
      .eq("adviseur_id", adviseurId)
      .eq("status", "voltooid")
      .gte("start_at", histFrom)
      .lt("start_at", histTo),
    sb
      .from("offertes")
      .select(
        "lead_id, totaal_inc_btw, ondertekend_op, leads(adviseur_id)"
      )
      .eq("status", "ondertekend")
      .not("ondertekend_op", "is", null)
      .gte("ondertekend_op", histFrom)
      .lt("ondertekend_op", histTo),
  ]);

  const gelopenByMonth = new Map<string, Set<string>>();
  for (const a of histAfs || []) {
    if (!afspraakBlokkeertAgenda(a.soort as string | null)) continue;
    const mk = formatInTimeZone(
      a.start_at as string,
      AMSTERDAM_TZ,
      "yyyy-MM"
    );
    let set = gelopenByMonth.get(mk);
    if (!set) {
      set = new Set();
      gelopenByMonth.set(mk, set);
    }
    set.add(a.lead_id as string);
  }

  const dealsByMonth = new Map<string, Set<string>>();
  const omzetByMonth = new Map<string, number>();
  for (const o of histOff || []) {
    const leadJoin = Array.isArray(o.leads) ? o.leads[0] : o.leads;
    const aid = (leadJoin as { adviseur_id?: string | null } | null)
      ?.adviseur_id;
    if (aid !== adviseurId) continue;
    const mk = formatInTimeZone(
      o.ondertekend_op as string,
      AMSTERDAM_TZ,
      "yyyy-MM"
    );
    let set = dealsByMonth.get(mk);
    if (!set) {
      set = new Set();
      dealsByMonth.set(mk, set);
    }
    set.add(o.lead_id as string);
    omzetByMonth.set(
      mk,
      (omzetByMonth.get(mk) || 0) + (Number(o.totaal_inc_btw) || 0)
    );
  }

  const conversie_maanden: SalesManagerMonthConversie[] = monthKeys.map(
    (mk) => {
      const visited = gelopenByMonth.get(mk) || new Set();
      const gelopen = visited.size;
      const dealSet = dealsByMonth.get(mk) || new Set();
      let deals = 0;
      for (const lid of visited) {
        if (dealSet.has(lid)) deals += 1;
      }
      const conversie_pct =
        gelopen > 0 ? Math.round((deals / gelopen) * 1000) / 10 : null;
      const doelRaw = goals[mk]?.[adviseurId];
      const conversie_doel_pct =
        doelRaw != null && Number.isFinite(doelRaw) ? doelRaw : null;
      const { label: mLabel } = monthRangeAmsterdam(mk);
      return {
        monthKey: mk,
        label: mLabel,
        gelopen,
        deals,
        conversie_pct,
        conversie_doel_pct,
        omzet_inc: Math.round((omzetByMonth.get(mk) || 0) * 100) / 100,
      };
    }
  );

  return {
    adviseur_id: adviseurId,
    naam: (adv.naam as string) || row.naam,
    email,
    start_adres: startAdres,
    startdatum,
    contract_signed_at: contractSignedAt,
    contract_sign_status: contractStatus,
    row,
    afspraak_sale_ratio: row.conversie_pct,
    avg_order_value: row.avg_order_value,
    conversie_maanden,
    timeline,
    map_pins,
  };
}
