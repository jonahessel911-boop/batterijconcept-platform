import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { splitIncToExBtw } from "@/lib/aanbetaling";
import {
  FACTUUR_BETAALTERMIJN_DAGEN,
  amsterdamDatePlusDays,
} from "@/lib/factuur-betaling";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/factuur
 * Handmatige conceptfactuur: { bedrag_inc_btw, omschrijving? }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    bedrag_inc_btw?: number | string;
    omschrijving?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const bedragRaw =
    typeof body.bedrag_inc_btw === "string"
      ? Number(body.bedrag_inc_btw.replace(",", "."))
      : Number(body.bedrag_inc_btw);
  if (!Number.isFinite(bedragRaw) || bedragRaw < 0.01) {
    return NextResponse.json(
      { error: "Vul een bedrag incl. btw in (minimaal €0,01)" },
      { status: 400 }
    );
  }

  const omschrijving =
    body.omschrijving?.trim() || "Factuur Batterijconcept";

  try {
    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select("id, lead_id, offerte_id, project_nummer")
      .eq("id", id)
      .single();

    if (error || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const split = splitIncToExBtw(bedragRaw);
    const today = new Date();
    const factuurdatum = amsterdamDatePlusDays(today, 0);
    const vervaldatum = amsterdamDatePlusDays(
      today,
      FACTUUR_BETAALTERMIJN_DAGEN
    );

    const { data: nummer, error: numErr } = await sb.rpc(
      "generate_factuur_nummer"
    );
    if (numErr || !nummer) {
      return NextResponse.json(
        { error: "Kon geen factuurnummer genereren", detail: numErr?.message },
        { status: 500 }
      );
    }

    const ref =
      (await sb
        .from("offertes")
        .select("offerte_nummer")
        .eq("id", project.offerte_id || "")
        .maybeSingle()).data?.offerte_nummer || project.project_nummer;

    const { data: factuur, error: insertErr } = await sb
      .from("facturen")
      .insert({
        lead_id: project.lead_id,
        project_id: project.id,
        offerte_id: project.offerte_id || null,
        factuur_nummer: nummer as string,
        status: "concept",
        omschrijving,
        bedrag_ex_btw: split.ex,
        btw_bedrag: split.btw,
        bedrag_inc_btw: split.inc,
        factuurdatum,
        vervaldatum,
        notities: `Betreft ${project.project_nummer}. Betaal op NL48 BUNQ 2209 5579 33 t.n.v. BatterijConcept o.v.v. ${ref}.`,
      })
      .select("*")
      .single();

    if (insertErr || !factuur) {
      return NextResponse.json(
        {
          error: "Factuur aanmaken mislukt",
          detail: insertErr?.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ factuur });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
