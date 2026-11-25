import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  readWarmtefondsSessionCookieFromRequest,
  verifyWarmtefondsSessionToken,
} from "@/lib/warmtefonds-auth";
import {
  resolveWarmtefondsOperator,
  type WarmtefondsOperator,
} from "@/lib/warmtefonds-portal";

/**
 * Portaal-API: e-mail/wachtwoord-sessie verplicht.
 * CRM-medewerkers (bc_session) mogen het portaal nog wel openen ter controle.
 */
export async function requireWarmtefondsPortalOperator(
  req: NextRequest,
  token: string
): Promise<{ operator: WarmtefondsOperator } | { error: NextResponse }> {
  const operator = await resolveWarmtefondsOperator(getSupabaseAdmin(), token);
  if (!operator) {
    return {
      error: NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      ),
    };
  }

  const wfSession = await verifyWarmtefondsSessionToken(
    readWarmtefondsSessionCookieFromRequest(req)
  );
  if (
    wfSession &&
    wfSession.portalToken === token &&
    wfSession.operatorId === operator.id
  ) {
    return { operator };
  }

  const crmSession = await verifySessionToken(
    req.cookies.get(COOKIE_NAME)?.value
  );
  if (crmSession?.adviseurId) {
    return { operator };
  }

  return {
    error: NextResponse.json(
      { error: "Niet ingelogd", login: "/warmtefonds/login" },
      { status: 401 }
    ),
  };
}
