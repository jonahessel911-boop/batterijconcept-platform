import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { hashPassword } from "@/lib/auth-password";
import {
  createInstallatieSessionToken,
  installatieSessionCookieOptions,
  type InstallatieAuthRol,
} from "@/lib/installatie-auth";
import {
  portalViewerPayload,
  resolveInstallatiePortal,
} from "@/lib/installatie-portal";

export const runtime = "nodejs";

/**
 * POST /api/installatie/auth/claim
 * Eerste wachtwoord zetten via oude magic-link token, daarna sessie.
 */
export async function POST(req: NextRequest) {
  let body: { token?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const token = String(body.token || "").trim();
  const password = String(body.password || "");
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Ongeldige link" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Wachtwoord minstens 8 tekens" },
      { status: 400 }
    );
  }

  try {
    const session = await resolveInstallatiePortal(token);
    if (!session) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    const password_hash = hashPassword(password);

    if (session.kind === "partner") {
      const { data: row } = await sb
        .from("installatie_partners")
        .select("id, password_hash, email")
        .eq("id", session.partner.id)
        .maybeSingle();
      if (row?.password_hash) {
        return NextResponse.json(
          {
            error:
              "Er staat al een wachtwoord. Log in via /installatie/login.",
          },
          { status: 409 }
        );
      }
      const { error } = await sb
        .from("installatie_partners")
        .update({ password_hash })
        .eq("id", session.partner.id);
      if (error) throw error;

      const sessTok = await createInstallatieSessionToken({
        kind: "partner",
        partnerId: session.partner.id,
        teamgenootId: null,
        naam: session.partner.naam,
        email: (session.partner.email || "").toLowerCase(),
        rol: "beheerder",
        portalToken: session.partner.portal_token,
      });
      const res = NextResponse.json({
        ok: true,
        ...portalViewerPayload(session),
      });
      res.cookies.set(installatieSessionCookieOptions(sessTok));
      return res;
    }

    const { data: row } = await sb
      .from("installatie_partner_teamgenoten")
      .select("id, password_hash, email, rol")
      .eq("id", session.teamgenoot.id)
      .maybeSingle();
    if (row?.password_hash) {
      return NextResponse.json(
        {
          error: "Er staat al een wachtwoord. Log in via /installatie/login.",
        },
        { status: 409 }
      );
    }
    const { error } = await sb
      .from("installatie_partner_teamgenoten")
      .update({ password_hash })
      .eq("id", session.teamgenoot.id);
    if (error) throw error;

    const authRol: InstallatieAuthRol =
      row?.rol === "beheerder" || session.authRol === "beheerder"
        ? "beheerder"
        : "monteur";

    const sessTok = await createInstallatieSessionToken({
      kind: "teamgenoot",
      partnerId: session.partner.id,
      teamgenootId: session.teamgenoot.id,
      naam: session.teamgenoot.naam,
      email: (session.teamgenoot.email || "").toLowerCase(),
      rol: authRol,
      portalToken: session.teamgenoot.portal_token,
    });
    const res = NextResponse.json({
      ok: true,
      ...portalViewerPayload({ ...session, authRol }),
    });
    res.cookies.set(installatieSessionCookieOptions(sessTok));
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Wachtwoord instellen mislukt") },
      { status: 500 }
    );
  }
}
