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
    let { data: order, error } = await sb
      .from("projecten")
      .select(
        `id, project_nummer, titel, status, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities,
         installateur_notitie, installateur_notitie_door,
         monteur, startdatum, opleverdatum, created_at,
         leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats)`
      )
      .eq("id", projectId)
      .eq("installatie_partner_id", partner.id)
      .single();

    if (
      error &&
      (error.message?.includes("installateur_notitie") ||
        error.code === "42703")
    ) {
      ({ data: order, error } = await sb
        .from("projecten")
        .select(
          `id, project_nummer, titel, status, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities,
           monteur, startdatum, opleverdatum, created_at,
           leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats)`
        )
        .eq("id", projectId)
        .eq("installatie_partner_id", partner.id)
        .single());
    }

    if (error || !order) {
      return NextResponse.json(
        { error: "Order niet gevonden" },
        { status: 404 }
      );
    }

    const { data: fotos } = await sb
      .from("project_fotos")
      .select(
        "id, project_id, storage_path, bestandsnaam, omschrijving, created_at"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

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

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      order,
      fotos: fotosWithUrl,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
