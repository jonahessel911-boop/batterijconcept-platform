import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { getSupabaseAdmin } from "@/lib/supabase";
import { normalizeRol } from "@/lib/rollen";
import type { InboxFolderId, InboxMail, InboxMailStatus } from "@/lib/inbox";

export const runtime = "nodejs";

type DbInboxRow = {
  id: string;
  folder: string;
  status: string;
  from_name: string | null;
  from_email: string;
  to_email: string;
  subject: string;
  body_text: string;
  received_at: string;
  lead_id: string | null;
  project_id: string | null;
  afspraak_id: string | null;
  suggested_actions: string[] | null;
  ai_summary: string | null;
  thread_id: string | null;
};

function rowToMail(row: DbInboxRow): InboxMail {
  return {
    id: row.id,
    folder: (row.folder || "algemeen") as InboxFolderId,
    status: (row.status || "nieuw") as InboxMailStatus,
    fromName: row.from_name || row.from_email,
    fromEmail: row.from_email,
    toEmail: row.to_email || "info@batterijconcept.nl",
    subject: row.subject || "(geen onderwerp)",
    bodyText: row.body_text || "",
    receivedAt: row.received_at,
    suggestedActions: (row.suggested_actions || []) as InboxMail["suggestedActions"],
    aiSummary: row.ai_summary,
    leadId: row.lead_id,
    projectId: row.project_id,
    afspraakId: row.afspraak_id,
    threadId: row.thread_id || undefined,
  };
}

/**
 * GET /api/inbox?email=…&lead_id=…
 * Mails voor deze klant (from/to e-mail of lead_id).
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

    const email = (req.nextUrl.searchParams.get("email") || "")
      .trim()
      .toLowerCase();
    const leadId = (req.nextUrl.searchParams.get("lead_id") || "").trim();
    if (!email && !leadId) {
      return NextResponse.json(
        { error: "email of lead_id verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    let query = sb
      .from("inbox_mails")
      .select(
        "id, folder, status, from_name, from_email, to_email, subject, body_text, received_at, lead_id, project_id, afspraak_id, suggested_actions, ai_summary, thread_id"
      )
      .order("received_at", { ascending: false })
      .limit(50);

    if (leadId && email) {
      query = query.or(
        `lead_id.eq.${leadId},from_email.eq.${email},to_email.eq.${email}`
      );
    } else if (leadId) {
      query = query.eq("lead_id", leadId);
    } else {
      // Exact match; DB-index op lower(from_email) — filter case-insensitive via eq
      // nadat we email al normaliseren naar lowercase.
      query = query.or(`from_email.eq.${email},to_email.eq.${email}`);
    }

    const { data, error } = await query;
    if (error) {
      // Tabel nog niet gemigreerd → lege inbox (UX blijft werken)
      if (
        error.code === "42P01" ||
        /inbox_mails|does not exist|relation/i.test(error.message || "")
      ) {
        return NextResponse.json({ mails: [] as InboxMail[] });
      }
      return NextResponse.json(
        { error: "Inbox laden mislukt", detail: error.message },
        { status: 500 }
      );
    }

    const mails = ((data || []) as DbInboxRow[]).map(rowToMail);
    return NextResponse.json({ mails });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Inbox laden mislukt") },
      { status: 500 }
    );
  }
}
