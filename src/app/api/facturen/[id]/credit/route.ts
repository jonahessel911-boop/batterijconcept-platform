import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { splitIncToExBtw } from "@/lib/aanbetaling";
import {
  factuurOmschrijvingMetProduct,
  primaireProductOmschrijving,
} from "@/lib/factuur-omschrijving";
import {
  FACTUUR_BETAALTERMIJN_DAGEN,
  amsterdamDatePlusDays,
} from "@/lib/factuur-betaling";

export const runtime = "nodejs";

/**
 * POST /api/facturen/[id]/credit
 * Maakt een concept-creditfactuur voor het volledige bedrag van deze factuur.
 * Body: { omschrijving? } — bedrag komt altijd van de oorspronkelijke factuur.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { omschrijving?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    /* lege body ok */
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: orig, error: origErr } = await sb
      .from("facturen")
      .select(
        "id, factuur_nummer, bedrag_inc_btw, bedrag_ex_btw, btw_bedrag, status, project_id, lead_id, offerte_id, credit_van_factuur_id, omschrijving"
      )
      .eq("id", id)
      .maybeSingle();

    if (origErr) throw origErr;
    if (!orig) {
      return NextResponse.json(
        { error: "Factuur niet gevonden" },
        { status: 404 }
      );
    }

    if (orig.credit_van_factuur_id) {
      return NextResponse.json(
        { error: "Je kunt geen creditfactuur van een creditfactuur maken" },
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

    const bedragRaw = Number(orig.bedrag_inc_btw);
    if (!Number.isFinite(bedragRaw) || bedragRaw < 0.01) {
      return NextResponse.json(
        { error: "Oorspronkelijke factuur heeft geen geldig bedrag" },
        { status: 400 }
      );
    }

    let productLabel: string | null = null;
    if (orig.offerte_id) {
      const { data: regels } = await sb
        .from("offerte_regels")
        .select("omschrijving, product_id, prijs_ex_btw, sort_order")
        .eq("offerte_id", orig.offerte_id)
        .order("sort_order", { ascending: true });
      productLabel = primaireProductOmschrijving(regels || []);
    }

    const omschrijving =
      body.omschrijving?.trim() ||
      factuurOmschrijvingMetProduct(
        productLabel,
        `Creditfactuur bij ${orig.factuur_nummer}`
      );

    let projectNummer: string | null = null;
    if (orig.project_id) {
      const { data: project } = await sb
        .from("projecten")
        .select("project_nummer")
        .eq("id", orig.project_id)
        .maybeSingle();
      projectNummer = project?.project_nummer || null;
    }

    // Gebruik exact dezelfde split als de oorspronkelijke factuur als die klopt;
    // anders herbereken vanuit incl. btw.
    const origEx = Number(orig.bedrag_ex_btw);
    const origBtw = Number(orig.btw_bedrag);
    const origInc = Number(orig.bedrag_inc_btw);
    const amountsMatch =
      Number.isFinite(origEx) &&
      Number.isFinite(origBtw) &&
      Number.isFinite(origInc) &&
      Math.abs(origEx + origBtw - origInc) < 0.02;

    const split = amountsMatch
      ? { ex: origEx, btw: origBtw, inc: origInc }
      : splitIncToExBtw(bedragRaw);

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

    const notities = projectNummer
      ? `CREDIT FACTUUR (${orig.factuur_nummer}). Betreft ${projectNummer}. Er hoeft niets te worden betaald.`
      : `CREDIT FACTUUR (${orig.factuur_nummer}). Er hoeft niets te worden betaald.`;

    const insertRow: Record<string, unknown> = {
      lead_id: orig.lead_id,
      project_id: orig.project_id || null,
      offerte_id: orig.offerte_id || null,
      factuur_nummer: nummer as string,
      status: "concept",
      omschrijving,
      bedrag_ex_btw: split.ex,
      btw_bedrag: split.btw,
      bedrag_inc_btw: split.inc,
      factuurdatum,
      vervaldatum,
      notities,
      credit_van_factuur_id: orig.id,
    };

    const { data: factuur, error: insertErr } = await sb
      .from("facturen")
      .insert(insertRow)
      .select("*, leads(naam, email, lead_number)")
      .single();

    if (
      insertErr &&
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
          error: "Creditfactuur aanmaken mislukt",
          detail: insertErr?.message,
        },
        { status: 500 }
      );
    }

    // Bij geannuleerd project: credit-taak automatisch afronden als alles gecrediteerd is
    if (orig.project_id) {
      const { data: proj } = await sb
        .from("projecten")
        .select("status")
        .eq("id", orig.project_id)
        .maybeSingle();
      if (proj?.status === "annulering") {
        const { syncAutoTakenVoorProject } = await import(
          "@/lib/sync-auto-taken"
        );
        await syncAutoTakenVoorProject(sb, orig.project_id, "annulering");
      }
    }

    return NextResponse.json({ factuur });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
