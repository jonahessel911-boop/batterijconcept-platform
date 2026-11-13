import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";
import { patchInboxMail, rowToInboxMail } from "@/lib/inbox-persist";
import type { InboxMailStatus } from "@/lib/inbox";

export const runtime = "nodejs";

const ALLOWED: InboxMailStatus[] = ["nieuw", "gelezen", "afgehandeld"];

/**
 * PATCH /api/instroom/inbox/[id]
 * Status bijwerken (o.a. markeer als gelezen).
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { id } = await ctx.params;
    if (!id?.trim()) {
      return NextResponse.json({ error: "id verplicht" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      status?: string;
    };
    const status = (body.status || "").trim() as InboxMailStatus;
    if (!ALLOWED.includes(status)) {
      return NextResponse.json(
        { error: "status moet nieuw, gelezen of afgehandeld zijn" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const row = await patchInboxMail(sb, id.trim(), { status });
    if (!row) {
      return NextResponse.json({ error: "Mail niet gevonden" }, { status: 404 });
    }
    return NextResponse.json({ mail: rowToInboxMail(row) });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Bijwerken mislukt") },
      { status: 500 }
    );
  }
}
