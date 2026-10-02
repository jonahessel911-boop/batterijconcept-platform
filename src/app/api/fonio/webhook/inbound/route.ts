/**
 * POST /api/fonio/webhook/inbound
 *
 * Fonio Inbound Webhook — vóór/bij start gesprek.
 * Body (Fonio): { fromNumber, toNumber, … }
 * Response JSON → beschikbaar als {{naam}}, {{lead_id}}, …
 *
 * Auth: header x-fonio-secret: FONIO_WEBHOOK_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  authorizeFonioWebhook,
  buildFonioLeadContext,
  phoneMatchVariants,
  pickStr,
  toE164Nl,
} from "@/lib/fonio";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = authorizeFonioWebhook(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const fromNumber = pickStr(
    body.fromNumber,
    body.from_number,
    body.telefoon,
    body.phone
  );
  const e164 = toE164Nl(fromNumber);
  const variants = phoneMatchVariants(fromNumber);

  if (!e164 || variants.length === 0) {
    return NextResponse.json({
      found: false,
      naam: "klant",
      firstName: "klant",
    });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: leads, error } = await sb
      .from("leads")
      .select(
        "id, naam, email, telefoon, straat, huisnummer, toevoeging, postcode, plaats, lead_number, status, notities"
      )
      .or(variants.map((v) => `telefoon.eq.${v}`).join(","))
      .order("created_at", { ascending: false })
      .limit(5);

    if (error) throw error;

    const lead =
      (leads || []).find((l) => toE164Nl(l.telefoon) === e164) ||
      leads?.[0] ||
      null;

    if (!lead) {
      return NextResponse.json({
        found: false,
        naam: "klant",
        firstName: "klant",
        telefoon: e164,
      });
    }

    return NextResponse.json({
      found: true,
      ...buildFonioLeadContext(lead),
      telefoon: e164,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Lead zoeken mislukt"), found: false },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/fonio/webhook/inbound",
    method: "POST",
    auth: "x-fonio-secret: FONIO_WEBHOOK_SECRET",
    fonio: "Assistant → Webhooks → Inbound Webhook → deze URL",
    example_request: { fromNumber: "+31639253647", toNumber: "+31857995113" },
    example_response: {
      found: true,
      naam: "Jan Jansen",
      firstName: "Jan",
      lead_id: "uuid",
    },
  });
}
