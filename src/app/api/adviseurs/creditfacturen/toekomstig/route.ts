import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { buildToekomstigeVerkoperCreditfacturen } from "@/lib/toekomstige-creditfacturen";

export const runtime = "nodejs";

/** GET /api/adviseurs/creditfacturen/toekomstig — preview eerstvolgende woensdag-run */
export async function GET() {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    const preview = await buildToekomstigeVerkoperCreditfacturen(sb);
    return NextResponse.json({ ok: true, ...preview });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Toekomstige facturen laden mislukt") },
      { status: 500 }
    );
  }
}
