import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { claimNextBelLead } from "@/lib/bel-claim";

export const runtime = "nodejs";

/**
 * POST /api/bel/claim-next
 * Body: { exclude_lead_id?: string }
 * Eerste vrije lead in bel-volgorde → soft claim voor de ingelogde beller.
 */
export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      exclude_lead_id?: string | null;
    };
    const exclude = body.exclude_lead_id?.trim() || null;

    const sb = getSupabaseAdmin();
    const result = await claimNextBelLead(sb, session.adviseurId, {
      excludeLeadIds: exclude ? [exclude] : [],
    });

    if (result.mode === "nocolumn") {
      return NextResponse.json(
        {
          error:
            "Kolommen bel_claimed_by/at ontbreken — voer supabase/migrate-bel-claim.sql uit in Supabase",
          lead: null,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      lead: result.lead,
      mode: result.mode,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Lead claimen mislukt") },
      { status: 500 }
    );
  }
}
