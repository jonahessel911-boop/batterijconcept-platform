import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { deleteDriveBestand } from "@/lib/drive";

export const runtime = "nodejs";

/** PATCH /api/drive/bestanden/[id] — hernoemen { naam } */
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
    const naam = (body.naam || "").trim().replace(/\.pdf$/i, "");
    if (!naam) {
      return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
    }
    if (naam.length > 160) {
      return NextResponse.json(
        { error: "Naam mag max. 160 tekens zijn" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("drive_bestanden")
      .update({ naam, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select(
        "id, map_id, naam, storage_path, bestandsnaam, mime_type, grootte_bytes, uploaded_by, created_at, updated_at"
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Hernoemen mislukt", detail: error?.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ bestand: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** DELETE /api/drive/bestanden/[id] */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("drive_bestanden")
      .select("id, storage_path")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json(
        { error: "Bestand niet gevonden" },
        { status: 404 }
      );
    }

    const result = await deleteDriveBestand(sb, data);
    if (result.error) {
      return NextResponse.json(
        { error: "Verwijderen mislukt", detail: result.error },
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
