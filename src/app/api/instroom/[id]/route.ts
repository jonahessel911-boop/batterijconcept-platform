import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  parseSollicitatieStatus,
  SOLLICITATIE_STATUSES,
} from "@/lib/sollicitatie";
import type { SollicitatieStatus } from "@/types/database";

export const runtime = "nodejs";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const patch: {
      naam?: string | null;
      email?: string | null;
      telefoon?: string | null;
      functie?: string | null;
      status?: SollicitatieStatus;
      notitie?: string | null;
    } = {};

    if ("naam" in body) patch.naam = pickStr(body.naam);
    if ("email" in body) patch.email = pickStr(body.email);
    if ("telefoon" in body) patch.telefoon = pickStr(body.telefoon);
    if ("functie" in body) patch.functie = pickStr(body.functie);
    if ("notitie" in body) patch.notitie = pickStr(body.notitie);
    if ("status" in body) {
      const status = parseSollicitatieStatus(body.status);
      if (!SOLLICITATIE_STATUSES.includes(status)) {
        return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
      }
      patch.status = status;
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("sollicitaties")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ sollicitatie: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}
