import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-v1/auth";
import { jsonOk } from "@/lib/api-v1/http";
import { buildApiV1DocsPayload } from "@/lib/api-v1/docs";

export const runtime = "nodejs";

/**
 * GET /api/v1 — volledige API-docs met alle parameters per endpoint
 * Auth: Authorization: Bearer <API_V1_KEY> of x-api-key
 */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  return jsonOk(buildApiV1DocsPayload());
}
