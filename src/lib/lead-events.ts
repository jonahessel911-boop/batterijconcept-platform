import { getSupabaseAdmin } from "@/lib/supabase";
import type { LeadEventSoort } from "@/types/database";

/** Uitgaande klantmail op de project-tijdlijn (lead_events + project_id). */
export async function logProjectKlantMail(opts: {
  leadId?: string | null;
  projectId: string;
  projectNummer?: string | null;
  to?: string | null;
  subject?: string | null;
  bericht?: string | null;
  ok: boolean;
  messageId?: string | null;
  tag?: string | null;
  titel?: string | null;
  by?: string | null;
}): Promise<void> {
  if (!opts.leadId) return;
  const titel =
    opts.titel?.trim() ||
    (opts.ok ? "Contactmail verstuurd" : "Contactmail mislukt");
  await logLeadEvent({
    leadId: opts.leadId,
    soort: "email",
    titel,
    detail: opts.bericht?.trim() || opts.subject || titel,
    meta: {
      to: opts.to || null,
      subject: opts.subject || null,
      bericht: opts.bericht || null,
      project_id: opts.projectId,
      project_nummer: opts.projectNummer || null,
      message_id: opts.messageId || null,
      tag: opts.tag || null,
      ok: opts.ok,
      by: opts.by || null,
    },
  });
}

export async function logLeadEvent(opts: {
  leadId: string;
  soort: LeadEventSoort | string;
  titel: string;
  detail?: string | null;
  meta?: Record<string, unknown> | null;
  /** Historische events (CDR-backfill) op call-tijd zetten. */
  createdAt?: string | null;
}): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    const row: Record<string, unknown> = {
      lead_id: opts.leadId,
      soort: opts.soort,
      titel: opts.titel,
      detail: opts.detail?.trim() || null,
      meta: opts.meta || null,
    };
    if (opts.createdAt) {
      const d = new Date(opts.createdAt);
      if (!Number.isNaN(d.getTime())) row.created_at = d.toISOString();
    }
    const { error } = await sb.from("lead_events").insert(row);
    if (error) {
      // Tabel ontbreekt nog → migratie nog niet gedraaid
      if (
        error.code === "42P01" ||
        error.message?.includes("lead_events")
      ) {
        return;
      }
      console.error("lead_events insert:", error.message);
    }
  } catch (e) {
    console.error("logLeadEvent:", e);
  }
}
