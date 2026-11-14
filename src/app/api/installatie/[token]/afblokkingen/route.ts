import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { isPartnerVenster, type PartnerVenster } from "@/lib/partner-slots";
import {
  loadPartnerAfblokkingen,
  togglePartnerAfblokking,
} from "@/lib/partner-afblokkingen-db";
import { resolveInstallatiePortal } from "@/lib/installatie-portal";

export const runtime = "nodejs";

/**
 * GET /api/installatie/[token]/afblokkingen?van=&tot=&teamgenoot_id=
 */
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
    const partner = session.partner;

    const p = req.nextUrl.searchParams;
    const van = p.get("van");
    const tot = p.get("tot");
    let teamgenootId = p.get("teamgenoot_id")?.trim() || null;
    if (session.kind === "teamgenoot") {
      teamgenootId = session.teamgenoot.id;
    }
    if (!van || !tot) {
      return NextResponse.json(
        { error: "van en tot (yyyy-MM-dd) zijn verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const result = await loadPartnerAfblokkingen(sb, {
      partnerIds: [partner.id],
      van,
      tot,
      teamgenootId,
    });

    if (result.error && result.items.length === 0 && !result.migrationRequired) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    return NextResponse.json({
      items: result.items,
      per_monteur: result.perMonteur,
      migration_required: result.migrationRequired || false,
      hint: result.migrationRequired
        ? "Run supabase/migrate-partner-afblokkingen-teamgenoot.sql voor afblokken per monteur"
        : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Afblokkingen laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST Body: { dag, venster, geblokkeerd, teamgenoot_id? }
 */
export async function POST(
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
    const partner = session.partner;

    let body: {
      dag?: string;
      venster?: string;
      geblokkeerd?: boolean;
      teamgenoot_id?: string | null;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    const { dag, venster } = body;
    if (!dag || !venster) {
      return NextResponse.json(
        { error: "dag en venster zijn verplicht" },
        { status: 400 }
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) {
      return NextResponse.json(
        { error: "dag moet yyyy-MM-dd zijn" },
        { status: 400 }
      );
    }
    if (!isPartnerVenster(venster)) {
      return NextResponse.json(
        { error: "venster moet ochtend of middag zijn" },
        { status: 400 }
      );
    }

    let teamgenootId = body.teamgenoot_id?.trim() || null;
    if (session.kind === "teamgenoot") {
      teamgenootId = session.teamgenoot.id;
    }

    const sb = getSupabaseAdmin();

    if (teamgenootId) {
      const { data: tg } = await sb
        .from("installatie_partner_teamgenoten")
        .select("id")
        .eq("id", teamgenootId)
        .eq("partner_id", partner.id)
        .maybeSingle();
      if (!tg) {
        return NextResponse.json(
          { error: "Teamgenoot niet gevonden" },
          { status: 400 }
        );
      }
    }

    const result = await togglePartnerAfblokking(sb, {
      partnerId: partner.id,
      dag,
      venster: venster as PartnerVenster,
      geblokkeerd: body.geblokkeerd !== false,
      teamgenootId,
    });

    if (result.error) {
      return NextResponse.json(
        {
          error: result.error,
          migration_required: result.migrationRequired,
          per_monteur: result.perMonteur,
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      item: result.item || null,
      geblokkeerd: result.geblokkeerd,
      message: result.message,
      per_monteur: result.perMonteur,
      migration_required: result.migrationRequired || false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Afblokken mislukt") },
      { status: 500 }
    );
  }
}
