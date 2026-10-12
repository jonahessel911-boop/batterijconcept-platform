import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  COOKIE_NAME,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol, type GebruikerRol } from "@/lib/rollen";

export type LiveSession = SessionPayload & {
  rol: GebruikerRol;
  email: string;
  naam: string;
};

/**
 * Sessierol + naam/e-mail live uit DB (zoals GET /api/auth/login).
 * Voorkomt stale JWT-rol na rolwijziging in Instellingen.
 */
export async function resolveLiveSession(
  session: SessionPayload
): Promise<LiveSession> {
  let rol = normalizeRol(session.rol);
  let naam = session.naam;
  let email = (session.email || "").trim();

  try {
    const sb = getSupabaseAdmin();
    const withRol = await sb
      .from("adviseurs")
      .select("rol, naam, email")
      .eq("id", session.adviseurId)
      .maybeSingle();

    let data: { rol?: string | null; naam?: string; email?: string | null } | null =
      null;

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

    if (data?.naam) naam = data.naam;
    if (data?.email) email = data.email.trim();

    if (data?.rol) {
      rol = normalizeRol(data.rol);
    } else if (
      isAdminEmail(email || session.email) ||
      isAdminAdviseur({ naam, email: email || session.email })
    ) {
      rol = "admin";
    }
  } catch {
    if (
      isAdminEmail(session.email) ||
      isAdminAdviseur({ naam: session.naam, email: session.email })
    ) {
      rol = "admin";
    }
  }

  return {
    ...session,
    rol,
    naam,
    email,
  };
}

/** Cookie-sessie + live admin-check. */
export async function requireAdminSession(): Promise<
  | { ok: true; session: LiveSession }
  | { ok: false; status: 401 | 403; error: string }
> {
  const jar = await cookies();
  const raw = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!raw) {
    return { ok: false, status: 401, error: "Niet ingelogd" };
  }
  const session = await resolveLiveSession(raw);
  if (session.rol !== "admin") {
    return {
      ok: false,
      status: 403,
      error: `Geen toegang (rol: ${session.rol}${session.email ? `, ${session.email}` : ""})`,
    };
  }
  return { ok: true, session };
}
