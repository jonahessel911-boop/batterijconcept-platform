import { createHmac, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { adresRegel } from "@/lib/format";
import {
  INSTALLATIE_DUUR_MINUTEN,
  SCHOUW_DUUR_MINUTEN,
  SERVICE_DUUR_MINUTEN,
} from "@/lib/planning-duur";
import { appBaseUrl } from "@/lib/email/postmark";

export type GcalKind = "schouw" | "installatie" | "service";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

const EVENT_ID_COL: Record<GcalKind, string> = {
  schouw: "schouw_gcal_event_id",
  installatie: "installatie_gcal_event_id",
  service: "service_gcal_event_id",
};

const DUUR: Record<GcalKind, number> = {
  schouw: SCHOUW_DUUR_MINUTEN,
  installatie: INSTALLATIE_DUUR_MINUTEN,
  service: SERVICE_DUUR_MINUTEN,
};

const LABEL: Record<GcalKind, string> = {
  schouw: "Schouw",
  installatie: "Installatie",
  service: "Service",
};

function clientId(): string | undefined {
  return process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim() || undefined;
}

function clientSecret(): string | undefined {
  return process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim() || undefined;
}

function oauthSecret(): string {
  return (
    process.env.GOOGLE_CALENDAR_STATE_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    clientSecret() ||
    "batterijconcept-gcal"
  );
}

export function googleCalendarConfigured(): boolean {
  return Boolean(clientId() && clientSecret());
}

export function googleCalendarRedirectUri(): string {
  const fromEnv = process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim();
  if (fromEnv) return fromEnv;
  return `${appBaseUrl()}/api/installatie-partners/google/callback`;
}

export function signGoogleOAuthState(partnerId: string): string {
  const payload = Buffer.from(
    JSON.stringify({ partnerId, t: Date.now() }),
    "utf8"
  ).toString("base64url");
  const sig = createHmac("sha256", oauthSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyGoogleOAuthState(
  state: string
): { partnerId: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", oauthSecret())
    .update(payload)
    .digest("base64url");
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { partnerId?: string; t?: number };
    if (!parsed.partnerId) return null;
    // Max 30 min geldig
    if (parsed.t && Date.now() - parsed.t > 30 * 60_000) return null;
    return { partnerId: parsed.partnerId };
  } catch {
    return null;
  }
}

export function buildGoogleAuthUrl(partnerId: string): string {
  const id = clientId();
  if (!id) throw new Error("GOOGLE_CALENDAR_CLIENT_ID ontbreekt");
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: googleCalendarRedirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state: signGoogleOAuthState(partnerId),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
};

export async function exchangeGoogleCode(code: string): Promise<TokenResponse> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("Google Calendar OAuth niet geconfigureerd");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: googleCalendarRedirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || "Token-uitwisseling mislukt");
  }
  return data;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const id = clientId();
  const secret = clientSecret();
  if (!id || !secret) throw new Error("Google Calendar OAuth niet geconfigureerd");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: id,
      client_secret: secret,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as TokenResponse & { error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || "Token vernieuwen mislukt");
  }
  return data;
}

export async function fetchGoogleUserEmail(accessToken: string): Promise<string | null> {
  const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { email?: string };
  return data.email?.trim() || null;
}

type PartnerTokens = {
  id: string;
  naam: string;
  google_refresh_token: string | null;
  google_access_token: string | null;
  google_token_expires_at: string | null;
  google_calendar_id: string | null;
};

async function getValidAccessToken(
  partner: PartnerTokens
): Promise<{ accessToken: string; calendarId: string } | null> {
  if (!partner.google_refresh_token) return null;
  const calendarId = partner.google_calendar_id?.trim() || "primary";
  const expiresAt = partner.google_token_expires_at
    ? new Date(partner.google_token_expires_at).getTime()
    : 0;
  const stillValid =
    partner.google_access_token &&
    expiresAt > Date.now() + 60_000;

  if (stillValid && partner.google_access_token) {
    return { accessToken: partner.google_access_token, calendarId };
  }

  const tokens = await refreshAccessToken(partner.google_refresh_token);
  const sb = getSupabaseAdmin();
  const expires = new Date(
    Date.now() + (tokens.expires_in || 3600) * 1000
  ).toISOString();
  await sb
    .from("installatie_partners")
    .update({
      google_access_token: tokens.access_token,
      google_token_expires_at: expires,
      ...(tokens.refresh_token
        ? { google_refresh_token: tokens.refresh_token }
        : {}),
    })
    .eq("id", partner.id);

  return { accessToken: tokens.access_token, calendarId };
}

type LeadLike = {
  naam?: string | null;
  telefoon?: string | null;
  email?: string | null;
  straat?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  postcode?: string | null;
  plaats?: string | null;
};

function buildEventBody(opts: {
  kind: GcalKind;
  startIso: string;
  projectNummer?: string | null;
  titel?: string | null;
  notities?: string | null;
  lead?: LeadLike | null;
}) {
  const start = new Date(opts.startIso);
  const end = new Date(start.getTime() + DUUR[opts.kind] * 60_000);
  const klant = opts.lead?.naam?.trim() || "Klant";
  const location = opts.lead ? adresRegel(opts.lead) : "";
  const descParts = [
    `Project ${opts.projectNummer || "—"}`,
    opts.titel ? `Titel: ${opts.titel}` : null,
    opts.lead?.telefoon ? `Tel: ${opts.lead.telefoon}` : null,
    opts.lead?.email ? `E-mail: ${opts.lead.email}` : null,
    opts.notities ? `Notitie: ${opts.notities}` : null,
  ].filter(Boolean);

  return {
    summary: `${LABEL[opts.kind]} · ${klant}`,
    description: descParts.join("\n"),
    location: location || undefined,
    start: { dateTime: start.toISOString(), timeZone: "Europe/Amsterdam" },
    end: { dateTime: end.toISOString(), timeZone: "Europe/Amsterdam" },
  };
}

async function gcalFetch(
  accessToken: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export type SyncGcalResult =
  | { ok: true; eventId: string; action: "created" | "updated" }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

/**
 * Maakt of werkt een Google Calendar-event bij direct na planning.
 * Faalt stil (ok:false) zodat planning in het platform niet blokkeert.
 */
export async function syncPartnerGoogleEvent(opts: {
  partnerId: string;
  projectId: string;
  kind: GcalKind;
  startIso: string;
  projectNummer?: string | null;
  titel?: string | null;
  notities?: string | null;
  lead?: LeadLike | null;
  existingEventId?: string | null;
}): Promise<SyncGcalResult> {
  if (!googleCalendarConfigured()) {
    return { ok: true, skipped: true, reason: "oauth_niet_geconfigureerd" };
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: partner, error } = await sb
      .from("installatie_partners")
      .select(
        "id, naam, google_refresh_token, google_access_token, google_token_expires_at, google_calendar_id"
      )
      .eq("id", opts.partnerId)
      .single();

    if (error || !partner) {
      return { ok: true, skipped: true, reason: "partner_niet_gevonden" };
    }
    if (!partner.google_refresh_token) {
      return { ok: true, skipped: true, reason: "niet_gekoppeld" };
    }

    const auth = await getValidAccessToken(partner as PartnerTokens);
    if (!auth) {
      return { ok: true, skipped: true, reason: "geen_token" };
    }

    const body = buildEventBody(opts);
    const cal = encodeURIComponent(auth.calendarId);
    let eventId = opts.existingEventId?.trim() || null;
    let action: "created" | "updated" = "created";

    if (eventId) {
      const patched = await gcalFetch(
        auth.accessToken,
        `/calendars/${cal}/events/${encodeURIComponent(eventId)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      if (patched.ok && typeof patched.json.id === "string") {
        eventId = patched.json.id;
        action = "updated";
      } else if (patched.status === 404) {
        eventId = null;
      } else {
        return {
          ok: false,
          error:
            (patched.json.error as { message?: string } | undefined)?.message ||
            `Google update mislukt (${patched.status})`,
        };
      }
    }

    if (!eventId) {
      const created = await gcalFetch(
        auth.accessToken,
        `/calendars/${cal}/events`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (!created.ok || typeof created.json.id !== "string") {
        return {
          ok: false,
          error:
            (created.json.error as { message?: string } | undefined)?.message ||
            `Google create mislukt (${created.status})`,
        };
      }
      eventId = created.json.id;
      action = "created";
    }

    await sb
      .from("projecten")
      .update({ [EVENT_ID_COL[opts.kind]]: eventId })
      .eq("id", opts.projectId);

    return { ok: true, eventId, action };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Google sync mislukt",
    };
  }
}

export async function deletePartnerGoogleEvent(opts: {
  partnerId: string;
  projectId: string;
  kind: GcalKind;
  eventId?: string | null;
}): Promise<SyncGcalResult> {
  if (!opts.eventId?.trim()) {
    return { ok: true, skipped: true, reason: "geen_event" };
  }
  if (!googleCalendarConfigured()) {
    return { ok: true, skipped: true, reason: "oauth_niet_geconfigureerd" };
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: partner } = await sb
      .from("installatie_partners")
      .select(
        "id, naam, google_refresh_token, google_access_token, google_token_expires_at, google_calendar_id"
      )
      .eq("id", opts.partnerId)
      .single();

    if (!partner?.google_refresh_token) {
      await sb
        .from("projecten")
        .update({ [EVENT_ID_COL[opts.kind]]: null })
        .eq("id", opts.projectId);
      return { ok: true, skipped: true, reason: "niet_gekoppeld" };
    }

    const auth = await getValidAccessToken(partner as PartnerTokens);
    if (auth) {
      const cal = encodeURIComponent(auth.calendarId);
      await gcalFetch(
        auth.accessToken,
        `/calendars/${cal}/events/${encodeURIComponent(opts.eventId)}`,
        { method: "DELETE" }
      );
    }

    await sb
      .from("projecten")
      .update({ [EVENT_ID_COL[opts.kind]]: null })
      .eq("id", opts.projectId);

    return { ok: true, eventId: opts.eventId, action: "updated" };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Google delete mislukt",
    };
  }
}

/** Helper: haal lead uit project-join. */
export function leadFromProjectJoin(raw: unknown): LeadLike | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return (raw[0] as LeadLike) ?? null;
  return raw as LeadLike;
}
