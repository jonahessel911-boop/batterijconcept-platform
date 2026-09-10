import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { DRIVE_BUCKET } from "@/lib/drive";

export const runtime = "nodejs";

/** GET /api/drive/mappen/[id] — map + breadcrumb pad */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: map, error } = await sb
      .from("drive_mappen")
      .select("id, parent_id, naam, created_by, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();

    if (error || !map) {
      return NextResponse.json({ error: "Map niet gevonden" }, { status: 404 });
    }

    const path: { id: string; naam: string }[] = [
      { id: map.id, naam: map.naam },
    ];
    let parentId = map.parent_id as string | null;
    for (let i = 0; i < 40 && parentId; i++) {
      const { data: parent } = await sb
        .from("drive_mappen")
        .select("id, parent_id, naam")
        .eq("id", parentId)
        .maybeSingle();
      if (!parent) break;
      path.unshift({ id: parent.id, naam: parent.naam });
      parentId = parent.parent_id;
    }

    return NextResponse.json({ map, path });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH /api/drive/mappen/[id] — hernoemen { naam } */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    let body: { naam?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }
    const naam = (body.naam || "").trim();
    if (!naam) {
      return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
    }
    if (naam.length > 120) {
      return NextResponse.json(
        { error: "Naam mag max. 120 tekens zijn" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("drive_mappen")
      .update({ naam, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id, parent_id, naam, created_by, created_at, updated_at")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Hernoemen mislukt", detail: error?.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ map: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** DELETE /api/drive/mappen/[id] — map + nested bestanden/mappen */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();

    const allMapIds = [id];
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift()!;
      const { data: kids } = await sb
        .from("drive_mappen")
        .select("id")
        .eq("parent_id", cur);
      for (const k of kids || []) {
        allMapIds.push(k.id);
        queue.push(k.id);
      }
    }

    const { data: files } = await sb
      .from("drive_bestanden")
      .select("id, storage_path")
      .in("map_id", allMapIds);

    const paths = (files || []).map((f) => f.storage_path).filter(Boolean);
    if (paths.length) {
      await sb.storage.from(DRIVE_BUCKET).remove(paths);
    }

    const { error } = await sb.from("drive_mappen").delete().eq("id", id);
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
