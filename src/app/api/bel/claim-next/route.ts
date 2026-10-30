import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { claimNextBelLead, type BelBakMode } from "@/lib/bel-claim";

export const runtime = "nodejs";

/**
 * POST /api/bel/claim-next
 * Body: { exclude_lead_id?: string, provincie?: string, bak?: "normaal"|"provincie"|"annuleringen", force_new?: boolean }
 * Eerste vrije lead in bel-volgorde → soft claim voor de ingelogde beller.
 * Annuleringen-bak: alleen klant-cancels die jij had ingepland.
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
      provincie?: string | null;
      force_new?: boolean;
      bak?: BelBakMode | null;
    };
    const exclude = body.exclude_lead_id?.trim() || null;
    const provincie = body.provincie?.trim() || null;
    const forceNew = Boolean(body.force_new);
    const bakRaw = (body.bak || "").trim();
    const bak: BelBakMode =
      bakRaw === "annuleringen"
        ? "annuleringen"
        : bakRaw === "provincie" || provincie
          ? "provincie"
          : "normaal";

    const sb = getSupabaseAdmin();
    const result = await claimNextBelLead(sb, session.adviseurId, {
      excludeLeadIds: exclude ? [exclude] : [],
      provincie: bak === "provincie" ? provincie : null,
      forceNew,
      bak,
    });

    if (result.mode === "nocolumn") {
      return NextResponse.json(
        {
          error:
            "Bel-claim staat nog niet aan in de database. Voer supabase/migrate-bel-claim.sql uit in de Supabase SQL Editor (opnieuw mag).",
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
