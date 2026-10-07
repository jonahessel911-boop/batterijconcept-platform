import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const runtime = "nodejs";

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) return { error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }) };
  if (normalizeRol(session.rol) !== "admin") {
    return { error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }) };
  }
  return { session };
}

function parseDueAt(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
  // datetime-local: YYYY-MM-DDTHH:mm → Amsterdam
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const local = v.length === 16 ? `${v}:00` : v.slice(0, 19);
    const d = fromZonedTime(local, AMSTERDAM_TZ);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/** GET /api/admin-taken?open=1 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const openOnly = req.nextUrl.searchParams.get("open") !== "0";

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("admin_taken")
      .select("*")
      .order("due_at", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(500);

    if (openOnly) q = q.eq("status", "todo");

    const { data, error } = await q;
    if (error) {
      if (error.code === "42P01" || error.message?.includes("admin_taken")) {
        return NextResponse.json({
          taken: [],
          error: "Voer supabase/migrate-admin-taken.sql uit in Supabase.",
        });
      }
      return NextResponse.json(
        { error: "Laden mislukt", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ taken: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/admin-taken — { titel, inhoud?, due_at } */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = (await req.json()) as {
      titel?: string;
      inhoud?: string | null;
      due_at?: string;
    };
    const titel = body.titel?.trim() || "";
    const inhoud = body.inhoud?.trim() || null;
    const dueAt = parseDueAt(body.due_at);

    if (!titel) {
      return NextResponse.json({ error: "Titel is verplicht" }, { status: 400 });
    }
    if (!dueAt) {
      return NextResponse.json(
        { error: "Deadline (datum + tijd) is verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("admin_taken")
      .insert({
        titel,
        inhoud,
        due_at: dueAt,
        status: "todo",
        created_by_id: auth.session!.adviseurId,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "42P01" || error.message?.includes("admin_taken")) {
        return NextResponse.json(
          {
            error: "Voer supabase/migrate-admin-taken.sql uit in Supabase.",
            detail: error.message,
          },
          { status: 500 }
        );
      }
      return NextResponse.json(
        { error: "Aanmaken mislukt", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ taak: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
