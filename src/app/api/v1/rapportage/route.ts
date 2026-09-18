import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-v1/auth";
import { GET as rapportageGet } from "@/app/api/rapportage/route";

export const runtime = "nodejs";

/** GET /api/v1/rapportage — sales/financial/geo (zelfde data als CRM rapportage) */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  return rapportageGet(req);
}
