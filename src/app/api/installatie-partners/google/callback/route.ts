import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl } from "@/lib/email/postmark";
import {
  exchangeGoogleCode,
  fetchGoogleUserEmail,
  verifyGoogleOAuthState,
} from "@/lib/google-calendar";

export const runtime = "nodejs";

function redirectCrm(opts: { ok?: boolean; error?: string }) {
  const url = new URL("/", appBaseUrl());
  url.searchParams.set("tab", "partners");
  url.searchParams.set("partners", "installatie");
  if (opts.ok) url.searchParams.set("gcal", "ok");
  if (opts.error) url.searchParams.set("gcal_error", opts.error);
  return NextResponse.redirect(url);
}

/**
 * GET /api/installatie-partners/google/callback
 * Google OAuth redirect — slaat tokens op bij de partner.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    return redirectCrm({ error: oauthError });
  }
  if (!code || !state) {
    return redirectCrm({ error: "geen_code" });
  }

  const verified = verifyGoogleOAuthState(state);
  if (!verified) {
    return redirectCrm({ error: "ongeldige_state" });
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    if (!tokens.refresh_token) {
      // Soms geen refresh_token bij her-koppelen; bestaande behouden als die er is
      const sb = getSupabaseAdmin();
      const { data: existing } = await sb
        .from("installatie_partners")
        .select("google_refresh_token")
        .eq("id", verified.partnerId)
        .maybeSingle();
      if (!existing?.google_refresh_token) {
        return redirectCrm({
          error: "geen_refresh_token_opnieuw_koppelen_met_consent",
        });
      }
    }

    const email = await fetchGoogleUserEmail(tokens.access_token);
    const expires = new Date(
      Date.now() + (tokens.expires_in || 3600) * 1000
    ).toISOString();

    const sb = getSupabaseAdmin();
    const patch: Record<string, unknown> = {
      google_access_token: tokens.access_token,
      google_token_expires_at: expires,
      google_connected_at: new Date().toISOString(),
      google_connected_email: email,
      google_calendar_id: "primary",
    };
    if (tokens.refresh_token) {
      patch.google_refresh_token = tokens.refresh_token;
    }

    const { error } = await sb
      .from("installatie_partners")
      .update(patch)
      .eq("id", verified.partnerId);

    if (error) {
      return redirectCrm({ error: "opslaan_mislukt" });
    }

    return redirectCrm({ ok: true });
  } catch {
    return redirectCrm({ error: "token_mislukt" });
  }
}
