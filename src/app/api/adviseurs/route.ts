import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateAvailableSlots } from "@/lib/slots";
import {
  appBaseUrl,
  sendEmail,
} from "@/lib/email/postmark";
import { teamWelkomEmail } from "@/lib/email/templates";
import {
  generatePassword,
  hashPassword,
} from "@/lib/auth-password";
import { errMessage } from "@/lib/errors";
import type { Adviseur } from "@/types/database";

export const runtime = "nodejs";

const ADVISEUR_PUBLIC =
  "id, naam, email, telefoon, actief, werktijd_start, werktijd_eind, created_at, updated_at";

function stripHash(row: Record<string, unknown>): Adviseur {
  const copy = { ...row };
  delete copy.password_hash;
  return copy as unknown as Adviseur;
}

/** GET /api/adviseurs — lijst + optioneel ?adviseur_id= voor slots */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const adviseurId = req.nextUrl.searchParams.get("adviseur_id");
    const includeInactive =
      req.nextUrl.searchParams.get("include_inactive") === "1";

    let query = sb
      .from("adviseurs")
      .select(ADVISEUR_PUBLIC)
      .order("naam");
    if (!includeInactive) {
      query = query.eq("actief", true);
    }

    const { data: adviseurs, error } = await query;
    if (error) throw error;

    if (!adviseurId) {
      return NextResponse.json({ adviseurs: adviseurs || [] });
    }

    const adviseur = (adviseurs || []).find((a) => a.id === adviseurId);
    if (!adviseur) {
      return NextResponse.json({ error: "Adviseur niet gevonden" }, { status: 404 });
    }

    const { data: busy } = await sb
      .from("afspraken")
      .select("start_at, end_at")
      .eq("adviseur_id", adviseurId)
      .neq("status", "geannuleerd");

    const slots = generateAvailableSlots({
      busy: busy || [],
    }).map((s) => ({
      start_at: s.start.toISOString(),
      end_at: s.end.toISOString(),
    }));

    return NextResponse.json({ adviseurs: adviseurs || [], slots });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/adviseurs — nieuw teamlid + welkomstmail met wachtwoord */
export async function POST(req: NextRequest) {
  let body: { naam?: string; email?: string; telefoon?: string };
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
    return NextResponse.json(
      { error: "E-mail is verplicht (voor login + welkomstmail)" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const password = generatePassword(12);
    const password_hash = hashPassword(password);

    let insert = await sb
      .from("adviseurs")
      .insert({
        naam,
        email,
        telefoon: body.telefoon?.trim() || null,
        password_hash,
        actief: true,
      })
      .select(ADVISEUR_PUBLIC)
      .single();

    // Kolom password_hash nog niet gemigreerd → opslaan zonder hash, mail wel sturen
    if (
      insert.error &&
      (insert.error.message?.includes("password_hash") ||
        insert.error.code === "42703")
    ) {
      insert = await sb
        .from("adviseurs")
        .insert({
          naam,
          email,
          telefoon: body.telefoon?.trim() || null,
          actief: true,
        })
        .select(ADVISEUR_PUBLIC)
        .single();

      return NextResponse.json(
        {
          error:
            "Voer eerst supabase/migrate-adviseur-password.sql uit in Supabase, daarna opnieuw toevoegen.",
          detail: insert.error?.message,
        },
        { status: 503 }
      );
    }

    if (insert.error || !insert.data) {
      return NextResponse.json(
        { error: insert.error?.message || "Opslaan mislukt" },
        { status: 500 }
      );
    }

    const loginUrl = `${appBaseUrl()}/login`;
    const html = teamWelkomEmail({
      naam,
      email,
      password,
      loginUrl,
    });
    const sent = await sendEmail({
      to: email,
      subject: `Welkom bij het team, ${naam}`,
      html,
      tag: "team-welkom",
    });

    return NextResponse.json(
      {
        adviseur: stripHash(insert.data as Record<string, unknown>),
        mail_sent: sent.ok,
        mail_error: sent.error,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH /api/adviseurs — bijwerken / deactiveren / opnieuw uitnodigen / wachtwoord */
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string;
    naam?: string;
    email?: string | null;
    telefoon?: string | null;
    actief?: boolean;
    resend_invite?: boolean;
    password?: string;
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

    if (body.resend_invite) {
      const { data: current, error: fetchErr } = await sb
        .from("adviseurs")
        .select("id, naam, email")
        .eq("id", body.id)
        .single();
      if (fetchErr || !current?.email) {
        return NextResponse.json(
          { error: "Adviseur of e-mail niet gevonden" },
          { status: 404 }
        );
      }

      const password = generatePassword(12);
      const password_hash = hashPassword(password);
      const { data, error } = await sb
        .from("adviseurs")
        .update({ password_hash })
        .eq("id", body.id)
        .select(ADVISEUR_PUBLIC)
        .single();

      if (error || !data) {
        return NextResponse.json(
          {
            error:
              error?.message?.includes("password_hash")
                ? "Voer migrate-adviseur-password.sql uit in Supabase"
                : error?.message || "Bijwerken mislukt",
          },
          { status: 500 }
        );
      }

      const loginUrl = `${appBaseUrl()}/login`;
      const sent = await sendEmail({
        to: current.email,
        subject: `Welkom bij het team, ${current.naam}`,
        html: teamWelkomEmail({
          naam: current.naam,
          email: current.email,
          password,
          loginUrl,
        }),
        tag: "team-welkom",
      });

      return NextResponse.json({
        adviseur: data,
        mail_sent: sent.ok,
        mail_error: sent.error,
      });
    }

    if (typeof body.password === "string") {
      const password = body.password.trim();
      if (password.length < 8) {
        return NextResponse.json(
          { error: "Wachtwoord moet minstens 8 tekens zijn" },
          { status: 400 }
        );
      }

      const { data, error } = await sb
        .from("adviseurs")
        .update({ password_hash: hashPassword(password) })
        .eq("id", body.id)
        .select(ADVISEUR_PUBLIC)
        .single();

      if (error || !data) {
        return NextResponse.json(
          {
            error:
              error?.message?.includes("password_hash")
                ? "Voer migrate-adviseur-password.sql uit in Supabase"
                : error?.message || "Wachtwoord bijwerken mislukt",
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ adviseur: data, password_updated: true });
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.naam === "string" && body.naam.trim()) {
      patch.naam = body.naam.trim();
    }
    if (body.email !== undefined) {
      patch.email = body.email?.trim().toLowerCase() || null;
    }
    if (body.telefoon !== undefined) {
      patch.telefoon = body.telefoon?.trim() || null;
    }
    if (typeof body.actief === "boolean") {
      patch.actief = body.actief;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
    }

    const { data, error } = await sb
      .from("adviseurs")
      .update(patch)
      .eq("id", body.id)
      .select(ADVISEUR_PUBLIC)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Bijwerken mislukt" },
        { status: 500 }
      );
    }

    return NextResponse.json({ adviseur: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
