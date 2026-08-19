import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

async function resolvePartner(token: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partners")
    .select("id, naam, email, telefoon, actief, portal_token")
    .eq("portal_token", token)
    .single();
  if (error || !data || !data.actief) return null;
  return data;
}

/** GET /api/installatie/[token]/orders/[projectId] */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: order, error } = await sb
      .from("projecten")
      .select(
        `id, project_nummer, titel, status, schouw_at, schouw_notities, installatie_at, installatie_notities, notities,
         monteur, startdatum, opleverdatum, created_at, offerte_id,
         leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats)`
      )
      .eq("id", projectId)
      .eq("installatie_partner_id", partner.id)
      .single();

    if (error || !order) {
      return NextResponse.json(
        { error: "Order niet gevonden" },
        { status: 404 }
      );
    }

    const [{ data: fotos }, offerteRes] = await Promise.all([
      sb
        .from("project_fotos")
        .select("id, project_id, storage_path, bestandsnaam, omschrijving, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true }),
      order.offerte_id
        ? sb
            .from("offertes")
            .select(
              "offerte_nummer, titel, status, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, intro_tekst, offerte_regels(omschrijving, aantal, prijs_ex_btw, totaal_ex_btw, sort_order)"
            )
            .eq("id", order.offerte_id)
            .single()
        : Promise.resolve({ data: null }),
    ]);

    const paths = (fotos || []).map((f) => f.storage_path);
    let urlMap = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await sb.storage
        .from("project-fotos")
        .createSignedUrls(paths, 60 * 60 * 6);
      for (const item of signed || []) {
        if (item.path && item.signedUrl) {
          urlMap.set(item.path, item.signedUrl);
        }
      }
    }

    const fotosWithUrl = (fotos || []).map((f) => ({
      ...f,
      url: urlMap.get(f.storage_path) || null,
    }));

    const offerte = offerteRes.data
      ? {
          ...offerteRes.data,
          offerte_regels: (
            (offerteRes.data as { offerte_regels?: { sort_order: number }[] })
              .offerte_regels || []
          ).sort((a, b) => a.sort_order - b.sort_order),
        }
      : null;

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      order,
      fotos: fotosWithUrl,
      offerte,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
