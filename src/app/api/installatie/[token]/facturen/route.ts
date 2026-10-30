import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  createPartnerSelfbillingFactuur,
  normalizePartnerSelfbillingRegels,
  type PartnerSelfbillingRegelInput,
} from "@/lib/partner-selfbilling";

export const runtime = "nodejs";

async function resolvePartner(token: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partners")
    .select(
      "id, naam, email, actief, portal_token, bedrijfsnaam, kvk_nummer, iban"
    )
    .eq("portal_token", token)
    .single();
  if (error || !data || !data.actief) return null;
  return data;
}

/**
 * GET /api/installatie/[token]/facturen
 * Concepten + verstuurde selfbilling-facturen voor deze partner.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: facturen, error } = await sb
      .from("partner_creditfacturen")
      .select(
        "id, factuur_nummer, status, week_jaar, week_nummer, periode_van, periode_tot, omschrijving, offerte_nummer, project_nummer, bedrag_ex_btw, btw_bedrag, bedrag_inc_btw, factuurdatum, betaald_op, verzonden_op, goedgekeurd_op, notities, created_at"
      )
      .eq("partner_id", partner.id)
      .in("status", ["concept", "verzonden", "goedgekeurd", "betaald"])
      .order("factuurdatum", { ascending: false });

    if (error) {
      if (
        error.code === "42703" ||
        error.message?.includes("partner_creditfacturen")
      ) {
        return NextResponse.json({
          partner: { id: partner.id, naam: partner.naam },
          facturen: [],
          migration_needed: true,
        });
      }
      throw error;
    }

    return NextResponse.json({
      partner: {
        id: partner.id,
        naam: partner.naam,
        heeft_kvk: Boolean(
          partner.bedrijfsnaam && partner.kvk_nummer && partner.iban
        ),
      },
      facturen: facturen || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/installatie/[token]/facturen
 * Body: { regels: [{omschrijving, bedrag_ex_btw}], project_nummer?, verstuur?: boolean }
 * Partner maakt selfbilling met vrije regels + 21% BTW.
 * verstuur=true → direct goedgekeurd (klaar voor BC-uitbetaling).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  let body: {
    regels?: PartnerSelfbillingRegelInput[];
    omschrijving?: string;
    notities?: string;
    project_nummer?: string;
    offerte_nummer?: string;
    verstuur?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const regels = normalizePartnerSelfbillingRegels(body.regels);
    if (regels.length === 0) {
      return NextResponse.json(
        {
          error:
            "Voeg minstens één regel toe (bijv. Meterkast, Materiaal) met bedrag excl. btw",
        },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const result = await createPartnerSelfbillingFactuur(sb, {
      partnerId: partner.id,
      regels,
      omschrijving: body.omschrijving,
      notities: body.notities,
      project_nummer: body.project_nummer,
      offerte_nummer: body.offerte_nummer,
      status: body.verstuur ? "goedgekeurd" : "concept",
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json(
      {
        factuur: result.factuur,
        verstuurd: Boolean(body.verstuur),
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Aanmaken mislukt") },
      { status: 500 }
    );
  }
}
