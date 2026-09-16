import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken, type SessionPayload } from "@/lib/auth-session";
import { isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";

export async function requireAiAdmin(): Promise<
  | { ok: true; session: SessionPayload }
  | { ok: false; status: number; error: string }
> {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return { ok: false, status: 401, error: "Niet ingelogd" };
  }
  const rol = normalizeRol(session.rol);
  if (rol !== "admin" && !isAdminEmail(session.email)) {
    return { ok: false, status: 403, error: "Alleen admin mag de AI interface gebruiken" };
  }
  return { ok: true, session };
}
