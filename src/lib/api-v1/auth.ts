/**
 * Centrale API-key authenticatie voor /api/v1/*
 *
 * Headers (één van beide):
 *   Authorization: Bearer <key>
 *   x-api-key: <key>
 *
 * Keys:
 *   API_V1_KEY       → scope admin (alles)
 *   API_V1_SALES_KEY → scope sales (alleen slots + afspraken boeken)
 */

import { NextRequest, NextResponse } from "next/server";

export type ApiScope = "admin" | "sales";

/** Welke paden een sales-key mag gebruiken (prefix match). */
export const SALES_ALLOWED_PATHS = [
  "/api/v1/slots",
  "/api/v1/afspraken",
] as const;

export function getApiV1Key(): string | null {
  const key = process.env.API_V1_KEY?.trim();
  return key || null;
}

export function getApiV1SalesKey(): string | null {
  const key = process.env.API_V1_SALES_KEY?.trim();
  return key || null;
}

export function extractApiKey(req: NextRequest): string | null {
  const headerKey = req.headers.get("x-api-key")?.trim();
  if (headerKey) return headerKey;

  const auth = req.headers.get("authorization")?.trim();
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export function resolveApiScope(req: NextRequest): ApiScope | null {
  const provided = extractApiKey(req);
  if (!provided) return null;

  const admin = getApiV1Key();
  if (admin && provided === admin) return "admin";

  const sales = getApiV1SalesKey();
  if (sales && provided === sales) return "sales";

  return null;
}

function noKeyConfigured(): NextResponse {
  return NextResponse.json(
    {
      error: "Geen API-key geconfigureerd op de server",
      hint: "Zet API_V1_KEY (en optioneel API_V1_SALES_KEY) in .env / Vercel",
    },
    { status: 503 }
  );
}

function unauthorized(detail?: string): NextResponse {
  return NextResponse.json(
    {
      error: detail || "Ongeldige of ontbrekende API-key",
      auth: "Authorization: Bearer <key> of header x-api-key",
    },
    { status: 401 }
  );
}

function forbidden(scope: ApiScope, allowed: ApiScope[]): NextResponse {
  return NextResponse.json(
    {
      error: "Deze API-key heeft geen toegang tot dit endpoint",
      scope,
      required_scopes: allowed,
    },
    { status: 403 }
  );
}

/**
 * Vereist een geldige API-key met één van de toegestane scopes.
 * Default: alleen admin (volledige key).
 * Sales-routes: requireApiKey(req, { scopes: ["admin", "sales"] })
 */
export function requireApiKey(
  req: NextRequest,
  opts?: { scopes?: ApiScope[] }
): NextResponse | null {
  const allowed: ApiScope[] = opts?.scopes?.length
    ? opts.scopes
    : ["admin"];

  const hasAnyKey = Boolean(getApiV1Key() || getApiV1SalesKey());
  if (!hasAnyKey) return noKeyConfigured();

  const scope = resolveApiScope(req);
  if (!scope) return unauthorized();

  if (!allowed.includes(scope)) {
    return forbidden(scope, allowed);
  }

  return null;
}

/** Convenience: slots + afspraken (sales-token OK). */
export function requireSalesOrAdminApiKey(
  req: NextRequest
): NextResponse | null {
  return requireApiKey(req, { scopes: ["admin", "sales"] });
}
