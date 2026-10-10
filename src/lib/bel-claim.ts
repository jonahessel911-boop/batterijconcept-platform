/**
 * Soft claim voor de Bel-tab: meerdere bellers, zelfde volgorde, geen dubbel.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Afspraak, Lead } from "@/types/database";
import { inBelQueue, sortBelQueue } from "@/lib/bel-queue";
import { isTerugbelSoort } from "@/lib/afspraak-soort";

/** Claim verloopt zonder heartbeat. */
export const BEL_CLAIM_TTL_MS = 15 * 60 * 1000;
const BEL_CLAIM_TTL_SEC = Math.floor(BEL_CLAIM_TTL_MS / 1000);

const ACTIEVE_AFSPRAAK = new Set(["gepland", "bevestigd", "verzet"]);

export function isBelClaimActive(
  claimedAt: string | null | undefined,
  now = new Date()
): boolean {
  if (!claimedAt) return false;
  const t = new Date(claimedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < BEL_CLAIM_TTL_MS;
}

/** Lead is geclaimd door iemand anders (en claim is nog geldig). */
export function isBelClaimedByOther(
  lead: Pick<Lead, "bel_claimed_by" | "bel_claimed_at">,
  callerId: string,
  now = new Date()
): boolean {
  if (!lead.bel_claimed_by || lead.bel_claimed_by === callerId) return false;
  return isBelClaimActive(lead.bel_claimed_at, now);
}

function claimColumnsMissing(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42703" ||
    msg.includes("bel_claimed_by") ||
    msg.includes("bel_claimed_at") ||
    msg.includes("try_claim_bel_lead")
  );
}

async function loadAppointmentLeadIds(
  sb: SupabaseClient
): Promise<Set<string>> {
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const { data } = await sb
    .from("afspraken")
    .select("lead_id, status, soort, start_at")
    .gte("start_at", from.toISOString())
    .limit(5000);

  const out = new Set<string>();
  const now = Date.now();
  for (const row of (data || []) as Pick<
    Afspraak,
    "lead_id" | "status" | "soort" | "start_at"
  >[]) {
    if (!ACTIEVE_AFSPRAAK.has(row.status)) continue;
    if (isTerugbelSoort(row.soort)) {
      out.add(row.lead_id);
      continue;
    }
    if (new Date(row.start_at).getTime() < now) continue;
    out.add(row.lead_id);
  }
  return out;
}

async function loadFonioBusyLeadIds(
  sb: SupabaseClient
): Promise<Set<string>> {
  const { data, error } = await sb
    .from("fonio_calls")
    .select("lead_id")
    .in("status", ["ringing", "active"]);
  if (error || !data) return new Set();
  return new Set(
    data.map((r) => r.lead_id as string).filter(Boolean)
  );
}

/** JS-fallback als RPC nog niet gedeployed is. */
async function tryClaimLeadJs(
  sb: SupabaseClient,
  leadId: string,
  callerId: string
): Promise<Lead | null> {
  const patch = {
    bel_claimed_by: callerId,
    bel_claimed_at: new Date().toISOString(),
  };

  {
    const { data, error } = await sb
      .from("leads")
      .update(patch)
      .eq("id", leadId)
      .is("bel_claimed_by", null)
      .select("*")
      .maybeSingle();
    if (claimColumnsMissing(error)) return null;
    if (error) throw error;
    if (data && (data as Lead).bel_claimed_by === callerId) {
      return data as Lead;
    }
  }

  {
    const { data, error } = await sb
      .from("leads")
      .update(patch)
      .eq("id", leadId)
      .eq("bel_claimed_by", callerId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (data && (data as Lead).bel_claimed_by === callerId) {
      return data as Lead;
    }
  }

  {
    const { data: row, error: readErr } = await sb
      .from("leads")
      .select("bel_claimed_by, bel_claimed_at")
      .eq("id", leadId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row || isBelClaimActive(row.bel_claimed_at as string | null)) {
      return null;
    }
    const staleAt = row.bel_claimed_at as string;
    const { data, error } = await sb
      .from("leads")
      .update(patch)
      .eq("id", leadId)
      .eq("bel_claimed_at", staleAt)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (data && (data as Lead).bel_claimed_by === callerId) {
      return data as Lead;
    }
  }

  return null;
}

async function tryClaimLead(
  sb: SupabaseClient,
  leadId: string,
  callerId: string
): Promise<Lead | null> {
  const { data, error } = await sb.rpc("try_claim_bel_lead", {
    p_lead_id: leadId,
    p_caller_id: callerId,
    p_ttl_seconds: BEL_CLAIM_TTL_SEC,
  });

  if (!error && data) {
    const lead = data as Lead;
    if (lead.bel_claimed_by === callerId) return lead;
    return null;
  }

  // Functie/kolom ontbreekt → JS-fallback (nooit lead zonder claim teruggeven)
  if (
    error &&
    (claimColumnsMissing(error) ||
      error.code === "PGRST202" ||
      error.message?.includes("Could not find the function"))
  ) {
    return tryClaimLeadJs(sb, leadId, callerId);
  }

  if (error) throw error;
  return null;
}

/**
 * Geef de eerste vrije lead in bel-volgorde aan deze beller.
 * Heeft de beller al een actieve claim → verleng en geef die terug.
 */
export async function claimNextBelLead(
  sb: SupabaseClient,
  callerId: string,
  opts?: {
    excludeLeadIds?: string[];
  }
): Promise<{
  lead: Lead | null;
  mode: "existing" | "new" | "empty" | "nocolumn";
}> {
  const now = new Date();
  const exclude = new Set(opts?.excludeLeadIds || []);

  // 1) Bestaande actieve claim van mij behouden
  const { data: mine, error: mineErr } = await sb
    .from("leads")
    .select("*")
    .eq("bel_claimed_by", callerId)
    .order("bel_claimed_at", { ascending: false })
    .limit(5);

  if (claimColumnsMissing(mineErr)) {
    return { lead: null, mode: "nocolumn" };
  }
  if (mineErr) throw mineErr;

  const staleMineIds: string[] = [];
  for (const row of (mine || []) as Lead[]) {
    if (exclude.has(row.id)) {
      staleMineIds.push(row.id);
      continue;
    }
    if (!isBelClaimActive(row.bel_claimed_at, now)) {
      staleMineIds.push(row.id);
      continue;
    }
    const { data: refreshed } = await sb
      .from("leads")
      .update({ bel_claimed_at: now.toISOString() })
      .eq("id", row.id)
      .eq("bel_claimed_by", callerId)
      .select("*")
      .maybeSingle();
    return {
      lead: (refreshed as Lead) || row,
      mode: "existing",
    };
  }

  // Verlopen / excluded claims loslaten — anders blokkeert unique index nieuwe claim
  if (staleMineIds.length > 0) {
    await sb
      .from("leads")
      .update({ bel_claimed_by: null, bel_claimed_at: null })
      .eq("bel_claimed_by", callerId)
      .in("id", staleMineIds);
  }

  // 2) Kandidaten laden en sorteren
  const [appointmentLeadIds, fonioBusy] = await Promise.all([
    loadAppointmentLeadIds(sb),
    loadFonioBusyLeadIds(sb),
  ]);

  const { data: rawLeads, error: leadsErr } = await sb
    .from("leads")
    .select("*")
    .in("status", ["nieuw", "geen_contact", "vervolg_geen_contact"])
    .order("created_at", { ascending: false })
    .limit(2000);

  if (leadsErr) {
    if (claimColumnsMissing(leadsErr)) {
      return { lead: null, mode: "nocolumn" };
    }
    throw leadsErr;
  }

  const candidates = sortBelQueue(
    ((rawLeads || []) as Lead[]).filter((l) => {
      if (exclude.has(l.id)) return false;
      if (fonioBusy.has(l.id)) return false;
      if (!inBelQueue(l, appointmentLeadIds)) return false;
      if (isBelClaimedByOther(l, callerId, now)) return false;
      return true;
    })
  );

  for (const candidate of candidates) {
    const claimed = await tryClaimLead(sb, candidate.id, callerId);
    if (claimed) {
      return { lead: claimed, mode: "new" };
    }
  }

  return { lead: null, mode: "empty" };
}

export async function heartbeatBelClaim(
  sb: SupabaseClient,
  callerId: string,
  leadId: string
): Promise<boolean> {
  const { data, error } = await sb
    .from("leads")
    .update({ bel_claimed_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("bel_claimed_by", callerId)
    .select("id")
    .maybeSingle();

  if (claimColumnsMissing(error)) return false;
  if (error) throw error;
  return Boolean(data);
}

export async function releaseBelClaim(
  sb: SupabaseClient,
  callerId: string,
  leadId?: string | null
): Promise<void> {
  let q = sb
    .from("leads")
    .update({ bel_claimed_by: null, bel_claimed_at: null })
    .eq("bel_claimed_by", callerId);
  if (leadId) q = q.eq("id", leadId);

  const { error } = await q;
  if (claimColumnsMissing(error)) return;
  if (error) throw error;
}
