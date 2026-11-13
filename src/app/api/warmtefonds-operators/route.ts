import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  generatePassword,
  hashPassword,
} from "@/lib/auth-password";
import { verstuurWarmtefondsAccountInvite } from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

const FIELDS =
  "id, naam, email, telefoon, actief, portal_token, tarief_inc, created_at, updated_at";
const FIELDS_MIN =
  "id, naam, email, telefoon, actief, portal_token, created_at, updated_at";

function isMissingColumn(
  error: { message?: string; code?: string } | null,
  col: string
) {
  return Boolean(
    error &&
      (error.code === "42703" ||
        error.message?.includes(col) ||
        error.code === "PGRST204")
  );
}

/** GET /api/warmtefonds-operators */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const includeInactive =
      req.nextUrl.searchParams.get("include_inactive") === "1";

    let query = sb
      .from("warmtefonds_operators")
      .select(FIELDS)
      .order("naam");
    if (!includeInactive) query = query.eq("actief", true);

    let { data, error } = await query;
    if (isMissingColumn(error, "tarief_inc")) {
      let fallback = sb
        .from("warmtefonds_operators")
        .select(FIELDS_MIN)
        .order("naam");
      if (!includeInactive) fallback = fallback.eq("actief", true);
      const soft = await fallback;
      data = soft.data as typeof data;
      error = soft.error;
    }
    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("warmtefonds_operators")
      ) {
        return NextResponse.json({
          operators: [],
          error:
            "Tabel warmtefonds_operators ontbreekt — draai migrate-warmtefonds-portaal.sql",
        });
      }
      throw error;
    }
    return NextResponse.json({ operators: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/warmtefonds-operators — nieuw account + welkomstmail */
export async function POST(req: NextRequest) {
  let body: {
    naam?: string;
    email?: string;
    telefoon?: string;
    tarief_inc?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const naam = body.naam?.trim();
  const email = body.email?.trim().toLowerCase();
  if (!naam) {
    return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "E-mail is verplicht" }, { status: 400 });
  }

  let tariefInc: number | null = null;
  if (body.tarief_inc !== undefined && body.tarief_inc !== null) {
    const n = Number(body.tarief_inc);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json(
        { error: "Ongeldig tarief" },
        { status: 400 }
      );
    }
    tariefInc = Math.round(n * 100) / 100;
  }

  try {
    const sb = getSupabaseAdmin();
    const portal_token = randomBytes(24).toString("hex");
    const password = generatePassword(12);
    const password_hash = hashPassword(password);

    const insertRow: Record<string, unknown> = {
      naam,
      email,
      telefoon: body.telefoon?.trim() || null,
      portal_token,
      actief: true,
      tarief_inc: tariefInc,
      password_hash,
    };

    let { data, error } = await sb
      .from("warmtefonds_operators")
      .insert(insertRow)
      .select(FIELDS)
      .single();

    if (isMissingColumn(error, "password_hash")) {
      return NextResponse.json(
        {
          error:
            "Voer migrate-warmtefonds-operator-accounts.sql uit in Supabase (wachtwoord-kolom).",
          migration_required: true,
        },
        { status: 503 }
      );
    }
    if (isMissingColumn(error, "tarief_inc")) {
      delete insertRow.tarief_inc;
      ({ data, error } = await sb
        .from("warmtefonds_operators")
        .insert(insertRow)
        .select(FIELDS_MIN)
        .single());
    }
    if (error) throw error;

    const mail = await verstuurWarmtefondsAccountInvite({
      naam,
      email,
      password,
    });

    return NextResponse.json({
      operator: data,
      mail_sent: mail.ok,
      mail_error: mail.error || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH /api/warmtefonds-operators */
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string;
    naam?: string;
    email?: string;
    telefoon?: string | null;
    actief?: boolean;
    tarief_inc?: number | null;
    regenerate_token?: boolean;
    /** Nieuw wachtwoord genereren + mailen. */
    send_invite?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const patch: Record<string, unknown> = {};
    if (body.naam !== undefined) patch.naam = body.naam.trim();
    if (body.email !== undefined) patch.email = body.email.trim().toLowerCase();
    if (body.telefoon !== undefined)
      patch.telefoon = body.telefoon?.trim() || null;
    if (body.actief !== undefined) {
      patch.actief = body.actief;
      // Inactief → token vernieuwen zodat oude links/sessies niet meer werken
      if (body.actief === false) {
        patch.portal_token = randomBytes(24).toString("hex");
      }
    }
    if (body.tarief_inc !== undefined) {
      if (body.tarief_inc === null || body.tarief_inc === ("" as unknown)) {
        patch.tarief_inc = null;
      } else {
        const n = Number(body.tarief_inc);
        if (!Number.isFinite(n) || n <= 0) {
          return NextResponse.json(
            { error: "Ongeldig tarief" },
            { status: 400 }
          );
        }
        patch.tarief_inc = Math.round(n * 100) / 100;
      }
    }
    if (body.regenerate_token) {
      patch.portal_token = randomBytes(24).toString("hex");
    }

    let plainPassword: string | null = null;
    if (body.send_invite) {
      plainPassword = generatePassword(12);
      patch.password_hash = hashPassword(plainPassword);
      if (!patch.portal_token) {
        // Zorg dat er altijd een geldige portal token is
        const { data: cur } = await sb
          .from("warmtefonds_operators")
          .select("portal_token")
          .eq("id", body.id)
          .maybeSingle();
        if (!cur?.portal_token) {
          patch.portal_token = randomBytes(24).toString("hex");
        }
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Niets te wijzigen" }, { status: 400 });
    }

    let { data, error } = await sb
      .from("warmtefonds_operators")
      .update(patch)
      .eq("id", body.id)
      .select(FIELDS)
      .single();

    if (isMissingColumn(error, "password_hash") && "password_hash" in patch) {
      return NextResponse.json(
        {
          error:
            "Voer migrate-warmtefonds-operator-accounts.sql uit in Supabase (wachtwoord-kolom).",
          migration_required: true,
        },
        { status: 503 }
      );
    }
    if (isMissingColumn(error, "tarief_inc")) {
      if ("tarief_inc" in patch && Object.keys(patch).length === 1) {
        return NextResponse.json(
          {
            error:
              "Kolom tarief_inc ontbreekt — draai migrate-warmtefonds-operator-accounts.sql",
          },
          { status: 400 }
        );
      }
      const slim = { ...patch };
      delete slim.tarief_inc;
      ({ data, error } = await sb
        .from("warmtefonds_operators")
        .update(slim)
        .eq("id", body.id)
        .select(FIELDS_MIN)
        .single());
    }
    if (error) throw error;

    let mail_sent = false;
    let mail_error: string | null = null;
    if (plainPassword && data) {
      const mail = await verstuurWarmtefondsAccountInvite({
        naam: String((data as { naam?: string }).naam || ""),
        email: String((data as { email?: string }).email || ""),
        password: plainPassword,
      });
      mail_sent = mail.ok;
      mail_error = mail.error || null;
    }

    return NextResponse.json({
      operator: data,
      mail_sent,
      mail_error,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
