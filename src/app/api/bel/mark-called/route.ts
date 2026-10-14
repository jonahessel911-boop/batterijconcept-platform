import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";

export const runtime = "nodejs";

/**
 * POST /api/bel/mark-called
 * Body: { lead_id, status?, eerste_gebeld?: boolean }
 * Zet laatst_gebeld_at + laatst_gebeld_door = ingelogde medewerker.
 */
export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      lead_id?: string;
      status?: string | null;
      eerste_gebeld?: boolean;
    };
    const leadId = body.lead_id?.trim();
    if (!leadId) {
      return NextResponse.json({ error: "lead_id is verplicht" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const door = session.adviseurId.trim();

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      laatst_gebeld_at: now,
      laatst_gebeld_door: door,
    };
    if (body.status?.trim()) {
      patch.status = body.status.trim();
    }
    if (body.eerste_gebeld) {
      patch.eerste_gebeld_at = now;
    }

    let { error } = await sb.from("leads").update(patch).eq("id", leadId);
    if (
      error &&
      (error.message?.includes("laatst_gebeld_door") || error.code === "42703")
    ) {
      const { laatst_gebeld_door: _, ...slim } = patch;
      const retry = await sb.from("leads").update(slim).eq("id", leadId);
      error = retry.error;
      if (!error) {
        return NextResponse.json({
          ok: true,
          patch: slim,
          hint: "Voer supabase/migrate-laatst-gebeld-door.sql uit voor beller-toewijzing.",
        });
      }
    }
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      patch: {
        laatst_gebeld_at: now,
        ...(door ? { laatst_gebeld_door: door } : {}),
        ...(body.status?.trim() ? { status: body.status.trim() } : {}),
        ...(body.eerste_gebeld ? { eerste_gebeld_at: now } : {}),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Bel-markering mislukt") },
      { status: 500 }
    );
  }
}
