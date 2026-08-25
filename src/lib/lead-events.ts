import { getSupabaseAdmin } from "@/lib/supabase";
import type { LeadEventSoort } from "@/types/database";

/** Log een gebeurtenis op de lead-tijdlijn (best-effort, faalt stil). */
export async function logLeadEvent(opts: {
  leadId: string;
  soort: LeadEventSoort | string;
  titel: string;
  detail?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("lead_events").insert({
      lead_id: opts.leadId,
      soort: opts.soort,
      titel: opts.titel,
      detail: opts.detail?.trim() || null,
      meta: opts.meta || null,
    });
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
