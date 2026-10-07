import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildAangetekendeBriefPdf } from "@/lib/pdf-aangetekende-brief";

export const runtime = "nodejs";

/**
 * GET /api/projecten/[id]/aangetekende-brief
 * Download aangetekende brief (Warmtefonds: meewerken of 50% annuleringskosten).
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, status, schouw_jaar, schouw_week, offerte_id, leads(naam, postcode, huisnummer, toevoeging, straat, plaats), offertes(id, offerte_nummer, ondertekend_op, totaal_inc_btw, titel)"
      )
      .eq("id", id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
    }

    if (project.status === "annulering") {
      return NextResponse.json(
        { error: "Project is al geannuleerd" },
        { status: 409 }
      );
    }

    const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
    type OffLite = {
      id: string;
      offerte_nummer: string;
      ondertekend_op?: string | null;
      totaal_inc_btw?: number | null;
      titel?: string | null;
    };
    const offJoin = Array.isArray(project.offertes)
      ? project.offertes[0]
      : project.offertes;
    let off: OffLite | null = (offJoin as OffLite | null) || null;

    if (!off?.id && project.offerte_id) {
      const { data: offRow } = await sb
        .from("offertes")
        .select("id, offerte_nummer, ondertekend_op, totaal_inc_btw, titel")
        .eq("id", project.offerte_id)
        .maybeSingle();
      off = (offRow as OffLite | null) || null;
    }

    if (!off?.id || !off.offerte_nummer) {
      return NextResponse.json(
        { error: "Geen offerte gekoppeld" },
        { status: 400 }
      );
    }

    let productOmschrijving = off.titel?.trim() || "thuisbatterij";

    const { data: regels } = await sb
      .from("offerte_regels")
      .select("omschrijving, sort_order")
      .eq("offerte_id", off.id)
      .order("sort_order", { ascending: true })
      .limit(5);

    const batterijRegel = (regels || []).find((r) => {
      const o = (r.omschrijving || "").toLowerCase();
      return (
        o.includes("batterij") ||
        o.includes("alpha") ||
        o.includes("kwh") ||
        o.includes("smile")
      );
    });
    if (batterijRegel?.omschrijving?.trim()) {
      productOmschrijving = batterijRegel.omschrijving.trim();
    } else if (regels?.[0]?.omschrijving?.trim()) {
      productOmschrijving = regels[0].omschrijving.trim();
    }

    const ondertekendOp =
      off.ondertekend_op || new Date().toISOString();

    const blob = await buildAangetekendeBriefPdf({
      klantNaam: lead?.naam || "klant",
      straat: lead?.straat,
      huisnummer: lead?.huisnummer,
      toevoeging: lead?.toevoeging,
      postcode: lead?.postcode,
      plaats: lead?.plaats,
      offerteNummer: off.offerte_nummer,
      ondertekendOp,
      productOmschrijving,
      totaalIncBtw: Number(off.totaal_inc_btw) || 0,
      schouwJaar: project.schouw_jaar,
      schouwWeek: project.schouw_week,
    });

    const bytes = Buffer.from(await blob.arrayBuffer());
    const filename = `aangetekend-${off.offerte_nummer}.pdf`;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "PDF mislukt") },
      { status: 500 }
    );
  }
}
