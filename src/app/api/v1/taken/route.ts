import { NextRequest } from "next/server";
import { requireApiKey } from "@/lib/api-v1/auth";
import { GET as takenGet, POST as takenPost } from "@/app/api/taken/route";

export const runtime = "nodejs";

/** GET /api/v1/taken */
export async function GET(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  return takenGet(req);
}

/** POST /api/v1/taken */
export async function POST(req: NextRequest) {
  const denied = requireApiKey(req);
  if (denied) return denied;
  return takenPost(req);
}
