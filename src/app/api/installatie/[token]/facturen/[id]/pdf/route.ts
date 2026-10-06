import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildPartnerCreditfactuurPdf } from "@/lib/pdf-partner-creditfactuur";

export const runtime = "nodejs";

async function resolvePartner(token: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partners")
    .select("id, naam, actief, portal_token")
    .eq("portal_token", token)
    .single();
  if (error || !data || !data.actief) return null;
  return data;
}

/**
 * GET /api/installatie/[token]/facturen/[id]/pdf
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: fac, error } = await sb
      .from("partner_creditfacturen")
      .select("*")
      .eq("id", id)
      .eq("partner_id", partner.id)
      .maybeSingle();

    if (error || !fac || fac.status === "geannuleerd") {
      return NextResponse.json(
        { error: "Factuur niet gevonden" },
        { status: 404 }
      );
    }

    const { data: partnerFull } = await sb
      .from("installatie_partners")
      .select(
        "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
      )
      .eq("id", partner.id)
      .maybeSingle();

    if (!partnerFull) {
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
        naam: partnerFull.naam,
        email: partnerFull.email,
        bedrijfsnaam: partnerFull.bedrijfsnaam,
        kvk_nummer: partnerFull.kvk_nummer,
        btw_nummer: partnerFull.btw_nummer,
        iban: partnerFull.iban,
        factuur_adres: partnerFull.factuur_adres,
        factuur_postcode: partnerFull.factuur_postcode,
        factuur_plaats: partnerFull.factuur_plaats,
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
