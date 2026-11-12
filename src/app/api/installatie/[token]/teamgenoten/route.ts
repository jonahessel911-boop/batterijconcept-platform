import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { generatePassword, hashPassword } from "@/lib/auth-password";
import { normalizeMerkenErvaring } from "@/lib/installatie-merken";
import { normalizeMonteurRegios } from "@/lib/postcode-provincie";
import { uploadMonteurDocument } from "@/lib/monteur-dossier";
import {
  installatieLoginUrl,
  newInstallatiePortalToken,
  requirePartnerPortal,
  verstuurTeamgenootPortaalInvite,
} from "@/lib/installatie-portal";

export const runtime = "nodejs";

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("installatie_partner_teamgenoten") ||
    msg.includes("portal_token") ||
    msg.includes("password_hash") ||
    msg.includes("regios") ||
    msg.includes("schema cache") ||
    msg.includes("does not exist")
  );
}

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function normalizeRol(raw: unknown): "beheerder" | "monteur" {
  return raw === "beheerder" ? "beheerder" : "monteur";
}

const SELECT =
  "id, partner_id, naam, email, telefoon, actief, portal_token, invite_sent_at, rol, kan_schouw, kan_installatie, leeftijd, merken_ervaring, regios, foto_storage_path, foto_bestandsnaam, foto_uploaded_at, created_at, updated_at";
const SELECT_MIN =
  "id, partner_id, naam, email, telefoon, actief, portal_token, invite_sent_at, created_at, updated_at";
const SELECT_NO_REGIOS =
  "id, partner_id, naam, email, telefoon, actief, portal_token, invite_sent_at, rol, kan_schouw, kan_installatie, leeftijd, merken_ervaring, foto_storage_path, foto_bestandsnaam, foto_uploaded_at, created_at, updated_at";

function publicTeamgenoot(row: Record<string, unknown>) {
  const { password_hash: _ph, ...rest } = row as {
    password_hash?: unknown;
  } & Record<string, unknown>;
  void _ph;
  return rest;
}

/** GET /api/installatie/[token]/teamgenoten — alleen beheerder */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders beheren het team." },
        { status: 403 }
      );
    }

    const sb = getSupabaseAdmin();
    const full = await sb
      .from("installatie_partner_teamgenoten")
      .select(SELECT)
      .eq("partner_id", partner.id)
      .order("naam");

    let rows = full.data as Record<string, unknown>[] | null;
    let error = full.error;

    if (error && isMissingTable(error)) {
      const mid = await sb
        .from("installatie_partner_teamgenoten")
        .select(SELECT_NO_REGIOS)
        .eq("partner_id", partner.id)
        .order("naam");
      rows = mid.data as Record<string, unknown>[] | null;
      error = mid.error;
    }

    if (error && isMissingTable(error)) {
      const soft = await sb
        .from("installatie_partner_teamgenoten")
        .select(SELECT_MIN)
        .eq("partner_id", partner.id)
        .order("naam");
      rows = soft.data as Record<string, unknown>[] | null;
      error = soft.error;
      if (error && isMissingTable(error)) {
        return NextResponse.json({
          teamgenoten: [],
          migration_required: true,
          hint: "Voer supabase/migrate-partner-teamgenoten.sql, migrate-installatie-portal-auth.sql en migrate-teamgenoot-regios.sql uit.",
        });
      }
    }
    if (error) throw error;

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      teamgenoten: (rows || []).map((r) => publicTeamgenoot(r)),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoten laden mislukt") },
      { status: 500 }
    );
  }
}

/** POST — nieuwe medewerker + welkomstmail met wachtwoord */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders beheren het team." },
        { status: 403 }
      );
    }

    let body: {
      naam?: string;
      email?: string;
      telefoon?: string;
      rol?: string;
      kan_schouw?: boolean;
      kan_installatie?: boolean;
      leeftijd?: number | string | null;
      merken_ervaring?: unknown;
      regios?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    const naam = pickStr(body.naam);
    const email = pickStr(body.email)?.toLowerCase() || null;
    if (!naam) {
      return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
    }
    if (!email) {
      return NextResponse.json(
        { error: "E-mail is verplicht — hiernaar gaat de inlogmail." },
        { status: 400 }
      );
    }

    const rol = normalizeRol(body.rol);
    const kan_schouw = body.kan_schouw === true;
    const kan_installatie =
      body.kan_installatie === undefined ? true : body.kan_installatie === true;
    const leeftijdRaw =
      body.leeftijd === null || body.leeftijd === undefined || body.leeftijd === ""
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
    const merken_ervaring = normalizeMerkenErvaring(body.merken_ervaring);
    const regios = normalizeMonteurRegios(body.regios);

    const portal_token = newInstallatiePortalToken();
    const plainPassword = generatePassword(12);
    const password_hash = hashPassword(plainPassword);
    const sb = getSupabaseAdmin();

    const insertFull = {
      partner_id: partner.id,
      naam,
      email,
      telefoon: pickStr(body.telefoon),
      actief: true,
      portal_token,
      password_hash,
      rol,
      kan_schouw,
      kan_installatie,
      leeftijd,
      merken_ervaring,
      regios,
    };

    let { data, error } = await sb
      .from("installatie_partner_teamgenoten")
      .insert(insertFull)
      .select(SELECT)
      .single();

    if (error && isMissingTable(error)) {
      const { regios: _r, ...withoutRegios } = insertFull;
      void _r;
      ({ data, error } = await sb
        .from("installatie_partner_teamgenoten")
        .insert(withoutRegios)
        .select(SELECT_NO_REGIOS)
        .single());
    }

    if (error && isMissingTable(error)) {
      ({ data, error } = await sb
        .from("installatie_partner_teamgenoten")
        .insert({
          partner_id: partner.id,
          naam,
          email,
          telefoon: pickStr(body.telefoon),
          actief: true,
          portal_token,
        })
        .select(SELECT_MIN)
        .single());
      if (error && isMissingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-partner-teamgenoten.sql, migrate-installatie-portal-auth.sql en migrate-teamgenoot-regios.sql uit in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
    }
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Opslaan mislukt" }, { status: 500 });
    }

    const tgToken =
      (data as { portal_token?: string }).portal_token || portal_token;

    const invite = await verstuurTeamgenootPortaalInvite({
      teamgenoot: {
        id: data.id,
        naam: data.naam,
        email,
        portal_token: tgToken,
      },
      partnerNaam: partner.naam,
      password: plainPassword,
    });

    return NextResponse.json(
      {
        teamgenoot: publicTeamgenoot(data as Record<string, unknown>),
        invite_sent: invite.ok,
        invite_error: invite.ok ? null : invite.error || null,
        login_url: installatieLoginUrl(),
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoot toevoegen mislukt") },
      { status: 500 }
    );
  }
}

/** PATCH — update, deactiveren, of resend_invite */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders beheren het team." },
        { status: 403 }
      );
    }

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const id = pickStr(form.get("id"));
      const file = form.get("file");
      if (!id) {
        return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
      }
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: "Bestand (file) is verplicht" },
          { status: 400 }
        );
      }
      const sb = getSupabaseAdmin();
      const result = await uploadMonteurDocument(
        sb,
        partner.id,
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
        teamgenoot: publicTeamgenoot(
          result.teamgenoot as unknown as Record<string, unknown>
        ),
        foto_url: result.url,
      });
    }

    let body: {
      id?: string;
      naam?: string;
      email?: string | null;
      telefoon?: string | null;
      actief?: boolean;
      rol?: string;
      kan_schouw?: boolean;
      kan_installatie?: boolean;
      leeftijd?: number | string | null;
      merken_ervaring?: unknown;
      regios?: unknown;
      resend_invite?: boolean;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    const id = pickStr(body.id);
    if (!id) {
      return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();

    if (body.resend_invite === true) {
      let { data: tg, error } = await sb
        .from("installatie_partner_teamgenoten")
        .select(SELECT)
        .eq("id", id)
        .eq("partner_id", partner.id)
        .maybeSingle();

      if (error && isMissingTable(error)) {
        ({ data: tg, error } = await sb
          .from("installatie_partner_teamgenoten")
          .select(SELECT_MIN)
          .eq("id", id)
          .eq("partner_id", partner.id)
          .maybeSingle());
      }
      if (error) throw error;
      if (!tg) {
        return NextResponse.json(
          { error: "Teamgenoot niet gevonden" },
          { status: 404 }
        );
      }

      let portalToken = (tg as { portal_token?: string | null }).portal_token;
      if (!portalToken) {
        portalToken = newInstallatiePortalToken();
        await sb
          .from("installatie_partner_teamgenoten")
          .update({ portal_token: portalToken })
          .eq("id", id);
      }

      const email = (tg.email || "").trim().toLowerCase();
      if (!email) {
        return NextResponse.json(
          { error: "Geen e-mailadres — vul eerst e-mail in." },
          { status: 400 }
        );
      }

      const plainPassword = generatePassword(12);
      const password_hash = hashPassword(plainPassword);
      await sb
        .from("installatie_partner_teamgenoten")
        .update({ password_hash })
        .eq("id", id);

      const invite = await verstuurTeamgenootPortaalInvite({
        teamgenoot: {
          id: tg.id,
          naam: tg.naam,
          email,
          portal_token: portalToken,
        },
        partnerNaam: partner.naam,
        password: plainPassword,
      });

      return NextResponse.json({
        teamgenoot: publicTeamgenoot({
          ...(tg as Record<string, unknown>),
          portal_token: portalToken,
        }),
        invite_sent: invite.ok,
        invite_error: invite.ok ? null : invite.error || null,
        login_url: installatieLoginUrl(),
      });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.naam !== undefined) {
      const naam = pickStr(body.naam);
      if (!naam) {
        return NextResponse.json(
          { error: "Naam mag niet leeg zijn" },
          { status: 400 }
        );
      }
      patch.naam = naam;
    }
    if ("email" in body) patch.email = pickStr(body.email)?.toLowerCase() || null;
    if ("telefoon" in body) patch.telefoon = pickStr(body.telefoon);
    if (typeof body.actief === "boolean") patch.actief = body.actief;
    if (body.rol !== undefined) patch.rol = normalizeRol(body.rol);
    if (typeof body.kan_schouw === "boolean") patch.kan_schouw = body.kan_schouw;
    if (typeof body.kan_installatie === "boolean") {
      patch.kan_installatie = body.kan_installatie;
    }
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
    if ("regios" in body) {
      patch.regios = normalizeMonteurRegios(body.regios);
    }

    let { data, error } = await sb
      .from("installatie_partner_teamgenoten")
      .update(patch)
      .eq("id", id)
      .eq("partner_id", partner.id)
      .select(SELECT)
      .single();

    if (error && isMissingTable(error)) {
      const fallbackPatch = { ...patch };
      delete fallbackPatch.regios;
      ({ data, error } = await sb
        .from("installatie_partner_teamgenoten")
        .update(fallbackPatch)
        .eq("id", id)
        .eq("partner_id", partner.id)
        .select(SELECT_NO_REGIOS)
        .single());
    }

    if (error && isMissingTable(error)) {
      const fallbackPatch = { ...patch };
      delete fallbackPatch.rol;
      delete fallbackPatch.kan_schouw;
      delete fallbackPatch.kan_installatie;
      delete fallbackPatch.leeftijd;
      delete fallbackPatch.merken_ervaring;
      delete fallbackPatch.regios;
      ({ data, error } = await sb
        .from("installatie_partner_teamgenoten")
        .update(fallbackPatch)
        .eq("id", id)
        .eq("partner_id", partner.id)
        .select(SELECT_MIN)
        .single());
    }

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Voer migrate-installatie-portal-auth.sql en migrate-teamgenoot-regios.sql uit in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      teamgenoot: publicTeamgenoot(data as Record<string, unknown>),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoot bijwerken mislukt") },
      { status: 500 }
    );
  }
}

/** DELETE /api/installatie/[token]/teamgenoten?id=… */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders beheren het team." },
        { status: 403 }
      );
    }

    const id = req.nextUrl.searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("installatie_partner_teamgenoten")
      .delete()
      .eq("id", id)
      .eq("partner_id", partner.id);

    if (error) {
      if (isMissingTable(error)) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-partner-teamgenoten.sql uit in Supabase.",
            migration_required: true,
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Teamgenoot verwijderen mislukt") },
      { status: 500 }
    );
  }
}
