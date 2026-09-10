import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import type { DriveMap } from "@/lib/drive-types";

export const runtime = "nodejs";

async function sessionAdviseurId(): Promise<string | null> {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  return session?.adviseurId || null;
}

/** GET /api/drive/mappen?parent_id=... — lijst mappen in map (null = root) */
export async function GET(req: NextRequest) {
  try {
    const parentRaw = req.nextUrl.searchParams.get("parent_id");
    const parentId = parentRaw && parentRaw !== "null" && parentRaw !== ""
      ? parentRaw
      : null;

    const sb = getSupabaseAdmin();
    let q = sb
      .from("drive_mappen")
      .select("id, parent_id, naam, created_by, created_at, updated_at")
      .order("naam", { ascending: true });

    if (parentId) q = q.eq("parent_id", parentId);
    else q = q.is("parent_id", null);

    const { data, error } = await q;
    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("drive_mappen")
      ) {
        return NextResponse.json({
          mappen: [] as DriveMap[],
          skipped: true,
          detail: "Voer supabase/migrate-drive.sql uit",
        });
      }
      return NextResponse.json(
        { error: "Laden mislukt", detail: error.message },
        { status: 500 }
      );
    }
    return NextResponse.json({ mappen: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/drive/mappen — { naam, parent_id? } */
export async function POST(req: NextRequest) {
  try {
    const adviseurId = await sessionAdviseurId();
    let body: { naam?: string; parent_id?: string | null };
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

    const parentId = body.parent_id || null;
    const sb = getSupabaseAdmin();

    if (parentId) {
      const { data: parent, error: pErr } = await sb
        .from("drive_mappen")
        .select("id")
        .eq("id", parentId)
        .maybeSingle();
      if (pErr || !parent) {
        return NextResponse.json(
          { error: "Bovenliggende map niet gevonden" },
          { status: 404 }
        );
      }
    }

    const { data, error } = await sb
      .from("drive_mappen")
      .insert({
        naam,
        parent_id: parentId,
        created_by: adviseurId,
      })
      .select("id, parent_id, naam, created_by, created_at, updated_at")
      .single();

    if (error || !data) {
      if (
        error?.code === "42P01" ||
        error?.message?.includes("drive_mappen")
      ) {
        return NextResponse.json(
          {
            error: "Drive-tabellen ontbreken",
            detail: "Voer supabase/migrate-drive.sql uit in Supabase",
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: "Aanmaken mislukt", detail: error?.message },
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
