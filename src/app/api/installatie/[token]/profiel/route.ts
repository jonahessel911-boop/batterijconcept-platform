import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { normalizeMerkenErvaring } from "@/lib/installatie-merken";
import { uploadMonteurDocument } from "@/lib/monteur-dossier";
import {
  isBeheerderSession,
  resolveInstallatiePortal,
} from "@/lib/installatie-portal";

export const runtime = "nodejs";

const SELECT =
  "id, partner_id, naam, email, telefoon, actief, rol, kan_schouw, kan_installatie, leeftijd, merken_ervaring, foto_storage_path, foto_bestandsnaam, foto_uploaded_at, created_at, updated_at";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function publicRow(row: Record<string, unknown>) {
  const { password_hash: _ph, ...rest } = row as {
    password_hash?: unknown;
  } & Record<string, unknown>;
  void _ph;
  return rest;
}

/** GET — eigen monteurprofiel (alleen teamgenoot-sessie) */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const session = await resolveInstallatiePortal(token, req);
    if (!session || session.kind !== "teamgenoot") {
      return NextResponse.json(
        { error: "Alleen beschikbaar voor teamleden." },
        { status: 403 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("installatie_partner_teamgenoten")
      .select(SELECT)
      .eq("id", session.teamgenoot.id)
      .eq("partner_id", session.partner.id)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "Profiel niet gevonden" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      teamgenoot: publicRow(data as Record<string, unknown>),
      can_edit_rol: isBeheerderSession(session),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Profiel laden mislukt") },
      { status: 500 }
    );
  }
}

/** PATCH — teamlid vult eigen leeftijd / merken / foto / contact */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const session = await resolveInstallatiePortal(token, req);
    if (!session || session.kind !== "teamgenoot") {
      return NextResponse.json(
        { error: "Alleen beschikbaar voor teamleden." },
        { status: 403 }
      );
    }

    const id = session.teamgenoot.id;
    const partnerId = session.partner.id;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "Bestand (file) is verplicht" },
          { status: 400 }
        );
      }
      const sb = getSupabaseAdmin();
      const result = await uploadMonteurDocument(
        sb,
        partnerId,
        id,
        "foto",
        file
      );
      if ("error" in result) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }
      return NextResponse.json({
        teamgenoot: publicRow(
          result.teamgenoot as unknown as Record<string, unknown>
        ),
        foto_url: result.url,
      });
    }

    let body: {
      telefoon?: string | null;
      leeftijd?: number | string | null;
      merken_ervaring?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if ("telefoon" in body) patch.telefoon = pickStr(body.telefoon);

    if ("leeftijd" in body) {
      const leeftijdRaw =
        body.leeftijd === null ||
        body.leeftijd === undefined ||
        body.leeftijd === ""
          ? null
          : Number(body.leeftijd);
      const leeftijd =
        leeftijdRaw != null && Number.isFinite(leeftijdRaw)
          ? Math.round(leeftijdRaw)
          : null;
      if (leeftijd != null && (leeftijd < 16 || leeftijd > 99)) {
        return NextResponse.json(
          { error: "Leeftijd moet tussen 16 en 99 liggen" },
          { status: 400 }
        );
      }
      patch.leeftijd = leeftijd;
    }

    if ("merken_ervaring" in body) {
      patch.merken_ervaring = normalizeMerkenErvaring(body.merken_ervaring);
    }

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("installatie_partner_teamgenoten")
      .update(patch)
      .eq("id", id)
      .eq("partner_id", partnerId)
      .select(SELECT)
      .single();

    if (error) {
      if (
        error.code === "42703" ||
        error.message?.includes("leeftijd") ||
        error.message?.includes("merken_ervaring") ||
        error.message?.includes("does not exist")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer migrate-installatie-portal-auth.sql uit in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      teamgenoot: publicRow(data as Record<string, unknown>),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Profiel opslaan mislukt") },
      { status: 500 }
    );
  }
}
