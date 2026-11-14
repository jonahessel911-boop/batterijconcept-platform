import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireCockpitAdmin } from "@/lib/sales-cockpit/auth";
import { clearCockpitCache } from "@/lib/sales-cockpit/build";
import { readActions, saveAction } from "@/lib/sales-cockpit/store";

export const runtime = "nodejs";

const STATUSSEN = new Set(["nieuw", "onderzoek", "loopt", "evalueren", "afgerond"]);

export async function GET() {
  const gate = await requireCockpitAdmin();
  if (!gate.ok) return gate.response;
  try {
    const { rows, missing } = await readActions(getSupabaseAdmin());
    return NextResponse.json({ missing, rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Acties laden mislukt";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireCockpitAdmin();
  if (!gate.ok) return gate.response;
  const body = await req.json().catch(() => null);
  if (!body?.signal_key) {
    return NextResponse.json({ error: "signal_key is verplicht" }, { status: 400 });
  }
  if (body.status && !STATUSSEN.has(body.status)) {
    return NextResponse.json({ error: "Onbekende status" }, { status: 400 });
  }
  try {
    const result = await saveAction(getSupabaseAdmin(), {
      ...body,
      signal_key: String(body.signal_key),
      expectedVersion: Number(body.expectedVersion) || 0,
      actorId: gate.session.adviseurId,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: "Deze actie is intussen gewijzigd", version: result.version },
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
