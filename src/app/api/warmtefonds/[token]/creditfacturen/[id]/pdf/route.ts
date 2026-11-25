import { NextRequest, NextResponse } from "next/server";
import { requireWarmtefondsPortalOperator } from "@/lib/warmtefonds-portal-guard";
import { edergyFactuurPdf } from "@/lib/edergy-factuur";

export const runtime = "nodejs";

/** GET /api/warmtefonds/[token]/creditfacturen/[id]/pdf */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;
  const access = await requireWarmtefondsPortalOperator(req, token);
  if ("error" in access) return access.error;
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
