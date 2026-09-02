import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { generateAvailableSlots, generateDayBlocks } from "@/lib/slots";
import { blockingBusySlots } from "@/lib/afspraak-busy";
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
import {
  GEBRUIKER_ROLLEN,
  normalizeRol,
} from "@/lib/rollen";

export const runtime = "nodejs";

const ADVISEUR_PUBLIC =
  "id, naam, email, telefoon, actief, werktijd_start, werktijd_eind, start_adres, rol, created_at, updated_at";
const ADVISEUR_PUBLIC_FALLBACK =
  "id, naam, email, telefoon, actief, werktijd_start, werktijd_eind, start_adres, created_at, updated_at";
const ADVISEUR_PUBLIC_MIN =
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

    let { data: adviseurs, error } = await query;
    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("start_adres") ||
        error.message?.includes("rol"))
    ) {
      let retry = sb
        .from("adviseurs")
        .select(
          error.message?.includes("rol")
            ? ADVISEUR_PUBLIC_FALLBACK
            : ADVISEUR_PUBLIC_MIN
        )
        .order("naam");
      if (!includeInactive) retry = retry.eq("actief", true);
      const second = await retry;
      if (
        second.error &&
        (second.error.code === "42703" ||
          second.error.message?.includes("start_adres"))
      ) {
        let bare = sb
          .from("adviseurs")
          .select(ADVISEUR_PUBLIC_MIN)
          .order("naam");
        if (!includeInactive) bare = bare.eq("actief", true);
        const third = await bare;
        adviseurs = (third.data || null) as typeof adviseurs;
        error = third.error;
      } else {
        adviseurs = (second.data || null) as typeof adviseurs;
        error = second.error;
      }
    }
    if (error) throw error;

    if (!adviseurId) {
      return NextResponse.json({ adviseurs: adviseurs || [] });
    }

    const adviseur = (adviseurs || []).find((a) => a.id === adviseurId);
    if (!adviseur) {
      return NextResponse.json({ error: "Adviseur niet gevonden" }, { status: 404 });
    }

    const busyRows = await blockingBusySlots(sb, adviseurId);
    const slots = generateAvailableSlots({
      busy: busyRows,
    }).map((s) => ({
      start_at: s.start.toISOString(),
      end_at: s.end.toISOString(),
    }));
    const blocks = generateDayBlocks({
      busy: busyRows,
    }).map((s) => ({
      start_at: s.start.toISOString(),
      end_at: s.end.toISOString(),
      busy: s.busy,
    }));

    return NextResponse.json({
      adviseurs: adviseurs || [],
      slots,
      blocks,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/adviseurs — nieuw teamlid + welkomstmail met wachtwoord */
export async function POST(req: NextRequest) {
  let body: {
    naam?: string;
    email?: string;
    telefoon?: string;
    rol?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const naam = body.naam?.trim();
  const email = body.email?.trim().toLowerCase();
  const rol = normalizeRol(body.rol);
  if (!naam) {
    return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json(
      { error: "E-mail is verplicht (voor login + welkomstmail)" },
      { status: 400 }
    );
  }
  if (!GEBRUIKER_ROLLEN.includes(rol)) {
    return NextResponse.json({ error: "Ongeldige rol" }, { status: 400 });
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
        rol,
      })
      .select(ADVISEUR_PUBLIC)
      .single();

    // Kolom password_hash / rol nog niet gemigreerd
    if (
      insert.error &&
      (insert.error.message?.includes("password_hash") ||
        insert.error.message?.includes("rol") ||
        insert.error.code === "42703")
    ) {
      const fallback: Record<string, unknown> = {
        naam,
        email,
        telefoon: body.telefoon?.trim() || null,
        actief: true,
        password_hash,
      };
      if (insert.error.message?.includes("rol")) {
        // password ok, rol mist
      } else {
        delete fallback.password_hash;
      }
      insert = await sb
        .from("adviseurs")
        .insert(fallback)
        .select(ADVISEUR_PUBLIC_FALLBACK)
        .single();

      if (insert.error || !insert.data) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-adviseur-password.sql en migrate-rollen.sql uit in Supabase.",
            detail: insert.error?.message,
          },
          { status: 503 }
        );
      }
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
    start_adres?: string | null;
    rol?: string;
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
    if (body.start_adres !== undefined) {
      patch.start_adres = body.start_adres?.trim() || null;
    }
    if (body.rol !== undefined) {
      const r = normalizeRol(body.rol);
      if (!GEBRUIKER_ROLLEN.includes(r)) {
        return NextResponse.json({ error: "Ongeldige rol" }, { status: 400 });
      }
      patch.rol = r;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
    }

    let { data, error } = await sb
      .from("adviseurs")
      .update(patch)
      .eq("id", body.id)
      .select(ADVISEUR_PUBLIC)
      .single();

    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("start_adres") ||
        error.message?.includes("rol"))
    ) {
      if (patch.rol !== undefined) {
        return NextResponse.json(
          {
            error: "Voer eerst supabase/migrate-rollen.sql uit in Supabase.",
          },
          { status: 503 }
        );
      }
      if (patch.start_adres !== undefined) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-adviseur-startadres.sql uit in Supabase.",
          },
          { status: 503 }
        );
      }
      const retry = await sb
        .from("adviseurs")
        .update(patch)
        .eq("id", body.id)
        .select(ADVISEUR_PUBLIC_FALLBACK)
        .single();
      data = retry.data as typeof data;
      error = retry.error;
    }

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
