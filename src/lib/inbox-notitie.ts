/**
 * Inbox-mail → lead.notities, project.notities en de lead-tijdlijn.
 * Idempotent op message-id.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDateTimeNl } from "@/lib/format";
import { logLeadEvent } from "@/lib/lead-events";
import { upsertStampedNotitieChronological } from "@/lib/lead-notitie";

function clip(text: string, max = 1600): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

function who(name: string | null | undefined, email: string): string {
  const n = (name || "").trim();
  const e = email.trim();
  if (n && e && n.toLowerCase() !== e.toLowerCase()) return `${n} <${e}>`;
  return e || n || "onbekend";
}

export function formatInboxNotitie(opts: {
  direction: "inbound" | "outbound";
  fromName?: string | null;
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  at?: string | Date | null;
}): string {
  if (opts.direction === "inbound") {
    const atRaw = opts.at ? new Date(opts.at) : new Date();
    const at = Number.isNaN(atRaw.getTime()) ? new Date() : atRaw;
    return [
      "Email ontvangen",
      formatDateTimeNl(at),
      `Onderwerp: ${opts.subject || "(geen onderwerp)"}`,
    ].join("\n");
  }
  const titel = "E-mail verstuurd";
  const party = `Naar: ${who(null, opts.toEmail)}`;
  const body = clip(opts.bodyText || "");
  return [titel, party, `Onderwerp: ${opts.subject || "(geen onderwerp)"}`, body]
    .filter(Boolean)
    .join("\n");
}

async function alreadyLogged(
  sb: SupabaseClient,
  leadId: string,
  messageId: string | null
): Promise<boolean> {
  if (!messageId) return false;
  const { data } = await sb
    .from("lead_events")
    .select("id")
    .eq("lead_id", leadId)
    .eq("soort", "email")
    .contains("meta", { message_id: messageId })
    .limit(1);
  return Boolean(data?.length);
}

async function projectIdForLead(
  sb: SupabaseClient,
  leadId: string,
  explicit: string | null
): Promise<string | null> {
  if (explicit) return explicit;
  const { data } = await sb
    .from("projecten")
    .select("id, status")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(8);
  const rows = (data || []) as { id: string; status: string | null }[];
  return (
    rows.find((p) => p.status !== "annulering")?.id || rows[0]?.id || null
  );
}

async function writeNotitie(
  sb: SupabaseClient,
  table: "leads" | "projecten",
  id: string,
  text: string,
  at: Date,
  author: string | null,
  dedupeKey: string
): Promise<void> {
  const { data } = await sb
    .from(table)
    .select("notities")
    .eq("id", id)
    .maybeSingle();
  const merged = upsertStampedNotitieChronological(
    (data as { notities?: string | null } | null)?.notities,
    text,
    at,
    author,
    { dedupeKey }
  );
  await sb.from(table).update({ notities: merged }).eq("id", id);
}

/** Schrijf een inbox-mail naar de notities van lead en project. */
export async function logInboxMailNotitie(
  sb: SupabaseClient,
  opts: {
    leadId?: string | null;
    projectId?: string | null;
    direction: "inbound" | "outbound";
    fromName?: string | null;
    fromEmail: string;
    toEmail: string;
    subject: string;
    bodyText: string;
    at?: string | Date | null;
    author?: string | null;
    messageId?: string | null;
    matchEmail?: string | null;
  }
): Promise<{ leadId: string | null; projectId: string | null }> {
  let leadId = opts.leadId || null;
  if (!leadId && opts.matchEmail) {
    const { data } = await sb
      .from("leads")
      .select("id")
      .ilike("email", opts.matchEmail.trim())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    leadId = (data as { id?: string } | null)?.id || null;
  }
  if (!leadId) return { leadId: null, projectId: null };

  const messageId = (opts.messageId || "").trim() || null;
  const atRaw = opts.at ? new Date(opts.at) : new Date();
  const at = Number.isNaN(atRaw.getTime()) ? new Date() : atRaw;
  const text = formatInboxNotitie({ ...opts, at });

  if (await alreadyLogged(sb, leadId, messageId)) {
    const projectId = await projectIdForLead(sb, leadId, opts.projectId || null);
    if (projectId && opts.direction === "inbound") {
      const { data: existing } = await sb
        .from("projecten")
        .select("notities")
        .eq("id", projectId)
        .maybeSingle();
      const notes =
        (existing as { notities?: string | null } | null)?.notities || "";
      const subject = (opts.subject || "").trim();
      const covered =
        /e-?mail ontvangen/i.test(notes) &&
        (notes.includes(formatDateTimeNl(at)) ||
          (subject &&
            subject !== "(geen onderwerp)" &&
            notes.includes(`Onderwerp: ${subject}`)));
      if (!covered) {
        await writeNotitie(
          sb,
          "projecten",
          projectId,
          text,
          at,
          (opts.fromName || "").trim() || opts.fromEmail,
          text
        );
      }
    }
    return { leadId, projectId };
  }
  const author =
    (opts.author || "").trim() ||
    (opts.direction === "inbound" ? opts.fromName || opts.fromEmail : null);
  const dedupeKey = text.split("\n").slice(0, 3).join("\n");

  await logLeadEvent({
    leadId,
    soort: "email",
    titel:
      opts.direction === "outbound"
        ? `E-mail verstuurd · ${opts.subject || "(geen onderwerp)"}`
        : `E-mail ontvangen · ${opts.subject || "(geen onderwerp)"}`,
    detail: text,
    createdAt: at.toISOString(),
    meta: {
      bron: "inbox",
      direction: opts.direction,
      message_id: messageId,
      from: opts.fromEmail,
      to: opts.toEmail,
      subject: opts.subject,
    },
  });

  await writeNotitie(sb, "leads", leadId, text, at, author, dedupeKey);

  const projectId = await projectIdForLead(sb, leadId, opts.projectId || null);
  if (projectId) {
    await writeNotitie(sb, "projecten", projectId, text, at, author, dedupeKey);
  }

  return { leadId, projectId };
}
