import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireBackofficeSession } from "@/lib/auth-require-backoffice";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";

function parseDueAt(raw: unknown): string | null {
  if (raw === null) return null;
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

async function loadItem(id: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("bo_agenda")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** PATCH /api/bo-agenda/[id] */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireBackofficeSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { id } = await ctx.params;

  try {
    const existing = await loadItem(id);
    if (!existing) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    if (
      normalizeRol(auth.session.rol) === "backoffice" &&
      existing.adviseur_id !== auth.session.adviseurId
    ) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const body = (await req.json()) as {
      titel?: string;
      inhoud?: string | null;
      start_at?: string;
      end_at?: string | null;
      soort?: string;
      status?: string;
    };

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.titel !== undefined) {
      const t = body.titel.trim();
      if (!t) {
        return NextResponse.json(
          { error: "Titel is verplicht" },
          { status: 400 }
        );
      }
      patch.titel = t;
    }
    if (body.inhoud !== undefined) {
      patch.inhoud = body.inhoud?.trim() || null;
    }
    if (body.soort === "taak" || body.soort === "afspraak") {
      patch.soort = body.soort;
    }
    if (body.start_at !== undefined) {
      const s = parseDueAt(body.start_at);
      if (!s) {
        return NextResponse.json(
          { error: "Ongeldige start_at" },
          { status: 400 }
        );
      }
      patch.start_at = s;
    }
    if (body.end_at !== undefined) {
      patch.end_at = parseDueAt(body.end_at);
    }
    if (body.status === "todo" || body.status === "done") {
      patch.status = body.status;
      patch.completed_at =
        body.status === "done" ? new Date().toISOString() : null;
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("bo_agenda")
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
    return NextResponse.json({ item: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** DELETE /api/bo-agenda/[id] */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireBackofficeSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { id } = await ctx.params;

  try {
    const existing = await loadItem(id);
    if (!existing) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    if (
      normalizeRol(auth.session.rol) === "backoffice" &&
      existing.adviseur_id !== auth.session.adviseurId
    ) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const sb = getSupabaseAdmin();
    const { error } = await sb.from("bo_agenda").delete().eq("id", id);
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
