import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  buildAttributionTree,
  buildRapportageTree,
  type RapportageLead,
} from "@/lib/rapportage";

export const runtime = "nodejs";

/** GET /api/rapportage?adviseur_id= */
export async function GET(req: NextRequest) {
  const adviseurId = req.nextUrl.searchParams.get("adviseur_id");

  try {
    const sb = getSupabaseAdmin();

    const [leadsRes, afsprakenRes, offertesRes, projectenRes, facturenRes] =
      await Promise.all([
        sb
          .from("leads")
          .select(
            "id, created_at, status, adviseur_id, lander, campaign_name, utm_campaign"
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
      ]);

    let leads: RapportageLead[] = (leadsRes.data || []) as RapportageLead[];
    if (leadsRes.error) {
      if (
        leadsRes.error.code === "42703" ||
        leadsRes.error.message?.includes("lander") ||
        leadsRes.error.message?.includes("campaign_name")
      ) {
        const retry = await sb
          .from("leads")
          .select("id, created_at, status, adviseur_id, utm_campaign");
        if (retry.error) throw retry.error;
        leads = (retry.data || []).map((l) => ({
          ...(l as RapportageLead),
          lander: null,
          campaign_name: null,
        }));
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

    return NextResponse.json({ tree, attribution });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Rapportage laden mislukt") },
      { status: 500 }
    );
  }
}
