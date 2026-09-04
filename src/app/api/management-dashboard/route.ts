import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { metaAdsSpendConfigured } from "@/lib/meta-ads-spend";
import {
  buildManagementDashboard,
  serializeManagementDashboard,
  parseInstellingen,
  type MgmtFilters,
  type MgmtPeriodPreset,
  type MgmtRaw,
} from "@/lib/management-dashboard";

export const runtime = "nodejs";

function parsePeriod(v: string | null): MgmtPeriodPreset {
  const allowed: MgmtPeriodPreset[] = [
    "today",
    "this_week",
    "last_week",
    "this_month",
    "last_month",
    "last_30_days",
    "this_quarter",
    "this_year",
    "custom",
  ];
  if (v && allowed.includes(v as MgmtPeriodPreset)) return v as MgmtPeriodPreset;
  return "this_month";
}

/** GET /api/management-dashboard?...filters */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const filters: MgmtFilters = {
    period: parsePeriod(sp.get("period")),
    customStart: sp.get("custom_start"),
    customEnd: sp.get("custom_end"),
    adviseurId: sp.get("adviseur_id") || null,
    leadbron: sp.get("leadbron") || null,
    campaign: sp.get("campaign") || null,
    regio: sp.get("regio") || null,
    orderStatus: sp.get("order_status") || null,
    installateurId: sp.get("installateur_id") || null,
    productModel: sp.get("product") || null,
    forecastLookbackDays: ([30, 60, 90].includes(Number(sp.get("lookback")))
      ? Number(sp.get("lookback"))
      : undefined) as 30 | 60 | 90 | undefined,
  };

  try {
    const sb = getSupabaseAdmin();

    const [
      leadsRes,
      afsprakenRes,
      offertesSignedRes,
      offertesAllRes,
      projectenRes,
      facturenRes,
      kostenRes,
      metaRes,
      beschikRes,
      adviseursRes,
      partnersRes,
      settingsRes,
    ] = await Promise.all([
      sb
        .from("leads")
        .select(
          "id, created_at, status, adviseur_id, lander, campaign_name, utm_campaign, ad_name, postcode, plaats"
        ),
      sb
        .from("afspraken")
        .select("id, lead_id, adviseur_id, start_at, created_at, status, soort"),
      sb
        .from("offertes")
        .select(
          "id, lead_id, status, ondertekend_op, created_at, subtotaal_ex_btw, btw_bedrag, financiering_voorbehoud, leads(adviseur_id), offerte_regels(omschrijving, aantal)"
        )
        .eq("status", "ondertekend"),
      sb
        .from("offertes")
        .select(
          "id, lead_id, status, ondertekend_op, created_at, subtotaal_ex_btw, btw_bedrag, financiering_voorbehoud, leads(adviseur_id), offerte_regels(omschrijving, aantal)"
        )
        .in("status", ["verzonden", "ondertekend", "concept", "afgewezen", "verlopen"]),
      sb
        .from("projecten")
        .select(
          "id, lead_id, offerte_id, created_at, status, projectkosten, schouw_at, schouw_jaar, schouw_week, installatie_at, installatie_partner_id, financiering_geschakeld_at, monteur, leads(adviseur_id)"
        ),
      sb
        .from("facturen")
        .select(
          "id, lead_id, status, bedrag_ex_btw, btw_bedrag, betaald_op, factuurdatum, vervaldatum, leads(adviseur_id)"
        ),
      sb
        .from("rapportage_kosten")
        .select("datum, soort, bedrag, adviseur_id")
        .order("datum", { ascending: true }),
      sb
        .from("meta_ad_spend")
        .select(
          "datum, level, campaign_name, adset_name, ad_name, spend"
        ),
      sb
        .from("adviseur_beschikbaarheid")
        .select("adviseur_id, jaar, week, beschikbaar"),
      sb
        .from("adviseurs")
        .select("id, naam, actief, commissie_pct"),
      sb.from("installatie_partners").select("id, naam"),
      sb
        .from("dashboard_instellingen")
        .select("*")
        .eq("actief", true)
        .limit(1)
        .maybeSingle(),
    ]);

    const mapOfferte = (o: Record<string, unknown>) => {
      const lead = o.leads as { adviseur_id?: string | null } | null;
      const regels = (o.offerte_regels || []) as {
        omschrijving?: string | null;
        aantal?: number | null;
      }[];
      return {
        id: o.id as string,
        lead_id: o.lead_id as string,
        status: o.status as string,
        ondertekend_op: (o.ondertekend_op as string) || null,
        created_at: o.created_at as string,
        subtotaal_ex_btw: Number(o.subtotaal_ex_btw) || 0,
        btw_bedrag: Number(o.btw_bedrag) || 0,
        adviseur_id: lead?.adviseur_id ?? null,
        financiering_voorbehoud: Boolean(o.financiering_voorbehoud),
        regels,
      };
    };

    let leads = (leadsRes.data || []) as MgmtRaw["leads"];
    if (leadsRes.error) {
      const retry = await sb
        .from("leads")
        .select(
          "id, created_at, status, adviseur_id, utm_campaign, postcode, plaats"
        );
      if (retry.error) throw retry.error;
      leads = (retry.data || []).map((l) => ({
        ...(l as MgmtRaw["leads"][0]),
        lander: null,
        campaign_name: null,
        ad_name: null,
      }));
    }

    let afspraken = (afsprakenRes.data || []) as MgmtRaw["afspraken"];
    if (afsprakenRes.error) {
      const retry = await sb
        .from("afspraken")
        .select("id, lead_id, adviseur_id, start_at, created_at, status");
      if (retry.error) throw retry.error;
      afspraken = (retry.data || []).map((a) => ({
        ...(a as MgmtRaw["afspraken"][0]),
        soort: null,
      }));
    }

    if (offertesSignedRes.error) throw offertesSignedRes.error;

    const offertes = (offertesSignedRes.data || []).map((o) =>
      mapOfferte(o as Record<string, unknown>)
    );
    const allOffertes = (offertesAllRes.error
      ? offertes
      : (offertesAllRes.data || []).map((o) =>
          mapOfferte(o as Record<string, unknown>)
        ));

    let projecten: MgmtRaw["projecten"] = [];
    if (projectenRes.error) {
      const retry = await sb
        .from("projecten")
        .select(
          "id, lead_id, offerte_id, created_at, status, leads(adviseur_id)"
        );
      if (retry.error) throw retry.error;
      projecten = (retry.data || []).map((p) => {
        const lead = p.leads as { adviseur_id?: string | null } | null;
        return {
          id: p.id,
          lead_id: p.lead_id,
          offerte_id: p.offerte_id,
          created_at: p.created_at,
          status: p.status,
          projectkosten: 0,
          adviseur_id: lead?.adviseur_id ?? null,
        };
      });
    } else {
      projecten = (projectenRes.data || []).map((p) => {
        const lead = p.leads as { adviseur_id?: string | null } | null;
        return {
          id: p.id,
          lead_id: p.lead_id,
          offerte_id: p.offerte_id,
          created_at: p.created_at,
          status: p.status as string,
          projectkosten: p.projectkosten != null ? Number(p.projectkosten) : 0,
          adviseur_id: lead?.adviseur_id ?? null,
          schouw_at: (p as { schouw_at?: string }).schouw_at ?? null,
          schouw_jaar: (p as { schouw_jaar?: number }).schouw_jaar ?? null,
          schouw_week: (p as { schouw_week?: number }).schouw_week ?? null,
          installatie_at: (p as { installatie_at?: string }).installatie_at ?? null,
          installatie_partner_id:
            (p as { installatie_partner_id?: string }).installatie_partner_id ??
            null,
          financiering_geschakeld_at:
            (p as { financiering_geschakeld_at?: string })
              .financiering_geschakeld_at ?? null,
          monteur: (p as { monteur?: string }).monteur ?? null,
        };
      });
    }

    const facturen = (facturenRes.error ? [] : facturenRes.data || []).map(
      (f) => {
        const lead = f.leads as { adviseur_id?: string | null } | null;
        return {
          id: f.id,
          lead_id: f.lead_id,
          status: f.status,
          bedrag_ex_btw: Number(f.bedrag_ex_btw) || 0,
          btw_bedrag: Number(f.btw_bedrag) || 0,
          betaald_op: f.betaald_op as string | null,
          factuurdatum: f.factuurdatum as string,
          vervaldatum: (f.vervaldatum as string) || null,
          adviseur_id: lead?.adviseur_id ?? null,
        };
      }
    );

    const kosten = (kostenRes.error ? [] : kostenRes.data || []).map((k) => ({
      datum: k.datum as string,
      soort: k.soort as "ad_spend" | "sales",
      bedrag: Number(k.bedrag) || 0,
      adviseur_id: (k.adviseur_id as string | null) ?? null,
    }));

    const metaSpend = (metaRes.error ? [] : metaRes.data || []).map((m) => ({
      datum: m.datum as string,
      level: m.level as string,
      campaign_name: (m.campaign_name as string) || null,
      adset_name: (m.adset_name as string) || null,
      ad_name: (m.ad_name as string) || null,
      spend: Number(m.spend) || 0,
    }));

    const beschikbaarheid = (
      beschikRes.error ? [] : beschikRes.data || []
    ).map((b) => ({
      adviseur_id: b.adviseur_id as string,
      jaar: Number(b.jaar),
      week: Number(b.week),
      beschikbaar: b.beschikbaar !== false,
    }));

    const adviseurs = (adviseursRes.data || []).map((a) => ({
      id: a.id as string,
      naam: a.naam as string,
      actief: Boolean(a.actief),
      commissie_pct: Number((a as { commissie_pct?: number }).commissie_pct) || 0,
    }));

    const installateurs = (partnersRes.error ? [] : partnersRes.data || []).map(
      (p) => ({
        id: p.id as string,
        naam: p.naam as string,
      })
    );

    const instellingen = parseInstellingen(
      settingsRes.error ? null : (settingsRes.data as Record<string, unknown>)
    );

    const raw: MgmtRaw = {
      leads,
      afspraken,
      offertes,
      allOffertes,
      projecten,
      facturen,
      kosten,
      metaSpend,
      beschikbaarheid,
      adviseurs,
      installateurs,
    };

    const cfg = metaAdsSpendConfigured();
    const data = buildManagementDashboard(raw, filters, instellingen, cfg.ok);

    return NextResponse.json({
      dashboard: serializeManagementDashboard(data),
      missingTables: {
        meta_ad_spend: Boolean(metaRes.error),
        dashboard_instellingen: Boolean(settingsRes.error),
        adviseur_beschikbaarheid: Boolean(beschikRes.error),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Managementdashboard laden mislukt") },
      { status: 500 }
    );
  }
}

/** PATCH /api/management-dashboard — update instellingen */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const sb = getSupabaseAdmin();
    const { data: existing } = await sb
      .from("dashboard_instellingen")
      .select("id")
      .eq("actief", true)
      .limit(1)
      .maybeSingle();

    const allowed = [
      "omzet_doel_maand",
      "winst_doel_maand",
      "minimale_marge_pct",
      "max_cpl",
      "max_kosten_per_afspraak",
      "max_kosten_per_sale",
      "doel_lead_to_appointment",
      "doel_show_rate",
      "doel_closing_rate",
      "slots_per_adviseur_per_week",
      "installaties_per_week",
      "standaard_inkoop",
      "standaard_installatie",
      "verwachte_betaaltermijn_dagen",
      "max_doorlooptijd_fase_dagen",
      "forecast_lookback_dagen",
      "beginsaldo_cash",
      "btw_reservering",
    ];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (k in body) patch[k] = body[k];
    }
    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: "Geen velden" }, { status: 400 });
    }

    if (existing?.id) {
      const { error } = await sb
        .from("dashboard_instellingen")
        .update(patch)
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await sb
        .from("dashboard_instellingen")
        .insert({ ...patch, actief: true });
      if (error) throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Instellingen opslaan mislukt") },
      { status: 500 }
    );
  }
}
