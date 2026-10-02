/**
 * POST /api/fonio/webhook/after
 *
 * Fonio Post-Call Webhook — na afloop gesprek.
 * Logt samenvatting / transcript + geeft dialer-slot vrij.
 *
 * Auth: header x-fonio-secret: FONIO_WEBHOOK_SECRET
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { logLeadEvent } from "@/lib/lead-events";
import {
  authorizeFonioWebhook,
  phoneMatchVariants,
  pickStr,
  toE164Nl,
} from "@/lib/fonio";
import {
  closeOldestOpenFonioCall,
  completeFonioCallForLead,
} from "@/lib/fonio-dialer";

export const runtime = "nodejs";

function pickNested(
  body: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null) return body[key];
  }
  const ctx =
    body.context && typeof body.context === "object"
      ? (body.context as Record<string, unknown>)
      : null;
  if (ctx) {
    for (const key of keys) {
      if (ctx[key] !== undefined && ctx[key] !== null) return ctx[key];
    }
  }
  return null;
}

function collectPhones(body: Record<string, unknown>): string[] {
  const raw = [
    pickNested(body, "telefoon", "phone", "toNumber", "to_number", "calledNumber", "called_number"),
    pickNested(body, "fromNumber", "from_number", "callerNumber", "caller_number"),
    body.customerNumber,
    body.customer_number,
  ];
  const out: string[] = [];
  for (const v of raw) {
    const e164 = toE164Nl(typeof v === "string" ? v : pickStr(v));
    if (e164 && !out.includes(e164)) out.push(e164);
  }
  return out;
}

async function resolveLeadId(
  body: Record<string, unknown>
): Promise<{ leadId: string | null; phone: string | null }> {
  const direct = pickStr(
    pickNested(body, "lead_id", "leadId") as string | undefined
  );
  if (direct && !direct.includes("{{")) {
    return { leadId: direct, phone: null };
  }

  const phones = collectPhones(body);
  if (phones.length === 0) return { leadId: null, phone: null };

  const sb = getSupabaseAdmin();
  for (const phone of phones) {
    const variants = phoneMatchVariants(phone);
    const { data: leads } = await sb
      .from("leads")
      .select("id, telefoon")
      .or(variants.map((v) => `telefoon.eq.${v}`).join(","))
      .order("created_at", { ascending: false })
      .limit(5);

    const lead =
      (leads || []).find((l) => toE164Nl(l.telefoon) === phone) || leads?.[0];
    if (lead?.id) return { leadId: lead.id, phone };
  }

  // Match open fonio_calls on number
  for (const phone of phones) {
    const { data: call } = await sb
      .from("fonio_calls")
      .select("lead_id, to_number")
      .eq("to_number", phone)
      .in("status", ["ringing", "active"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (call?.lead_id) return { leadId: call.lead_id, phone };
  }

  return { leadId: null, phone: phones[0] || null };
}

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

  try {
    console.info("Fonio after body keys", Object.keys(body));

    const { leadId: resolvedLead, phone } = await resolveLeadId(body);
    let leadId = resolvedLead;

    const summary = pickStr(
      pickNested(
        body,
        "summary",
        "samenvatting",
        "call_summary",
        "callSummary"
      ) as string | undefined
    );
    const transcript = pickStr(
      pickNested(
        body,
        "transcript",
        "transcription",
        "gesprek",
        "recording_transcript"
      ) as string | undefined
    );
    const outcome = pickStr(
      pickNested(
        body,
        "outcome",
        "resultaat",
        "status",
        "disposition"
      ) as string | undefined
    );
    const durationRaw = pickNested(
      body,
      "duration",
      "duration_seconds",
      "call_duration",
      "durationSeconds"
    );
    const duration =
      typeof durationRaw === "number"
        ? durationRaw
        : typeof durationRaw === "string" && durationRaw.trim()
          ? Number(durationRaw)
          : null;

    const sb = getSupabaseAdmin();

    // Altijd een dialer-slot vrijgeven — ook zonder lead_id/telefoon
    if (!leadId) {
      leadId = await closeOldestOpenFonioCall(sb, "after_no_id");
      console.warn("Fonio after: geen lead in body → oudste open call gesloten", {
        keys: Object.keys(body),
        phone,
        closedLead: leadId,
      });
    }

    if (!leadId) {
      return NextResponse.json({
        ok: true,
        logged: false,
        reason: "Geen open call / lead",
      });
    }

    const detailParts: string[] = [];
    if (outcome) detailParts.push(`Uitkomst: ${outcome}`);
    if (duration != null && Number.isFinite(duration)) {
      detailParts.push(`Duur: ${Math.round(duration)}s`);
    }
    if (summary) detailParts.push(summary);
    else if (transcript) {
      detailParts.push(
        transcript.length > 1200
          ? `${transcript.slice(0, 1200)}…`
          : transcript
      );
    }

    await logLeadEvent({
      leadId,
      soort: "bel",
      titel: "Fonio gesprek afgerond",
      detail: detailParts.join("\n\n") || null,
      meta: {
        bron: "fonio",
        outcome: outcome || null,
        duration_seconds:
          duration != null && Number.isFinite(duration) ? duration : null,
        has_transcript: Boolean(transcript),
        has_summary: Boolean(summary),
      },
    });

    if (summary) {
      const { data: lead } = await sb
        .from("leads")
        .select("notities")
        .eq("id", leadId)
        .maybeSingle();
      const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
      const line = `[Fonio ${stamp}] ${summary}`;
      const prev = (lead?.notities || "").trim();
      const next = prev ? `${prev}\n\n${line}` : line;
      await sb
        .from("leads")
        .update({ notities: next.slice(0, 8000) })
        .eq("id", leadId);
    }

    const { data: leadStatus } = await sb
      .from("leads")
      .select("status")
      .eq("id", leadId)
      .maybeSingle();
    const booked =
      leadStatus?.status === "afspraak" ||
      leadStatus?.status === "na_afspraak";

    await completeFonioCallForLead(sb, leadId, {
      summary,
      outcome,
      booked,
      toNumber: phone,
    });

    return NextResponse.json({
      ok: true,
      logged: true,
      lead_id: leadId,
      booked,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "After-webhook mislukt") },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/fonio/webhook/after",
    method: "POST",
    auth: "x-fonio-secret: FONIO_WEBHOOK_SECRET",
    note: "Sluit dialer-slot + logt gesprek. Zonder lead_id: oudste open call.",
  });
}
