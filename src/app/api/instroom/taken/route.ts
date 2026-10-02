import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

const SELECT =
  "*, sollicitaties(id, naam, email, telefoon, functie, status)";

/** GET /api/instroom/taken — open acties (optioneel ?sollicitatie_id=&open=0) */
export async function GET(req: NextRequest) {
  const sollicitatieId = req.nextUrl.searchParams.get("sollicitatie_id");
  const openOnly = req.nextUrl.searchParams.get("open") !== "0";

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("sollicitatie_taken")
      .select(SELECT)
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);

    if (sollicitatieId) q = q.eq("sollicitatie_id", sollicitatieId);
    if (openOnly) q = q.neq("status", "done");

    const { data, error } = await q;
    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("sollicitatie_taken")
      ) {
        return NextResponse.json({
          taken: [],
          error:
            "Voer supabase/migrate-sollicitatie-status-v2.sql uit in Supabase.",
        });
      }
      return NextResponse.json(
        { error: "Laden mislukt", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ taken: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
