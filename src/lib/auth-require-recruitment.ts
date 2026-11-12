import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import {
  resolveLiveSession,
  type LiveSession,
} from "@/lib/auth-require-admin";
import { magRecruitment } from "@/lib/rollen";

/**
 * Admin of recruiter — Recruitment / instroom-API's.
 * Live DB-rol (niet alleen JWT) zodat rolwijziging meteen geldt.
 */
export async function requireRecruitmentSession(): Promise<
  | { ok: true; session: LiveSession }
  | { ok: false; status: 401 | 403; error: string }
> {
  const jar = await cookies();
  const raw = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!raw) {
    return { ok: false, status: 401, error: "Niet ingelogd" };
  }
  const session = await resolveLiveSession(raw);
  if (!magRecruitment(session.rol)) {
    return {
      ok: false,
      status: 403,
      error: `Geen toegang tot recruitment (rol: ${session.rol}${session.email ? `, ${session.email}` : ""})`,
    };
  }
  return { ok: true, session };
}
