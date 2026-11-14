import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { resolveWarmtefondsOperator } from "@/lib/warmtefonds-portal";
import { edergyFactuurPdf } from "@/lib/edergy-factuur";

export const runtime = "nodejs";

/** GET /api/warmtefonds/[token]/creditfacturen/[id]/pdf */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  const operator = await resolveWarmtefondsOperator(getSupabaseAdmin(), token);
  if (!operator) {
    return NextResponse.json({ error: "Portaal niet gevonden" }, { status: 404 });
  }
  const file = await edergyFactuurPdf(id);
  if (!file) {
    return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
  }
  return new NextResponse(Buffer.from(file.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Factuur ${file.nummer} - Batterij Concept.pdf"`,
    },
  });
}
