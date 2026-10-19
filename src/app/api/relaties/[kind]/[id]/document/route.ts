import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import {
  RELATIE_CONTRACT_BUCKET,
  signedContractUrl,
  type RelatieKind,
} from "@/lib/relatie-contract";
import { logRelatieActiviteit } from "@/lib/relatie-activiteit";
import {
  parseRelatieDocType,
  relatieDocMeta,
  uploadRelatieDocument,
} from "@/lib/relatie-document";

export const runtime = "nodejs";

function parseKind(raw: string): RelatieKind | null {
  if (raw === "adviseur" || raw === "partner") return raw;
  return null;
}

function tableFor(kind: RelatieKind): string {
  return kind === "adviseur" ? "adviseurs" : "installatie_partners";
}

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) return { error: "Niet ingelogd", status: 401 as const };
  const sb = getSupabaseAdmin();
  const { data: adv } = await sb
    .from("adviseurs")
    .select("rol, naam, email")
    .eq("id", session.adviseurId)
    .maybeSingle();
  const email = adv?.email ?? session.email;
  const naam = adv?.naam || session.naam;
  const rol = normalizeRol(adv?.rol || session.rol);
  const mag =
    rol === "admin" ||
    isAdminEmail(email) ||
    isAdminAdviseur({ naam, email });
  if (!mag) {
    return { error: "Alleen admin", status: 403 as const };
  }
  return { sb, session };
}

/**
 * GET /api/relaties/[kind]/[id]/document?type=kvk_uitreksel|certificaten
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind: kindRaw, id } = await ctx.params;
  const kind = parseKind(kindRaw);
  const docType = parseRelatieDocType(req.nextUrl.searchParams.get("type"));
  if (!kind || !docType) {
    return NextResponse.json({ error: "Ongeldig type" }, { status: 400 });
  }

  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const meta = relatieDocMeta(docType);
    const { data, error } = await auth.sb
      .from(tableFor(kind))
      .select([meta.path, meta.name, meta.at].join(", "))
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (error.code === "42703" || error.message?.includes(meta.path)) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-relatie-onboarding.sql uit in Supabase",
          },
          { status: 503 }
        );
      }
      throw error;
    }
    if (!data) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    const row = data as unknown as Record<string, string | null>;
    const path = row[meta.path];
    const url = await signedContractUrl(auth.sb, path);
    return NextResponse.json({
      bestandsnaam: row[meta.name],
      uploaded_at: row[meta.at],
      storage_path: path,
      url,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Document laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/relaties/[kind]/[id]/document?type=…
 * multipart file
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind: kindRaw, id } = await ctx.params;
  const kind = parseKind(kindRaw);
  const docType = parseRelatieDocType(req.nextUrl.searchParams.get("type"));
  if (!kind || !docType) {
    return NextResponse.json({ error: "Ongeldig type" }, { status: 400 });
  }

  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Geen bestand" }, { status: 400 });
    }
    const result = await uploadRelatieDocument(
      auth.sb,
      kind,
      id,
      docType,
      file
    );
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }

    const meta = relatieDocMeta(docType);
    await logRelatieActiviteit(auth.sb, {
      kind,
      relatieId: id,
      soort: docType,
      titel: `${meta.label} geüpload`,
      detail: result.bestandsnaam,
      createdBy: auth.session.adviseurId,
    });

    return NextResponse.json({
      ok: true,
      ...result.fields,
      url: result.url,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Upload mislukt") },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/relaties/[kind]/[id]/document?type=…
 */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind: kindRaw, id } = await ctx.params;
  const kind = parseKind(kindRaw);
  const docType = parseRelatieDocType(req.nextUrl.searchParams.get("type"));
  if (!kind || !docType) {
    return NextResponse.json({ error: "Ongeldig type" }, { status: 400 });
  }

  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const meta = relatieDocMeta(docType);
    const { data, error } = await auth.sb
      .from(tableFor(kind))
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    const path = (data as unknown as Record<string, string | null>)[meta.path];
    if (path) {
      await auth.sb.storage.from(RELATIE_CONTRACT_BUCKET).remove([path]);
    }
    await auth.sb
      .from(tableFor(kind))
      .update({
        [meta.path]: null,
        [meta.name]: null,
        [meta.at]: null,
      })
      .eq("id", id);

    await logRelatieActiviteit(auth.sb, {
      kind,
      relatieId: id,
      soort: `${docType}_verwijderd`,
      titel: `${meta.label} verwijderd`,
      createdBy: auth.session.adviseurId,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}
