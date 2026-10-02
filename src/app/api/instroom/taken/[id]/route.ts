import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { SollicitatieTaakStatus } from "@/types/database";

export const runtime = "nodejs";

const SELECT =
  "*, sollicitaties(id, naam, email, telefoon, functie, status)";

const STATUSES: SollicitatieTaakStatus[] = ["todo", "doing", "done"];

/** PATCH /api/instroom/taken/[id] — status bijwerken (voltooid) */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const patch: {
      status?: SollicitatieTaakStatus;
      titel?: string;
      due_at?: string;
      notities?: string | null;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };

    if ("status" in body) {
      const status = String(body.status || "");
      if (!STATUSES.includes(status as SollicitatieTaakStatus)) {
        return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
      }
      patch.status = status as SollicitatieTaakStatus;
    }
    if (typeof body.titel === "string" && body.titel.trim()) {
      patch.titel = body.titel.trim();
    }
    if (typeof body.due_at === "string" && body.due_at.trim()) {
      const d = new Date(body.due_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: "Ongeldige deadline" }, { status: 400 });
      }
      patch.due_at = d.toISOString();
    }
    if ("notities" in body) {
      patch.notities =
        typeof body.notities === "string" ? body.notities.trim() || null : null;
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("sollicitatie_taken")
      .update(patch)
      .eq("id", id)
      .select(SELECT)
      .single();

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-sollicitatie-status-v2.sql uit in Supabase.",
          },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ taak: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}
