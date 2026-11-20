import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  applyOwnJobsFilter,
  portalViewerPayload,
  resolveInstallatiePortal,
  resolveOwnJobsScope,
  scopesToOwnJobsOnly,
} from "@/lib/installatie-portal";

export const runtime = "nodejs";

/** GET /api/installatie/[token] — partner/beheerder of monteur + orderslijst */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const session = await resolveInstallatiePortal(token, req);
    if (!session) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    const scope = await resolveOwnJobsScope(session);
    const SELECT_FULL =
      "id, project_nummer, titel, status, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities, notities, monteur, installatie_partner_id, installatie_teamgenoot_id, installatie_koppel_id, offerte_id, materiaal_checks, startdatum, opleverdatum, created_at, leads(naam, telefoon, email, postcode, huisnummer, toevoeging, straat, plaats, lead_number), offertes(offerte_regels(omschrijving, aantal))";
    const SELECT_NO_KOPPEL =
      "id, project_nummer, titel, status, schouw_at, schouw_jaar, schouw_week, schouw_notities, installatie_at, installatie_notities, notities, monteur, installatie_partner_id, installatie_teamgenoot_id, offerte_id, materiaal_checks, startdatum, opleverdatum, created_at, leads(naam, telefoon, email, postcode, huisnummer, toevoeging, straat, plaats, lead_number), offertes(offerte_regels(omschrijving, aantal))";
    let q = sb
      .from("projecten")
      .select(SELECT_FULL)
      .eq("installatie_partner_id", session.partner.id)
      .order("schouw_at", { ascending: true, nullsFirst: false }) as unknown as {
        eq: (col: string, val: string) => typeof q;
        or: (filter: string) => typeof q;
      };
    q = applyOwnJobsFilter(q, scope);

    const first = await (q as unknown as Promise<{
      data: unknown[] | null;
      error: { message?: string; code?: string } | null;
    }>);
    let orders = first.data;
    let error = first.error;

    if (
      error &&
      (error.message?.includes("installatie_koppel_id") ||
        (error.code === "42703" &&
          error.message?.includes("installatie_koppel_id")))
    ) {
      let retry = sb
        .from("projecten")
        .select(SELECT_NO_KOPPEL)
        .eq("installatie_partner_id", session.partner.id)
        .order("schouw_at", { ascending: true, nullsFirst: false });
      if (scopesToOwnJobsOnly(session)) {
        retry = retry.eq("installatie_teamgenoot_id", session.teamgenoot.id);
      }
      const second = await retry;
      orders = second.data as unknown[] | null;
      error = second.error;
    }

    if (error) {
      if (
        scopesToOwnJobsOnly(session) &&
        (error.message?.includes("installatie_teamgenoot_id") ||
          error.code === "42703")
      ) {
        return NextResponse.json({
          ...portalViewerPayload(session),
          partner: {
            id: session.partner.id,
            naam: session.partner.naam,
            email: session.partner.email,
          },
          orders: [],
          hint: "Voer migrate-project-installatie-teamgenoot.sql uit.",
        });
      }
      throw error;
    }

    return NextResponse.json({
      ...portalViewerPayload(session),
      partner: {
        id: session.partner.id,
        naam: session.partner.naam,
        email: session.partner.email,
      },
      orders: orders || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
