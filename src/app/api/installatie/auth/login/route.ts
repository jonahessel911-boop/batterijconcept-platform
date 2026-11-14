import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth-password";
import {
  createInstallatieSessionToken,
  installatieSessionCookieOptions,
  clearInstallatieSessionCookieOptions,
  type InstallatieAuthRol,
} from "@/lib/installatie-auth";
import { portalViewerPayload } from "@/lib/installatie-portal";

export const runtime = "nodejs";

function normalizeRol(raw: unknown): InstallatieAuthRol {
  return raw === "beheerder" ? "beheerder" : "monteur";
}

/** POST /api/installatie/auth/login — e-mail + wachtwoord */
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

    // 1) Teamgenoot
    let tgQuery = await sb
      .from("installatie_partner_teamgenoten")
      .select(
        "id, partner_id, naam, email, telefoon, actief, portal_token, password_hash, rol"
      )
      .ilike("email", email)
      .limit(10);

    if (
      tgQuery.error &&
      (tgQuery.error.code === "42703" ||
        tgQuery.error.message?.includes("password_hash") ||
        tgQuery.error.message?.includes("rol"))
    ) {
      return NextResponse.json(
        {
          error:
            "Voer migrate-installatie-portal-auth.sql uit in Supabase (wachtwoord-kolommen).",
          migration_required: true,
        },
        { status: 503 }
      );
    }
    if (tgQuery.error) throw tgQuery.error;

    const tgMatches = (tgQuery.data || []).filter(
      (t) =>
        t.email?.toLowerCase() === email &&
        t.actief !== false &&
        t.password_hash
    );

    for (const tg of tgMatches) {
      if (!verifyPassword(password, String(tg.password_hash))) continue;

      const { data: partner, error: pErr } = await sb
        .from("installatie_partners")
        .select(
          "id, naam, email, telefoon, actief, portal_token, bedrijfsnaam, kvk_nummer, iban"
        )
        .eq("id", tg.partner_id)
        .maybeSingle();
      if (pErr || !partner || !partner.actief) continue;

      const authRol = normalizeRol(tg.rol);
      const portalToken =
        tg.portal_token || partner.portal_token || "";
      if (!portalToken || portalToken.length < 16) {
        return NextResponse.json(
          { error: "Account incompleet — vraag om een nieuwe uitnodiging." },
          { status: 400 }
        );
      }

      const token = await createInstallatieSessionToken({
        kind: "teamgenoot",
        partnerId: partner.id,
        teamgenootId: tg.id,
        naam: tg.naam,
        email,
        rol: authRol,
        portalToken,
      });

      const session = {
        kind: "teamgenoot" as const,
        partner,
        teamgenoot: {
          id: tg.id,
          partner_id: tg.partner_id,
          naam: tg.naam,
          email: tg.email,
          telefoon: tg.telefoon,
          actief: tg.actief !== false,
          portal_token: portalToken,
          rol: authRol,
        },
        authRol,
      };

      const res = NextResponse.json({
        ok: true,
        ...portalViewerPayload(session),
      });
      res.cookies.set(installatieSessionCookieOptions(token));
      return res;
    }

    // 2) Partner (beheerder)
    const partnerQuery = await sb
      .from("installatie_partners")
      .select(
        "id, naam, email, telefoon, actief, portal_token, bedrijfsnaam, kvk_nummer, iban, password_hash"
      )
      .ilike("email", email)
      .limit(10);

    if (
      partnerQuery.error &&
      (partnerQuery.error.code === "42703" ||
        partnerQuery.error.message?.includes("password_hash"))
    ) {
      return NextResponse.json(
        {
          error:
            "Voer migrate-installatie-portal-auth.sql uit in Supabase (wachtwoord-kolommen).",
          migration_required: true,
        },
        { status: 503 }
      );
    }
    if (partnerQuery.error) throw partnerQuery.error;

    const partners = (partnerQuery.data || []).filter(
      (p) =>
        p.email?.toLowerCase() === email &&
        p.actief !== false &&
        p.password_hash
    );

    for (const partner of partners) {
      if (!verifyPassword(password, String(partner.password_hash))) continue;
      if (!partner.portal_token || partner.portal_token.length < 16) {
        return NextResponse.json(
          { error: "Partnerportaal heeft geen geldige token." },
          { status: 400 }
        );
      }

      const token = await createInstallatieSessionToken({
        kind: "partner",
        partnerId: partner.id,
        teamgenootId: null,
        naam: partner.naam,
        email,
        rol: "beheerder",
        portalToken: partner.portal_token,
      });

      const session = {
        kind: "partner" as const,
        partner,
        teamgenoot: null,
        authRol: "beheerder" as const,
      };

      const res = NextResponse.json({
        ok: true,
        ...portalViewerPayload(session),
      });
      res.cookies.set(installatieSessionCookieOptions(token));
      return res;
    }

    return NextResponse.json(
      { error: "Onjuiste e-mail of wachtwoord" },
      { status: 401 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Inloggen mislukt") },
      { status: 500 }
    );
  }
}

/** DELETE /api/installatie/auth/login — uitloggen */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearInstallatieSessionCookieOptions());
  return res;
}

/** GET /api/installatie/auth/login — huidige sessie */
export async function GET(req: NextRequest) {
  try {
    const {
      resolveInstallatiePortal,
      portalViewerPayload: payload,
    } = await import("@/lib/installatie-portal");
    const session = await resolveInstallatiePortal("session", req);
    if (!session) {
      return NextResponse.json({ authenticated: false }, { status: 401 });
    }
    return NextResponse.json({
      authenticated: true,
      ...payload(session),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Sessie laden mislukt") },
      { status: 500 }
    );
  }
}
