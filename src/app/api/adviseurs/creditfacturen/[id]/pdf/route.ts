import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import { buildAdviseurCreditPdfBytes } from "@/lib/adviseur-creditfactuur-pdf-data";

export const runtime = "nodejs";

/**
 * GET /api/adviseurs/creditfacturen/[id]/pdf
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (rol !== "admin" && rol !== "adviseur") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const sb = getSupabaseAdmin();
    const { data: fac, error } = await sb
      .from("adviseur_creditfacturen")
      .select(
        "id, adviseur_id, factuur_nummer, status, week_jaar, week_nummer, periode_van, periode_tot, bedrag_ex_btw, btw_bedrag, bedrag_inc_btw, factuurdatum, notities"
      )
      .eq("id", id)
      .maybeSingle();

    if (error || !fac) {
      return NextResponse.json(
        { error: "Creditfactuur niet gevonden" },
        { status: 404 }
      );
    }

    if (rol === "adviseur" && fac.adviseur_id !== session.adviseurId) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const { data: adv } = await sb
      .from("adviseurs")
      .select(
        "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
      )
      .eq("id", fac.adviseur_id)
      .maybeSingle();

    if (!adv) {
      return NextResponse.json(
        { error: "Adviseur niet gevonden" },
        { status: 404 }
      );
    }

    const bytes = await buildAdviseurCreditPdfBytes(sb, fac, adv);
    const filename = `${fac.factuur_nummer}.pdf`;

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "PDF mislukt", detail: errMessage(e) },
      { status: 500 }
    );
  }
}
