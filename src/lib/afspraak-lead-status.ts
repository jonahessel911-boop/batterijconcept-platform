import type { SupabaseClient } from "@supabase/supabase-js";
import { leadStatusVoorAfspraakSoort } from "@/lib/afspraak-soort";

const BESCHERMDE_STATUS = new Set([
  "deal",
  "geen_interesse",
  "offerte_afgewezen",
  "niet_gekwalificeerd",
]);

const AFSPRAAK_STATUS = new Set([
  "afspraak",
  "vervolg_fysiek",
  "vervolg_tel",
]);

/**
 * Leadstatus volgt de agenda:
 * - nog een toekomstige actieve afspraak → status bij het soort
 * - geen actieve afspraak meer (geannuleerd/voltooid) → `na_afspraak`
 *   (niet terug naar de bellijst)
 *   Uitkomsten na bezoek (`na_afspraak`, afgewezen, etc.) blijven staan.
 */
export async function syncLeadNaAfspraak(
  sb: SupabaseClient,
  leadId: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  let remaining: { id: string; start_at: string; soort?: string }[] | null =
    null;
  let error: { message?: string; code?: string } | null = null;

  const first = await sb
    .from("afspraken")
    .select("id, start_at, soort")
    .eq("lead_id", leadId)
    .neq("status", "geannuleerd")
    .neq("status", "voltooid")
    .gt("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(1);
  remaining = first.data;
  error = first.error;

  if (error && (error.code === "42703" || error.message?.includes("soort"))) {
    const retry = await sb
      .from("afspraken")
      .select("id, start_at")
      .eq("lead_id", leadId)
      .neq("status", "geannuleerd")
      .neq("status", "voltooid")
      .gt("start_at", nowIso)
      .order("start_at", { ascending: true })
      .limit(1);
    remaining = retry.data;
    error = retry.error;
  }
  if (error) return;

  const { data: lead } = await sb
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .single();
  if (!lead) return;
  if (BESCHERMDE_STATUS.has(lead.status)) return;

  if (remaining && remaining.length > 0) {
    const next = leadStatusVoorAfspraakSoort(remaining[0].soort);
    if (lead.status !== next) {
      await sb.from("leads").update({ status: next }).eq("id", leadId);
    }
    return;
  }

  // Geen actieve toekomstige afspraak meer
  if (AFSPRAAK_STATUS.has(lead.status)) {
    // Geannuleerd huisbezoek/vervolg → niet terug naar bellijst
    let upd = await sb
      .from("leads")
      .update({
        status: "na_afspraak",
        terugbellen: false,
        terugbel_notitie: null,
      })
      .eq("id", leadId);
    if (
      upd.error &&
      (upd.error.code === "42703" ||
        upd.error.message?.includes("terugbel"))
    ) {
      await sb
        .from("leads")
        .update({ status: "na_afspraak" })
        .eq("id", leadId);
    }
    return;
  }

  // Alleen terugbel afgerond/geannuleerd: vlag uitzetten, status laten
  const clear = await sb
    .from("leads")
    .update({ terugbellen: false, terugbel_notitie: null })
    .eq("id", leadId);
  if (
    clear.error &&
    (clear.error.code === "42703" ||
      clear.error.message?.includes("terugbel"))
  ) {
    /* kolom ontbreekt — negeren */
  }
}
