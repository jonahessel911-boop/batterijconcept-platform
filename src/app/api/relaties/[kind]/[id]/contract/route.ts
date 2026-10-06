import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import {
  signedContractUrl,
  uploadRelatieContract,
  type RelatieKind,
} from "@/lib/relatie-contract";

export const runtime = "nodejs";

function parseKind(raw: string): RelatieKind | null {
  if (raw === "adviseur" || raw === "partner") return raw;
  return null;
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
 * GET /api/relaties/[kind]/[id]/contract — signed download-URL
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind: kindRaw, id } = await ctx.params;
  const kind = parseKind(kindRaw);
  if (!kind) {
    return NextResponse.json({ error: "Ongeldig type" }, { status: 400 });
  }

  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const table = kind === "adviseur" ? "adviseurs" : "installatie_partners";
    const { data, error } = await auth.sb
      .from(table)
      .select("contract_storage_path, contract_bestandsnaam, contract_uploaded_at")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (
        error.code === "42703" ||
        error.message?.includes("contract_storage_path")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-relatie-gegevens-contract.sql uit in Supabase",
          },
          { status: 503 }
        );
      }
      throw error;
    }
    if (!data) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    const url = await signedContractUrl(
      auth.sb,
      data.contract_storage_path as string | null
    );
    return NextResponse.json({
      contract_bestandsnaam: data.contract_bestandsnaam,
      contract_uploaded_at: data.contract_uploaded_at,
      url,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/relaties/[kind]/[id]/contract — multipart file
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind: kindRaw, id } = await ctx.params;
  const kind = parseKind(kindRaw);
  if (!kind) {
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
      return NextResponse.json(
        { error: "Bestand (file) is verplicht" },
        { status: 400 }
      );
    }
    const result = await uploadRelatieContract(auth.sb, kind, id, file);
    if ("error" in result) {
      return NextResponse.json(
        { error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
