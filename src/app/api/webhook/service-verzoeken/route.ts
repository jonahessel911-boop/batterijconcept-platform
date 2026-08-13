import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import {
  findProjectByKlantEmail,
  syncProjectServiceStatus,
} from "@/lib/service-verzoek";

export const runtime = "nodejs";

function pickStr(...values: (string | undefined | null)[]) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * POST /api/webhook/service-verzoeken
 *
 * Inkomend serviceverzoek (website / mail-automation).
 * Koppelt automatisch aan het juiste project via klant-email.
 *
 * Body: email*, onderwerp|subject, omschrijving|bericht|message
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const email = pickStr(
    body.email as string,
    body.klant_email as string,
    body.from as string
  );
  const onderwerp = pickStr(
    body.onderwerp as string,
    body.subject as string,
    body.titel as string
  );
  const omschrijving = pickStr(
    body.omschrijving as string,
    body.bericht as string,
    body.message as string,
    body.body as string
  );

  if (!email) {
    return NextResponse.json(
      { error: "Veld 'email' is verplicht (klant-email voor projectkoppeling)" },
      { status: 400 }
    );
  }
  if (!onderwerp) {
    return NextResponse.json(
      { error: "Veld 'onderwerp' (of subject) is verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const match = await findProjectByKlantEmail(sb, email);

    if (!match) {
      return NextResponse.json(
        {
          error:
            "Geen project gevonden voor dit e-mailadres. Lead moet een project hebben.",
          email,
        },
        { status: 404 }
      );
    }

    const { data, error } = await sb
      .from("service_verzoeken")
      .insert({
        project_id: match.project.id,
        lead_id: match.lead.id,
        onderwerp,
        omschrijving,
        klant_email: email.toLowerCase(),
        status: "open",
      })
      .select("id, onderwerp, status, created_at")
      .single();

    if (error || !data) {
      // Fallback zonder klant_email-kolom als migratie nog niet gedraaid is
      if (
        error?.message?.includes("klant_email") ||
        error?.code === "42703"
      ) {
        const retry = await sb
          .from("service_verzoeken")
          .insert({
            project_id: match.project.id,
            lead_id: match.lead.id,
            onderwerp,
            omschrijving,
            status: "open",
          })
          .select("id, onderwerp, status, created_at")
          .single();
        if (retry.error || !retry.data) {
          return NextResponse.json(
            {
              error: "Serviceverzoek opslaan mislukt",
              detail: retry.error?.message || error.message,
            },
            { status: 500 }
          );
        }
        await syncProjectServiceStatus(sb, match.project.id);
        return NextResponse.json(
          {
            ok: true,
            verzoek_id: retry.data.id,
            project_id: match.project.id,
            project_nummer: match.project.project_nummer,
            lead_number: match.lead.lead_number,
            status: "open",
          },
          { status: 201 }
        );
      }

      return NextResponse.json(
        { error: "Serviceverzoek opslaan mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    await syncProjectServiceStatus(sb, match.project.id);

    return NextResponse.json(
      {
        ok: true,
        verzoek_id: data.id,
        project_id: match.project.id,
        project_nummer: match.project.project_nummer,
        lead_number: match.lead.lead_number,
        status: "open",
      },
      { status: 201 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onbekende fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/webhook/service-verzoeken",
    method: "POST",
    description:
      "Serviceverzoek inschieten. Koppelt via klant-email aan het juiste project en zet status op Service.",
    example: {
      email: "klant@example.com",
      onderwerp: "Omvormer geeft foutmelding",
      omschrijving: "Sinds gisteren knippert het lampje rood.",
    },
  });
}
