import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireBackofficeSession } from "@/lib/auth-require-backoffice";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import { normalizeRol } from "@/lib/rollen";
import {
  defaultTaakCategorie,
  isTaakCategorie,
  type TaakCategorie,
} from "@/lib/taak-categorie";

export const runtime = "nodejs";

type Soort = "taak" | "afspraak";

function parseDueAt(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const v = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    const local = v.length === 16 ? `${v}:00` : v.slice(0, 19);
    const d = fromZonedTime(local, AMSTERDAM_TZ);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function parseSoort(raw: unknown): Soort {
  return raw === "taak" ? "taak" : "afspraak";
}

/**
 * GET /api/bo-agenda?adviseur_id=&from=&to=&open=1
 * Persoonlijke agenda + open project-taken voor die medewerker.
 */
export async function GET(req: NextRequest) {
  const auth = await requireBackofficeSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const sp = req.nextUrl.searchParams;
  const projectIdFilter = sp.get("project_id")?.trim() || "";
  if (projectIdFilter) {
    try {
      const sb = getSupabaseAdmin();
      const { data, error } = await sb
        .from("bo_agenda")
        .select(
          "*, adviseur:adviseurs!adviseur_id(id, naam), created_by:adviseurs!created_by_id(id, naam)"
        )
        .eq("project_id", projectIdFilter)
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) {
        if (
          error.code === "42P01" ||
          error.message?.includes("bo_agenda") ||
          /project_id/i.test(error.message || "")
        ) {
          return NextResponse.json({ items: [], project_taken: [] });
        }
        return NextResponse.json(
          { error: "Agenda laden mislukt", detail: error.message },
          { status: 500 }
        );
      }
      return NextResponse.json({
        items: data || [],
        project_taken: [],
      });
    } catch (e) {
      return NextResponse.json(
        { error: errMessage(e, "Fout") },
        { status: 500 }
      );
    }
  }

  let adviseurId = sp.get("adviseur_id")?.trim() || "";
  // Backoffice ziet standaard zichzelf; admin mag iedereen
  if (!adviseurId || normalizeRol(auth.session.rol) !== "admin") {
    if (normalizeRol(auth.session.rol) === "backoffice") {
      adviseurId = auth.session.adviseurId;
    }
  }
  if (!adviseurId) {
    adviseurId = auth.session.adviseurId;
  }

  const from = sp.get("from")?.trim() || null;
  const to = sp.get("to")?.trim() || null;
  const openOnly = sp.get("open") !== "0";

  try {
    const sb = getSupabaseAdmin();

    const agendaSelectWithProject =
      "*, projecten(id, project_nummer, titel, leads(naam, plaats))";

    let agendaQ = sb
      .from("bo_agenda")
      .select(agendaSelectWithProject)
      .eq("adviseur_id", adviseurId)
      .order("start_at", { ascending: true })
      .limit(500);

    if (openOnly) agendaQ = agendaQ.eq("status", "todo");
    if (from) agendaQ = agendaQ.gte("start_at", from);
    if (to) agendaQ = agendaQ.lte("start_at", to);

    let { data: agenda, error: agendaErr } = await agendaQ;
    // Zonder project_id-kolom / FK: opnieuw zonder join.
    if (
      agendaErr &&
      /project/i.test(agendaErr.message || "")
    ) {
      let plainQ = sb
        .from("bo_agenda")
        .select("*")
        .eq("adviseur_id", adviseurId)
        .order("start_at", { ascending: true })
        .limit(500);
      if (openOnly) plainQ = plainQ.eq("status", "todo");
      if (from) plainQ = plainQ.gte("start_at", from);
      if (to) plainQ = plainQ.lte("start_at", to);
      const plain = await plainQ;
      agenda = plain.data;
      agendaErr = plain.error;
    }
    if (agendaErr) {
      if (
        agendaErr.code === "42P01" ||
        agendaErr.message?.includes("bo_agenda")
      ) {
        return NextResponse.json({
          items: [],
          project_taken: [],
          adviseur_id: adviseurId,
          error: "Voer supabase/migrate-bo-agenda.sql uit in Supabase.",
        });
      }
      return NextResponse.json(
        { error: "Agenda laden mislukt", detail: agendaErr.message },
        { status: 500 }
      );
    }

    let takenQ = sb
      .from("project_taken")
      .select(
        "id, project_id, titel, status, afdeling, categorie, due_at, auto_key, verantwoordelijke_id, projecten(id, project_nummer, titel, leads(naam, plaats))"
      )
      .eq("verantwoordelijke_id", adviseurId)
      .order("due_at", { ascending: true })
      .limit(300);

    if (openOnly) takenQ = takenQ.neq("status", "done");
    if (from) takenQ = takenQ.gte("due_at", from);
    if (to) takenQ = takenQ.lte("due_at", to);

    let { data: projectTaken, error: takenErr } = await takenQ;
    if (takenErr && /categorie/i.test(takenErr.message || "")) {
      let retryQ = sb
        .from("project_taken")
        .select(
          "id, project_id, titel, status, afdeling, due_at, auto_key, verantwoordelijke_id, projecten(id, project_nummer, titel, leads(naam, plaats))"
        )
        .eq("verantwoordelijke_id", adviseurId)
        .order("due_at", { ascending: true })
        .limit(300);
      if (openOnly) retryQ = retryQ.neq("status", "done");
      if (from) retryQ = retryQ.gte("due_at", from);
      if (to) retryQ = retryQ.lte("due_at", to);
      const plain = await retryQ;
      projectTaken = plain.data as typeof projectTaken;
    }

    return NextResponse.json({
      adviseur_id: adviseurId,
      items: agenda || [],
      project_taken: projectTaken || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bo-agenda
 * { titel, inhoud?, start_at, end_at?, soort?, adviseur_id?, project_id?, categorie? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireBackofficeSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await req.json()) as {
      titel?: string;
      inhoud?: string | null;
      start_at?: string;
      end_at?: string | null;
      soort?: string;
      adviseur_id?: string | null;
      project_id?: string | null;
      categorie?: string | null;
    };

    const titel = body.titel?.trim() || "";
    if (!titel) {
      return NextResponse.json({ error: "Titel is verplicht" }, { status: 400 });
    }

    let adviseurId = body.adviseur_id?.trim() || auth.session.adviseurId;
    if (
      normalizeRol(auth.session.rol) === "backoffice" &&
      adviseurId !== auth.session.adviseurId
    ) {
      adviseurId = auth.session.adviseurId;
    }

    const soort = parseSoort(body.soort);
    const startAt = parseDueAt(body.start_at);
    if (!startAt) {
      return NextResponse.json(
        { error: "start_at is verplicht" },
        { status: 400 }
      );
    }
    const endAt =
      soort === "afspraak" ? parseDueAt(body.end_at) || null : null;
    const projectId = body.project_id?.trim() || null;
    if (body.categorie != null && body.categorie !== "" && !isTaakCategorie(body.categorie)) {
      return NextResponse.json(
        { error: "Ongeldige categorie" },
        { status: 400 }
      );
    }
    const categorie: TaakCategorie = defaultTaakCategorie({
      hasProject: Boolean(projectId),
      categorie: body.categorie,
    });

    const sb = getSupabaseAdmin();
    const row: Record<string, unknown> = {
      adviseur_id: adviseurId,
      titel,
      inhoud: body.inhoud?.trim() || null,
      soort,
      start_at: startAt,
      end_at: endAt,
      status: "todo",
      created_by_id: auth.session.adviseurId,
      categorie,
    };
    if (projectId) row.project_id = projectId;

    let { data, error } = await sb
      .from("bo_agenda")
      .insert(row)
      .select(
        "*, projecten(id, project_nummer, titel, leads(naam, plaats))"
      )
      .single();

    // Oude DB zonder project_id / categorie: opnieuw zonder die kolommen.
    if (
      error &&
      (/project_id/i.test(error.message || "") ||
        /categorie/i.test(error.message || ""))
    ) {
      if (/project_id/i.test(error.message || "")) delete row.project_id;
      if (/categorie/i.test(error.message || "")) delete row.categorie;
      const retry = await sb
        .from("bo_agenda")
        .insert(row)
        .select("*")
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("bo_agenda")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-bo-agenda.sql uit in Supabase.",
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: "Aanmaken mislukt", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ item: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
