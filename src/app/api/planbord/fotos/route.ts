import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlanbordFoto = {
  project_id: string;
  omschrijving: string | null;
  bestandsnaam: string | null;
  storage_path: string | null;
  created_at: string;
  url: string | null;
};

/** GET /api/planbord/fotos?ids=uuid,uuid — één signed-url-ronde voor het planbord. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("ids") || "";
  const ids = [
    ...new Set(
      raw
        .split(",")
        .map((id) => id.trim())
        .filter((id) => UUID_RE.test(id))
    ),
  ].slice(0, 80);
  if (ids.length === 0) {
    return NextResponse.json({ fotos: [] as PlanbordFoto[] });
  }
  try {
    const sb = getSupabaseAdmin();
    const { data: fotos, error } = await sb
      .from("project_fotos")
      .select(
        "project_id, storage_path, bestandsnaam, omschrijving, created_at"
      )
      .in("project_id", ids)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const paths = [...new Set((fotos || []).map((f) => f.storage_path).filter(Boolean))];
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
      })) as PlanbordFoto[],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
