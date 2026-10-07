import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const runtime = "nodejs";

type Soort = "taak" | "afspraak";

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

function parseSoort(raw: unknown): Soort {
  return raw === "afspraak" ? "afspraak" : "taak";
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

/** POST /api/admin-taken — { titel, inhoud?, due_at, end_at?, soort? } */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  try {
    const body = (await req.json()) as {
      titel?: string;
      inhoud?: string | null;
      due_at?: string;
      end_at?: string | null;
      soort?: string;
    };
    const titel = body.titel?.trim() || "";
    const inhoud = body.inhoud?.trim() || null;
    const soort = parseSoort(body.soort);
    const dueAt = parseDueAt(body.due_at);

    if (!titel) {
      return NextResponse.json({ error: "Titel is verplicht" }, { status: 400 });
    }
    if (!dueAt) {
      return NextResponse.json(
        {
          error:
            soort === "afspraak"
              ? "Starttijd is verplicht"
              : "Deadline (datum + tijd) is verplicht",
        },
        { status: 400 }
      );
    }

    let endAt: string | null = null;
    if (soort === "afspraak") {
      endAt = parseDueAt(body.end_at);
      if (!endAt) {
        // Default: 1 uur na start
        endAt = new Date(new Date(dueAt).getTime() + 60 * 60 * 1000).toISOString();
      }
      if (new Date(endAt).getTime() <= new Date(dueAt).getTime()) {
        return NextResponse.json(
          { error: "Eindtijd moet na de starttijd liggen" },
          { status: 400 }
        );
      }
    }

    const sb = getSupabaseAdmin();
    const row: Record<string, unknown> = {
      titel,
      inhoud,
      due_at: dueAt,
      status: "todo",
      created_by_id: auth.session!.adviseurId,
    };

    // soort/end_at: graceful als migratie nog niet gedraaid is
    row.soort = soort;
    row.end_at = endAt;

    let { data, error } = await sb
      .from("admin_taken")
      .insert(row)
      .select("*")
      .single();

    if (
      error &&
      (error.message?.includes("soort") ||
        error.message?.includes("end_at") ||
        error.code === "42703")
    ) {
      const { soort: _s, end_at: _e, ...withoutSoort } = row;
      const retry = await sb
        .from("admin_taken")
        .insert(withoutSoort)
        .select("*")
        .single();
      data = retry.data;
      error = retry.error;
      if (!error && soort === "afspraak") {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-admin-taken-afspraak.sql uit om afspraken op te slaan.",
          },
          { status: 500 }
        );
      }
    }

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
