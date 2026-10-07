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
  if (!session) {
    return { error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }) };
  }
  if (normalizeRol(session.rol) !== "admin") {
    return { error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }) };
  }
  return { session };
}

function parseDueAt(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
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

/** PATCH /api/admin-taken/[id] */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;

  try {
    const body = (await req.json()) as {
      titel?: string;
      inhoud?: string | null;
      due_at?: string;
      end_at?: string | null;
      soort?: string;
      status?: string;
    };

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.titel === "string") {
      const t = body.titel.trim();
      if (!t) {
        return NextResponse.json({ error: "Titel is verplicht" }, { status: 400 });
      }
      patch.titel = t;
    }
    if ("inhoud" in body) {
      patch.inhoud =
        typeof body.inhoud === "string" ? body.inhoud.trim() || null : null;
    }
    if (body.soort === "taak" || body.soort === "afspraak") {
      patch.soort = body.soort;
      if (body.soort === "taak") patch.end_at = null;
    }
    if ("due_at" in body) {
      const due = parseDueAt(body.due_at);
      if (!due) {
        return NextResponse.json(
          { error: "Ongeldige datum/tijd" },
          { status: 400 }
        );
      }
      patch.due_at = due;
    }
    if ("end_at" in body) {
      if (body.end_at == null || body.end_at === "") {
        patch.end_at = null;
      } else {
        const end = parseDueAt(body.end_at);
        if (!end) {
          return NextResponse.json(
            { error: "Ongeldige eindtijd" },
            { status: 400 }
          );
        }
        patch.end_at = end;
      }
    }
    if (body.status === "todo" || body.status === "done") {
      patch.status = body.status;
      patch.completed_at =
        body.status === "done" ? new Date().toISOString() : null;
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("admin_taken")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: "Bijwerken mislukt", detail: error.message },
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

/** DELETE /api/admin-taken/[id] */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { id } = await ctx.params;

  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("admin_taken").delete().eq("id", id);
    if (error) {
      return NextResponse.json(
        { error: "Verwijderen mislukt", detail: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
