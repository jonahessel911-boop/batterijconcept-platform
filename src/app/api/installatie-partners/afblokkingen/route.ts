import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isPartnerVenster, type PartnerVenster } from "@/lib/partner-slots";
import {
  loadPartnerAfblokkingen,
  togglePartnerAfblokking,
} from "@/lib/partner-afblokkingen-db";

export const runtime = "nodejs";

/**
 * GET ?partner_id=&van=&tot=&teamgenoot_id=
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const van = p.get("van");
  const tot = p.get("tot");
  const one = p.get("partner_id");
  const many = p.get("partner_ids");
  const teamgenootId = p.get("teamgenoot_id")?.trim() || null;
  const ids = [
    ...(one ? [one] : []),
    ...(many
      ? many
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : []),
  ];

  if (!van || !tot) {
    return NextResponse.json(
      { error: "van en tot (yyyy-MM-dd) zijn verplicht" },
      { status: 400 }
    );
  }
  if (!ids.length) {
    return NextResponse.json(
      { error: "partner_id of partner_ids is verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const result = await loadPartnerAfblokkingen(sb, {
      partnerIds: ids,
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
        ? "Run supabase/migrate-partner-afblokkingen-teamgenoot.sql"
        : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}

/**
 * POST Body: { partner_id, dag, venster, geblokkeerd, teamgenoot_id? }
 */
export async function POST(req: NextRequest) {
  let body: {
    partner_id?: string;
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

  const { partner_id, dag, venster } = body;
  if (!partner_id || !dag || !venster) {
    return NextResponse.json(
      { error: "partner_id, dag en venster zijn verplicht" },
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

  const teamgenootId = body.teamgenoot_id?.trim() || null;

  try {
    const sb = getSupabaseAdmin();

    if (teamgenootId) {
      const { data: tg } = await sb
        .from("installatie_partner_teamgenoten")
        .select("id")
        .eq("id", teamgenootId)
        .eq("partner_id", partner_id)
        .maybeSingle();
      if (!tg) {
        return NextResponse.json(
          { error: "Teamgenoot niet gevonden" },
          { status: 400 }
        );
      }
    }

    const result = await togglePartnerAfblokking(sb, {
      partnerId: partner_id,
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
      { error: e instanceof Error ? e.message : "Fout" },
      { status: 500 }
    );
  }
}
