import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  ensureBtwDraftFactuur,
  ensureRestantDraftFactuur,
} from "@/lib/ensure-btw-factuur";
import { magWarmtefondsRestantFactuur } from "@/lib/aanbetaling";
import { resolveFinancieringStatus } from "@/lib/financiering-status";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/offertes/[id]/factuur
 * { soort?: 'aanbetaling' | 'restant' } — conceptfactuur aanmaken/bijwerken.
 * Default: aanbetaling (BTW / Warmtefonds-aanbetaling).
 * Restant bij Warmtefonds: pas na aanvraag_goedgekeurd.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { soort?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty ok */
  }
  const soort = body.soort === "restant" ? "restant" : "aanbetaling";

  try {
    const sb = getSupabaseAdmin();
    const { data: offerte, error } = await sb
      .from("offertes")
      .select(
        "id, lead_id, offerte_nummer, status, btw_bedrag, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud, aanbetaling_modus, aanbetaling_bedrag_inc"
      )
      .eq("id", id)
      .single();

    if (error || !offerte) {
      return NextResponse.json({ error: "Offerte niet gevonden" }, { status: 404 });
    }
    if (offerte.status !== "ondertekend") {
      return NextResponse.json(
        { error: "Alleen ondertekende offertes krijgen een factuur" },
        { status: 409 }
      );
    }

    const { data: project } = await sb
      .from("projecten")
      .select("id, status, financiering_status")
      .eq("offerte_id", id)
      .maybeSingle();

    if (soort === "restant") {
      const isWf = Boolean(offerte.financiering_voorbehoud);
      const fs = project
        ? resolveFinancieringStatus(project)
        : null;
      if (isWf && fs !== "afgewezen" && !magWarmtefondsRestantFactuur(fs)) {
        return NextResponse.json(
          {
            error:
              "Restantfactuur Warmtefonds pas na goedkeuring van de aanvraag",
            code: "wf_niet_goedgekeurd",
            financiering_status: fs,
          },
          { status: 409 }
        );
      }

      const factuur = await ensureRestantDraftFactuur(sb, {
        offerteId: offerte.id,
        leadId: offerte.lead_id,
        projectId: project?.id || null,
        offerteNummer: offerte.offerte_nummer,
        orderIncBtw: Number(offerte.totaal_inc_btw) || 0,
        orderExBtw: Number(offerte.subtotaal_ex_btw) || 0,
        warmtefonds: isWf && fs !== "afgewezen",
      });

      if (!factuur) {
        return NextResponse.json({
          skipped: true,
          reason: "Geen restant meer te factureren",
        });
      }

      return NextResponse.json({ factuur, soort: "restant" });
    }

    const factuur = await ensureBtwDraftFactuur(sb, {
      offerteId: offerte.id,
      leadId: offerte.lead_id,
      projectId: project?.id || null,
      offerteNummer: offerte.offerte_nummer,
      btwBedrag: Number(offerte.btw_bedrag) || 0,
      subtotaalExBtw: Number(offerte.subtotaal_ex_btw) || 0,
      totaalIncBtw: Number(offerte.totaal_inc_btw) || 0,
      financieringVoorbehoud: Boolean(offerte.financiering_voorbehoud),
      aanbetalingModus: offerte.aanbetaling_modus,
      aanbetalingBedragInc:
        offerte.aanbetaling_bedrag_inc != null
          ? Number(offerte.aanbetaling_bedrag_inc)
          : null,
    });

    if (!factuur) {
      return NextResponse.json({
        skipped: true,
        reason: "Geen aanbetaling voor deze offerte",
      });
    }

    return NextResponse.json({ factuur, soort: "aanbetaling" });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
