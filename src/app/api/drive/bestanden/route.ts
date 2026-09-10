import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { signDriveUrls, uploadDrivePdf, type DriveBestand } from "@/lib/drive";

export const runtime = "nodejs";

async function sessionAdviseurId(): Promise<string | null> {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  return session?.adviseurId || null;
}

/** GET /api/drive/bestanden?map_id=... — bestanden in map (null = root) */
export async function GET(req: NextRequest) {
  try {
    const mapRaw = req.nextUrl.searchParams.get("map_id");
    const mapId =
      mapRaw && mapRaw !== "null" && mapRaw !== "" ? mapRaw : null;

    const sb = getSupabaseAdmin();
    let q = sb
      .from("drive_bestanden")
      .select(
        "id, map_id, naam, storage_path, bestandsnaam, mime_type, grootte_bytes, uploaded_by, created_at, updated_at"
      )
      .order("naam", { ascending: true });

    if (mapId) q = q.eq("map_id", mapId);
    else q = q.is("map_id", null);

    const { data, error } = await q;
    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("drive_bestanden")
      ) {
        return NextResponse.json({
          bestanden: [] as DriveBestand[],
          skipped: true,
          detail: "Voer supabase/migrate-drive.sql uit",
        });
      }
      return NextResponse.json(
        { error: "Laden mislukt", detail: error.message },
        { status: 500 }
      );
    }

    const withUrls = await signDriveUrls(sb, (data || []) as DriveBestand[]);
    return NextResponse.json({ bestanden: withUrls });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/drive/bestanden — multipart: file, naam?, map_id? */
export async function POST(req: NextRequest) {
  try {
    const adviseurId = await sessionAdviseurId();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Geen bestand" }, { status: 400 });
    }

    const mapRaw = form.get("map_id");
    const mapId =
      typeof mapRaw === "string" && mapRaw && mapRaw !== "null"
        ? mapRaw
        : null;
    if (!mapId) {
      return NextResponse.json(
        { error: "Kies eerst een map om in te uploaden" },
        { status: 400 }
      );
    }
    const naamRaw = form.get("naam");
    const displayName =
      typeof naamRaw === "string" && naamRaw.trim()
        ? naamRaw.trim()
        : file.name.replace(/\.pdf$/i, "") || "Document";

    const sb = getSupabaseAdmin();

    const { data: map, error: mErr } = await sb
      .from("drive_mappen")
      .select("id")
      .eq("id", mapId)
      .maybeSingle();
    if (mErr || !map) {
      return NextResponse.json(
        { error: "Map niet gevonden" },
        { status: 404 }
      );
    }

    const result = await uploadDrivePdf(sb, {
      mapId,
      displayName,
      file,
      uploadedBy: adviseurId,
    });

    if ("error" in result) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }

    return NextResponse.json({ bestand: result.bestand });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
