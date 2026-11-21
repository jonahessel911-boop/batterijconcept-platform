import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-require-admin";
import { TEST_FLOW_STEPS } from "@/lib/afspraak-opvolging/test-flow-defs";
import {
  sendTestFlowStep,
  type TestFlowId,
  type TestFlowStepId,
} from "@/lib/afspraak-opvolging/test-flow-steps";
import { toE164Nl } from "@/lib/sms/phone";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * POST /api/opvolging-ab/test-flow-step
 * Body: { flow, stepId, email?, telefoon?, voornaam? }
 * Stuurt één stap van de A/B-flow (admin-only).
 */
export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await req.json()) as {
      flow?: unknown;
      stepId?: unknown;
      email?: unknown;
      telefoon?: unknown;
      voornaam?: unknown;
    };

    const flow = body.flow as TestFlowId;
    const stepId = body.stepId as TestFlowStepId;
    if (flow !== "intensief" && flow !== "rustig") {
      return NextResponse.json({ error: "flow ongeldig" }, { status: 400 });
    }
    if (!TEST_FLOW_STEPS[flow].some((s) => s.id === stepId)) {
      return NextResponse.json(
        { error: "stepId hoort niet bij deze flow" },
        { status: 400 }
      );
    }

    const emailRaw =
      typeof body.email === "string" ? body.email.trim() : "";
    const email = emailRaw ? emailRaw.toLowerCase() : null;
    if (email && !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Ongeldig e-mailadres" },
        { status: 400 }
      );
    }

    const telRaw =
      typeof body.telefoon === "string" ? body.telefoon.trim() : "";
    const telefoon = telRaw ? toE164Nl(telRaw) : null;
    if (telRaw && !telefoon) {
      return NextResponse.json(
        { error: "Ongeldig telefoonnummer" },
        { status: 400 }
      );
    }

    const step = TEST_FLOW_STEPS[flow].find((s) => s.id === stepId)!;
    if (step.hasMail && !email) {
      return NextResponse.json(
        { error: "E-mailadres verplicht voor deze stap" },
        { status: 400 }
      );
    }
    if (step.hasSms && !telefoon) {
      return NextResponse.json(
        { error: "Telefoonnummer verplicht voor deze stap" },
        { status: 400 }
      );
    }

    const voornaam =
      typeof body.voornaam === "string" && body.voornaam.trim()
        ? body.voornaam.trim()
        : email?.split("@")[0] || "Test";

    const result = await sendTestFlowStep({
      flow,
      stepId,
      email,
      telefoon,
      voornaam,
    });

    return NextResponse.json({
      ...result,
      flow,
      stepId,
      email,
      telefoon,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** GET — stappenlijst per flow (admin). */
export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({ steps: TEST_FLOW_STEPS });
}
