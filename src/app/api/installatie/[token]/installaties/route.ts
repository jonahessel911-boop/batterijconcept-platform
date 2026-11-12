import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requirePartnerPortal } from "@/lib/installatie-portal";

export const runtime = "nodejs";

const SELECT = `
  id, project_nummer, titel, status, schouw_at, installatie_at,
  installatie_voltooid_at, monteur, installatie_teamgenoot_id,
  schouw_notities, installatie_notities,
  monteur_beoordeling_sterren, monteur_beoordeling_notitie,
  monteur_beoordeling_op, monteur_beoordeling_door,
  klantvriendelijkheid_sterren, klantvriendelijkheid_notitie,
  klantvriendelijkheid_op, klantvriendelijkheid_door,
  leads(naam, plaats, postcode, straat, huisnummer, toevoeging),
  installatie_teamgenoot:installatie_partner_teamgenoten!installatie_teamgenoot_id(id, naam)
`;

const SELECT_FALLBACK = `
  id, project_nummer, titel, status, schouw_at, installatie_at,
  installatie_voltooid_at, monteur,
  schouw_notities, installatie_notities,
  monteur_beoordeling_sterren, monteur_beoordeling_notitie,
  monteur_beoordeling_op, monteur_beoordeling_door,
  leads(naam, plaats, postcode, straat, huisnummer, toevoeging)
`;

/**
 * GET — partner: installaties (gepland/afgerond) + beoordeling.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders zien Installaties." },
        { status: 403 }
      );
    }

    const sb = getSupabaseAdmin();
    let { data, error } = await sb
      .from("projecten")
      .select(SELECT)
      .eq("installatie_partner_id", partner.id)
      .not(
        "status",
        "in",
        "(annulering,hold_sales_actie)"
      )
      .or(
        "installatie_at.not.is.null,installatie_voltooid_at.not.is.null,status.in.(installatie_ingepland,installatie_voltooid,review_gevraagd,afgerond,service)"
      )
      .order("installatie_at", { ascending: false, nullsFirst: false });

    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("monteur_beoordeling") ||
        error.message?.includes("klantvriendelijkheid") ||
        error.message?.includes("installatie_teamgenoot") ||
        error.code === "PGRST200")
    ) {
      ({ data, error } = await sb
        .from("projecten")
        .select(SELECT_FALLBACK)
        .eq("installatie_partner_id", partner.id)
        .not("status", "in", "(annulering,hold_sales_actie)")
        .or(
          "installatie_at.not.is.null,status.in.(installatie_ingepland,installatie_voltooid,review_gevraagd,afgerond,service)"
        )
        .order("installatie_at", { ascending: false, nullsFirst: false }));
    }

    if (error) throw error;

    const rows = data || [];
    const openBeoordeling = rows.filter(
      (r) =>
        (r.installatie_voltooid_at ||
          r.status === "installatie_voltooid" ||
          r.status === "review_gevraagd" ||
          r.status === "afgerond" ||
          r.status === "service") &&
        r.monteur_beoordeling_sterren == null
    ).length;

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      installaties: rows,
      open_beoordeling: openBeoordeling,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Installaties laden mislukt") },
      { status: 500 }
    );
  }
}
