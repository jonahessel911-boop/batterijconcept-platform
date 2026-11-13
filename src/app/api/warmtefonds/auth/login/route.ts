/**
 * POST /api/warmtefonds/auth/login — e-mail + wachtwoord
 * DELETE — uitloggen
 * GET — huidige sessie
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth-password";
import {
  createWarmtefondsSessionToken,
  warmtefondsSessionCookieOptions,
  clearWarmtefondsSessionCookieOptions,
  readWarmtefondsSessionCookieFromRequest,
  verifyWarmtefondsSessionToken,
} from "@/lib/warmtefonds-auth";

export const runtime = "nodejs";

/** POST — inloggen */
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  const password = String(body.password || "");
  if (!email || !password) {
    return NextResponse.json(
      { error: "E-mail en wachtwoord zijn verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    let query = await sb
      .from("warmtefonds_operators")
      .select(
        "id, naam, email, telefoon, actief, portal_token, password_hash, tarief_inc"
      )
      .ilike("email", email)
      .limit(10);

    if (
      query.error &&
      (query.error.code === "42703" ||
        query.error.message?.includes("password_hash"))
    ) {
      return NextResponse.json(
        {
          error:
            "Voer migrate-warmtefonds-operator-accounts.sql uit in Supabase (wachtwoord-kolom).",
          migration_required: true,
        },
        { status: 503 }
      );
    }
    if (query.error) throw query.error;

    const matches = (query.data || []).filter(
      (o) => o.email?.toLowerCase() === email
    );
    const op =
      matches.find((o) => o.actief !== false && o.password_hash) ||
      matches.find((o) => o.password_hash) ||
      matches[0];

    if (!op) {
      return NextResponse.json(
        { error: "Onjuiste e-mail of wachtwoord" },
        { status: 401 }
      );
    }
    if (op.actief === false) {
      return NextResponse.json(
        {
          error:
            "Dit account is inactief. Je hebt geen toegang tot het portaal.",
        },
        { status: 403 }
      );
    }
    if (!op.password_hash) {
      return NextResponse.json(
        {
          error:
            "Nog geen wachtwoord ingesteld. Vraag Batterijconcept om inloggegevens.",
        },
        { status: 401 }
      );
    }
    if (!verifyPassword(password, String(op.password_hash))) {
      return NextResponse.json(
        { error: "Onjuiste e-mail of wachtwoord" },
        { status: 401 }
      );
    }

    const portalToken = String(op.portal_token || "");
    if (!portalToken || portalToken.length < 16) {
      return NextResponse.json(
        { error: "Account incompleet — vraag om een nieuwe uitnodiging." },
        { status: 400 }
      );
    }

    const sessionToken = await createWarmtefondsSessionToken({
      operatorId: op.id,
      naam: op.naam,
      email,
      portalToken,
    });

    const res = NextResponse.json({
      ok: true,
      operator: {
        id: op.id,
        naam: op.naam,
        email: op.email,
      },
      portal_token: portalToken,
      redirect: `/warmtefonds/${portalToken}`,
    });
    res.cookies.set(warmtefondsSessionCookieOptions(sessionToken));
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Inloggen mislukt") },
      { status: 500 }
    );
  }
}

/** DELETE — uitloggen */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearWarmtefondsSessionCookieOptions());
  return res;
}

/** GET — huidige sessie */
export async function GET(req: NextRequest) {
  const raw = readWarmtefondsSessionCookieFromRequest(req);
  const session = await verifyWarmtefondsSessionToken(raw);
  if (!session) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({
    authenticated: true,
    operator: {
      id: session.operatorId,
      naam: session.naam,
      email: session.email,
    },
    portal_token: session.portalToken,
  });
}
