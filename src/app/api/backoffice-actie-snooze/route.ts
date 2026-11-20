import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";

export const runtime = "nodejs";

function tableMissing(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    (error.message || "").includes("backoffice_actie_snooze")
  );
}

/** GET /api/backoffice-actie-snooze */
export async function GET() {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("backoffice_actie_snooze")
      .select("actie_id, tot");
    if (error) {
      if (tableMissing(error)) return NextResponse.json({ snoozes: {} });
      return NextResponse.json(
        { error: "Laden mislukt", detail: error.message },
        { status: 500 }
      );
    }
    const snoozes: Record<string, string> = {};
    for (const row of data || []) {
      if (row.actie_id && row.tot) snoozes[row.actie_id] = row.tot;
    }
    return NextResponse.json({ snoozes });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PUT /api/backoffice-actie-snooze — doorschuiven tot datum */
export async function PUT(req: Request) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    let body: { actie_id?: string; tot?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }
    const actieId = (body.actie_id || "").trim();
    const tot = (body.tot || "").trim();
    if (!actieId || !tot) {
      return NextResponse.json({ error: "actie_id en tot verplicht" }, { status: 400 });
    }
    const totDate = new Date(tot);
    if (!Number.isFinite(totDate.getTime())) {
      return NextResponse.json({ error: "Ongeldige tot" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { error } = await sb.from("backoffice_actie_snooze").upsert(
      {
        actie_id: actieId,
        tot: totDate.toISOString(),
        adviseur_id: session.adviseurId || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "actie_id" }
    );
    if (error) {
      if (tableMissing(error)) {
        return NextResponse.json({ ok: true, skipped: true });
      }
      return NextResponse.json(
        { error: "Opslaan mislukt", detail: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, tot: totDate.toISOString() });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
