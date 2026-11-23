import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { isRikNaam } from "@/lib/ops-namen";
import { normalizeRol } from "@/lib/rollen";
import type { SupabaseClient } from "@supabase/supabase-js";

const SALES_COCKPIT_EXTRA_EMAILS = new Set([
  "tarik@batterijconcept.nl",
]);

function magSalesCockpitAccess(opts: {
  rol: string;
  email?: string | null;
  naam?: string | null;
}): boolean {
  if (opts.rol === "admin") return true;
  if (isAdminEmail(opts.email)) return true;
  if (isAdminAdviseur({ naam: opts.naam || "", email: opts.email })) return true;
  if (isRikNaam(opts.naam)) return true;
  const email = opts.email?.trim().toLowerCase();
  return Boolean(email && SALES_COCKPIT_EXTRA_EMAILS.has(email));
}

export async function requireSalesCockpitAdmin(): Promise<
  | { sb: SupabaseClient; actorId: string; naam: string }
  | { error: string; status: 401 | 403 }
> {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session?.adviseurId) return { error: "Niet ingelogd", status: 401 };
  const sb = getSupabaseAdmin();
  const { data: adv } = await sb
    .from("adviseurs")
    .select("id, rol, naam, email")
    .eq("id", session.adviseurId)
    .maybeSingle();
  const email = adv?.email ?? session.email;
  const naam = adv?.naam || session.naam;
  const rol = normalizeRol(adv?.rol || session.rol);
  const mag = magSalesCockpitAccess({ rol, email, naam });
  if (!mag) return { error: "Geen toegang tot salescockpit", status: 403 };
  return { sb, actorId: session.adviseurId, naam };
}

/** Bestaande cockpitroutes verwachten deze vorm. Zelfde admincontrole. */
export async function requireCockpitAdmin() {
  const result = await requireSalesCockpitAdmin();
  if ("error" in result) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: result.error }, { status: result.status }),
    };
  }
  return {
    ok: true as const,
    response: null,
    session: { adviseurId: result.actorId, naam: result.naam },
    sb: result.sb,
  };
}
