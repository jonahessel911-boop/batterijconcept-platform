import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/taken/clear
 * Wist alle project_taken. Stuurt GEEN e-mails.
 * Body: { clear_all: true }
 */
export async function POST(req: NextRequest) {
  let body: { clear_all?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty */
  }
  if (!body.clear_all) {
    return NextResponse.json(
      { error: "Bevestig met { clear_all: true }" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("project_taken")
      .delete()
      .not("id", "is", null)
      .select("id");

    if (error) {
      return NextResponse.json(
        { error: "Wissen mislukt", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      deleted: data?.length ?? 0,
      mails_sent: false,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
