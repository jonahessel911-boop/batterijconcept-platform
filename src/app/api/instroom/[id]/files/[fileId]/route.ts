import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

function safeFilename(name: string): string {
  return name.replace(/[\r\n"]/g, "").trim() || "cv.pdf";
}

/** GET /api/instroom/:id/files/:fileId — download CV/PDF (sessie). */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; fileId: string }> }
) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id, fileId } = await ctx.params;
  if (!id || !fileId) {
    return NextResponse.json({ error: "Bestand ontbreekt" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("sollicitatie_bestanden")
      .select("id, sollicitatie_id, storage_path, bestandsnaam, mime_type")
      .eq("id", fileId)
      .eq("sollicitatie_id", id)
      .maybeSingle();

    if (error) throw error;
    if (!row?.storage_path) {
      return NextResponse.json(
        { error: "Bestand niet gevonden" },
        { status: 404 }
      );
    }

    const { data: blob, error: dlErr } = await sb.storage
      .from("sollicitaties")
      .download(row.storage_path);
    if (dlErr || !blob) {
      return NextResponse.json(
        { error: dlErr?.message || "Download mislukt" },
        { status: 404 }
      );
    }

    const bytes = Buffer.from(await blob.arrayBuffer());
    const filename = safeFilename(row.bestandsnaam || "cv.pdf");
    const mime =
      row.mime_type ||
      (/\.pdf$/i.test(filename) ? "application/pdf" : "application/octet-stream");

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Download mislukt") },
      { status: 500 }
    );
  }
}
