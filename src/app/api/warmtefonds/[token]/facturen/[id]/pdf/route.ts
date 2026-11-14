import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildFactuurPdf } from "@/lib/pdf-factuur";
import { selectFactuurById } from "@/lib/factuur-query";
import {
  isWarmtefondsPortalProject,
  resolveWarmtefondsOperator,
} from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

/** GET /api/warmtefonds/[token]/facturen/[id]/pdf — klantfactuur via portaal-token. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json({ error: "Portaal niet gevonden" }, { status: 404 });
    }

    const loaded = await selectFactuurById(sb, id);
    const factuur = loaded.data as {
      id: string;
      factuur_nummer?: string | null;
      status?: string | null;
      project_id?: string | null;
      offerte_id?: string | null;
      credit_van_factuur_id?: string | null;
      leads?: unknown;
      credit_van?: { id: string; factuur_nummer: string } | { id: string; factuur_nummer: string }[] | null;
    } | null;
    if (!factuur) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    let project: {
      betaalwijze?: string | null;
      financiering_status?: string | null;
      status?: string | null;
    } | null = null;
    if (factuur.project_id) {
      const { data } = await sb
        .from("projecten")
        .select("id, betaalwijze, financiering_status, status")
        .eq("id", factuur.project_id)
        .maybeSingle();
      project = data;
    }
    if (!project && factuur.offerte_id) {
      const { data } = await sb
        .from("projecten")
        .select("id, betaalwijze, financiering_status, status")
        .eq("offerte_id", factuur.offerte_id)
        .maybeSingle();
      project = data;
    }
    if (!project || !isWarmtefondsPortalProject(project)) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    let offerte = null;
    if (factuur.offerte_id) {
      const { data: o } = await sb
        .from("offertes")
        .select("offerte_nummer, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw")
        .eq("id", factuur.offerte_id)
        .maybeSingle();
      offerte = o;
    }

    const creditVanRaw = factuur.credit_van;
    const creditVan = Array.isArray(creditVanRaw) ? creditVanRaw[0] : creditVanRaw;
    const isCredit = Boolean(factuur.credit_van_factuur_id);
    const blob = await buildFactuurPdf({
      factuur: factuur as never,
      lead: factuur.leads as never,
      offerte,
      creditVanNummer: creditVan?.factuur_nummer || null,
    });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const filename = `${isCredit ? "credit-" : ""}${factuur.factuur_nummer || "factuur"}${
      factuur.status === "concept" ? "-concept" : ""
    }.pdf`;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "PDF mislukt") },
      { status: 500 }
    );
  }
}
