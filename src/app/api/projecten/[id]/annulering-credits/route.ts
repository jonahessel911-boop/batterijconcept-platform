import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { requireBackofficeSession } from "@/lib/auth-require-backoffice";
import { creditFacturenBijAnnulering } from "@/lib/annulering-creditfacturen";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/annulering-credits
 * Body: { binnenBedenktijd: true, creditFacturen: true }
 * Per verstuurde factuur (betaald of nog open) een eigen creditfactuur, mailen en boeken.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireBackofficeSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await ctx.params;
  let body: { binnenBedenktijd?: boolean; creditFacturen?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  if (!body.binnenBedenktijd || !body.creditFacturen) {
    return NextResponse.json(
      {
        error:
          "Alleen bij annulering binnen bedenktijd, als de facturen direct gecrediteerd moeten worden",
      },
      { status: 400 }
    );
  }

  try {
    const { results, error } = await creditFacturenBijAnnulering(id);
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    const mislukt = results.filter((r) => !r.ok);
    const waarschuwingen = results
      .map((r) => r.warning)
      .filter((w): w is string => Boolean(w));
    return NextResponse.json({
      ok: mislukt.length === 0,
      results,
      error: mislukt.length
        ? mislukt
            .map((r) => `${r.origineel}: ${r.error || "mislukt"}`)
            .join(" · ")
        : undefined,
      warning: waarschuwingen.length ? waarschuwingen.join(" · ") : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Creditfacturen mislukt") },
      { status: 500 }
    );
  }
}
