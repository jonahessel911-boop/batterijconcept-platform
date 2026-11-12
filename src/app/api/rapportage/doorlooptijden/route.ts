import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { buildDoorlooptijdenReport } from "@/lib/doorlooptijden";

export const runtime = "nodejs";

/** GET /api/rapportage/doorlooptijden — echte WF/materiaal/install doorlooptijden. */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const report = await buildDoorlooptijdenReport(sb);
    return NextResponse.json({ ok: true, ...report });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: errMessage(e) },
      { status: 500 }
    );
  }
}
