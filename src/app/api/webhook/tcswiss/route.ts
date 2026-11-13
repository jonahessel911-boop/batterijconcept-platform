/**
 * POST /api/webhook/tcswiss
 *
 * Ontvangt RelayPro / TC Swiss partner-gebeurtenissen (push).
 * Docs: https://mijn.tcswiss.nl/partner-docs?bron=Batterijconcept
 *
 * Soorten: uitkomst | afspraak | offerte | verkoop | verkoop_teruggedraaid |
 *          status | notitie | document | partner_actie | test
 *
 * Auth (in volgorde):
 * 1. Standard Webhooks / legacy HMAC met TCSWISS_RELAYPRO_WEBHOOK_SECRET
 * 2. X-RelayPro-Token == TCSWISS_RELAYPRO_TOKEN (alleen zonder webhook-secret)
 * 3. TCSWISS_WEBHOOK_ALLOW_UNSIGNED=1 (alleen lokaal testen)
 *
 * Configureer bij TC Swiss webhook-URL:
 *   https://platform.batterijconcept.nl/api/webhook/tcswiss
 */

import { NextRequest, NextResponse } from "next/server";
import { authorizeTcSwissWebhook } from "@/lib/tcswiss";
import { ingestTcSwissEvents } from "@/lib/tcswiss-webhook";
import { readTcSwissEvents } from "@/lib/tcswiss-events-store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  const store = readTcSwissEvents();
  return NextResponse.json({
    endpoint: "/api/webhook/tcswiss",
    ok: true,
    lastVolgnummer: store.lastVolgnummer,
    stored: store.items.length,
    recent: store.items.slice(0, 5).map((i) => ({
      id: i.id,
      volgnummer: i.volgnummer,
      soort: i.soort,
      lead: i.lead,
      externId: i.externId,
      receivedAt: i.receivedAt,
      logged: i.logged,
    })),
    auth: {
      webhookSecret: Boolean(
        process.env.TCSWISS_RELAYPRO_WEBHOOK_SECRET?.trim() ||
          process.env.TCSWISS_WEBHOOK_SECRET?.trim()
      ),
      partnerToken: Boolean(process.env.TCSWISS_RELAYPRO_TOKEN?.trim()),
      allowUnsigned: process.env.TCSWISS_WEBHOOK_ALLOW_UNSIGNED === "1",
    },
    soorten: [
      "uitkomst",
      "afspraak",
      "offerte",
      "verkoop",
      "verkoop_teruggedraaid",
      "status",
      "notitie",
      "document",
      "partner_actie",
      "test",
    ],
    configure:
      "https://platform.batterijconcept.nl/api/webhook/tcswiss",
  });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const auth = authorizeTcSwissWebhook({
    rawBody,
    headers: req.headers,
  });
  if (!auth.ok) {
    return NextResponse.json(
      { error: "Unauthorized", reason: auth.reason },
      { status: 401 }
    );
  }

  let parsed: unknown = {};
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await ingestTcSwissEvents({
      rawJson: parsed,
      source: "webhook",
    });
    return NextResponse.json({
      ok: true,
      via: auth.via,
      ...result,
    });
  } catch (e) {
    console.error("tcswiss webhook:", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Webhook verwerken mislukt",
      },
      { status: 500 }
    );
  }
}
