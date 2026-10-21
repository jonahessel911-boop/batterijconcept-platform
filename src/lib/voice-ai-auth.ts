import { cookies } from "next/headers";
import {
  COOKIE_NAME,
  verifySessionToken,
  type SessionPayload,
} from "@/lib/auth-session";
import { isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol, type GebruikerRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

/** Admin + sales manager: Voice AI tab, beluisteren, feedback. */
export function canCoachVoiceAi(
  rol: string | null | undefined,
  email?: string | null
): boolean {
  const r = normalizeRol(rol);
  return r === "admin" || r === "sales_manager" || isAdminEmail(email);
}

/** Coach-rollen (admin / sales manager) of admin-e-mail. */
export async function requireVoiceAiAccess(): Promise<
  | { ok: true; session: SessionPayload }
  | { ok: false; status: number; error: string }
> {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return { ok: false, status: 401, error: "Niet ingelogd" };
  }
  if (!canCoachVoiceAi(session.rol, session.email)) {
    return { ok: false, status: 403, error: "Geen toegang tot Voice AI" };
  }
  return { ok: true, session };
}

/**
 * Upload toestaan: coach (admin/SM) óf de adviseur van de afspraak.
 * Voor agenda → Voice AI flow zonder adviseur-tab.
 */
export async function requireVoiceUploadForAfspraak(
  afspraakId: string
): Promise<
  | { ok: true; session: SessionPayload; rol: GebruikerRol }
  | { ok: false; status: number; error: string }
> {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return { ok: false, status: 401, error: "Niet ingelogd" };
  }

  const rol = normalizeRol(session.rol);
  if (canCoachVoiceAi(rol, session.email)) {
    return { ok: true, session, rol };
  }

  if (rol !== "adviseur" || !session.adviseurId) {
    return { ok: false, status: 403, error: "Geen toegang tot voice-upload" };
  }

  const sb = getSupabaseAdmin();
  const { data: afspraak, error } = await sb
    .from("afspraken")
    .select("id, adviseur_id")
    .eq("id", afspraakId)
    .maybeSingle();

  if (error || !afspraak) {
    return { ok: false, status: 404, error: "Afspraak niet gevonden" };
  }
  if (afspraak.adviseur_id !== session.adviseurId) {
    return {
      ok: false,
      status: 403,
      error: "Alleen de adviseur van deze afspraak mag uploaden",
    };
  }

  return { ok: true, session, rol };
}
