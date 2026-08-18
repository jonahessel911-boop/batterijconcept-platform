import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Leadstatus volgt de agenda:
 * - nog een actieve afspraak → status `afspraak` (niet als deal/geen_interesse overschrijven)
 * - geen actieve afspraak meer → terug naar bellijst (`nieuw` / `geen_contact`)
 */
export async function syncLeadNaAfspraak(
  sb: SupabaseClient,
  leadId: string
): Promise<void> {
  const { data: remaining } = await sb
    .from("afspraken")
    .select("id")
    .eq("lead_id", leadId)
    .neq("status", "geannuleerd")
    .limit(1);

  if (remaining && remaining.length > 0) {
    const { data: lead } = await sb
      .from("leads")
      .select("status")
      .eq("id", leadId)
      .single();
    if (lead?.status === "nieuw" || lead?.status === "geen_contact") {
      await sb.from("leads").update({ status: "afspraak" }).eq("id", leadId);
    }
    return;
  }

  const { data: lead } = await sb
    .from("leads")
    .select("status, belpogingen")
    .eq("id", leadId)
    .single();
  if (!lead || lead.status !== "afspraak") return;

  const next = Number(lead.belpogingen) > 0 ? "geen_contact" : "nieuw";
  await sb.from("leads").update({ status: next }).eq("id", leadId);
}
