import { subDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";

export type AdviseurConversie = {
  rate: number; // 0–1
  pct: number; // 0–100
  /** Unieke leads met gelopen huisbezoek in het venster */
  uitgevoerd: number;
  /** Daarvan met getekende deal */
  deals: number;
};

/**
 * Sales-conversie per adviseur: gelopen huisbezoeken → getekende deal
 * (rolling window, default 90 dagen).
 *
 * Deal telt via lead (offerte heeft geen adviseur_id) — toegeschreven
 * aan de adviseur van het gelopen huisbezoek.
 */
export async function loadAdviseurConversieMap(
  sb: SupabaseClient,
  adviseurIds: string[],
  daysBack = 90
): Promise<Map<string, AdviseurConversie>> {
  const map = new Map<string, AdviseurConversie>();
  for (const id of adviseurIds) {
    map.set(id, { rate: 0, pct: 0, uitgevoerd: 0, deals: 0 });
  }
  if (adviseurIds.length === 0) return map;

  const since = subDays(new Date(), daysBack).toISOString();
  const nowIso = new Date().toISOString();

  const { data: afspraken, error } = await sb
    .from("afspraken")
    .select("id, adviseur_id, lead_id, status, soort, start_at")
    .in("adviseur_id", adviseurIds)
    .eq("status", "voltooid")
    .gte("start_at", since)
    .lte("start_at", nowIso);

  if (error || !afspraken?.length) return map;

  const uitgevoerd = afspraken.filter((a) =>
    afspraakBlokkeertAgenda(a.soort)
  );
  if (!uitgevoerd.length) return map;

  /** Per adviseur: unieke leads met gelopen huisbezoek */
  const leadsByAdv = new Map<string, Set<string>>();
  const leadIds = new Set<string>();
  for (const a of uitgevoerd) {
    if (!a.adviseur_id || !a.lead_id) continue;
    leadIds.add(a.lead_id);
    let set = leadsByAdv.get(a.adviseur_id);
    if (!set) {
      set = new Set();
      leadsByAdv.set(a.adviseur_id, set);
    }
    set.add(a.lead_id);
  }

  // Offertes hebben geen adviseur_id — deal via lead
  const { data: offertes } = await sb
    .from("offertes")
    .select("lead_id, status")
    .in("lead_id", [...leadIds])
    .eq("status", "ondertekend");

  const dealLeads = new Set<string>();
  for (const o of offertes || []) {
    if (o.lead_id) dealLeads.add(o.lead_id as string);
  }

  for (const id of adviseurIds) {
    const visited = leadsByAdv.get(id);
    const uitgevoerdN = visited?.size || 0;
    let dealsN = 0;
    if (visited) {
      for (const leadId of visited) {
        if (dealLeads.has(leadId)) dealsN += 1;
      }
    }
    const rate = uitgevoerdN > 0 ? dealsN / uitgevoerdN : 0;
    map.set(id, {
      rate,
      pct: Math.round(rate * 1000) / 10,
      uitgevoerd: uitgevoerdN,
      deals: dealsN,
    });
  }

  return map;
}
