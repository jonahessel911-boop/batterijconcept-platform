import { NextRequest } from "next/server";
import {
  resolveApiScope,
  requireSalesOrAdminApiKey,
} from "@/lib/api-v1/auth";
import { jsonOk } from "@/lib/api-v1/http";
import { buildApiV1DocsPayload } from "@/lib/api-v1/docs";

export const runtime = "nodejs";

/**
 * GET /api/v1 — API-docs
 * Admin-key: volledige docs
 * Sales-key: alleen slots + afspraken
 */
export async function GET(req: NextRequest) {
  const denied = requireSalesOrAdminApiKey(req);
  if (denied) return denied;

  const scope = resolveApiScope(req) || "admin";
  return jsonOk(buildApiV1DocsPayload({ scope }));
}
