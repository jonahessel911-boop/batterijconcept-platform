import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-require-admin";
import { getOpvolgingAbMetrics } from "@/lib/afspraak-opvolging/metrics";
import {
  getOpvolgingAbSettings,
  setOpvolgingAbEnabled,
} from "@/lib/afspraak-opvolging/settings";
import { isBirdSmsConfigured } from "@/lib/sms/bird";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** GET — settings + metrics (admin). */
export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = getSupabaseAdmin();
    const [settings, metrics] = await Promise.all([
      getOpvolgingAbSettings(sb),
      getOpvolgingAbMetrics(sb),
    ]);
    return NextResponse.json({
      settings,
      metrics,
      sms_configured: isBirdSmsConfigured(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH — { enabled: boolean } (admin). */
export async function PATCH(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await req.json()) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled (boolean) is verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const settings = await setOpvolgingAbEnabled(sb, body.enabled);
    const metrics = await getOpvolgingAbMetrics(sb);
    return NextResponse.json({
      settings,
      metrics,
      sms_configured: isBirdSmsConfigured(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
