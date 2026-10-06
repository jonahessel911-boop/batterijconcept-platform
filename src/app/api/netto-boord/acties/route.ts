import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";

const SELECT =
  "*, verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), aangemaakt_door:adviseurs!aangemaakt_door_id(id, naam, email), projecten(id, project_nummer, titel, status, lead_id, leads(naam, plaats, telefoon))";

const SELECT_FALLBACK =
  "*, verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), projecten(id, project_nummer, titel, status, lead_id, leads(naam, plaats, telefoon))";

async function requireSession() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  const rol = normalizeRol(session.rol);
  if (rol !== "admin" && rol !== "adviseur") {
    return {
      error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }),
    };
  }
  return { session, rol };
}

/**
 * POST /api/netto-boord/acties
 * Adviseur maakt een backoffice-actie (notitie + deadline) vanuit Nettoboord.
 */
export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  let body: {
    project_id?: string;
    offerte_id?: string;
    titel?: string;
    notities?: string | null;
    due_at?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const notities = body.notities?.trim() || "";
  const titel =
    body.titel?.trim() ||
    (notities
      ? notities.length > 80
        ? `${notities.slice(0, 77)}…`
        : notities
      : "");
  if (!titel) {
    return NextResponse.json(
      { error: "Omschrijving / notitie is verplicht" },
      { status: 400 }
    );
  }
  if (!body.due_at) {
    return NextResponse.json(
      { error: "Deadline is verplicht" },
      { status: 400 }
    );
  }
  const due = new Date(body.due_at);
  if (Number.isNaN(due.getTime())) {
    return NextResponse.json({ error: "Ongeldige deadline" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    let projectId = body.project_id?.trim() || "";

    if (!projectId && body.offerte_id) {
      const { data: proj } = await sb
        .from("projecten")
        .select("id, lead_id, leads(adviseur_id)")
        .eq("offerte_id", body.offerte_id)
        .maybeSingle();
      if (!proj) {
        return NextResponse.json(
          {
            error:
              "Nog geen project voor deze order — actie pas mogelijk na kickoff.",
          },
          { status: 400 }
        );
      }
      projectId = proj.id;
      const leadJoin = proj.leads as
        | { adviseur_id: string | null }
        | { adviseur_id: string | null }[]
        | null;
      const lead = Array.isArray(leadJoin) ? leadJoin[0] : leadJoin;
      if (
        auth.rol === "adviseur" &&
        lead?.adviseur_id &&
        lead.adviseur_id !== auth.session.adviseurId
      ) {
        return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
      }
    }

    if (!projectId) {
      return NextResponse.json(
        { error: "project_id of offerte_id is verplicht" },
        { status: 400 }
      );
    }

    const { data: project, error: pErr } = await sb
      .from("projecten")
      .select("id, lead_id, leads(adviseur_id)")
      .eq("id", projectId)
      .maybeSingle();
    if (pErr || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }
    const leadJoin = project.leads as
      | { adviseur_id: string | null }
      | { adviseur_id: string | null }[]
      | null;
    const lead = Array.isArray(leadJoin) ? leadJoin[0] : leadJoin;
    if (
      auth.rol === "adviseur" &&
      lead?.adviseur_id &&
      lead.adviseur_id !== auth.session.adviseurId
    ) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const insertRow = {
      project_id: projectId,
      titel,
      status: "todo" as const,
      afdeling: "Backoffice",
      verantwoordelijke_id: null as string | null,
      due_at: due.toISOString(),
      notities: notities || null,
      auto_key: null as string | null,
      aangemaakt_door_id: auth.session.adviseurId,
    };

    let { data, error } = await sb
      .from("project_taken")
      .insert(insertRow)
      .select(SELECT)
      .single();

    if (
      error &&
      (error.message?.includes("aangemaakt_door_id") ||
        error.code === "42703")
    ) {
      const { aangemaakt_door_id: _drop, ...withoutCol } = insertRow;
      const retry = await sb
        .from("project_taken")
        .insert(withoutCol)
        .select(SELECT_FALLBACK)
        .single();
      data = retry.data as typeof data;
      error = retry.error;
      if (!error && data) {
        return NextResponse.json({
          taak: data,
          warning:
            "Voer supabase/migrate-project-taken-aangemaakt-door.sql uit zodat de adviseur later een mail krijgt bij afronden.",
        });
      }
    }

    if (error || !data) {
      return NextResponse.json(
        { error: "Actie aanmaken mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ taak: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
