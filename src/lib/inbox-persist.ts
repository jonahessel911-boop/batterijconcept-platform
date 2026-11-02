/**
 * Persist AI-geboekte mails naar inbox_mails.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  actionsForFolder,
  normalizeInboxFolder,
  type InboxAttachment,
  type InboxFolderId,
  type InboxMail,
  type InboxMailStatus,
} from "@/lib/inbox";
import { logInboxMailNotitie } from "@/lib/inbox-notitie";

export type InboxDbRow = {
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
  ai_reason: string | null;
  ai_confidence: number | null;
  ai_classified_at: string | null;
  ai_function: string | null;
  ai_effects: InboxMail["aiEffects"] | null;
  thread_id: string | null;
  message_id: string | null;
  body_html: string | null;
  in_reply_to: string | null;
  /** AI-boeking leeft hier: de live tabel heeft nog geen ai_* kolommen. */
  raw_headers: Record<string, unknown> | null;
};

function parseAttachments(
  raw: Record<string, unknown> | null | undefined
): InboxAttachment[] {
  const list = raw?.attachments;
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const a = item as Record<string, unknown>;
      const id = typeof a.id === "string" ? a.id : "";
      const filename = typeof a.filename === "string" ? a.filename : "";
      const storagePath =
        typeof a.storagePath === "string" ? a.storagePath : "";
      if (!id || !filename || !storagePath) return null;
      return {
        id,
        filename,
        contentType:
          typeof a.contentType === "string"
            ? a.contentType
            : "application/octet-stream",
        size: typeof a.size === "number" ? a.size : 0,
        storagePath,
        isImage: typeof a.isImage === "boolean" ? a.isImage : undefined,
      } satisfies InboxAttachment;
    })
    .filter((x): x is InboxAttachment => Boolean(x));
}

function parseImageUrls(
  raw: Record<string, unknown> | null | undefined
): string[] {
  const list = raw?.image_urls;
  if (!Array.isArray(list)) return [];
  return list
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    .map((u) => u.trim())
    .slice(0, 24);
}

function aiFromRaw(raw: Record<string, unknown> | null | undefined) {
  const r = raw || {};
  const effects = r.ai_effects;
  return {
    aiSummary: typeof r.ai_summary === "string" ? r.ai_summary : null,
    aiReason: typeof r.ai_reason === "string" ? r.ai_reason : null,
    aiConfidence:
      typeof r.ai_confidence === "number" ? r.ai_confidence : null,
    aiClassifiedAt:
      typeof r.ai_classified_at === "string" ? r.ai_classified_at : null,
    aiEffects:
      effects && typeof effects === "object"
        ? (effects as InboxMail["aiEffects"])
        : null,
    attachments: parseAttachments(r),
    imageUrls: parseImageUrls(r),
  };
}

export function rowToInboxMail(row: InboxDbRow): InboxMail {
  const ai = aiFromRaw(row.raw_headers);
  const intended =
    typeof row.raw_headers?.intended_folder === "string"
      ? row.raw_headers.intended_folder
      : null;
  let folder = normalizeInboxFolder(intended || row.folder);
  // Legacy: afspraak-afzegging zat in algemeen + effect
  if (folder === "algemeen" && ai.aiEffects?.cancelAfspraak) {
    folder = "afzegging_afspraak";
  }
  const suggested =
    (row.suggested_actions || []).length > 0
      ? (row.suggested_actions as InboxMail["suggestedActions"])
      : actionsForFolder(folder, ai.aiEffects);
  return {
    id: row.id,
    folder,
    status: (row.status || "nieuw") as InboxMailStatus,
    fromName: row.from_name || row.from_email,
    fromEmail: row.from_email,
    toEmail: row.to_email || "info@batterijconcept.nl",
    subject: row.subject || "(geen onderwerp)",
    bodyText: row.body_text || "",
    receivedAt: row.received_at,
    suggestedActions: suggested,
    aiSummary: ai.aiSummary,
    aiReason: ai.aiReason,
    aiConfidence: ai.aiConfidence,
    aiClassifiedAt: ai.aiClassifiedAt,
    aiEffects: ai.aiEffects,
    leadId: row.lead_id,
    projectId: row.project_id,
    afspraakId: row.afspraak_id,
    threadId: row.thread_id || undefined,
    messageId: row.message_id,
    bodyHtml: row.body_html,
    attachments: ai.attachments,
    imageUrls: ai.imageUrls,
  };
}

const SELECT_COLS =
  "id, folder, status, from_name, from_email, to_email, subject, body_text, body_html, received_at, lead_id, project_id, afspraak_id, suggested_actions, thread_id, message_id, in_reply_to, raw_headers";

export async function findInboxMailByMessageId(
  sb: SupabaseClient,
  messageId: string
): Promise<InboxDbRow | null> {
  const id = messageId.trim();
  if (!id) return null;
  const { data, error } = await sb
    .from("inbox_mails")
    .select(SELECT_COLS)
    .eq("message_id", id)
    .maybeSingle();
  if (error) {
    if (
      error.code === "42P01" ||
      /inbox_mails|does not exist|relation/i.test(error.message || "")
    ) {
      return null;
    }
    throw error;
  }
  return (data as InboxDbRow) || null;
}

export async function getInboxMail(
  sb: SupabaseClient,
  id: string
): Promise<InboxDbRow | null> {
  const { data, error } = await sb
    .from("inbox_mails")
    .select(SELECT_COLS)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (
      error.code === "42P01" ||
      /inbox_mails|does not exist|relation/i.test(error.message || "")
    ) {
      return null;
    }
    throw error;
  }
  return (data as InboxDbRow) || null;
}

export async function findLeadIdByEmail(
  sb: SupabaseClient,
  email: string
): Promise<string | null> {
  const e = email.trim().toLowerCase();
  if (!e) return null;
  const { data } = await sb
    .from("leads")
    .select("id")
    .ilike("email", e)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id || null;
}

/** Insert geboekte inbound mail. Skip als message_id al bestaat. */
export async function insertBookedInboxMail(
  sb: SupabaseClient,
  mail: InboxMail,
  opts?: {
    messageId?: string | null;
    bodyHtml?: string | null;
    aiFunction?: string | null;
    attachments?: InboxAttachment[] | null;
    imageUrls?: string[] | null;
  }
): Promise<{ row: InboxDbRow | null; inserted: boolean; skipped?: boolean }> {
  const messageId = (opts?.messageId || "").trim() || null;
  if (messageId) {
    const existing = await findInboxMailByMessageId(sb, messageId);
    if (existing) {
      return { row: existing, inserted: false, skipped: true };
    }
  }

  let leadId = mail.leadId || null;
  if (!leadId && mail.fromEmail) {
    leadId = await findLeadIdByEmail(sb, mail.fromEmail);
  }

  const insertRow = {
    folder: normalizeInboxFolder(
      mail.folder === "inbox" ? "algemeen" : mail.folder
    ),
    status: mail.status || "nieuw",
    direction: "inbound" as const,
    message_id: messageId,
    thread_id: mail.threadId || messageId,
    from_name: mail.fromName || null,
    from_email: mail.fromEmail,
    to_email: mail.toEmail || "info@batterijconcept.nl",
    subject: mail.subject || "",
    body_text: mail.bodyText || "",
    body_html: opts?.bodyHtml || null,
    received_at: mail.receivedAt || new Date().toISOString(),
    lead_id: leadId,
    project_id: mail.projectId || null,
    afspraak_id: mail.afspraakId || null,
    suggested_actions: mail.suggestedActions || [],
    raw_headers: {
      ai_summary: mail.aiSummary || null,
      ai_reason: mail.aiReason || null,
      ai_confidence: mail.aiConfidence ?? null,
      ai_classified_at: mail.aiClassifiedAt || null,
      ai_function: opts?.aiFunction || null,
      ai_effects: mail.aiEffects || null,
      attachments: opts?.attachments?.length
        ? opts.attachments
        : mail.attachments?.length
          ? mail.attachments
          : [],
      image_urls: opts?.imageUrls?.length
        ? opts.imageUrls
        : mail.imageUrls?.length
          ? mail.imageUrls
          : [],
    },
  };

  let { data, error } = await sb
    .from("inbox_mails")
    .insert(insertRow)
    .select(SELECT_COLS)
    .maybeSingle();

  // DB-constraint nog op oude mappen → fallback algemeen + intended_folder
  if (
    error &&
    (error.code === "23514" || /folder|check/i.test(error.message || ""))
  ) {
    const intended = insertRow.folder;
    insertRow.folder = "algemeen";
    insertRow.raw_headers = {
      ...insertRow.raw_headers,
      intended_folder: intended,
    };
    ({ data, error } = await sb
      .from("inbox_mails")
      .insert(insertRow)
      .select(SELECT_COLS)
      .maybeSingle());
  }

  if (error) {
    // Race: unique message_id
    if (error.code === "23505" && messageId) {
      const existing = await findInboxMailByMessageId(sb, messageId);
      return { row: existing, inserted: false, skipped: true };
    }
    throw error;
  }

  const row = (data as InboxDbRow) || null;
  if (row) {
    try {
      const linked = await logInboxMailNotitie(sb, {
        leadId: row.lead_id,
        projectId: row.project_id,
        direction: "inbound",
        fromName: row.from_name,
        fromEmail: row.from_email,
        toEmail: row.to_email,
        subject: row.subject,
        bodyText: row.body_text,
        at: row.received_at,
        messageId: row.message_id,
        matchEmail: row.from_email,
      });
      const linkPatch: { lead_id?: string; project_id?: string } = {};
      if (linked.leadId && !row.lead_id) linkPatch.lead_id = linked.leadId;
      if (linked.projectId && !row.project_id) {
        linkPatch.project_id = linked.projectId;
      }
      if (Object.keys(linkPatch).length) {
        await sb.from("inbox_mails").update(linkPatch).eq("id", row.id);
        if (linkPatch.lead_id) row.lead_id = linkPatch.lead_id;
        if (linkPatch.project_id) row.project_id = linkPatch.project_id;
      }
    } catch (err) {
      console.error("inbox notitie:", err);
    }
  }

  return { row, inserted: true };
}

export async function listInboxMails(
  sb: SupabaseClient,
  opts?: {
    folder?: string | null;
    email?: string | null;
    leadId?: string | null;
    limit?: number;
  }
): Promise<InboxDbRow[]> {
  const limit = Math.min(Math.max(opts?.limit || 100, 1), 300);
  let query = sb
    .from("inbox_mails")
    .select(SELECT_COLS)
    .order("received_at", { ascending: false })
    .limit(limit);

  const folder = (opts?.folder || "").trim();
  if (folder && folder !== "inbox") {
    query = query.eq("folder", folder);
    if (folder !== "archief" && folder !== "verzonden") {
      query = query
        .neq("status", "afgehandeld")
        .neq("status", "gearchiveerd");
    }
  } else if (folder === "inbox" || !folder) {
    // Standaard open werk + archief/verzonden meenemen voor UI-tabs;
    // open-filter gebeurt client-side. Bij folder=inbox: alleen open.
    if (folder === "inbox") {
      query = query
        .not("folder", "in", "(archief,verzonden)")
        .not("status", "in", "(afgehandeld,gearchiveerd)");
    }
  }

  const email = (opts?.email || "").trim().toLowerCase();
  const leadId = (opts?.leadId || "").trim();
  if (leadId && email) {
    query = query.or(
      `lead_id.eq.${leadId},from_email.eq.${email},to_email.eq.${email}`
    );
  } else if (leadId) {
    query = query.eq("lead_id", leadId);
  } else if (email) {
    query = query.or(`from_email.eq.${email},to_email.eq.${email}`);
  }

  const { data, error } = await query;
  if (error) {
    if (
      error.code === "42P01" ||
      /inbox_mails|does not exist|relation/i.test(error.message || "")
    ) {
      return [];
    }
    throw error;
  }
  return (data || []) as InboxDbRow[];
}

/** Hard delete — weg uit de mailbox. */
export async function deleteInboxMail(
  sb: SupabaseClient,
  id: string
): Promise<boolean> {
  const { error } = await sb.from("inbox_mails").delete().eq("id", id);
  if (error) {
    if (
      error.code === "42P01" ||
      /inbox_mails|does not exist|relation/i.test(error.message || "")
    ) {
      return false;
    }
    throw error;
  }
  return true;
}

export async function patchInboxMail(
  sb: SupabaseClient,
  id: string,
  patchIn: {
    folder?: InboxFolderId | null;
    status?: InboxMailStatus | null;
    aiSummary?: string | null;
    aiReason?: string | null;
    aiConfidence?: number | null;
    aiClassifiedAt?: string | null;
    aiFunction?: string | null;
    aiEffects?: InboxMail["aiEffects"] | null;
    suggestedActions?: string[] | null;
  }
): Promise<InboxDbRow | null> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patchIn.folder) {
    patch.folder = normalizeInboxFolder(
      patchIn.folder === "inbox" ? "algemeen" : patchIn.folder
    );
  }
  if (patchIn.status) patch.status = patchIn.status;
  const aiKeys = [
    "aiSummary",
    "aiReason",
    "aiConfidence",
    "aiClassifiedAt",
    "aiFunction",
    "aiEffects",
  ] as const;
  if (aiKeys.some((k) => k in patchIn)) {
    const existing = await getInboxMail(sb, id);
    const prev =
      existing?.raw_headers && typeof existing.raw_headers === "object"
        ? existing.raw_headers
        : {};
    patch.raw_headers = {
      ...prev,
      ...("aiSummary" in patchIn
        ? { ai_summary: patchIn.aiSummary ?? null }
        : {}),
      ...("aiReason" in patchIn ? { ai_reason: patchIn.aiReason ?? null } : {}),
      ...("aiConfidence" in patchIn
        ? { ai_confidence: patchIn.aiConfidence ?? null }
        : {}),
      ...("aiClassifiedAt" in patchIn
        ? { ai_classified_at: patchIn.aiClassifiedAt ?? null }
        : {}),
      ...("aiFunction" in patchIn
        ? { ai_function: patchIn.aiFunction ?? null }
        : {}),
      ...("aiEffects" in patchIn
        ? { ai_effects: patchIn.aiEffects ?? null }
        : {}),
    };
  }
  if ("suggestedActions" in patchIn)
    patch.suggested_actions = patchIn.suggestedActions ?? [];

  const keys = Object.keys(patch).filter((k) => k !== "updated_at");
  if (keys.length === 0) return null;

  const { data, error } = await sb
    .from("inbox_mails")
    .update(patch)
    .eq("id", id)
    .select(SELECT_COLS)
    .maybeSingle();
  if (error) throw error;
  return (data as InboxDbRow) || null;
}

/** @deprecated alias */
export async function patchInboxMailFolder(
  sb: SupabaseClient,
  id: string,
  folder?: InboxFolderId | null,
  status?: InboxMailStatus | null
): Promise<InboxDbRow | null> {
  return patchInboxMail(sb, id, { folder, status });
}
