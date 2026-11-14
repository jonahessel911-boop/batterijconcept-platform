import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { listInboxMails, rowToInboxMail } from "@/lib/inbox-persist";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/**
 * GET /api/inbox
 * ?folder=…&email=…&lead_id=…&limit=…
 * Zonder email/lead_id: volledige inbox (admin/backoffice).
 */
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (
      rol !== "admin" &&
      rol !== "backoffice" &&
      rol !== "sales_manager"
    ) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const sp = req.nextUrl.searchParams;
    const email = (sp.get("email") || "").trim().toLowerCase();
    const leadId = (sp.get("lead_id") || "").trim();
    const folder = (sp.get("folder") || "").trim() || null;
    const limit = Number(sp.get("limit") || 100) || 100;

    // Per-klant view mag met email/lead; volledige inbox alleen admin/BO
    if (!email && !leadId && rol === "sales_manager") {
      return NextResponse.json(
        { error: "email of lead_id verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const rows = await listInboxMails(sb, {
      folder,
      email: email || null,
      leadId: leadId || null,
      limit,
    });

    return NextResponse.json({
      mails: rows.map(rowToInboxMail),
      count: rows.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Inbox laden mislukt") },
      { status: 500 }
    );
  }
}
