/**
 * Centrale API-key authenticatie voor /api/v1/*
 *
 * Headers (één van beide):
 *   Authorization: Bearer <API_V1_KEY>
 *   x-api-key: <API_V1_KEY>
 */

import { NextRequest, NextResponse } from "next/server";

export function getApiV1Key(): string | null {
  const key = process.env.API_V1_KEY?.trim();
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

export function requireApiKey(req: NextRequest): NextResponse | null {
  const expected = getApiV1Key();
  if (!expected) {
    return NextResponse.json(
      {
        error: "API_V1_KEY is niet geconfigureerd op de server",
        hint: "Zet API_V1_KEY in .env / Vercel env vars",
      },
      { status: 503 }
    );
  }
  const provided = extractApiKey(req);
  if (!provided || provided !== expected) {
    return NextResponse.json(
      {
        error: "Ongeldige of ontbrekende API-key",
        auth: "Authorization: Bearer <API_V1_KEY> of header x-api-key",
      },
      { status: 401 }
    );
  }
  return null;
}
