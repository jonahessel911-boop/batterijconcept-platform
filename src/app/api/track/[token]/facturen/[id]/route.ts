import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildFactuurPdf } from "@/lib/pdf-factuur";
import { errMessage } from "@/lib/errors";
import { selectFactuurById } from "@/lib/factuur-query";

export const runtime = "nodejs";

/**
 * GET /api/track/[token]/facturen/[id] — factuur PDF voor klant
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  if (!token || token.length < 16 || !id) {
    return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: offerte, error } = await sb
      .from("offertes")
      .select("id, lead_id, status, track_token")
      .eq("track_token", token)
      .maybeSingle();

    if (error || !offerte || offerte.status !== "ondertekend") {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }

    const { data: project } = await sb
      .from("projecten")
      .select("id")
      .eq("offerte_id", offerte.id)
      .maybeSingle();

    const { data: factuur, error: facErr } = await selectFactuurById(sb, id);
    if (facErr || !factuur) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    const allowedStatuses = ["verzonden", "betaald", "deels_betaald"];
    if (!allowedStatuses.includes(factuur.status)) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    const sameOfferte = factuur.offerte_id === offerte.id;
    const sameProject = Boolean(project?.id && factuur.project_id === project.id);
    if (factuur.lead_id !== offerte.lead_id || (!sameOfferte && !sameProject)) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    let offerteJoin = null;
    if (factuur.offerte_id) {
      const { data: o } = await sb
        .from("offertes")
        .select("offerte_nummer, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw")
        .eq("id", factuur.offerte_id)
        .maybeSingle();
      offerteJoin = o;
    }

    const creditVanRaw = factuur.credit_van as
      | { id: string; factuur_nummer: string }
      | { id: string; factuur_nummer: string }[]
      | null;
    const creditVan = Array.isArray(creditVanRaw)
      ? creditVanRaw[0]
      : creditVanRaw;

    const blob = await buildFactuurPdf({
      factuur,
      lead: factuur.leads,
      offerte: offerteJoin,
      creditVanNummer: creditVan?.factuur_nummer || null,
    });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const isCredit = Boolean(factuur.credit_van_factuur_id);
    const filename = `${isCredit ? "credit-" : ""}${factuur.factuur_nummer}.pdf`;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "PDF mislukt") },
      { status: 500 }
    );
  }
}
