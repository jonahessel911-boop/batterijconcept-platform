/**
 * Detecteer of een lead al als sale via Offertes is doorgezet naar backoffice.
 * Zo ja: agenda mag niet opnieuw afboeken (voorkomt overschrijven sale → vervolg).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isSaleUitkomst } from "@/lib/afspraak-soort";
import { normalizeProjectStatus } from "@/lib/labels";
import type { LeadStatus } from "@/types/database";

export type DoorgezetteSaleCheck = {
  doorgezet: boolean;
  reden: "sale_status" | "offerte_actie" | "project" | null;
};

/**
 * Lead is al doorgezet naar BO als:
 * - leadstatus sale_* is, of
 * - er een ondertekende offerte met actie_required=false is, of
 * - er een niet-geannuleerd project bestaat.
 */
export async function checkDoorgezetteSale(
  sb: SupabaseClient,
  leadId: string,
  leadStatus?: string | null
): Promise<DoorgezetteSaleCheck> {
  if (isSaleUitkomst(leadStatus as LeadStatus | null | undefined)) {
    return { doorgezet: true, reden: "sale_status" };
  }

  const [{ data: offertes }, { data: projecten }, { data: lead }] =
    await Promise.all([
      sb
        .from("offertes")
        .select("id, actie_required, status")
        .eq("lead_id", leadId)
        .eq("status", "ondertekend")
        .limit(5),
      sb
        .from("projecten")
        .select("id, status")
        .eq("lead_id", leadId)
        .limit(5),
      leadStatus === undefined
        ? sb.from("leads").select("status").eq("id", leadId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const status =
    leadStatus !== undefined
      ? leadStatus
      : ((lead as { status?: string | null } | null)?.status ?? null);

  if (isSaleUitkomst(status as LeadStatus | null | undefined)) {
    return { doorgezet: true, reden: "sale_status" };
  }

  for (const o of offertes || []) {
    if (o.actie_required === false) {
      return { doorgezet: true, reden: "offerte_actie" };
    }
  }

  for (const p of projecten || []) {
    if (normalizeProjectStatus(p.status as string) === "annulering") continue;
    return { doorgezet: true, reden: "project" };
  }

  return { doorgezet: false, reden: null };
}
