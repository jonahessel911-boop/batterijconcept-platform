import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { ensureStandardVacatures } from "@/lib/ensure-standard-vacatures";
import type { RecruitmentVacature } from "@/types/database";

export const runtime = "nodejs";

/** Publiek: alleen open vacatures. */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    let vacatures: RecruitmentVacature[] = [];
    try {
      vacatures = await ensureStandardVacatures(sb);
    } catch (error) {
      const err = error as { code?: string };
      if (err.code === "42P01") {
        return NextResponse.json({ vacatures: [] });
      }
      throw error;
    }
    return NextResponse.json({
      vacatures: vacatures.filter((v) => v.status === "open"),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Vacatures laden mislukt"), vacatures: [] },
      { status: 500 }
    );
  }
}
