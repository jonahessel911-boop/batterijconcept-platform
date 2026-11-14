import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import type { InboxFolderId, InboxMailStatus } from "@/lib/inbox";
import {
  deleteInboxMail,
  patchInboxMail,
  rowToInboxMail,
} from "@/lib/inbox-persist";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * DELETE /api/inbox/[id]
 * Mail hard verwijderen uit de mailbox.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (rol !== "admin" && rol !== "backoffice") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const { id } = await ctx.params;
    if (!id?.trim()) {
      return NextResponse.json({ error: "id verplicht" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    await deleteInboxMail(sb, id.trim());
    return NextResponse.json({ ok: true, deletedId: id.trim() });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/inbox/[id]
 * Map / status / AI-velden bijwerken.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (rol !== "admin" && rol !== "backoffice") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const { id } = await ctx.params;
    if (!id?.trim()) {
      return NextResponse.json({ error: "id verplicht" }, { status: 400 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      folder?: InboxFolderId;
      status?: InboxMailStatus;
      aiSummary?: string | null;
      aiReason?: string | null;
      aiConfidence?: number | null;
      aiClassifiedAt?: string | null;
      aiFunction?: string | null;
      aiEffects?: Record<string, boolean> | null;
      suggestedActions?: string[] | null;
    };

    const sb = getSupabaseAdmin();
    const row = await patchInboxMail(sb, id.trim(), {
      folder: body.folder || null,
      status: body.status || null,
      ...("aiSummary" in body ? { aiSummary: body.aiSummary } : {}),
      ...("aiReason" in body ? { aiReason: body.aiReason } : {}),
      ...("aiConfidence" in body ? { aiConfidence: body.aiConfidence } : {}),
      ...("aiClassifiedAt" in body
        ? { aiClassifiedAt: body.aiClassifiedAt }
        : {}),
      ...("aiFunction" in body ? { aiFunction: body.aiFunction } : {}),
      ...("aiEffects" in body
        ? {
            aiEffects: body.aiEffects
              ? {
                  createServiceVerzoek: Boolean(
                    body.aiEffects.createServiceVerzoek
                  ),
                  cancelAfspraak: Boolean(body.aiEffects.cancelAfspraak),
                  leadGeenContact: Boolean(body.aiEffects.leadGeenContact),
                  leadGeenInteresse: Boolean(
                    body.aiEffects.leadGeenInteresse
                  ),
                }
              : null,
          }
        : {}),
      ...("suggestedActions" in body
        ? { suggestedActions: body.suggestedActions }
        : {}),
    });
    if (!row) {
      return NextResponse.json({ error: "Mail niet gevonden" }, { status: 404 });
    }
    return NextResponse.json({ mail: rowToInboxMail(row) });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Inbox update mislukt") },
      { status: 500 }
    );
  }
}
