/**
 * POST /api/fonio/outbound
 * Start outbound call voor een lead (of los telefoonnummer).
 *
 * Body: { lead_id }  of  { telefoon, naam?, lead_id? }
 * Auth: Authorization: Bearer API_V1_KEY  of  x-api-key
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireApiKey } from "@/lib/api-v1/auth";
import {
  buildFonioLeadContext,
  fonioConfigured,
  pickStr,
  rememberFonioOutboundLead,
  toE164Nl,
  triggerFonioOutbound,
} from "@/lib/fonio";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const denied = requireApiKey(req, { scopes: ["admin"] });
  if (denied) return denied;

  if (!fonioConfigured()) {
    return NextResponse.json(
      {
        error: "Fonio niet geconfigureerd",
        hint: "Zet FONIO_API_KEY en FONIO_FROM_NUMBER in env",
      },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const leadId = pickStr(body.lead_id, body.leadId);
  let telefoon = pickStr(body.telefoon, body.phone, body.toNumber, body.to);
  let context: Record<string, unknown> = {};

  try {
    const sb = getSupabaseAdmin();

    if (leadId) {
      const { data: lead, error } = await sb
        .from("leads")
        .select(
          "id, naam, email, telefoon, straat, huisnummer, toevoeging, postcode, plaats, lead_number, status, notities"
        )
        .eq("id", leadId)
        .maybeSingle();
      if (error) throw error;
      if (!lead) {
        return NextResponse.json({ error: "Lead niet gevonden" }, { status: 404 });
      }
      telefoon = telefoon || lead.telefoon;
      context = buildFonioLeadContext(lead);
    } else {
      const naam = pickStr(body.naam, body.name, body.firstName) || "klant";
      context = buildFonioLeadContext({
        naam,
        telefoon,
        plaats: pickStr(body.plaats, body.city),
        straat: pickStr(body.straat, body.adres),
        huisnummer: pickStr(body.huisnummer),
        toevoeging: pickStr(body.toevoeging),
        postcode: pickStr(body.postcode),
        email: pickStr(body.email),
      });
    }

    const to = toE164Nl(telefoon);
    if (!to) {
      return NextResponse.json(
        { error: "Geen geldig telefoonnummer" },
        { status: 400 }
      );
    }
    context.telefoon = to;

    if (leadId) {
      await rememberFonioOutboundLead({ leadId, toNumber: to });
    }

    const result = await triggerFonioOutbound({
      toNumber: to,
      context,
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.data },
        { status: result.status >= 400 ? result.status : 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      toNumber: to,
      lead_id: leadId || null,
      context,
      fonio: result.data,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Outbound mislukt") },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/fonio/outbound",
    method: "POST",
    auth: "Authorization: Bearer API_V1_KEY",
    body: { lead_id: "uuid" },
    context_fields: [
      "firstName",
      "naam",
      "lead_id",
      "lead_number",
      "email",
      "telefoon",
      "straat",
      "huisnummer",
      "toevoeging",
      "postcode",
      "plaats",
      "adres",
      "status",
      "notities",
    ],
  });
}
