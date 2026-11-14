import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireCockpitAdmin } from "@/lib/sales-cockpit/auth";
import { clearCockpitCache } from "@/lib/sales-cockpit/build";
import { parseCockpitSettings } from "@/lib/sales-cockpit/settings";
import { readSettings, writeSettings } from "@/lib/sales-cockpit/store";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireCockpitAdmin();
  if (!gate.ok) return gate.response;
  try {
    const row = await readSettings(getSupabaseAdmin());
    return NextResponse.json(row);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Instellingen laden mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireCockpitAdmin();
  if (!gate.ok) return gate.response;
  const body = await req.json().catch(() => null);
  try {
    const result = await writeSettings(getSupabaseAdmin(), {
      waarden: parseCockpitSettings(body?.waarden),
      expectedVersion: Number(body?.expectedVersion) || 0,
      actorId: gate.session.adviseurId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: "Instellingen zijn intussen gewijzigd", version: result.version },
        { status: 409 }
      );
    }
    clearCockpitCache();
    return NextResponse.json({ ok: true, version: result.version });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Opslaan mislukt";
    const status = message.includes("niet geïnstalleerd") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
