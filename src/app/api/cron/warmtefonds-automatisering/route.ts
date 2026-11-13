import { NextResponse } from "next/server";
import { verstuurWarmtefondsAfspraakFlows } from "@/lib/warmtefonds-automatisering";

export const runtime = "nodejs";

/** GET /api/cron/warmtefonds-automatisering — 1 dag voor de afspraak. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const q = new URL(req.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await verstuurWarmtefondsAfspraakFlows();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
