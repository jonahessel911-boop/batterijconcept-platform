import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-v1/auth";
import { GET as managementGet } from "@/app/api/management-dashboard/route";

export const runtime = "nodejs";

/** GET /api/v1/sales — management sales KPIs */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  return managementGet(req);
}
