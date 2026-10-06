import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  COOKIE_NAME,
  createSessionToken,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/auth-session";
import { isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";

function isAdminSession(session: {
  rol: string;
  email: string;
  impersonatorId?: string;
}): boolean {
  if (session.impersonatorId) return false;
  return (
    normalizeRol(session.rol) === "admin" || isAdminEmail(session.email)
  );
}

/**
 * POST /api/auth/impersonate { adviseur_id }
 * Admin → sessie als die verkoper/medewerker (“Login als”).
 */
export async function POST(req: NextRequest) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  if (!isAdminSession(session)) {
    return NextResponse.json(
      { error: "Alleen admin mag inloggen als iemand anders." },
      { status: 403 }
    );
  }

  let body: { adviseur_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }
  if (!body.adviseur_id) {
    return NextResponse.json(
      { error: "adviseur_id is verplicht" },
      { status: 400 }
    );
  }
  if (body.adviseur_id === session.adviseurId) {
    return NextResponse.json(
      { error: "Je bent al als deze gebruiker ingelogd." },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: target, error } = await sb
      .from("adviseurs")
      .select("id, naam, email, rol, actief")
      .eq("id", body.adviseur_id)
      .maybeSingle();

    if (error || !target) {
      return NextResponse.json(
        { error: "Gebruiker niet gevonden" },
        { status: 404 }
      );
    }
    if (!target.actief) {
      return NextResponse.json(
        { error: "Deze gebruiker is niet actief." },
        { status: 400 }
      );
    }
    if (!target.email?.trim()) {
      return NextResponse.json(
        { error: "Gebruiker heeft geen e-mailadres." },
        { status: 400 }
      );
    }

    let rol = normalizeRol(target.rol || "adviseur");
    if (isAdminEmail(target.email)) rol = "admin";

    const token = await createSessionToken({
      adviseurId: target.id,
      naam: target.naam,
      email: target.email.trim(),
      rol,
      impersonatorId: session.adviseurId,
      impersonatorNaam: session.naam,
      impersonatorEmail: session.email,
      impersonatorRol: session.rol,
    });

    const res = NextResponse.json({
      ok: true,
      adviseur: {
        id: target.id,
        naam: target.naam,
        email: target.email.trim(),
        rol,
      },
      impersonating: {
        id: session.adviseurId,
        naam: session.naam,
      },
    });
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Inloggen als mislukt") },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/auth/impersonate — terug naar admin-sessie.
 */
export async function DELETE() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  if (!session.impersonatorId) {
    return NextResponse.json(
      { error: "Je bent niet ingelogd als iemand anders." },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: admin, error } = await sb
      .from("adviseurs")
      .select("id, naam, email, rol, actief")
      .eq("id", session.impersonatorId)
      .maybeSingle();

    const naam =
      admin?.naam || session.impersonatorNaam || "Admin";
    const email =
      (admin?.email || session.impersonatorEmail || "").trim();
    let rol = normalizeRol(
      admin?.rol || session.impersonatorRol || "admin"
    );
    if (isAdminEmail(email)) rol = "admin";

    if (error && !session.impersonatorEmail) {
      return NextResponse.json(
        { error: "Admin-sessie herstellen mislukt" },
        { status: 500 }
      );
    }

    const token = await createSessionToken({
      adviseurId: session.impersonatorId,
      naam,
      email: email || session.impersonatorEmail || "",
      rol,
    });

    const res = NextResponse.json({
      ok: true,
      adviseur: {
        id: session.impersonatorId,
        naam,
        email,
        rol,
      },
    });
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Terugkeren mislukt") },
      { status: 500 }
    );
  }
}
