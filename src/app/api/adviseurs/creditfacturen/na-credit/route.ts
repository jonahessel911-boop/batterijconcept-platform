import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { listAanbetalingNaCreditUitbetaling } from "@/lib/aanbetaling-na-credit-uitbetaling";
import { ensureNettoAanbetalingCreditfactuur } from "@/lib/netto-creditfactuur";

export const runtime = "nodejs";

/** GET — gecrediteerde aanbetalingen waar wél betaald is, nog geen uitbetaling. */
export async function GET() {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rijen = await listAanbetalingNaCreditUitbetaling(getSupabaseAdmin());
    return NextResponse.json({ ok: true, rijen });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

/** POST { factuur_id } — maak tranche-A concept voor deze betaalde aanbetaling. */
export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      factuur_id?: string;
    };
    const factuurId = body.factuur_id?.trim();
    if (!factuurId) {
      return NextResponse.json(
        { error: "factuur_id is verplicht" },
        { status: 400 }
      );
    }
    const sb = getSupabaseAdmin();
    const rijen = await listAanbetalingNaCreditUitbetaling(sb);
    const allowed = rijen.some(
      (r) => r.factuurId === factuurId && r.kanUitbetalen
    );
    if (!allowed) {
      return NextResponse.json(
        { error: "Deze factuur staat niet in de na-credit-lijst." },
        { status: 400 }
      );
    }
    const result = await ensureNettoAanbetalingCreditfactuur(sb, factuurId, {
      autoVerstuur: false,
      allowAnnulering: true,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Aanmaken mislukt" },
        { status: 500 }
      );
    }
    return NextResponse.json({
      ok: true,
      created: Boolean(result.created),
      skipped: result.skipped || null,
      creditfactuur_id: result.creditfactuur_id || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Aanmaken mislukt") },
      { status: 500 }
    );
  }
}
