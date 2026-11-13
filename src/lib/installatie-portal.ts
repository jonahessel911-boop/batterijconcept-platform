/**
 * Resolve installatieportaal: cookie-sessie, URL-token, of "session"-alias.
 */
import { randomBytes } from "crypto";
import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { teamgenootPortaalWelkomEmail } from "@/lib/email/templates";
import {
  readInstallatieSessionCookieFromRequest,
  verifyInstallatieSessionToken,
  type InstallatieAuthRol,
} from "@/lib/installatie-auth";

export type InstallatiePortalPartner = {
  id: string;
  naam: string;
  email: string | null;
  telefoon?: string | null;
  actief: boolean;
  portal_token: string;
  bedrijfsnaam?: string | null;
  kvk_nummer?: string | null;
  iban?: string | null;
};

export type InstallatiePortalTeamgenoot = {
  id: string;
  partner_id: string;
  naam: string;
  email: string | null;
  telefoon: string | null;
  actief: boolean;
  portal_token: string;
  invite_sent_at?: string | null;
  rol?: InstallatieAuthRol | null;
  kan_schouw?: boolean | null;
  kan_installatie?: boolean | null;
};

export type InstallatiePortalSession =
  | {
      kind: "partner";
      partner: InstallatiePortalPartner;
      teamgenoot: null;
      authRol: "beheerder";
      /** Ingelogde persoon (niet bedrijfsnaam), indien bekend. */
      viewerNaam?: string | null;
    }
  | {
      kind: "teamgenoot";
      partner: InstallatiePortalPartner;
      teamgenoot: InstallatiePortalTeamgenoot;
      authRol: InstallatieAuthRol;
      viewerNaam?: string | null;
    };

function isMissingColumn(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    msg.includes("portal_token") ||
    msg.includes("invite_sent_at") ||
    msg.includes("password_hash") ||
    msg.includes("does not exist")
  );
}

export function newInstallatiePortalToken(): string {
  return randomBytes(24).toString("hex");
}

export function installatiePortalUrl(token: string): string {
  // Direct portaal via token — geen wachtwoord-login
  return `${appBaseUrl()}/installatie/${encodeURIComponent(token)}`;
}

export function installatieLoginUrl(): string {
  return `${appBaseUrl()}/installatie/login`;
}

export function isBeheerderSession(session: InstallatiePortalSession): boolean {
  return session.authRol === "beheerder";
}

/** Monteur ziet alleen eigen klussen; beheerder/partner ziet alles van de partner. */
export function scopesToOwnJobsOnly(
  session: InstallatiePortalSession
): session is Extract<InstallatiePortalSession, { kind: "teamgenoot" }> & {
  authRol: "monteur";
} {
  return session.kind === "teamgenoot" && session.authRol === "monteur";
}

function normalizeTgRol(raw: unknown): InstallatieAuthRol {
  return raw === "beheerder" ? "beheerder" : "monteur";
}

const PARTNER_SELECT =
  "id, naam, email, telefoon, actief, portal_token, bedrijfsnaam, kvk_nummer, iban";

const TG_SELECT_FULL =
  "id, partner_id, naam, email, telefoon, actief, portal_token, invite_sent_at, rol, kan_schouw, kan_installatie";

const TG_SELECT_MIN =
  "id, partner_id, naam, email, telefoon, actief, portal_token, invite_sent_at";

async function loadPartnerById(
  id: string
): Promise<InstallatiePortalPartner | null> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partners")
    .select(PARTNER_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error || !data || !data.actief) return null;
  return data as InstallatiePortalPartner;
}

async function loadTeamgenootById(
  id: string
): Promise<InstallatiePortalTeamgenoot | null> {
  const sb = getSupabaseAdmin();
  let { data, error } = await sb
    .from("installatie_partner_teamgenoten")
    .select(TG_SELECT_FULL)
    .eq("id", id)
    .maybeSingle();
  if (error && isMissingColumn(error)) {
    ({ data, error } = await sb
      .from("installatie_partner_teamgenoten")
      .select(TG_SELECT_MIN)
      .eq("id", id)
      .maybeSingle());
  }
  if (error || !data || data.actief === false) return null;
  return {
    ...(data as InstallatiePortalTeamgenoot),
    rol: normalizeTgRol((data as { rol?: string }).rol),
  };
}

async function sessionFromCookieToken(
  cookieToken: string | null | undefined
): Promise<InstallatiePortalSession | null> {
  const payload = await verifyInstallatieSessionToken(cookieToken);
  if (!payload) return null;

  const partner = await loadPartnerById(payload.partnerId);
  if (!partner) return null;

  if (payload.kind === "partner") {
    return {
      kind: "partner",
      partner,
      teamgenoot: null,
      authRol: "beheerder",
      viewerNaam: payload.naam?.trim() || null,
    };
  }

  if (!payload.teamgenootId) return null;
  const tg = await loadTeamgenootById(payload.teamgenootId);
  if (!tg || tg.partner_id !== partner.id) return null;
  const authRol = normalizeTgRol(tg.rol ?? payload.rol);
  return {
    kind: "teamgenoot",
    partner,
    teamgenoot: tg,
    authRol,
    viewerNaam: tg.naam?.trim() || payload.naam?.trim() || null,
  };
}

/** Partner of teamgenoot op basis van URL-token (legacy) of "session"+cookie. */
export async function resolveInstallatiePortal(
  token: string,
  req?: NextRequest | null
): Promise<InstallatiePortalSession | null> {
  const trimmed = (token || "").trim();

  // Cookie-sessie (pad /api/installatie/session/…)
  if (trimmed === "session" || trimmed === "me") {
    if (!req) return null;
    return sessionFromCookieToken(readInstallatieSessionCookieFromRequest(req));
  }

  // Ook cookie accepteren naast token (na login op oude URL)
  if (req) {
    const fromCookie = await sessionFromCookieToken(
      readInstallatieSessionCookieFromRequest(req)
    );
    if (fromCookie) {
      const cookieTok =
        fromCookie.kind === "partner"
          ? fromCookie.partner.portal_token
          : fromCookie.teamgenoot.portal_token;
      if (cookieTok === trimmed) return fromCookie;
    }
  }

  if (!trimmed || trimmed.length < 16) return null;
  const sb = getSupabaseAdmin();

  const { data: partner, error: pErr } = await sb
    .from("installatie_partners")
    .select(PARTNER_SELECT)
    .eq("portal_token", trimmed)
    .maybeSingle();

  if (!pErr && partner && partner.actief) {
    return {
      kind: "partner",
      partner: partner as InstallatiePortalPartner,
      teamgenoot: null,
      authRol: "beheerder",
      viewerNaam: null,
    };
  }

  let { data: tg, error: tgErr } = await sb
    .from("installatie_partner_teamgenoten")
    .select(TG_SELECT_FULL)
    .eq("portal_token", trimmed)
    .maybeSingle();

  if (tgErr && isMissingColumn(tgErr)) {
    ({ data: tg, error: tgErr } = await sb
      .from("installatie_partner_teamgenoten")
      .select(TG_SELECT_MIN)
      .eq("portal_token", trimmed)
      .maybeSingle());
  }
  if (tgErr && isMissingColumn(tgErr)) {
    return null;
  }
  if (tgErr || !tg || tg.actief === false) return null;

  const parent = await loadPartnerById(tg.partner_id);
  if (!parent) return null;

  const authRol = normalizeTgRol((tg as { rol?: string }).rol);
  const teamgenoot = {
    ...(tg as InstallatiePortalTeamgenoot),
    rol: authRol,
  };
  return {
    kind: "teamgenoot",
    partner: parent,
    teamgenoot,
    authRol,
    viewerNaam: teamgenoot.naam?.trim() || null,
  };
}

/** Alleen beheerder (partner-account of teamgenoot-beheerder). */
export async function requirePartnerPortal(
  token: string,
  req?: NextRequest | null
): Promise<InstallatiePortalPartner | null> {
  const session = await resolveInstallatiePortal(token, req);
  if (!session || !isBeheerderSession(session)) return null;
  return session.partner;
}

/**
 * Controleer of dit portaal-token bij deze order hoort.
 * Monteur: alleen als installatie_teamgenoot_id matcht.
 */
export async function assertPortalOrderAccess(
  token: string,
  projectId: string,
  select = "id",
  req?: NextRequest | null
): Promise<{
  session: InstallatiePortalSession;
  order: Record<string, unknown>;
} | null> {
  const session = await resolveInstallatiePortal(token, req);
  if (!session) return null;

  const sb = getSupabaseAdmin();
  let query = sb
    .from("projecten")
    .select(select)
    .eq("id", projectId)
    .eq("installatie_partner_id", session.partner.id);

  if (scopesToOwnJobsOnly(session)) {
    query = query.eq("installatie_teamgenoot_id", session.teamgenoot.id);
  }

  const { data: order, error } = await query.maybeSingle();
  if (error || !order || typeof order !== "object") return null;
  return { session, order: order as unknown as Record<string, unknown> };
}

export function portalViewerPayload(session: InstallatiePortalSession) {
  const beheerder = isBeheerderSession(session);
  const tabs = (() => {
    if (session.kind === "partner") {
      return [
        "agenda",
        "verwachting",
        "installaties",
        "team",
        "facturen",
      ] as const;
    }
    if (beheerder) {
      return [
        "agenda",
        "verwachting",
        "installaties",
        "team",
        "facturen",
        "profiel",
      ] as const;
    }
    return ["agenda", "profiel"] as const;
  })();

  const viewerNaam =
    session.kind === "teamgenoot"
      ? session.teamgenoot.naam?.trim() || session.viewerNaam || null
      : session.viewerNaam &&
          session.viewerNaam.trim() !== session.partner.naam.trim()
        ? session.viewerNaam.trim()
        : null;

  if (session.kind === "partner") {
    return {
      role: "partner" as const,
      auth_rol: "beheerder" as const,
      partner: {
        id: session.partner.id,
        naam: session.partner.naam,
        email: session.partner.email,
      },
      teamgenoot: null,
      viewer_naam: viewerNaam,
      tabs,
      api_token: session.partner.portal_token,
    };
  }

  return {
    role: beheerder ? ("partner" as const) : ("teamgenoot" as const),
    auth_rol: session.authRol,
    partner: {
      id: session.partner.id,
      naam: session.partner.naam,
      email: session.partner.email,
    },
    teamgenoot: {
      id: session.teamgenoot.id,
      naam: session.teamgenoot.naam,
      email: session.teamgenoot.email,
      rol: session.authRol,
    },
    viewer_naam: viewerNaam,
    tabs,
    api_token: session.teamgenoot.portal_token,
  };
}

/** Stuur welkomstmail met login-URL + tijdelijk wachtwoord. */
export async function verstuurTeamgenootPortaalInvite(opts: {
  teamgenoot: {
    id: string;
    naam: string;
    email: string;
    portal_token: string;
  };
  partnerNaam: string;
  password?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const email = opts.teamgenoot.email.trim().toLowerCase();
  if (!email) return { ok: false, error: "E-mail ontbreekt" };

  const portalUrl = installatiePortalUrl(opts.teamgenoot.portal_token);
  const html = teamgenootPortaalWelkomEmail({
    naam: opts.teamgenoot.naam,
    partnerNaam: opts.partnerNaam,
    email,
    portalUrl,
    password: opts.password || null,
  });

  try {
    await sendEmail({
      to: email,
      subject: `Je installatieportaal — ${opts.partnerNaam}`,
      html,
      tag: "installatie-teamgenoot-welkom",
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Mail versturen mislukt",
    };
  }

  const sb = getSupabaseAdmin();
  await sb
    .from("installatie_partner_teamgenoten")
    .update({ invite_sent_at: new Date().toISOString() })
    .eq("id", opts.teamgenoot.id);

  return { ok: true };
}
