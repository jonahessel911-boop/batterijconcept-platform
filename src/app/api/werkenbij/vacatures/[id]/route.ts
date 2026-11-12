import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { RecruitmentVacature } from "@/types/database";

export const runtime = "nodejs";

/** Publiek: één open vacature. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("recruitment_vacatures")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          { error: "Vacatures nog niet geconfigureerd" },
          { status: 404 }
        );
      }
      throw error;
    }
    if (!data || (data as RecruitmentVacature).status !== "open") {
      return NextResponse.json(
        { error: "Vacature niet gevonden of gesloten" },
        { status: 404 }
      );
    }
    return NextResponse.json({ vacature: data as RecruitmentVacature });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Vacature laden mislukt") },
      { status: 500 }
    );
  }
}
