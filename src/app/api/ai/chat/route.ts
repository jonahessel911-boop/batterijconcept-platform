import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import { requireAiAdmin } from "@/lib/ai/require-admin";
import { runCrmAiChat, type AiChatMessage } from "@/lib/ai/chat";

export const runtime = "nodejs";
export const maxDuration = 60;

/** POST /api/ai/chat — admin-only CRM AI chat */
export async function POST(req: NextRequest) {
  const gate = await requireAiAdmin();
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  let body: { messages?: AiChatMessage[]; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const messages: AiChatMessage[] = Array.isArray(body.messages)
    ? body.messages
        .filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string" &&
            m.content.trim()
        )
        .map((m) => ({
          role: m.role,
          content: m.content.trim().slice(0, 8000),
        }))
    : [];

  if (body.message?.trim()) {
    messages.push({ role: "user", content: body.message.trim().slice(0, 8000) });
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "Geen bericht" }, { status: 400 });
  }

  try {
    const result = await runCrmAiChat(messages);
    return NextResponse.json({
      reply: result.reply,
      toolsUsed: result.toolsUsed,
      proposedActions: result.proposedActions,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "AI chat mislukt") },
      { status: 500 }
    );
  }
}
