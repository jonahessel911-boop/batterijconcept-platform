import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  buildAttributionTree,
  buildGeoBreakdown,
  buildRapportageTree,
  type RapportageLead,
} from "@/lib/rapportage";
import {
  buildFinancialDashboard,
  parseFinancialRange,
  type CommissieMap,
} from "@/lib/financial-dashboard";

export const runtime = "nodejs";

/** GET /api/rapportage?adviseur_id=&financial_range=last_30_days */
export async function GET(req: NextRequest) {
  const adviseurId = req.nextUrl.searchParams.get("adviseur_id");
  const financialRange = parseFinancialRange(
    req.nextUrl.searchParams.get("financial_range")
  );

  try {
    const sb = getSupabaseAdmin();

    const [leadsRes, afsprakenRes, offertesRes, projectenRes, facturenRes, kostenRes] =
      await Promise.all([
        sb
          .from("leads")
          .select(
            "id, created_at, status, adviseur_id, lander, campaign_name, utm_campaign, ad_name, utm_content, postcode, plaats"
          ),
        sb
          .from("afspraken")
          .select("id, lead_id, adviseur_id, start_at, created_at, status, soort"),
        sb
          .from("offertes")
          .select(
            "id, lead_id, status, ondertekend_op, created_at, subtotaal_ex_btw, leads(adviseur_id), offerte_regels(omschrijving, aantal)"
          )
          .eq("status", "ondertekend"),
        sb
          .from("projecten")
          .select(
            "id, lead_id, offerte_id, created_at, projectkosten, leads(adviseur_id)"
          ),
        sb
          .from("facturen")
          .select(
            "id, lead_id, status, bedrag_ex_btw, betaald_op, factuurdatum, leads(adviseur_id)"
          ),
        sb
          .from("rapportage_kosten")
          .select("datum, soort, bedrag, adviseur_id")
          .order("datum", { ascending: true }),
      ]);

    let leads: RapportageLead[] = (leadsRes.data || []) as RapportageLead[];
    if (leadsRes.error) {
      if (
        leadsRes.error.code === "42703" ||
        leadsRes.error.message?.includes("lander") ||
        leadsRes.error.message?.includes("campaign_name") ||
        leadsRes.error.message?.includes("ad_name")
      ) {
        const retry = await sb
          .from("leads")
          .select(
            "id, created_at, status, adviseur_id, utm_campaign, utm_content, postcode, plaats"
          );
        if (retry.error) {
          const retryBasic = await sb
            .from("leads")
            .select(
              "id, created_at, status, adviseur_id, utm_campaign, postcode, plaats"
            );
          if (retryBasic.error) throw retryBasic.error;
          leads = (retryBasic.data || []).map((l) => ({
            ...(l as RapportageLead),
            lander: null,
            campaign_name: null,
            ad_name: null,
            utm_content: null,
          }));
        } else {
          leads = (retry.data || []).map((l) => ({
            ...(l as RapportageLead),
            lander: null,
            campaign_name: null,
            ad_name: null,
          }));
        }
      } else {
        throw leadsRes.error;
      }
    }

    const projectenRaw = projectenRes.data || [];
    const projecten = projectenRaw.map((p) => {
      const lead = p.leads as { adviseur_id?: string | null } | null;
      return {
        id: p.id,
        lead_id: p.lead_id,
        offerte_id: p.offerte_id,
        created_at: p.created_at,
        projectkosten:
          p.projectkosten != null ? Number(p.projectkosten) : 0,
        adviseur_id: lead?.adviseur_id ?? null,
      };
    });

    // Als projectkosten-kolom mist, PostgREST kan hele select falen
    let projectenSafe = projecten;
    if (
      projectenRes.error &&
      (projectenRes.error.message?.includes("projectkosten") ||
        projectenRes.error.code === "42703")
    ) {
      const retry = await sb
        .from("projecten")
        .select("id, lead_id, offerte_id, created_at, leads(adviseur_id)");
      projectenSafe = (retry.data || []).map((p) => {
        const lead = p.leads as { adviseur_id?: string | null } | null;
        return {
          id: p.id,
          lead_id: p.lead_id,
          offerte_id: p.offerte_id,
          created_at: p.created_at,
          projectkosten: 0,
          adviseur_id: lead?.adviseur_id ?? null,
        };
      });
    }

    const offertes = (offertesRes.data || []).map((o) => {
      const lead = o.leads as { adviseur_id?: string | null } | null;
      const regels = (o.offerte_regels || []) as {
        omschrijving?: string | null;
        aantal?: number | null;
      }[];
      return {
        id: o.id,
        lead_id: o.lead_id,
        status: o.status,
        ondertekend_op: o.ondertekend_op,
        created_at: o.created_at,
        subtotaal_ex_btw: Number(o.subtotaal_ex_btw) || 0,
        adviseur_id: lead?.adviseur_id ?? null,
        regels,
      };
    });

    const facturen = (facturenRes.error ? [] : facturenRes.data || []).map(
      (f) => {
        const lead = f.leads as { adviseur_id?: string | null } | null;
        return {
          id: f.id,
          lead_id: f.lead_id,
          status: f.status,
          bedrag_ex_btw: Number(f.bedrag_ex_btw) || 0,
          betaald_op: f.betaald_op as string | null,
          factuurdatum: f.factuurdatum as string,
          adviseur_id: lead?.adviseur_id ?? null,
        };
      }
    );

    let afsprakenData: {
      id: string;
      lead_id: string;
      adviseur_id: string | null;
      start_at: string;
      created_at: string;
      status: string;
      soort?: string | null;
    }[] = (afsprakenRes.data || []) as {
      id: string;
      lead_id: string;
      adviseur_id: string | null;
      start_at: string;
      created_at: string;
      status: string;
      soort?: string | null;
    }[];
    if (afsprakenRes.error) {
      if (
        afsprakenRes.error.code === "42703" ||
        afsprakenRes.error.message?.includes("soort")
      ) {
        const retry = await sb
          .from("afspraken")
          .select("id, lead_id, adviseur_id, start_at, created_at, status");
        if (retry.error) throw retry.error;
        afsprakenData = (retry.data || []) as typeof afsprakenData;
      } else {
        throw afsprakenRes.error;
      }
    }
    if (offertesRes.error) throw offertesRes.error;

    const raw = {
      leads,
      afspraken: afsprakenData,
      offertes,
      projecten: projectenSafe,
      facturen,
    };

    const tree = buildRapportageTree(raw, adviseurId);
    const attribution = buildAttributionTree(raw, adviseurId);
    const geo = buildGeoBreakdown(raw, adviseurId);

    const kosten = (kostenRes.error ? [] : kostenRes.data || []).map((k) => ({
      datum: k.datum as string,
      soort: k.soort as "ad_spend" | "sales",
      bedrag: Number(k.bedrag) || 0,
      adviseur_id: (k.adviseur_id as string | null) ?? null,
    }));

    // Commissie-% per adviseur ophalen
    let commissieMap: CommissieMap | undefined;
    {
      const { data: advRows } = await sb
        .from("adviseurs")
        .select("id, commissie_pct");
      if (advRows) {
        commissieMap = new Map<string, number>();
        for (const row of advRows) {
          const pct = Number((row as Record<string, unknown>).commissie_pct) || 0;
          if (pct > 0) commissieMap.set(row.id, pct);
        }
      }
    }

    const financial = buildFinancialDashboard(
      raw,
      kosten,
      adviseurId,
      financialRange,
      undefined,
      commissieMap
    );

    return NextResponse.json({ tree, attribution, financial, geo });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Rapportage laden mislukt") },
      { status: 500 }
    );
  }
}
