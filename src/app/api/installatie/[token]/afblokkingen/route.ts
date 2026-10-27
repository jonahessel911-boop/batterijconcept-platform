import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { isPartnerVenster, type PartnerVenster } from "@/lib/partner-slots";

export const runtime = "nodejs";

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("partner_afblokkingen") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

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
 * GET /api/installatie/[token]/afblokkingen?van=yyyy-MM-dd&tot=yyyy-MM-dd
 * Partner mag alleen eigen afblokkingen zien.
 */
export async function GET(
  req: NextRequest,
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

    const p = req.nextUrl.searchParams;
    const van = p.get("van");
    const tot = p.get("tot");
    if (!van || !tot) {
      return NextResponse.json(
        { error: "van en tot (yyyy-MM-dd) zijn verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("partner_afblokkingen")
      .select("id, partner_id, dag, venster")
      .eq("partner_id", partner.id)
      .gte("dag", van)
      .lte("dag", tot)
      .order("dag")
      .order("venster");

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json({
          items: [],
          hint: "Run supabase/migrate-partner-agenda.sql",
          migration_required: true,
        });
      }
      throw error;
    }

    return NextResponse.json({ items: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Afblokkingen laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/installatie/[token]/afblokkingen
 * Body: { dag, venster: "ochtend"|"middag", geblokkeerd: boolean }
 * partner_id komt altijd uit het token (geen client-override).
 */
export async function POST(
  req: NextRequest,
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

    let body: {
      dag?: string;
      venster?: string;
      geblokkeerd?: boolean;
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

    const geblokkeerd = body.geblokkeerd !== false;
    const v = venster as PartnerVenster;
    const sb = getSupabaseAdmin();

    if (!geblokkeerd) {
      const { error } = await sb
        .from("partner_afblokkingen")
        .delete()
        .eq("partner_id", partner.id)
        .eq("dag", dag)
        .eq("venster", v);

      if (error) {
        if (isMissingTable(error)) {
          return NextResponse.json(
            {
              error:
                "Database-migratie ontbreekt. Run supabase/migrate-partner-agenda.sql in Supabase.",
              migration_required: true,
            },
            { status: 503 }
          );
        }
        throw error;
      }
      return NextResponse.json({
        geblokkeerd: false,
        message: `${dag} ${v} weer open`,
      });
    }

    const { data, error } = await sb
      .from("partner_afblokkingen")
      .upsert(
        { partner_id: partner.id, dag, venster: v },
        { onConflict: "partner_id,dag,venster" }
      )
      .select("id, partner_id, dag, venster")
      .single();

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Database-migratie ontbreekt. Run supabase/migrate-partner-agenda.sql in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      item: data,
      geblokkeerd: true,
      message: `${dag} ${v} geblokkeerd`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Afblokken mislukt") },
      { status: 500 }
    );
  }
}
