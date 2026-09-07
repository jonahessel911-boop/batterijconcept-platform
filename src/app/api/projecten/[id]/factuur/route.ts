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
 * Creditfactuur: { credit_van_factuur_id, bedrag_inc_btw?, omschrijving? }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    bedrag_inc_btw?: number | string;
    omschrijving?: string | null;
    credit_van_factuur_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const creditVanId = body.credit_van_factuur_id?.trim() || null;

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

    let creditVan: {
      id: string;
      factuur_nummer: string;
      bedrag_inc_btw: number;
      status: string;
      project_id: string | null;
      lead_id: string;
      offerte_id: string | null;
    } | null = null;

    if (creditVanId) {
      const { data: orig, error: origErr } = await sb
        .from("facturen")
        .select(
          "id, factuur_nummer, bedrag_inc_btw, status, project_id, lead_id, offerte_id, credit_van_factuur_id"
        )
        .eq("id", creditVanId)
        .single();

      if (origErr || !orig) {
        return NextResponse.json(
          { error: "Oorspronkelijke factuur niet gevonden" },
          { status: 404 }
        );
      }
      if (orig.credit_van_factuur_id) {
        return NextResponse.json(
          { error: "Je kunt geen creditfactuur van een creditfactuur maken" },
          { status: 400 }
        );
      }
      if (orig.project_id !== project.id && orig.lead_id !== project.lead_id) {
        return NextResponse.json(
          { error: "Factuur hoort niet bij dit project" },
          { status: 400 }
        );
      }
      if (orig.status === "concept" || orig.status === "vervallen") {
        return NextResponse.json(
          {
            error:
              "Creditfactuur alleen mogelijk bij een verzonden of betaalde factuur",
          },
          { status: 400 }
        );
      }
      creditVan = orig;
    }

    const bedragRaw =
      typeof body.bedrag_inc_btw === "string"
        ? Number(body.bedrag_inc_btw.replace(",", "."))
        : body.bedrag_inc_btw != null
          ? Number(body.bedrag_inc_btw)
          : creditVan
            ? Number(creditVan.bedrag_inc_btw)
            : NaN;

    if (!Number.isFinite(bedragRaw) || bedragRaw < 0.01) {
      return NextResponse.json(
        { error: "Vul een bedrag incl. btw in (minimaal €0,01)" },
        { status: 400 }
      );
    }

    const omschrijving =
      body.omschrijving?.trim() ||
      (creditVan
        ? `Creditfactuur bij ${creditVan.factuur_nummer}`
        : "Factuur Batterijconcept");

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

    const notities = creditVan
      ? `CREDIT FACTUUR (${creditVan.factuur_nummer}). Betreft ${project.project_nummer}. Er hoeft niets te worden betaald.`
      : `Betreft ${project.project_nummer}. Betaal op NL48 BUNQ 2209 5579 33 t.n.v. BatterijConcept o.v.v. ${ref}.`;

    const insertRow: Record<string, unknown> = {
      lead_id: project.lead_id,
      project_id: project.id,
      offerte_id: project.offerte_id || creditVan?.offerte_id || null,
      factuur_nummer: nummer as string,
      status: "concept",
      omschrijving,
      bedrag_ex_btw: split.ex,
      btw_bedrag: split.btw,
      bedrag_inc_btw: split.inc,
      factuurdatum,
      vervaldatum,
      notities,
    };
    if (creditVan?.id) {
      insertRow.credit_van_factuur_id = creditVan.id;
    }

    const insertResult = await sb
      .from("facturen")
      .insert(insertRow)
      .select("*")
      .single();
    let factuur = insertResult.data;
    let insertErr = insertResult.error;
    if (
      insertErr &&
      creditVan?.id &&
      (insertErr.message?.includes("credit_van_factuur_id") ||
        insertErr.code === "42703")
    ) {
      return NextResponse.json(
        {
          error:
            "Creditfacturen vereisen een database-migratie. Voer supabase/migrate-factuur-credit.sql uit in Supabase.",
          detail: insertErr.message,
        },
        { status: 400 }
      );
    }

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
