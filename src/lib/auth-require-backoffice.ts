import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";

export type BackofficeSession = {
  adviseurId: string;
  email: string;
  naam?: string | null;
  rol: string;
};

/**
 * Admin of backoffice — Taken-agenda / interne BO-tools.
 */
export async function requireBackofficeSession(): Promise<
  | { ok: true; session: BackofficeSession }
  | { ok: false; status: number; error: string }
> {
  const jar = await cookies();
  const raw = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!raw) {
    return { ok: false, status: 401, error: "Niet ingelogd" };
  }
  const rol = normalizeRol(raw.rol);
  if (rol !== "admin" && rol !== "backoffice") {
    return { ok: false, status: 403, error: "Geen toegang" };
  }
  return {
    ok: true,
    session: {
      adviseurId: raw.adviseurId,
      email: raw.email,
      naam: raw.naam,
      rol,
    },
  };
}
