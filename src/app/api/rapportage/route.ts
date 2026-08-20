import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildRapportageTree } from "@/lib/rapportage";

export const runtime = "nodejs";

/** GET /api/rapportage?adviseur_id= */
export async function GET(req: NextRequest) {
  const adviseurId = req.nextUrl.searchParams.get("adviseur_id");

  try {
    const sb = getSupabaseAdmin();

    const [leadsRes, afsprakenRes, offertesRes, projectenRes, kostenRes, facturenRes] =
      await Promise.all([
        sb.from("leads").select("id, created_at, status, adviseur_id"),
        sb
          .from("afspraken")
          .select("id, lead_id, adviseur_id, start_at, status, soort"),
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
        sb.from("rapportage_kosten").select("datum, soort, bedrag, adviseur_id"),
        sb
          .from("facturen")
          .select(
            "id, lead_id, status, bedrag_ex_btw, betaald_op, factuurdatum, leads(adviseur_id)"
          ),
      ]);

    // Soft-fail als migraties nog niet gedraaid zijn
    const kosten =
      kostenRes.error &&
      (kostenRes.error.message?.includes("rapportage_kosten") ||
        kostenRes.error.code === "42P01")
        ? []
        : kostenRes.data || [];

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

    if (leadsRes.error) throw leadsRes.error;
    let afsprakenData: {
      id: string;
      lead_id: string;
      adviseur_id: string | null;
      start_at: string;
      status: string;
      soort?: string | null;
    }[] = (afsprakenRes.data || []) as {
      id: string;
      lead_id: string;
      adviseur_id: string | null;
      start_at: string;
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
          .select("id, lead_id, adviseur_id, start_at, status");
        if (retry.error) throw retry.error;
        afsprakenData = (retry.data || []) as typeof afsprakenData;
      } else {
        throw afsprakenRes.error;
      }
    }
    if (offertesRes.error) throw offertesRes.error;

    const tree = buildRapportageTree(
      {
        leads: leadsRes.data || [],
        afspraken: afsprakenData,
        offertes,
        projecten: projectenSafe,
        kosten: kosten as {
          datum: string;
          soort: "ad_spend" | "sales";
          bedrag: number;
          adviseur_id: string | null;
        }[],
        facturen,
      },
      adviseurId
    );

    return NextResponse.json({ tree });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Rapportage laden mislukt") },
      { status: 500 }
    );
  }
}

/** POST /api/rapportage — zet ad_spend of sales kosten voor een dag */
export async function POST(req: NextRequest) {
  let body: {
    datum?: string;
    soort?: "ad_spend" | "sales";
    bedrag?: number;
    adviseur_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.datum || !body.soort) {
    return NextResponse.json(
      { error: "datum en soort zijn verplicht" },
      { status: 400 }
    );
  }
  if (body.soort !== "ad_spend" && body.soort !== "sales") {
    return NextResponse.json({ error: "Ongeldige soort" }, { status: 400 });
  }

  const bedrag = Number(body.bedrag);
  if (Number.isNaN(bedrag) || bedrag < 0) {
    return NextResponse.json({ error: "Ongeldig bedrag" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const adviseurId = body.adviseur_id || null;

    let q = sb
      .from("rapportage_kosten")
      .select("id")
      .eq("datum", body.datum)
      .eq("soort", body.soort);
    if (adviseurId) q = q.eq("adviseur_id", adviseurId);
    else q = q.is("adviseur_id", null);

    const { data: existing } = await q.maybeSingle();

    if (existing?.id) {
      const { data, error } = await sb
        .from("rapportage_kosten")
        .update({ bedrag })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return NextResponse.json({ kosten: data });
    }

    const { data, error } = await sb
      .from("rapportage_kosten")
      .insert({
        datum: body.datum,
        soort: body.soort,
        bedrag,
        adviseur_id: adviseurId,
      })
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ kosten: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      {
        error: errMessage(
          e,
          "Opslaan mislukt — run migrate-rapportage.sql in Supabase"
        ),
      },
      { status: 500 }
    );
  }
}
