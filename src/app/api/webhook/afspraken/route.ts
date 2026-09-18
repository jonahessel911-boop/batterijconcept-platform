import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { isAdminAdviseur } from "@/lib/admin-adviseur";
import { normalizeAfspraakSoort } from "@/lib/afspraak-soort";
import {
  parseAfspraakStartAt,
  parseJaNee,
  planAfspraak,
} from "@/lib/plan-afspraak";

export const runtime = "nodejs";

function pickStr(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function withWebhookAuth(req: NextRequest) {
  const expected = process.env.AFSPRAAK_WEBHOOK_SECRET?.trim();
  if (!expected) return true;
  const provided = req.headers.get("x-webhook-secret")?.trim();
  return Boolean(provided && provided === expected);
}

/**
 * GET /api/webhook/afspraken — docs
 * POST /api/webhook/afspraken — afspraak inplannen (extern)
 *
 * Zelfde planningsflow als CRM POST /api/afspraken (overlap-check, leadstatus,
 * bevestigingsmail bij soort=nieuw).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "POST /api/webhook/afspraken",
    auth: "Header x-webhook-secret (alleen als AFSPRAAK_WEBHOOK_SECRET is gezet)",
    body: {
      lead_id: "uuid — of lead_number",
      lead_number: "BC-YYYYMMDD-XXXX (alternatief voor lead_id)",
      adviseur_id: "uuid — of adviseur_email; anders lead.adviseur_id",
      adviseur_email: "optioneel",
      start_at:
        "ISO (UTC) of Amsterdam-lokaal YYYY-MM-DDTHH:mm / YYYY-MM-DD HH:mm",
      soort: "nieuw | bel | warme_bel | vervolg_fysiek | vervolg_tel | vervolg_punt (default: nieuw)",
      partner_aanwezig: "ja/nee — verplicht bij soort=nieuw",
      andere_offertes_gehad: "ja/nee — verplicht bij soort=nieuw",
      notities: "optioneel",
    },
    example: {
      lead_number: "BC-20260916-A1B2",
      adviseur_email: "huub@batterijconcept.nl",
      start_at: "2026-09-20T13:00",
      soort: "nieuw",
      partner_aanwezig: true,
      andere_offertes_gehad: false,
      notities: "Via website planner",
    },
  });
}

export async function POST(req: NextRequest) {
  if (!withWebhookAuth(req)) {
    return NextResponse.json({ error: "Ongeldige webhook-secret" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const leadIdRaw = pickStr(body.lead_id, body.leadId);
  const leadNumber = pickStr(
    body.lead_number,
    body.leadNumber,
    body.lead_nummer
  );
  const adviseurIdRaw = pickStr(body.adviseur_id, body.adviseurId);
  const adviseurEmail = pickStr(
    body.adviseur_email,
    body.adviseurEmail,
    body.adviseur
  )?.toLowerCase();
  const startRaw = pickStr(body.start_at, body.startAt, body.start, body.datum);
  const notities = pickStr(body.notities, body.notes, body.opmerking, body.bericht);
  const soort = normalizeAfspraakSoort(
    pickStr(body.soort, body.type, body.afspraak_soort) || "nieuw"
  );

  if (!startRaw) {
    return NextResponse.json(
      { error: "start_at is verplicht (ISO of Amsterdam YYYY-MM-DDTHH:mm)" },
      { status: 400 }
    );
  }
  if (!leadIdRaw && !leadNumber) {
    return NextResponse.json(
      { error: "lead_id of lead_number is verplicht" },
      { status: 400 }
    );
  }

  const start = parseAfspraakStartAt(startRaw);
  if (!start) {
    return NextResponse.json({ error: "Ongeldige start_at" }, { status: 400 });
  }

  let partnerAanwezig = parseJaNee(
    body.partner_aanwezig ?? body.partnerAanwezig ?? body.partner
  );
  let andereOffertes = parseJaNee(
    body.andere_offertes_gehad ??
      body.andereOffertesGehad ??
      body.andere_offertes
  );

  // Webhook-default voor huisbezoek als niet meegegeven (zelfde als Agenda V2)
  if (soort === "nieuw") {
    if (partnerAanwezig === undefined) partnerAanwezig = true;
    if (andereOffertes === undefined) andereOffertes = false;
  }

  try {
    const sb = getSupabaseAdmin();

    let lead: {
      id: string;
      lead_number: string | null;
      adviseur_id: string | null;
      naam: string | null;
    } | null = null;

    if (leadIdRaw) {
      const { data } = await sb
        .from("leads")
        .select("id, lead_number, adviseur_id, naam")
        .eq("id", leadIdRaw)
        .maybeSingle();
      lead = data;
    } else if (leadNumber) {
      const { data } = await sb
        .from("leads")
        .select("id, lead_number, adviseur_id, naam")
        .eq("lead_number", leadNumber)
        .maybeSingle();
      lead = data;
    }

    if (!lead) {
      return NextResponse.json({ error: "Lead niet gevonden" }, { status: 404 });
    }

    let adviseurId = adviseurIdRaw || lead.adviseur_id || null;

    if (!adviseurId && adviseurEmail) {
      const { data: byEmail } = await sb
        .from("adviseurs")
        .select("id, naam, email, actief")
        .ilike("email", adviseurEmail)
        .maybeSingle();
      if (byEmail?.id && byEmail.actief !== false) {
        adviseurId = byEmail.id;
      }
    }

    if (!adviseurId) {
      const { data: adviseurs } = await sb
        .from("adviseurs")
        .select("id, naam, email, actief")
        .eq("actief", true)
        .order("naam");
      const pick = (adviseurs || []).find((a) => !isAdminAdviseur(a));
      adviseurId = pick?.id || adviseurs?.[0]?.id || null;
    }

    if (!adviseurId) {
      return NextResponse.json(
        { error: "Geen adviseur gevonden (geef adviseur_id of adviseur_email)" },
        { status: 400 }
      );
    }

    const { data: adviseurOk } = await sb
      .from("adviseurs")
      .select("id")
      .eq("id", adviseurId)
      .maybeSingle();
    if (!adviseurOk) {
      return NextResponse.json(
        { error: "Adviseur niet gevonden" },
        { status: 404 }
      );
    }

    const result = await planAfspraak(sb, {
      lead_id: lead.id,
      adviseur_id: adviseurId,
      start_at: start,
      soort,
      notities,
      partner_aanwezig: partnerAanwezig,
      andere_offertes_gehad: andereOffertes,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }

    const afspraak = result.afspraak as {
      id?: string;
      start_at?: string;
      end_at?: string;
      status?: string;
      soort?: string;
    };

    return NextResponse.json(
      {
        ok: true,
        afspraak_id: afspraak.id,
        lead_id: lead.id,
        lead_number: lead.lead_number,
        start_at: afspraak.start_at,
        end_at: afspraak.end_at,
        status: afspraak.status,
        soort: afspraak.soort,
        manage_url: result.manage_url,
        bevestiging_direct: result.bevestiging_direct,
        bevestiging_error: result.bevestiging_error,
        afspraak: result.afspraak,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Afspraak plannen mislukt") },
      { status: 500 }
    );
  }
}
