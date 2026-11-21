import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-require-admin";
import { isBirdSmsConfigured, sendSms } from "@/lib/sms/bird";
import { toE164Nl } from "@/lib/sms/phone";

export const runtime = "nodejs";

/**
 * POST /api/opvolging-ab/test-sms
 * Body: { to: string, body?: string }
 * Admin-only: stuurt 1 test-SMS via Bird.
 */
export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  if (!isBirdSmsConfigured()) {
    return NextResponse.json(
      { error: "Bird SMS niet geconfigureerd (BIRD_API_KEY / BIRD_SMS_FROM)" },
      { status: 503 }
    );
  }

  try {
    const body = (await req.json()) as { to?: unknown; body?: unknown };
    const toRaw = typeof body.to === "string" ? body.to : "";
    const to = toE164Nl(toRaw);
    if (!to) {
      return NextResponse.json(
        { error: "Ongeldig telefoonnummer (to)" },
        { status: 400 }
      );
    }

    const text =
      (typeof body.body === "string" && body.body.trim()) ||
      `Batterijconcept test-SMS · ${new Date().toLocaleString("nl-NL", {
        timeZone: "Europe/Amsterdam",
      })}`;

    const result = await sendSms({
      to,
      body: text,
      tag: "admin-test-sms",
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error || "SMS mislukt" },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      to,
      messageId: result.messageId ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
