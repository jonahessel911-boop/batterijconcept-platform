import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { resolveWarmtefondsOperator } from "@/lib/warmtefonds-portal";
import {
  leesWarmtefondsConfig,
  normaliseerConfig,
  schrijfWarmtefondsConfig,
  wfContactTemplates,
} from "@/lib/warmtefonds-automatisering";

export const runtime = "nodejs";

/** GET /api/warmtefonds/[token]/instellingen */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const operator = await resolveWarmtefondsOperator(getSupabaseAdmin(), token);
    if (!operator) {
      return NextResponse.json({ error: "Portaal niet gevonden" }, { status: 404 });
    }
    const config = await leesWarmtefondsConfig();
    return NextResponse.json({
      binnenkomst: config.binnenkomst,
      dag_ervoor: config.dag_ervoor,
      templates: wfContactTemplates(config),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PUT /api/warmtefonds/[token]/instellingen */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const operator = await resolveWarmtefondsOperator(getSupabaseAdmin(), token);
    if (!operator) {
      return NextResponse.json({ error: "Portaal niet gevonden" }, { status: 404 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      binnenkomst?: unknown;
      dag_ervoor?: unknown;
    };
    const bestaand = await leesWarmtefondsConfig();
    const volgend = normaliseerConfig({
      binnenkomst: body.binnenkomst,
      dag_ervoor: body.dag_ervoor,
      verzonden: bestaand.verzonden,
    });
    await schrijfWarmtefondsConfig(volgend);
    return NextResponse.json({
      binnenkomst: volgend.binnenkomst,
      dag_ervoor: volgend.dag_ervoor,
      templates: wfContactTemplates(volgend),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}
