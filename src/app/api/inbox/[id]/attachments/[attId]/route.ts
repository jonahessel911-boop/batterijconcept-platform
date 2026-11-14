import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { downloadInboxAttachment } from "@/lib/inbox-attachments";
import { isInboxImageAttachment } from "@/lib/inbox";
import { getInboxMail, rowToInboxMail } from "@/lib/inbox-persist";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/inbox/[id]/attachments/[attId]
 * Afbeeldingen inline (galerij); ?download=1 forceren als download.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; attId: string }> }
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

    const { id, attId } = await ctx.params;
    if (!id?.trim() || !attId?.trim()) {
      return NextResponse.json({ error: "id verplicht" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const row = await getInboxMail(sb, id.trim());
    if (!row) {
      return NextResponse.json({ error: "Mail niet gevonden" }, { status: 404 });
    }
    const mail = rowToInboxMail(row);
    const att = (mail.attachments || []).find((a) => a.id === attId.trim());
    if (!att) {
      return NextResponse.json(
        { error: "Bijlage niet gevonden" },
        { status: 404 }
      );
    }

    const file = await downloadInboxAttachment(att.storagePath);
    if (!file) {
      return NextResponse.json(
        { error: "Bestand niet beschikbaar" },
        { status: 404 }
      );
    }

    const filename = att.filename.replace(/"/g, "");
    const forceDownload = req.nextUrl.searchParams.get("download") === "1";
    const asImage = isInboxImageAttachment(att) && !forceDownload;
    return new NextResponse(new Uint8Array(file.bytes), {
      status: 200,
      headers: {
        "Content-Type": att.contentType || file.contentType,
        "Content-Disposition": asImage
          ? `inline; filename="${filename}"`
          : `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
