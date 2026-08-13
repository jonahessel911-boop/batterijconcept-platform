import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { syncProjectServiceStatus } from "@/lib/service-verzoek";

export const runtime = "nodejs";

/** GET /api/service-verzoeken — lijst (optioneel ?status=open) */
export async function GET(req: NextRequest) {
  try {
    const sb = getSupabaseAdmin();
    const status = req.nextUrl.searchParams.get("status");
    let q = sb
      .from("service_verzoeken")
      .select(
        "*, leads(naam, lead_number), projecten(id, project_nummer, titel, status)"
      )
      .order("created_at", { ascending: false });

    if (status === "open" || status === "afgehandeld") {
      q = q.eq("status", status);
    }

    const { data, error } = await q;
    if (error) throw error;
    return NextResponse.json({ verzoeken: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** POST /api/service-verzoeken — nieuw verzoek → projectstatus Service */
export async function POST(req: NextRequest) {
  let body: {
    project_id?: string;
    onderwerp?: string;
    omschrijving?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const projectId = body.project_id?.trim();
  const onderwerp = body.onderwerp?.trim();
  if (!projectId || !onderwerp) {
    return NextResponse.json(
      { error: "project_id en onderwerp zijn verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: project, error: pErr } = await sb
      .from("projecten")
      .select("id, lead_id")
      .eq("id", projectId)
      .single();

    if (pErr || !project) {
      return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
    }

    const { data, error } = await sb
      .from("service_verzoeken")
      .insert({
        project_id: project.id,
        lead_id: project.lead_id,
        onderwerp,
        omschrijving: body.omschrijving?.trim() || null,
        status: "open",
      })
      .select(
        "*, leads(naam, lead_number), projecten(id, project_nummer, titel, status)"
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error: "Verzoek opslaan mislukt",
          detail: error?.message,
        },
        { status: 500 }
      );
    }

    await syncProjectServiceStatus(sb, project.id);

    const { data: refreshed } = await sb
      .from("service_verzoeken")
      .select(
        "*, leads(naam, lead_number), projecten(id, project_nummer, titel, status)"
      )
      .eq("id", data.id)
      .single();

    return NextResponse.json(
      { verzoek: refreshed || data },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
