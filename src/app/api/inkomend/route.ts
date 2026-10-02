import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import {
  normalizeInkomendeFactuurStatus,
  signInkomendeFactuurBestanden,
} from "@/lib/inkomende-facturen";
import type {
  InkomendeFactuur,
  InkomendeFactuurBestand,
  InkomendeFactuurStatus,
} from "@/types/database";

export const runtime = "nodejs";

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  if (normalizeRol(session.rol) !== "admin") {
    return {
      error: NextResponse.json({ error: "Alleen admin" }, { status: 403 }),
    };
  }
  return { session };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const status = req.nextUrl.searchParams.get("status")?.trim() || "";
  const limit = Math.min(
    200,
    Math.max(1, Number(req.nextUrl.searchParams.get("limit") || 80) || 80)
  );

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("inkomende_facturen")
      .select(
        "id, postmark_message_id, from_email, from_name, to_email, subject, body_text, received_at, status, leverancier, bedrag_ex_btw, btw_bedrag, bedrag_inc_btw, factuurdatum, project_id, notitie, created_at, updated_at, inkomende_factuur_bestanden(id, inkomende_factuur_id, storage_path, bestandsnaam, mime_type, grootte_bytes, content_id, created_at)"
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      q = q.eq("status", normalizeInkomendeFactuurStatus(status));
    }

    const { data, error } = await q;
    if (error) {
      return NextResponse.json(
        { error: "Laden mislukt", detail: error.message },
        { status: 500 }
      );
    }

    const items: InkomendeFactuur[] = await Promise.all(
      ((data || []) as Array<
        InkomendeFactuur & {
          inkomende_factuur_bestanden?: InkomendeFactuurBestand[];
        }
      >).map(async (row) => {
        const rawBestanden = row.inkomende_factuur_bestanden || [];
        const bestanden = await signInkomendeFactuurBestanden(
          sb,
          rawBestanden
        );
        const { inkomende_factuur_bestanden: _, ...rest } = row;
        return { ...rest, bestanden };
      })
    );

    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json(
      { error: "Laden mislukt", detail: errMessage(e) },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  let body: {
    id?: string;
    status?: InkomendeFactuurStatus;
    notitie?: string | null;
    leverancier?: string | null;
    factuurdatum?: string | null;
    bedrag_ex_btw?: number | null;
    btw_bedrag?: number | null;
    bedrag_inc_btw?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id verplicht" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.status !== undefined) {
    patch.status = normalizeInkomendeFactuurStatus(body.status);
  }
  if (body.notitie !== undefined) {
    patch.notitie =
      typeof body.notitie === "string" ? body.notitie.trim() || null : null;
  }
  if (body.leverancier !== undefined) {
    patch.leverancier =
      typeof body.leverancier === "string"
        ? body.leverancier.trim() || null
        : null;
  }
  if (body.factuurdatum !== undefined) {
    const d =
      typeof body.factuurdatum === "string" ? body.factuurdatum.trim() : "";
    patch.factuurdatum = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
  }
  for (const key of [
    "bedrag_ex_btw",
    "btw_bedrag",
    "bedrag_inc_btw",
  ] as const) {
    if (body[key] !== undefined) {
      const n = body[key];
      patch[key] =
        typeof n === "number" && Number.isFinite(n)
          ? Math.round(n * 100) / 100
          : null;
    }
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("inkomende_facturen")
      .update(patch)
      .eq("id", id)
      .select(
        "id, postmark_message_id, from_email, from_name, to_email, subject, body_text, received_at, status, leverancier, bedrag_ex_btw, btw_bedrag, bedrag_inc_btw, factuurdatum, project_id, notitie, created_at, updated_at"
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: "Opslaan mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ item: data as InkomendeFactuur });
  } catch (e) {
    return NextResponse.json(
      { error: "Opslaan mislukt", detail: errMessage(e) },
      { status: 500 }
    );
  }
}
