import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAdminAdviseurId } from "@/lib/admin-adviseur";
import { enrichAddressFields } from "@/lib/postcode";
import type { WebhookLeadPayload } from "@/types/database";
import { looksLikeSollicitatie } from "@/lib/sollicitatie-detect";

export const runtime = "nodejs";

const SOLLICITATIE_WEBHOOK = "/api/webhook/sollicitaties";

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function pickStr(...values: (string | undefined | null)[]) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * POST /api/webhook/leads
 *
 * Ontvangt leads vanaf de website-scan (of andere bronnen).
 * Maakt automatisch lead_number + created_at aan.
 *
 * Body (JSON):
 *   naam* , email, telefoon, postcode, huisnummer,
 *   adres|straat, woonplaats|plaats, notities|notes|opmerkingen|bericht,
 *   utm_source, …
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

  // Sollicitaties horen in Instroom, niet in de lead/bel-queue
  if (looksLikeSollicitatie(body as unknown as Record<string, unknown>)) {
    const origin = new URL(req.url).origin;
    const forwardUrl = `${origin}${SOLLICITATIE_WEBHOOK}`;
    try {
      const forwardRes = await fetch(forwardUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(req.headers.get("x-webhook-secret")
            ? { "x-webhook-secret": req.headers.get("x-webhook-secret")! }
            : {}),
        },
        body: JSON.stringify(body),
      });
      const forwardData = await forwardRes.json().catch(() => ({}));
      if (!forwardRes.ok) {
        return NextResponse.json(
          {
            error:
              "Dit lijkt een sollicitatie. Gebruik POST /api/webhook/sollicitaties",
            detail: forwardData.error,
          },
          { status: forwardRes.status }
        );
      }
      return NextResponse.json(
        {
          ...forwardData,
          redirected_from: "leads",
          hint: "Sollicitaties komen in Instroom, niet in Bellen/Leads.",
        },
        { status: forwardRes.status }
      );
    } catch (e) {
      return NextResponse.json(
        {
          error:
            "Dit lijkt een sollicitatie. Stuur naar POST /api/webhook/sollicitaties (Instroom).",
          detail: e instanceof Error ? e.message : undefined,
        },
        { status: 400 }
      );
    }
  }

  try {
    const supabase = getSupabaseAdmin();

    // Uniek lead ID: BC-YYYYMMDD-XXXX
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

    const adminId = await getAdminAdviseurId(supabase);

    const postcode = pickStr(body.postcode);
    const huisnummer = pickStr(body.huisnummer);
    let straat = pickStr(body.adres, body.straat);
    let plaats = pickStr(body.woonplaats, body.plaats);

    // Als adres leeg is: vul straat/plaats via postcode-API
    if ((!straat || !plaats) && postcode && huisnummer) {
      const filled = await enrichAddressFields({
        postcode,
        huisnummer,
        straat,
        plaats,
      });
      straat = filled.straat;
      plaats = filled.plaats;
    }

    const row = {
      lead_number: leadNumber as string,
      naam: body.naam.trim(),
      email: pickStr(body.email),
      telefoon: pickStr(body.telefoon),
      postcode,
      huisnummer,
      toevoeging: pickStr(body.toevoeging),
      straat,
      plaats,
      utm_source: pickStr(body.utm_source),
      utm_medium: pickStr(body.utm_medium),
      utm_campaign: pickStr(body.utm_campaign),
      utm_content: pickStr(body.utm_content),
      utm_term: pickStr(body.utm_term),
      bron: pickStr(body.bron) || "website",
      notities: pickStr(
        body.notities,
        body.notes,
        body.opmerkingen,
        body.bericht,
        body.message
      ),
      status: "nieuw" as const,
      prioriteit: "normaal" as const,
      // Standaard bij Admin tot iemand anders overneemt
      ...(adminId ? { adviseur_id: adminId } : {}),
      // created_at / updated_at: database default now()
      raw_payload: body,
    };

    let { data, error } = await supabase
      .from("leads")
      .insert(row)
      .select("id, lead_number, created_at, naam, email, straat, plaats, utm_source")
      .single();

    // Fallback als adviseur_id-kolom nog niet gemigreerd is
    if (
      error &&
      adminId &&
      (error.message?.includes("adviseur_id") || error.code === "42703")
    ) {
      const { adviseur_id: _drop, ...withoutAdv } = row as typeof row & {
        adviseur_id?: string;
      };
      void _drop;
      ({ data, error } = await supabase
        .from("leads")
        .insert(withoutAdv)
        .select(
          "id, lead_number, created_at, naam, email, straat, plaats, utm_source"
        )
        .single());
    }

    if (error || !data) {
      console.error(error);
      return NextResponse.json(
        { error: "Lead opslaan mislukt", detail: error?.message },
        { status: 500 }
      );
    }

    // Bedankt-mail (niet blokkerend voor response)
    if (data.email) {
      try {
        const { sendEmail } = await import("@/lib/email/postmark");
        const { leadThankYouEmail } = await import("@/lib/email/templates");
        await sendEmail({
          to: data.email,
          subject: "Bedankt voor je aanvraag! — Batterijconcept",
          html: leadThankYouEmail({ naam: data.naam }),
          tag: "lead-bedankt",
        });
      } catch (mailErr) {
        console.error("Lead thank-you mail:", mailErr);
      }
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
      "Webhook voor lead-intake (thuisbatterij-aanvragen). Genereert uniek lead_number (BC-YYYYMMDD-XXXX). Sollicitaties worden doorgestuurd naar /api/webhook/sollicitaties (Instroom).",
    example: {
      naam: "Jan Jansen",
      email: "jan@example.com",
      telefoon: "0612345678",
      postcode: "1234 AB",
      huisnummer: "12",
      adres: "Voorbeeldstraat",
      woonplaats: "Amsterdam",
      notities: "Heeft zonnepanelen, wil 10 kWh batterij",
      utm_source: "google",
    },
    response: {
      ok: true,
      lead_id: "uuid",
      lead_number: "BC-20260813-A1B2",
      created_at: "2026-08-13T11:00:00.000Z",
    },
  });
}
