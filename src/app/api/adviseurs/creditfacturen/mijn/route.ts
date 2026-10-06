import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import { mailGoedgekeurdeAdviseurCreditfactuur } from "@/lib/creditfactuur-verstuur";

export const runtime = "nodejs";

async function requireAdviseurSession() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) return { error: "Niet ingelogd", status: 401 as const };
  const rol = normalizeRol(session.rol);
  if (rol !== "adviseur" && rol !== "admin") {
    return { error: "Geen toegang", status: 403 as const };
  }
  return { session };
}

/**
 * GET /api/adviseurs/creditfacturen/mijn
 * Eigen selfbilling-facturen voor de ingelogde adviseur (geen concepten).
 */
export async function GET() {
  const auth = await requireAdviseurSession();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: facturen, error } = await sb
      .from("adviseur_creditfacturen")
      .select(
        "id, factuur_nummer, status, week_jaar, week_nummer, periode_van, periode_tot, aantal_aanbetalingen, bedrag_ex_btw, bedrag_inc_btw, factuurdatum, betaald_op, verzonden_op, goedgekeurd_op, notities, created_at"
      )
      .eq("adviseur_id", auth.session.adviseurId)
      .in("status", ["verzonden", "goedgekeurd", "betaald"])
      .order("factuurdatum", { ascending: false })
      .limit(100);

    if (error) {
      if (
        error.code === "42703" ||
        error.message?.includes("adviseur_creditfacturen")
      ) {
        return NextResponse.json({
          facturen: [],
          migration_needed: true,
        });
      }
      throw error;
    }

    return NextResponse.json({ facturen: facturen || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/adviseurs/creditfacturen/mijn
 * Body: { id, action: "goedkeuren" }
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdviseurSession();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { id?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.id || body.action !== "goedkeuren") {
    return NextResponse.json(
      { error: "id en action=goedkeuren zijn verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: fac, error } = await sb
      .from("adviseur_creditfacturen")
      .select("id, adviseur_id, status, factuur_nummer, goedgekeurd_op")
      .eq("id", body.id)
      .maybeSingle();

    if (error || !fac) {
      return NextResponse.json(
        { error: "Factuur niet gevonden" },
        { status: 404 }
      );
    }
    if (fac.adviseur_id !== auth.session.adviseurId) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }
    if (fac.status === "goedgekeurd" || fac.status === "betaald") {
      return NextResponse.json({ factuur: fac, already: true });
    }
    if (fac.status !== "verzonden") {
      return NextResponse.json(
        { error: "Alleen verstuurde facturen kunnen worden goedgekeurd" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await sb
      .from("adviseur_creditfacturen")
      .update({
        status: "goedgekeurd",
        goedgekeurd_op: now,
      })
      .eq("id", body.id)
      .select("*")
      .single();

    if (updErr || !updated) {
      return NextResponse.json(
        { error: updErr?.message || "Goedkeuren mislukt" },
        { status: 500 }
      );
    }

    let mail_sent = false;
    let mail_error: string | null = null;
    try {
      const mail = await mailGoedgekeurdeAdviseurCreditfactuur(sb, body.id);
      mail_sent = mail.ok;
      mail_error = mail.ok ? null : mail.error || "Mail mislukt";
    } catch (mailErr) {
      mail_error =
        mailErr instanceof Error ? mailErr.message : "Mail mislukt";
    }

    return NextResponse.json({
      factuur: updated,
      mail_sent,
      mail_error,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Goedkeuren mislukt") },
      { status: 500 }
    );
  }
}
