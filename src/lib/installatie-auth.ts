/**
 * Sessies voor het installatieportaal (apart van CRM bc_session).
 */
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "bc_installatie_session";
const SESSION_DAYS = 30;

function sessionSecret(): string {
  return (
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "batterijconcept-dev-secret"
  );
}

export type InstallatieAuthRol = "beheerder" | "monteur";

export type InstallatieSessionPayload = {
  /** partner | teamgenoot */
  kind: "partner" | "teamgenoot";
  partnerId: string;
  teamgenootId: string | null;
  naam: string;
  email: string;
  rol: InstallatieAuthRol;
  /** Legacy token voor API-paden / deep links */
  portalToken: string;
  exp: number;
};

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]!);
  const b64 =
    typeof btoa !== "undefined"
      ? btoa(binary)
      : Buffer.from(arr).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(s: string): ArrayBuffer {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const str =
    typeof atob !== "undefined"
      ? atob(b64 + pad)
      : Buffer.from(b64 + pad, "base64").toString("binary");
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
  return out.buffer;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(payloadB64: string): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64)
  );
  return toBase64Url(sig);
}

export async function createInstallatieSessionToken(
  data: Omit<InstallatieSessionPayload, "exp">
): Promise<string> {
  const payload: InstallatieSessionPayload = {
    ...data,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  };
  const payloadB64 = toBase64Url(
    new TextEncoder().encode(JSON.stringify(payload))
  );
  const sig = await sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

export async function verifyInstallatieSessionToken(
  token: string | undefined | null
): Promise<InstallatieSessionPayload | null> {
  if (!token) return null;
  const [payloadB64, sig] = token.split(".");
  if (!payloadB64 || !sig) return null;
  try {
    const key = await hmacKey();
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(sig),
      new TextEncoder().encode(payloadB64)
    );
    if (!ok) return null;
    const json = new TextDecoder().decode(fromBase64Url(payloadB64));
    const payload = JSON.parse(json) as InstallatieSessionPayload;
    if (
      !payload.partnerId ||
      !payload.exp ||
      payload.exp < Date.now() ||
      !payload.portalToken
    ) {
      return null;
    }
    if (payload.rol !== "beheerder" && payload.rol !== "monteur") {
      payload.rol = payload.kind === "partner" ? "beheerder" : "monteur";
    }
    return payload;
  } catch {
    return null;
  }
}

export function installatieSessionCookieOptions(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export function clearInstallatieSessionCookieOptions() {
  return {
    name: COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

export function readInstallatieSessionCookieFromRequest(
  req: NextRequest
): string | null {
  return req.cookies.get(COOKIE_NAME)?.value || null;
}

/** Server Components / Route Handlers (cookies()). */
export async function readInstallatieSessionCookie(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value || null;
}

export { COOKIE_NAME as INSTALLATIE_COOKIE_NAME };
