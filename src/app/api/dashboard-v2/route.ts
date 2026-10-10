import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { normalizeProjectStatus } from "@/lib/labels";
import {
  buildDashboardV2,
  buildDashboardV2Capacity,
  buildDashboardV2Drilldown,
  buildDashboardV2Finance,
  emptyDashboardV2Capacity,
  emptyDashboardV2Finance,
  parseDashboardV2Kpi,
  parseDashboardV2Period,
  storeWeeklyGoals,
  type DashboardV2Goals,
  type DashboardV2Raw,
  type DrilldownRaw,
} from "@/lib/dashboard-v2";
import {
  dayKeyAmsterdam,
  loadAfblokkingen,
  weekKeyString,
} from "@/lib/adviseur-beschikbaarheid";
import { META_LEAD_CAMPAIGN_ID } from "@/lib/meta-ads-spend";
import { addDays, getISOWeekYear } from "date-fns";

export const runtime = "nodejs";

type Sb = ReturnType<typeof getSupabaseAdmin>;

/** Paginate past PostgREST default ~1000-row cap. */
async function fetchAllRows<T extends Record<string, unknown>>(
  build: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message?: string; code?: string } | null;
  }>
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function loadGoalsRaw(sb: Sb): Promise<unknown> {
  const { data, error } = await sb
    .from("dashboard_instellingen")
    .select("dashboard_v2_doelen")
    .eq("actief", true)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (
      error.code === "42703" ||
      error.message?.includes("dashboard_v2_doelen")
    ) {
      return {};
    }
    return {};
  }
  return data?.dashboard_v2_doelen ?? {};
}

async function loadAfsprakenRows(sb: Sb): Promise<Record<string, unknown>[]> {
  try {
    return await fetchAllRows((from, to) =>
      sb
        .from("afspraken")
        .select(
          "id, lead_id, adviseur_id, start_at, end_at, created_at, status, soort, leads(naam, lead_number, plaats, status)"
        )
        .order("created_at", { ascending: true })
        .range(from, to)
    );
  } catch {
    try {
      return await fetchAllRows((from, to) =>
        sb
          .from("afspraken")
          .select(
            "id, lead_id, adviseur_id, start_at, end_at, created_at, status, soort"
          )
          .order("created_at", { ascending: true })
          .range(from, to)
      );
    } catch {
      return fetchAllRows((from, to) =>
        sb
          .from("afspraken")
          .select("id, lead_id, adviseur_id, start_at, created_at, status")
          .order("created_at", { ascending: true })
          .range(from, to)
      );
    }
  }
}

async function loadUnavailableByAdviseur(
  sb: Sb,
  adviseurIds: string[],
  jaren: number[]
): Promise<Map<string, Set<string>>> {
  const map = new Map<string, Set<string>>();
  if (adviseurIds.length === 0 || jaren.length === 0) return map;
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
      error.message?.includes("adviseur_beschikbaarheid") ||
      error.message?.includes("schema cache")
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

async function loadDrilldownRaw(sb: Sb): Promise<DrilldownRaw> {
  const [leadsRows, afsprakenRows, offertesRows, projectenRows, adviseursRes] =
    await Promise.all([
      fetchAllRows((from, to) =>
        sb
          .from("leads")
          .select(
            "id, created_at, naam, lead_number, status, telefoon, plaats, adviseur_id"
          )
          .order("created_at", { ascending: true })
          .range(from, to)
      ),
      loadAfsprakenRows(sb),
      fetchAllRows((from, to) =>
        sb
          .from("offertes")
          .select(
            "id, lead_id, status, ondertekend_op, created_at, subtotaal_ex_btw, offerte_nummer, leads(naam, lead_number, adviseur_id)"
          )
          .in("status", ["ondertekend", "afgewezen"])
          .not("ondertekend_op", "is", null)
          .order("ondertekend_op", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        sb
          .from("projecten")
          .select("id, offerte_id, status")
          .not("offerte_id", "is", null)
          .range(from, to)
      ),
      sb.from("adviseurs").select("id, naam, email, actief, rol"),
    ]);

  if (adviseursRes.error) throw adviseursRes.error;

  const geannuleerdOfferteIds = new Set(
    projectenRows
      .filter(
        (p) =>
          normalizeProjectStatus(p.status as string | null) === "annulering"
      )
      .map((p) => p.offerte_id as string)
      .filter(Boolean)
  );

  const leadMap = new Map(
    leadsRows.map((l) => [
      l.id as string,
      {
        naam: (l.naam as string) || null,
        lead_number: (l.lead_number as string) || null,
        plaats: (l.plaats as string) || null,
        status: (l.status as string) || null,
      },
    ])
  );

  const afspraken: DrilldownRaw["afspraken"] = afsprakenRows.map((a) => {
    const joined = a.leads as {
      naam?: string | null;
      lead_number?: string | null;
      plaats?: string | null;
      status?: string | null;
    } | null;
    const lead = joined || leadMap.get(a.lead_id as string);
    return {
      id: a.id as string,
      lead_id: a.lead_id as string,
      adviseur_id: (a.adviseur_id as string) || null,
      start_at: a.start_at as string,
      end_at: ((a as { end_at?: string | null }).end_at as string) || null,
      created_at: (a.created_at as string) || null,
      status: a.status as string,
      soort: ((a as { soort?: string | null }).soort as string) || null,
      lead_naam: lead?.naam || null,
      lead_number: lead?.lead_number || null,
      lead_plaats: lead?.plaats || null,
      lead_status: lead?.status || null,
    };
  });

  const offertes = offertesRows.map((o) => {
    const lead = o.leads as {
      naam?: string | null;
      lead_number?: string | null;
      adviseur_id?: string | null;
    } | null;
    const status = (o.status as string) || "";
    const geannuleerd =
      status === "afgewezen" || geannuleerdOfferteIds.has(o.id as string);
    return {
      id: o.id as string,
      lead_id: o.lead_id as string,
      adviseur_id: lead?.adviseur_id ?? null,
      ondertekend_op: (o.ondertekend_op as string) || null,
      created_at: o.created_at as string,
      subtotaal_ex_btw: Number(o.subtotaal_ex_btw) || 0,
      offerte_nummer: (o.offerte_nummer as string) || null,
      lead_naam: lead?.naam || null,
      lead_number: lead?.lead_number || null,
      geannuleerd,
    };
  });

  const adviseurs = (adviseursRes.data || []).map((a) => ({
    id: a.id as string,
    naam: a.naam as string,
    actief: Boolean(a.actief),
    rol: ((a as { rol?: string | null }).rol as string | null) || "adviseur",
    email: ((a as { email?: string | null }).email as string | null) || null,
  }));

  return {
    leads: leadsRows.map((l) => ({
      id: l.id as string,
      created_at: l.created_at as string,
      naam: (l.naam as string) || null,
      lead_number: (l.lead_number as string) || null,
      status: (l.status as string) || null,
      telefoon: (l.telefoon as string) || null,
      plaats: (l.plaats as string) || null,
      adviseur_id:
        ((l as { adviseur_id?: string | null }).adviseur_id as string) || null,
    })),
    afspraken,
    offertes,
    adviseurs,
  };
}
function toDashboardRaw(raw: DrilldownRaw): DashboardV2Raw {
  return {
    leads: raw.leads.map((l) => ({
      id: l.id,
      created_at: l.created_at,
      adviseur_id: l.adviseur_id ?? null,
      status: l.status ?? null,
    })),
    afspraken: raw.afspraken.map((a) => ({
      id: a.id,
      lead_id: a.lead_id,
      adviseur_id: a.adviseur_id,
      start_at: a.start_at,
      created_at: a.created_at,
      status: a.status,
      soort: a.soort,
    })),
    offertes: raw.offertes.map((o) => ({
      id: o.id,
      lead_id: o.lead_id,
      adviseur_id: o.adviseur_id,
      ondertekend_op: o.ondertekend_op,
      created_at: o.created_at,
      subtotaal_ex_btw: o.subtotaal_ex_btw,
      geannuleerd: Boolean(o.geannuleerd),
    })),
    adviseurs: raw.adviseurs,
  };
}

/** GET /api/dashboard-v2?period=…&from=&to=&scope=team|adviseur|beller&person= */
export async function GET(req: NextRequest) {
  const period = parseDashboardV2Period(req.nextUrl.searchParams.get("period"));
  const kpi = parseDashboardV2Kpi(req.nextUrl.searchParams.get("kpi"));
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  const week = req.nextUrl.searchParams.get("week");
  const rangeOpts = { from, to, week };
  const scopeParam = req.nextUrl.searchParams.get("scope");
  const scope: "team" | "adviseur" | "beller" =
    scopeParam === "adviseur" || scopeParam === "beller" ? scopeParam : "team";
  let personId = req.nextUrl.searchParams.get("person");

  try {
    const sb = getSupabaseAdmin();
    const [raw, goalsRaw] = await Promise.all([
      loadDrilldownRaw(sb),
      loadGoalsRaw(sb),
    ]);

    if (scope !== "team" && !personId) {
      const candidates = raw.adviseurs.filter((a) => {
        if (!a.actief) return false;
        const r = (a.rol || "adviseur").toLowerCase();
        if (scope === "beller") return r === "beller";
        return r === "adviseur";
      });
      personId = candidates[0]?.id || null;
    }
    const scopeOpts = { scope, personId };
    if (kpi) {
      const detail = buildDashboardV2Drilldown(
        raw,
        period,
        kpi,
        goalsRaw,
        rangeOpts
      );
      return NextResponse.json({ detail });
    }

    const now = new Date();
    const dashboard = buildDashboardV2(
      toDashboardRaw(raw),
      period,
      goalsRaw,
      now,
      rangeOpts,
      scopeOpts
    );

    // Capaciteit: vrije slots (incl. afblokkingen) → leads @ 25% L2A
    let capacity = emptyDashboardV2Capacity(4);
    try {
      const weeksAhead = 4;
      const daysAhead = weeksAhead * 7;
      const van = dayKeyAmsterdam(now);
      const tot = dayKeyAmsterdam(addDays(now, daysAhead + 2));
      const y = getISOWeekYear(now);
      const adviseurIds = raw.adviseurs.map((a) => a.id);
      const [unavailableByAdviseur, afblokkingen] = await Promise.all([
        loadUnavailableByAdviseur(sb, adviseurIds, [y - 1, y, y + 1]),
        loadAfblokkingen(sb, { adviseurIds, van, tot }),
      ]);
      capacity = buildDashboardV2Capacity({
        adviseurs: raw.adviseurs,
        afspraken: raw.afspraken.map((a) => ({
          adviseur_id: a.adviseur_id,
          start_at: a.start_at,
          end_at: a.end_at ?? null,
          status: a.status,
          soort: a.soort,
        })),
        unavailableByAdviseur,
        afblokkingen,
        weeksAhead,
        now,
      });
    } catch {
      capacity = emptyDashboardV2Capacity(4);
    }

    // Finance: omzet / sales / inkoop / leadkosten
    let finance = emptyDashboardV2Finance();
    try {
      const [
        offertesFinRes,
        facturenRes,
        projectenFinRes,
        kostenRes,
        metaRes,
        advComRes,
      ] = await Promise.all([
        sb
          .from("offertes")
          .select(
            "id, lead_id, status, ondertekend_op, subtotaal_ex_btw, totaal_inc_btw, leads(adviseur_id), offerte_regels(omschrijving, aantal)"
          )
          .in("status", ["ondertekend", "afgewezen"])
          .not("ondertekend_op", "is", null),
        sb
          .from("facturen")
          .select(
            "id, offerte_id, lead_id, status, bedrag_inc_btw, betaald_op, omschrijving, credit_van_factuur_id"
          ),
        sb
          .from("projecten")
          .select("id, offerte_id, status, materiaal_checks")
          .not("offerte_id", "is", null),
        sb
          .from("rapportage_kosten")
          .select("datum, soort, bedrag")
          .order("datum", { ascending: true }),
        sb
          .from("meta_ad_spend")
          .select("datum, spend, campaign_id")
          .eq("campaign_id", META_LEAD_CAMPAIGN_ID),
        sb.from("adviseurs").select("id, commissie_pct"),
      ]);

      const geannuleerdOfferteIds = new Set(
        (projectenFinRes.data || [])
          .filter(
            (p) =>
              normalizeProjectStatus(p.status as string | null) === "annulering"
          )
          .map((p) => p.offerte_id as string)
          .filter(Boolean)
      );

      const commissieByAdviseur = new Map<string, number>();
      for (const a of advComRes.data || []) {
        const pct = Number((a as { commissie_pct?: number }).commissie_pct);
        if (Number.isFinite(pct) && pct > 0) {
          commissieByAdviseur.set(a.id as string, pct);
        }
      }

      finance = buildDashboardV2Finance(
        {
          offertes: (offertesFinRes.data || []).map((o) => {
            const lead = o.leads as { adviseur_id?: string | null } | null;
            const status = (o.status as string) || "";
            return {
              id: o.id as string,
              lead_id: o.lead_id as string,
              adviseur_id: lead?.adviseur_id ?? null,
              ondertekend_op: (o.ondertekend_op as string) || null,
              subtotaal_ex_btw: Number(o.subtotaal_ex_btw) || 0,
              totaal_inc_btw: Number(o.totaal_inc_btw) || null,
              geannuleerd:
                status === "afgewezen" ||
                geannuleerdOfferteIds.has(o.id as string),
              regels: ((o as { offerte_regels?: { omschrijving?: string; aantal?: number }[] })
                .offerte_regels || []) as {
                omschrijving?: string | null;
                aantal?: number | null;
              }[],
            };
          }),
          facturen: (facturenRes.error ? [] : facturenRes.data || []).map(
            (f) => ({
              id: f.id as string,
              offerte_id: (f.offerte_id as string) || null,
              lead_id: f.lead_id as string,
              status: f.status as string,
              bedrag_inc_btw:
                f.bedrag_inc_btw != null ? Number(f.bedrag_inc_btw) : null,
              betaald_op: (f.betaald_op as string) || null,
              omschrijving: (f.omschrijving as string) || null,
              credit_van_factuur_id:
                (f as { credit_van_factuur_id?: string | null })
                  .credit_van_factuur_id ?? null,
            })
          ),
          projecten: (projectenFinRes.error
            ? []
            : projectenFinRes.data || []
          ).map((p) => ({
            id: p.id as string,
            offerte_id: (p.offerte_id as string) || null,
            status: (p.status as string) || null,
            materiaal_checks:
              ((p as { materiaal_checks?: Record<string, unknown> | null })
                .materiaal_checks as Record<string, unknown> | null) ?? null,
          })),
          kosten: (kostenRes.error ? [] : kostenRes.data || []).map((k) => ({
            datum: k.datum as string,
            soort: k.soort as string,
            bedrag: Number(k.bedrag) || 0,
          })),
          metaSpend: (metaRes.error ? [] : metaRes.data || []).map((m) => ({
            datum: m.datum as string,
            spend: Number(m.spend) || 0,
            campaign_id: (m.campaign_id as string) || null,
          })),
          commissieByAdviseur,
        },
        {
          rangeStart: dashboard.rangeStart,
          rangeEnd: dashboard.rangeEnd,
          buckets: dashboard.buckets.map((b) => ({
            key: b.key,
            label: b.label,
            start: b.start,
            end: b.end,
          })),
        }
      );
    } catch {
      finance = emptyDashboardV2Finance();
    }

    return NextResponse.json({
      dashboard: { ...dashboard, capacity, finance },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Dashboard v2 laden mislukt") },
      { status: 500 }
    );
  }
}

/** PATCH /api/dashboard-v2 — sla weekdoelen op (per 7 dagen) */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      goals?: Partial<DashboardV2Goals>;
    };
    if (!body.goals || typeof body.goals !== "object") {
      return NextResponse.json({ error: "goals verplicht" }, { status: 400 });
    }

    const goals: DashboardV2Goals = {
      leads: Number(body.goals.leads) || 0,
      afsprakenGepland: Number(body.goals.afsprakenGepland) || 0,
      leadToAppt: Number(body.goals.leadToAppt) || 0,
      afspraakToSale: Number(body.goals.afspraakToSale) || 0,
      orders: Number(body.goals.orders) || 0,
      omzet: Number(body.goals.omzet) || 0,
      omzetPerAdviseur:
        body.goals.omzetPerAdviseur &&
        typeof body.goals.omzetPerAdviseur === "object"
          ? Object.fromEntries(
              Object.entries(body.goals.omzetPerAdviseur).map(([id, v]) => [
                id,
                Number(v) || 0,
              ])
            )
          : {},
    };

    const sb = getSupabaseAdmin();
    const { data: existing, error: readErr } = await sb
      .from("dashboard_instellingen")
      .select("id, dashboard_v2_doelen")
      .eq("actief", true)
      .limit(1)
      .maybeSingle();

    if (
      readErr &&
      (readErr.code === "42703" ||
        readErr.message?.includes("dashboard_v2_doelen"))
    ) {
      return NextResponse.json(
        {
          error:
            "Kolom dashboard_v2_doelen ontbreekt — voer migrate-dashboard-v2-doelen.sql uit",
        },
        { status: 500 }
      );
    }
    if (readErr) throw readErr;

    const stored = storeWeeklyGoals(goals);

    if (existing?.id) {
      const { error } = await sb
        .from("dashboard_instellingen")
        .update({ dashboard_v2_doelen: stored })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from("dashboard_instellingen").insert({
        dashboard_v2_doelen: stored,
        actief: true,
      });
      if (error) throw error;
    }

    return NextResponse.json({ ok: true, goals: stored.per_7_days });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Doelen opslaan mislukt") },
      { status: 500 }
    );
  }
}
