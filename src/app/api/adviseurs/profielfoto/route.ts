import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { resolveLiveSession } from "@/lib/auth-require-admin";
import {
  clearAdviseurProfielfoto,
  publicProfielfotoUrl,
  uploadAdviseurProfielfoto,
} from "@/lib/adviseur-profielfoto";

export const runtime = "nodejs";

async function requireSession() {
  const jar = await cookies();
  const raw = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!raw) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  const session = await resolveLiveSession(raw);
  return { session };
}

/**
 * GET /api/adviseurs/profielfoto — eigen profiel + foto-url
 */
export async function GET() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("adviseurs")
      .select("id, naam, email, profielfoto_path, commissie_pct")
      .eq("id", auth.session.adviseurId)
      .maybeSingle();

    if (error) {
      if (
        error.message?.includes("profielfoto_path") ||
        error.message?.includes("commissie_pct") ||
        error.code === "42703"
      ) {
        const bare = await sb
          .from("adviseurs")
          .select("id, naam, email, commissie_pct")
          .eq("id", auth.session.adviseurId)
          .maybeSingle();
        const barePct = (bare.data as { commissie_pct?: number | null } | null)
          ?.commissie_pct;
        return NextResponse.json({
          id: bare.data?.id || auth.session.adviseurId,
          naam: bare.data?.naam || auth.session.naam,
          email: bare.data?.email || auth.session.email,
          profielfoto_url: null,
          commissie_pct:
            barePct != null && Number.isFinite(Number(barePct))
              ? Number(barePct)
              : null,
          migration_needed: Boolean(
            error.message?.includes("profielfoto_path")
          ),
        });
      }
      throw error;
    }

    const pct = (data as { commissie_pct?: number | null } | null)
      ?.commissie_pct;
    return NextResponse.json({
      id: data?.id || auth.session.adviseurId,
      naam: data?.naam || auth.session.naam,
      email: data?.email || auth.session.email,
      profielfoto_url: publicProfielfotoUrl(sb, data?.profielfoto_path),
      commissie_pct:
        pct != null && Number.isFinite(Number(pct)) ? Number(pct) : null,
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

/**
 * POST /api/adviseurs/profielfoto — multipart field "foto"
 */
export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  try {
    const form = await req.formData();
    const file = form.get("foto");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Geen foto ontvangen" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const result = await uploadAdviseurProfielfoto(
      sb,
      auth.session.adviseurId,
      file
    );
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }

    return NextResponse.json({
      ok: true,
      profielfoto_url: result.url,
      path: result.path,
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

/**
 * DELETE /api/adviseurs/profielfoto — foto verwijderen
 */
export async function DELETE() {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  try {
    const sb = getSupabaseAdmin();
    const result = await clearAdviseurProfielfoto(sb, auth.session.adviseurId);
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true, profielfoto_url: null });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
