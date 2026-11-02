/**
 * POST /api/fonio/outbound
 * Fonio plaatst geen gesprekken meer. Bellen doen eigen mensen vanuit de belbak.
 * Auth: Authorization: Bearer API_V1_KEY  of  x-api-key
 */

import { NextRequest, NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-v1/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = requireApiKey(req, { scopes: ["admin"] });
  if (denied) return denied;

  return NextResponse.json(
    {
      error: "Fonio belt niet meer. Bel deze lead zelf vanuit de belbak.",
    },
    { status: 410 }
  );
}
