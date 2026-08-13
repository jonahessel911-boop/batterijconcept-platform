import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import type { WebhookLeadPayload } from "@/types/database";

export const runtime = "nodejs";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * POST /api/webhook/leads
 *
 * Ontvangt leads vanaf de website-scan (of andere bronnen).
 * Maakt automatisch een uniek lead_number aan.
 *
 * Body (JSON):
 *   naam* , email, telefoon, postcode, huisnummer, toevoeging,
 *   straat, plaats, utm_source, utm_medium, utm_campaign, …
 */
export async function POST(req: NextRequest) {
  let body: WebhookLeadPayload;
  try {
    body = await req.json();
  } catch {
    return badRequest("Ongeldige JSON");
  }

  if (!body.naam || typeof body.naam !== "string" || !body.naam.trim()) {
    return badRequest("Veld 'naam' is verplicht");
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: leadNumber, error: numErr } = await supabase.rpc(
      "generate_lead_number"
    );
    if (numErr || !leadNumber) {
      console.error(numErr);
      return NextResponse.json(
        { error: "Kon leadnummer niet genereren", detail: numErr?.message },
        { status: 500 }
      );
    }

    const row = {
      lead_number: leadNumber as string,
      naam: body.naam.trim(),
      email: body.email?.trim() || null,
      telefoon: body.telefoon?.trim() || null,
      postcode: body.postcode?.trim() || null,
      huisnummer: body.huisnummer?.trim() || null,
      toevoeging: body.toevoeging?.trim() || null,
      straat: body.straat?.trim() || null,
      plaats: body.plaats?.trim() || null,
      utm_source: body.utm_source?.trim() || null,
      utm_medium: body.utm_medium?.trim() || null,
      utm_campaign: body.utm_campaign?.trim() || null,
      utm_content: body.utm_content?.trim() || null,
      utm_term: body.utm_term?.trim() || null,
      bron: body.bron?.trim() || "website",
      notities: body.notities?.trim() || null,
      status: "nieuw" as const,
      prioriteit: "normaal" as const,
      raw_payload: body,
    };

    const { data, error } = await supabase
      .from("leads")
      .insert(row)
      .select("id, lead_number, created_at")
      .single();

    if (error) {
      console.error(error);
      return NextResponse.json(
        { error: "Lead opslaan mislukt", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        lead_id: data.id,
        lead_number: data.lead_number,
        created_at: data.created_at,
      },
      { status: 201 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onbekende fout";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/webhook/leads",
    method: "POST",
    description:
      "Webhook voor lead-intake. Genereert uniek lead_number (BC-YYYYMMDD-XXXX).",
  });
}
