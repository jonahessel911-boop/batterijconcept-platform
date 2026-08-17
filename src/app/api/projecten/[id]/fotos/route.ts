import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { randomBytes } from "crypto";

export const runtime = "nodejs";

/** GET /api/projecten/[id]/fotos */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: fotos, error } = await sb
      .from("project_fotos")
      .select("id, project_id, storage_path, bestandsnaam, omschrijving, created_at")
      .eq("project_id", id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const paths = (fotos || []).map((f) => f.storage_path);
    const urlMap = new Map<string, string>();
    if (paths.length > 0) {
      const { data: signed } = await sb.storage
        .from("project-fotos")
        .createSignedUrls(paths, 60 * 60 * 6);
      for (const item of signed || []) {
        if (item.path && item.signedUrl) {
          urlMap.set(item.path, item.signedUrl);
        }
      }
    }

    return NextResponse.json({
      fotos: (fotos || []).map((f) => ({
        ...f,
        url: urlMap.get(f.storage_path) || null,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/projecten/[id]/fotos — multipart form: file + optional omschrijving */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: project, error: projErr } = await sb
      .from("projecten")
      .select("id")
      .eq("id", id)
      .single();
    if (projErr || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const omschrijving = String(form.get("omschrijving") || "").trim() || null;

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Bestand (file) is verplicht" },
        { status: 400 }
      );
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "Alleen afbeeldingen zijn toegestaan" },
        { status: 400 }
      );
    }

    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json(
        { error: "Bestand mag max. 8 MB zijn" },
        { status: 400 }
      );
    }

    const ext =
      file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
      "jpg";
    const storage_path = `${id}/${Date.now()}-${randomBytes(4).toString("hex")}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadErr } = await sb.storage
      .from("project-fotos")
      .upload(storage_path, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadErr) {
      return NextResponse.json(
        {
          error: "Upload mislukt",
          detail: uploadErr.message,
        },
        { status: 500 }
      );
    }

    const { data: row, error: insertErr } = await sb
      .from("project_fotos")
      .insert({
        project_id: id,
        storage_path,
        bestandsnaam: file.name,
        omschrijving,
      })
      .select("id, project_id, storage_path, bestandsnaam, omschrijving, created_at")
      .single();

    if (insertErr || !row) {
      return NextResponse.json(
        { error: insertErr?.message || "Opslaan mislukt" },
        { status: 500 }
      );
    }

    const { data: signed } = await sb.storage
      .from("project-fotos")
      .createSignedUrl(storage_path, 60 * 60 * 6);

    return NextResponse.json(
      { foto: { ...row, url: signed?.signedUrl || null } },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** DELETE /api/projecten/[id]/fotos?foto_id= */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const fotoId = req.nextUrl.searchParams.get("foto_id");
  if (!fotoId) {
    return NextResponse.json({ error: "foto_id is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: foto, error } = await sb
      .from("project_fotos")
      .select("id, storage_path, project_id")
      .eq("id", fotoId)
      .eq("project_id", id)
      .single();

    if (error || !foto) {
      return NextResponse.json({ error: "Foto niet gevonden" }, { status: 404 });
    }

    await sb.storage.from("project-fotos").remove([foto.storage_path]);
    await sb.from("project_fotos").delete().eq("id", fotoId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
