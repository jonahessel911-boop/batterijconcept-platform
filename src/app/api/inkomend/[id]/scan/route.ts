import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { magInkomend, normalizeRol } from "@/lib/rollen";
import {
  openaiConfigured,
  scanAndPersistInkomendeFactuur,
} from "@/lib/inkomende-factuur-ai";
import { signInkomendeFactuurBestanden } from "@/lib/inkomende-facturen";
import type {
  InkomendeFactuur,
  InkomendeFactuurBestand,
} from "@/types/database";

export const runtime = "nodejs";
export const maxDuration = 90;

type Ctx = { params: Promise<{ id: string }> };

async function requireInkomendAccess() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  if (!magInkomend(normalizeRol(session.rol))) {
    return {
      error: NextResponse.json(
        { error: "Geen toegang tot inkomende facturen" },
        { status: 403 }
      ),
    };
  }
  return { session };
}

/** POST /api/inkomend/[id]/scan — AI-scan bijlagen → vul bedragen/datum/leverancier */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const auth = await requireInkomendAccess();
  if (auth.error) return auth.error;

  if (!openaiConfigured()) {
    return NextResponse.json(
      {
        error:
          "OPENAI_API_KEY ontbreekt. Zet deze in Vercel Environment Variables en redeploy.",
      },
      { status: 503 }
    );
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "id verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { item, extract, booked } = await scanAndPersistInkomendeFactuur(
      sb,
      id
    );

    const { data: files } = await sb
      .from("inkomende_factuur_bestanden")
      .select(
        "id, inkomende_factuur_id, storage_path, bestandsnaam, mime_type, grootte_bytes, content_id, created_at"
      )
      .eq("inkomende_factuur_id", id);

    const bestanden = await signInkomendeFactuurBestanden(
      sb,
      (files || []) as InkomendeFactuurBestand[]
    );

    return NextResponse.json({
      ok: true,
      booked,
      extract,
      item: { ...(item as InkomendeFactuur), bestanden },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "AI-scan mislukt", detail: errMessage(e) },
      { status: 500 }
    );
  }
}
