import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import { buildPartnerCreditfactuurPdf } from "@/lib/pdf-partner-creditfactuur";

export const runtime = "nodejs";

/**
 * GET /api/partners/creditfacturen/[id]/pdf
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
    const mag =
      rol === "admin" ||
      isAdminEmail(session.email) ||
      isAdminAdviseur({ naam: session.naam, email: session.email });
    if (!mag) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const sb = getSupabaseAdmin();
    const { data: fac, error } = await sb
      .from("partner_creditfacturen")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !fac) {
      return NextResponse.json(
        { error: "Creditfactuur niet gevonden" },
        { status: 404 }
      );
    }

    const { data: partner } = await sb
      .from("installatie_partners")
      .select(
        "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
      )
      .eq("id", fac.partner_id)
      .maybeSingle();

    if (!partner) {
      return NextResponse.json(
        { error: "Partner niet gevonden" },
        { status: 404 }
      );
    }

    const blob = await buildPartnerCreditfactuurPdf({
      factuur: {
        factuur_nummer: fac.factuur_nummer,
        factuurdatum: fac.factuurdatum,
        status: fac.status,
        week_jaar: fac.week_jaar,
        week_nummer: fac.week_nummer,
        periode_van: fac.periode_van,
        periode_tot: fac.periode_tot,
        bedrag_ex_btw: Number(fac.bedrag_ex_btw || 0),
        bedrag_inc_btw: Number(fac.bedrag_inc_btw || 0),
        btw_bedrag: Number(fac.btw_bedrag || 0),
        omschrijving: fac.omschrijving,
        notities: fac.notities,
        offerte_nummer: fac.offerte_nummer,
        project_nummer: fac.project_nummer,
      },
      partner: {
        naam: partner.naam,
        email: partner.email,
        bedrijfsnaam: partner.bedrijfsnaam,
        kvk_nummer: partner.kvk_nummer,
        btw_nummer: partner.btw_nummer,
        iban: partner.iban,
        factuur_adres: partner.factuur_adres,
        factuur_postcode: partner.factuur_postcode,
        factuur_plaats: partner.factuur_plaats,
      },
    });

    const bytes = Buffer.from(await blob.arrayBuffer());
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fac.factuur_nummer}.pdf"`,
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
