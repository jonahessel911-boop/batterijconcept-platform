import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { uploadSollicitatieBestand } from "@/lib/sollicitatie-bestanden";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: row, error: existsErr } = await sb
      .from("sollicitaties")
      .select("id")
      .eq("id", id)
      .single();
    if (existsErr || !row) {
      return NextResponse.json(
        { error: "Sollicitatie niet gevonden" },
        { status: 404 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Bestand (file) is verplicht" },
        { status: 400 }
      );
    }

    const result = await uploadSollicitatieBestand(sb, id, file);
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Upload mislukt") },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const fileId = req.nextUrl.searchParams.get("file_id");
  if (!fileId) {
    return NextResponse.json({ error: "file_id is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("sollicitatie_bestanden")
      .select("id, sollicitatie_id, storage_path")
      .eq("id", fileId)
      .eq("sollicitatie_id", id)
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Bestand niet gevonden" }, { status: 404 });
    }

    await sb.storage.from("sollicitaties").remove([data.storage_path]);
    await sb.from("sollicitatie_bestanden").delete().eq("id", fileId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}
