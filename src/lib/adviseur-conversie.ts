import { subDays } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";

export type AdviseurConversie = {
  rate: number; // 0–1
  pct: number; // 0–100
  uitgevoerd: number;
  deals: number;
};

/**
 * Sales-conversie per adviseur: voltooide huisbezoeken → getekende deal
 * (rolling window, default 90 dagen).
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

  const byAdvUit = new Map<string, Set<string>>();
  const leadIds = new Set<string>();
  for (const a of uitgevoerd) {
    if (!a.adviseur_id || !a.lead_id) continue;
    leadIds.add(a.lead_id);
    let set = byAdvUit.get(a.adviseur_id);
    if (!set) {
      set = new Set();
      byAdvUit.set(a.adviseur_id, set);
    }
    set.add(a.id);
  }

  const { data: offertes } = await sb
    .from("offertes")
    .select("lead_id, adviseur_id, status")
    .in("lead_id", [...leadIds])
    .eq("status", "ondertekend");

  const dealLeadsByAdv = new Map<string, Set<string>>();
  for (const o of offertes || []) {
    if (!o.adviseur_id || !o.lead_id) continue;
    let set = dealLeadsByAdv.get(o.adviseur_id);
    if (!set) {
      set = new Set();
      dealLeadsByAdv.set(o.adviseur_id, set);
    }
    set.add(o.lead_id);
  }

  for (const id of adviseurIds) {
    const uitgevoerdN = byAdvUit.get(id)?.size || 0;
    const dealsN = dealLeadsByAdv.get(id)?.size || 0;
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
