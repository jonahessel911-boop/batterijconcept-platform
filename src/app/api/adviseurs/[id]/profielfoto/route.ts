import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { resolveLiveSession } from "@/lib/auth-require-admin";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import {
  clearAdviseurProfielfoto,
  publicProfielfotoUrl,
  uploadAdviseurProfielfoto,
} from "@/lib/adviseur-profielfoto";

export const runtime = "nodejs";

async function requireAdmin() {
  const jar = await cookies();
  const raw = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!raw) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  const session = await resolveLiveSession(raw);
  const sb = getSupabaseAdmin();
  const { data: adv } = await sb
    .from("adviseurs")
    .select("rol, naam, email")
    .eq("id", session.adviseurId)
    .maybeSingle();
  const email = adv?.email ?? session.email;
  const naam = adv?.naam || session.naam;
  const rol = normalizeRol(adv?.rol || session.rol);
  const mag =
    rol === "admin" ||
    isAdminEmail(email) ||
    isAdminAdviseur({ naam, email });
  if (!mag) {
    return {
      error: NextResponse.json({ error: "Alleen admin" }, { status: 403 }),
    };
  }
  return { sb, session };
}

/** POST /api/adviseurs/[id]/profielfoto — admin upload voor medewerker */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;

  try {
    const form = await req.formData();
    const file = form.get("foto");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json(
        { error: "Geen foto ontvangen" },
        { status: 400 }
      );
    }
    const result = await uploadAdviseurProfielfoto(auth.sb, id, file);
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

/** DELETE /api/adviseurs/[id]/profielfoto */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  try {
    const result = await clearAdviseurProfielfoto(auth.sb, id);
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({
      ok: true,
      profielfoto_url: null as string | null,
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

/** GET — signed/public url */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;
  try {
    const { data, error } = await auth.sb
      .from("adviseurs")
      .select("id, naam, profielfoto_path")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    return NextResponse.json({
      id: data.id,
      naam: data.naam,
      profielfoto_url: publicProfielfotoUrl(auth.sb, data.profielfoto_path),
      path: data.profielfoto_path,
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
