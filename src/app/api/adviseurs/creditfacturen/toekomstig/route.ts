import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { buildToekomstigeVerkoperCreditfacturen } from "@/lib/toekomstige-creditfacturen";
import { ensureNettoAanbetalingCreditfactuur } from "@/lib/netto-creditfactuur";

export const runtime = "nodejs";

/** GET /api/adviseurs/creditfacturen/toekomstig — preview eerstvolgende woensdag-run
 *  ?mode=vooruit → alleen aanbetalingen van de huidige week (volgende uitbetaling)
 */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const modeRaw = (req.nextUrl.searchParams.get("mode") || "").toLowerCase();
    const mode = modeRaw === "vooruit" ? "vooruit" : "default";

    const sb = getSupabaseAdmin();
    const preview = await buildToekomstigeVerkoperCreditfacturen(sb, new Date(), {
      mode,
    });
    return NextResponse.json({ ok: true, ...preview });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Toekomstige facturen laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/adviseurs/creditfacturen/toekomstig
 * Maakt concept-creditfacturen (CF-YYYY/AANBETALING/OFF-…) voor alle
 * aanbetaalde orders in de aankomende commissieweek die nog geen CF hebben.
 */
export async function POST() {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    const preview = await buildToekomstigeVerkoperCreditfacturen(sb);
    const targets = preview.regels.filter((r) => r.status === "nieuw");

    let created = 0;
    let skipped = 0;
    const errors: string[] = [];
    const ids: string[] = [];

    for (const r of targets) {
      const result = await ensureNettoAanbetalingCreditfactuur(
        sb,
        r.factuurId,
        { autoVerstuur: false }
      );
      if (!result.ok) {
        errors.push(
          `${r.offerteNummer || r.factuurNummer}: ${result.error || "fout"}`
        );
        continue;
      }
      if (result.created && result.creditfactuur_id) {
        created += 1;
        ids.push(result.creditfactuur_id);
      } else if (result.skipped) {
        skipped += 1;
        if (result.creditfactuur_id) ids.push(result.creditfactuur_id);
      }
    }

    const refreshed = await buildToekomstigeVerkoperCreditfacturen(sb);
    return NextResponse.json({
      ok: errors.length === 0,
      created,
      skipped,
      errors,
      ids,
      ...refreshed,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Concepten aanmaken mislukt") },
      { status: 500 }
    );
  }
}
