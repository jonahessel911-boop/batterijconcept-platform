import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  createSessionToken,
  sessionCookieOptions,
  clearSessionCookieOptions,
  COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth-session";
import { hashPassword, verifyPassword } from "@/lib/auth-password";
import { errMessage } from "@/lib/errors";
import { normalizeRol } from "@/lib/rollen";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";

export const runtime = "nodejs";

const BOOTSTRAP_EMAIL = (
  process.env.ADMIN_EMAIL || "admin@batterijconcept.nl"
).toLowerCase();
const BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD || "Admin@1";

async function findAdviseur(email: string) {
  const sb = getSupabaseAdmin();

  type Row = {
    id: string;
    naam: string;
    email: string | null;
    actief: boolean;
    password_hash?: string | null;
    rol?: string | null;
  };

  let rows: Row[] | null = null;

  const withHash = await sb
    .from("adviseurs")
    .select("id, naam, email, password_hash, actief, rol")
    .ilike("email", email)
    .limit(5);

  if (
    withHash.error &&
    (withHash.error.message?.includes("password_hash") ||
      withHash.error.message?.includes("rol") ||
      withHash.error.code === "42703")
  ) {
    const plain = await sb
      .from("adviseurs")
      .select("id, naam, email, actief, password_hash")
      .ilike("email", email)
      .limit(5);
    if (
      plain.error &&
      (plain.error.message?.includes("password_hash") ||
        plain.error.code === "42703")
    ) {
      const bare = await sb
        .from("adviseurs")
        .select("id, naam, email, actief")
        .ilike("email", email)
        .limit(5);
      if (bare.error) throw bare.error;
      rows = bare.data as Row[];
    } else if (plain.error) {
      throw plain.error;
    } else {
      rows = plain.data as Row[];
    }
  } else if (withHash.error) {
    throw withHash.error;
  } else {
    rows = withHash.data as Row[];
  }

  return (rows || []).find(
    (a) => a.email?.toLowerCase() === email && a.actief
  );
}

async function ensureAdminPersisted(adviseurId: string, password: string) {
  try {
    const sb = getSupabaseAdmin();
    await sb
      .from("adviseurs")
      .update({ password_hash: hashPassword(password), actief: true })
      .eq("id", adviseurId);
  } catch {
    /* kolom ontbreekt nog — bootstrap login blijft werken */
  }
}

/** POST /api/auth/login */
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) {
    return NextResponse.json(
      { error: "E-mail en wachtwoord zijn verplicht" },
      { status: 400 }
    );
  }

  try {
    const adviseur = await findAdviseur(email);

    const isBootstrap =
      email === BOOTSTRAP_EMAIL && password === BOOTSTRAP_PASSWORD;

    let ok = false;
    if (adviseur?.password_hash) {
      ok = verifyPassword(password, adviseur.password_hash);
    }
    if (!ok && isBootstrap) {
      ok = true;
    }

    if (!ok || !adviseur) {
      // Bootstrap: adviseur-rij ontbreekt nog → aanmaken
      if (isBootstrap) {
        const sb = getSupabaseAdmin();
        const insertPayload: Record<string, unknown> = {
          naam: "Admin",
          email: BOOTSTRAP_EMAIL,
          telefoon: "085 800 1645",
          actief: true,
          password_hash: hashPassword(password),
          rol: "admin",
        };
        let created = await sb
          .from("adviseurs")
          .insert(insertPayload)
          .select("id, naam, email, rol")
          .single();
        if (
          created.error &&
          (created.error.message?.includes("password_hash") ||
            created.error.message?.includes("rol") ||
            created.error.code === "42703")
        ) {
          delete insertPayload.password_hash;
          delete insertPayload.rol;
          created = await sb
            .from("adviseurs")
            .insert(insertPayload)
            .select("id, naam, email")
            .single();
        }
        if (created.error || !created.data) {
          return NextResponse.json(
            { error: created.error?.message || "Admin aanmaken mislukt" },
            { status: 500 }
          );
        }
        const token = await createSessionToken({
          adviseurId: created.data.id,
          naam: created.data.naam,
          email: created.data.email || BOOTSTRAP_EMAIL,
          rol: "admin",
        });
        const res = NextResponse.json({
          ok: true,
          adviseur: {
            id: created.data.id,
            naam: created.data.naam,
            email: created.data.email,
            rol: "admin",
          },
        });
        res.cookies.set(sessionCookieOptions(token));
        return res;
      }

      return NextResponse.json(
        { error: "Onjuiste e-mail of wachtwoord" },
        { status: 401 }
      );
    }

    if (isBootstrap) {
      void ensureAdminPersisted(adviseur.id, password);
    }

    const rol = normalizeRol(
      adviseur.rol ||
        (isAdminEmail(adviseur.email) ||
        isAdminAdviseur(adviseur) ||
        isBootstrap
          ? "admin"
          : "adviseur")
    );

    // Zorg dat bekende admins (o.a. jona@) ook in DB admin blijven
    if (rol === "admin" && adviseur.rol !== "admin") {
      void (async () => {
        try {
          const sb = getSupabaseAdmin();
          await sb
            .from("adviseurs")
            .update({ rol: "admin", actief: true })
            .eq("id", adviseur.id);
        } catch {
          /* kolom ontbreekt nog */
        }
      })();
    }

    const token = await createSessionToken({
      adviseurId: adviseur.id,
      naam: adviseur.naam,
      email: adviseur.email || email,
      rol,
    });

    const res = NextResponse.json({
      ok: true,
      adviseur: {
        id: adviseur.id,
        naam: adviseur.naam,
        email: adviseur.email,
        rol,
      },
    });
    res.cookies.set(sessionCookieOptions(token));
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Inloggen mislukt") },
      { status: 500 }
    );
  }
}

/** GET /api/auth/login — wie is ingelogd */
export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  // Rol live uit DB (wijzigingen in Instellingen meteen actief)
  let rol = normalizeRol(session.rol);
  try {
    const sb = getSupabaseAdmin();
    let data: { rol?: string | null; naam?: string; email?: string | null } | null =
      null;
    const withRol = await sb
      .from("adviseurs")
      .select("rol, naam, email")
      .eq("id", session.adviseurId)
      .maybeSingle();
    if (
      withRol.error &&
      (withRol.error.message?.includes("rol") || withRol.error.code === "42703")
    ) {
      const bare = await sb
        .from("adviseurs")
        .select("naam, email")
        .eq("id", session.adviseurId)
        .maybeSingle();
      data = bare.data;
    } else if (!withRol.error) {
      data = withRol.data;
    }
    if (
      data &&
      (isAdminEmail(data.email) ||
        isAdminAdviseur({
          naam: data.naam || session.naam,
          email: data.email ?? session.email,
        }))
    ) {
      rol = "admin";
    } else if (data?.rol) {
      rol = normalizeRol(data.rol);
    } else if (
      isAdminEmail(session.email) ||
      isAdminAdviseur({
        naam: session.naam,
        email: session.email,
      })
    ) {
      rol = "admin";
    }
  } catch {
    if (
      isAdminEmail(session.email) ||
      isAdminAdviseur({
        naam: session.naam,
        email: session.email,
      })
    ) {
      rol = "admin";
    }
  }

  return NextResponse.json({
    authenticated: true,
    adviseur: {
      id: session.adviseurId,
      naam: session.naam,
      email: session.email,
      rol,
    },
  });
}

/** DELETE /api/auth/login — uitloggen */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(clearSessionCookieOptions());
  return res;
}
