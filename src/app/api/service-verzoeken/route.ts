import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  findProjectByKlantEmail,
  syncProjectServiceStatus,
} from "@/lib/service-verzoek";

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

/** POST /api/service-verzoeken — via project_id óf via klant-email */
export async function POST(req: NextRequest) {
  let body: {
    project_id?: string;
    email?: string;
    onderwerp?: string;
    omschrijving?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const onderwerp = body.onderwerp?.trim();
  if (!onderwerp) {
    return NextResponse.json(
      { error: "onderwerp is verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();

    let projectId = body.project_id?.trim() || "";
    let leadId = "";
    let klantEmail: string | null = body.email?.trim().toLowerCase() || null;

    if (!projectId && klantEmail) {
      const match = await findProjectByKlantEmail(sb, klantEmail);
      if (!match) {
        return NextResponse.json(
          {
            error:
              "Geen project gevonden voor dit e-mailadres. Lead moet een project hebben.",
          },
          { status: 404 }
        );
      }
      projectId = match.project.id;
      leadId = match.lead.id;
    } else if (projectId) {
      const { data: project, error: pErr } = await sb
        .from("projecten")
        .select("id, lead_id")
        .eq("id", projectId)
        .single();

      if (pErr || !project) {
        return NextResponse.json(
          { error: "Project niet gevonden" },
          { status: 404 }
        );
      }
      leadId = project.lead_id;
    } else {
      return NextResponse.json(
        { error: "project_id of email is verplicht" },
        { status: 400 }
      );
    }

    const insertRow: Record<string, unknown> = {
      project_id: projectId,
      lead_id: leadId,
      onderwerp,
      omschrijving: body.omschrijving?.trim() || null,
      status: "open",
    };
    if (klantEmail) insertRow.klant_email = klantEmail;

    let { data, error } = await sb
      .from("service_verzoeken")
      .insert(insertRow)
      .select(
        "*, leads(naam, lead_number), projecten(id, project_nummer, titel, status)"
      )
      .single();

    if (
      error &&
      (error.message?.includes("klant_email") || error.code === "42703")
    ) {
      delete insertRow.klant_email;
      ({ data, error } = await sb
        .from("service_verzoeken")
        .insert(insertRow)
        .select(
          "*, leads(naam, lead_number), projecten(id, project_nummer, titel, status)"
        )
        .single());
    }

    if (error || !data) {
      return NextResponse.json(
        {
          error: "Verzoek opslaan mislukt",
          detail: error?.message,
        },
        { status: 500 }
      );
    }

    await syncProjectServiceStatus(sb, projectId);

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
