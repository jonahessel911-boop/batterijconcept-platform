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
 * Body (JSON of multipart):
 *   naam* , email, telefoon, postcode, huisnummer,
 *   adres|straat, woonplaats|plaats, notities|notes|opmerkingen|bericht,
 *   lander|Lander, campaign_name|Campaign_name, ad_name|Ad_name,
 *   utm_source, …
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  const isMultipart = contentType.includes("multipart/form-data");

  let body: WebhookLeadPayload & Record<string, unknown>;
  let formData: FormData | null = null;

  try {
    if (isMultipart) {
      formData = await req.formData();
      const fields: Record<string, unknown> = {};
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") fields[key] = value;
        else if (value instanceof File && value.size > 0) {
          fields[key] = value;
          // Detectiehulp voor sollicitaties zonder bron=…
          if (!fields.cv && !fields.resume && !fields.file) fields.cv = value;
        }
      }
      body = fields as WebhookLeadPayload & Record<string, unknown>;
    } else {
      body = (await req.json()) as WebhookLeadPayload & Record<string, unknown>;
    }
  } catch {
    return badRequest("Ongeldige payload (JSON of multipart)");
  }

  const naam = pickStr(
    typeof body.naam === "string" ? body.naam : null,
    typeof body.name === "string" ? (body.name as string) : null
  );
  if (!naam) {
    return badRequest("Veld 'naam' is verplicht");
  }
  body.naam = naam;

  // Sollicitaties horen in Instroom, niet in de lead/bel-queue
  if (looksLikeSollicitatie(body as Record<string, unknown>)) {
    const origin = new URL(req.url).origin;
    const forwardUrl = `${origin}${SOLLICITATIE_WEBHOOK}`;
    try {
      const secret = req.headers.get("x-webhook-secret");
      const forwardRes = formData
        ? await fetch(forwardUrl, {
            method: "POST",
            headers: {
              ...(secret ? { "x-webhook-secret": secret } : {}),
            },
            body: formData,
          })
        : await fetch(forwardUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(secret ? { "x-webhook-secret": secret } : {}),
            },
            body: JSON.stringify(body),
          });
      const forwardData = await forwardRes.json().catch(() => ({}));
      if (!forwardRes.ok) {
        return NextResponse.json(
          {
            error:
              "Dit lijkt een sollicitatie. Gebruik POST /api/webhook/sollicitaties",
            detail: forwardData.error || forwardData.warning,
            upload_errors: forwardData.upload_errors,
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
      lander: pickStr(
        body.lander,
        typeof body.Lander === "string" ? body.Lander : null
      ),
      campaign_name: pickStr(
        body.campaign_name,
        typeof body.Campaign_name === "string" ? body.Campaign_name : null,
        typeof body.campaign === "string" ? body.campaign : null,
        typeof body.utm_campaign === "string" ? body.utm_campaign : null
      ),
      ad_name: pickStr(
        body.ad_name,
        typeof body.Ad_name === "string" ? body.Ad_name : null,
        typeof body.ad === "string" ? body.ad : null,
        typeof body.utm_content === "string" ? body.utm_content : null
      ),
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
      meta_fbc: pickStr(
        body.fbc,
        typeof body._fbc === "string" ? body._fbc : null,
        typeof body.meta_fbc === "string" ? body.meta_fbc : null
      ),
      meta_fbp: pickStr(
        body.fbp,
        typeof body._fbp === "string" ? body._fbp : null,
        typeof body.meta_fbp === "string" ? body.meta_fbp : null
      ),
      meta_client_ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        req.headers.get("x-real-ip") ||
        null,
      meta_user_agent: req.headers.get("user-agent"),
      meta_event_source_url: pickStr(
        typeof body.event_source_url === "string"
          ? body.event_source_url
          : null,
        typeof body.page_url === "string" ? body.page_url : null,
        typeof body.landing_url === "string" ? body.landing_url : null,
        body.lander,
        typeof body.Lander === "string" ? body.Lander : null
      ),
      // Standaard bij Admin tot iemand anders overneemt
      ...(adminId ? { adviseur_id: adminId } : {}),
      // created_at / updated_at: database default now()
      raw_payload: body,
    };

    // fbclid → fbc cookie-formaat als fbc ontbreekt
    const fbclid = pickStr(
      typeof body.fbclid === "string" ? body.fbclid : null
    );
    if (!row.meta_fbc && fbclid) {
      row.meta_fbc = `fb.1.${Date.now()}.${fbclid}`;
    }

    let { data, error } = await supabase
      .from("leads")
      .insert(row)
      .select(
        "id, lead_number, created_at, naam, email, straat, plaats, utm_source, lander, campaign_name, ad_name"
      )
      .single();

    // Fallback als Meta CAPI-kolommen nog niet gemigreerd zijn
    if (
      error &&
      (error.message?.includes("meta_") ||
        error.message?.includes("capi_events") ||
        error.code === "42703")
    ) {
      const {
        meta_fbc: _fbc,
        meta_fbp: _fbp,
        meta_client_ip: _ip,
        meta_user_agent: _ua,
        meta_event_source_url: _url,
        ...withoutMeta
      } = row as typeof row & {
        meta_fbc?: string | null;
        meta_fbp?: string | null;
        meta_client_ip?: string | null;
        meta_user_agent?: string | null;
        meta_event_source_url?: string | null;
      };
      void _fbc;
      void _fbp;
      void _ip;
      void _ua;
      void _url;
      ({ data, error } = await supabase
        .from("leads")
        .insert(withoutMeta)
        .select(
          "id, lead_number, created_at, naam, email, straat, plaats, utm_source, lander, campaign_name, ad_name"
        )
        .single());
    }

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
          "id, lead_number, created_at, naam, email, straat, plaats, utm_source, lander, campaign_name, ad_name"
        )
        .single());
    }

    // Fallback als lander/campaign_name/ad_name nog niet gemigreerd zijn
    if (
      error &&
      (error.message?.includes("lander") ||
        error.message?.includes("campaign_name") ||
        error.message?.includes("ad_name") ||
        error.code === "42703")
    ) {
      const {
        lander: _l,
        campaign_name: _c,
        ad_name: _a,
        ...withoutAttr
      } = row as typeof row & {
        lander?: string | null;
        campaign_name?: string | null;
        ad_name?: string | null;
      };
      void _l;
      void _c;
      void _a;
      ({ data, error } = await supabase
        .from("leads")
        .insert(withoutAttr)
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
        lander: data.lander ?? null,
        campaign_name: data.campaign_name ?? null,
        ad_name: data.ad_name ?? null,
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
      lander: "thuisbatterij-scan",
      Campaign_name: "Meta_NL_Augustus",
      Ad_name: "Video_besparing_v2",
      utm_source: "facebook",
    },
    response: {
      ok: true,
      lead_id: "uuid",
      lead_number: "BC-20260813-A1B2",
      created_at: "2026-08-13T11:00:00.000Z",
      lander: "thuisbatterij-scan",
      campaign_name: "Meta_NL_Augustus",
      ad_name: "Video_besparing_v2",
    },
    notes: {
      campaign_name:
        "Aliases: campaign_name, Campaign_name, campaign, utm_campaign",
      ad_name: "Aliases: ad_name, Ad_name, ad, utm_content",
    },
  });
}
