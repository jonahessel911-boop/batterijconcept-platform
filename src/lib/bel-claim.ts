/**
 * Soft claim voor de Bel-tab: meerdere bellers, zelfde volgorde, geen dubbel.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Afspraak, Lead } from "@/types/database";
import {
  inAnnuleringBelQueue,
  inBelQueue,
  inNormaleBelQueue,
  inPrioOmplannenBelQueue,
  isNlProvincie,
  leadInProvincie,
  sortAnnuleringBelQueue,
  sortBelQueue,
  sortPrioOmplannenBelQueue,
} from "@/lib/bel-queue";
import { isTerugbelSoort } from "@/lib/afspraak-soort";

export type BelBakMode =
  | "normaal"
  | "provincie"
  | "annuleringen"
  | "prio_omplannen";

/** Claim verloopt zonder heartbeat. Kort houden zodat een vastgelopen tab de lijst niet blokkeert. */
export const BEL_CLAIM_TTL_MS = 4 * 60 * 1000;
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
    msg.includes("try_claim_bel_lead") ||
    msg.includes("try_claim_first_bel_lead")
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

function isUniqueClaimError(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "23505" ||
    msg.includes("leads_one_bel_claim_per_caller") ||
    msg.includes("duplicate key")
  );
}

async function loadMineClaim(
  sb: SupabaseClient,
  callerId: string
): Promise<Lead | null> {
  const { data } = await sb
    .from("leads")
    .select("*")
    .eq("bel_claimed_by", callerId)
    .order("bel_claimed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lead = data as Lead | null;
  if (!lead) return null;
  if (!isBelClaimActive(lead.bel_claimed_at)) return null;
  return lead;
}

const CLAIM_BATCH = 80;

async function tryClaimFirstLead(
  sb: SupabaseClient,
  leadIds: string[],
  callerId: string
): Promise<Lead | null> {
  const ids = leadIds.slice(0, CLAIM_BATCH);
  if (ids.length === 0) return null;

  const { data, error } = await sb.rpc("try_claim_first_bel_lead", {
    p_lead_ids: ids,
    p_caller_id: callerId,
    p_ttl_seconds: BEL_CLAIM_TTL_SEC,
  });

  if (!error && data) {
    const lead = data as Lead;
    if (lead.bel_claimed_by === callerId) return lead;
    return null;
  }

  if (isUniqueClaimError(error)) {
    return loadMineClaim(sb, callerId);
  }

  if (
    error &&
    (claimColumnsMissing(error) ||
      error.code === "PGRST202" ||
      error.message?.includes("Could not find the function"))
  ) {
    for (const id of ids) {
      const claimed = await tryClaimLead(sb, id, callerId);
      if (claimed) return claimed;
    }
    return null;
  }

  if (error) throw error;
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

  if (isUniqueClaimError(error)) {
    return loadMineClaim(sb, callerId);
  }

  // Functie/kolom ontbreekt → JS-fallback (nooit lead zonder claim teruggeven)
  if (
    error &&
    (claimColumnsMissing(error) ||
      error.code === "PGRST202" ||
      error.message?.includes("Could not find the function"))
  ) {
    try {
      return await tryClaimLeadJs(sb, leadId, callerId);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (isUniqueClaimError(err)) return loadMineClaim(sb, callerId);
      throw e;
    }
  }

  if (error) throw error;
  return null;
}

async function loadRecentAfsprakenForAnnuleringen(
  sb: SupabaseClient
): Promise<Afspraak[]> {
  const selectFull =
    "id, lead_id, adviseur_id, start_at, end_at, status, soort, notities, updated_at, created_at, ingepland_door_id, annulering_code, herpland_van_afspraak_id";
  const selectBasic =
    "id, lead_id, adviseur_id, start_at, end_at, status, soort, notities, updated_at, created_at, ingepland_door_id";
  let select = selectFull;
  const rows: Afspraak[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("afspraken")
      .select(select)
      .order("start_at", { ascending: false })
      .range(from, from + 999);
    if (
      error &&
      select === selectFull &&
      ((error.message || "").includes("annulering_code") ||
        (error.message || "").includes("herpland_van") ||
        error.code === "42703")
    ) {
      select = selectBasic;
      from = -1000;
      rows.length = 0;
      continue;
    }
    if (error) throw error;
    const chunk = (data || []) as unknown as Afspraak[];
    rows.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return rows;
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
    /** Alleen leads in deze provincie (postcode → provincie). */
    provincie?: string | null;
    /** Bij wisselen van bak: nooit oude claim hergebruiken. */
    forceNew?: boolean;
    /** normaal | provincie | annuleringen | prio_omplannen */
    bak?: BelBakMode | null;
  }
): Promise<{
  lead: Lead | null;
  mode: "existing" | "new" | "empty" | "nocolumn";
}> {
  const now = new Date();
  const exclude = new Set(opts?.excludeLeadIds || []);
  const bak: BelBakMode =
    opts?.bak === "annuleringen"
      ? "annuleringen"
      : opts?.bak === "prio_omplannen"
        ? "prio_omplannen"
        : opts?.provincie
          ? "provincie"
          : "normaal";
  const provincie =
    bak === "provincie" && opts?.provincie && isNlProvincie(opts.provincie)
      ? opts.provincie
      : null;
  const forceNew = Boolean(opts?.forceNew);

  // 1) Bestaande actieve claim van mij behouden (mits binnen bak-filter)
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

  const needsAfspraken = bak === "annuleringen" || bak === "prio_omplannen";
  const afsprakenForMine = needsAfspraken
    ? await loadRecentAfsprakenForAnnuleringen(sb)
    : null;
  const appointmentLeadIdsForMine = needsAfspraken
    ? await loadAppointmentLeadIds(sb)
    : null;

  const staleMineIds: string[] = [];
  for (const row of (mine || []) as Lead[]) {
    if (forceNew || exclude.has(row.id)) {
      staleMineIds.push(row.id);
      continue;
    }
    if (!isBelClaimActive(row.bel_claimed_at, now)) {
      staleMineIds.push(row.id);
      continue;
    }
    if (bak === "annuleringen") {
      if (
        !inAnnuleringBelQueue(
          row,
          afsprakenForMine || [],
          appointmentLeadIdsForMine || undefined
        )
      ) {
        staleMineIds.push(row.id);
        continue;
      }
    } else if (bak === "prio_omplannen") {
      if (
        !inPrioOmplannenBelQueue(
          row,
          afsprakenForMine || [],
          appointmentLeadIdsForMine || undefined
        )
      ) {
        staleMineIds.push(row.id);
        continue;
      }
    } else {
      if (row.status === "afspraak_afgezegd_klant") {
        staleMineIds.push(row.id);
        continue;
      }
      if (provincie && !leadInProvincie(row, provincie)) {
        staleMineIds.push(row.id);
        continue;
      }
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
  const appointmentLeadIds = await loadAppointmentLeadIds(sb);

  if (bak === "annuleringen" || bak === "prio_omplannen") {
    const afspraken = afsprakenForMine || (await loadRecentAfsprakenForAnnuleringen(sb));
    const leadIds = [
      ...new Set(
        afspraken
          .filter((a) => a.status === "geannuleerd")
          .map((a) => a.lead_id)
          .filter(Boolean)
      ),
    ];
    const rawLeads: Lead[] = [];
    for (let i = 0; i < leadIds.length; i += 200) {
      const slice = leadIds.slice(i, i + 200);
      const { data: chunk, error: leadsErr } = await sb
        .from("leads")
        .select("*")
        .in("id", slice);
      if (leadsErr) {
        if (claimColumnsMissing(leadsErr)) {
          return { lead: null, mode: "nocolumn" };
        }
        throw leadsErr;
      }
      rawLeads.push(...((chunk || []) as Lead[]));
    }

    const candidates =
      bak === "prio_omplannen"
        ? sortPrioOmplannenBelQueue(
            rawLeads.filter((l) => {
              if (exclude.has(l.id)) return false;
              if (isBelClaimedByOther(l, callerId, now)) return false;
              return inPrioOmplannenBelQueue(l, afspraken, appointmentLeadIds);
            }),
            afspraken
          )
        : sortAnnuleringBelQueue(
            rawLeads.filter((l) => {
              if (exclude.has(l.id)) return false;
              if (isBelClaimedByOther(l, callerId, now)) return false;
              return inAnnuleringBelQueue(l, afspraken, appointmentLeadIds);
            }),
            afspraken
          );

    const claimed = await tryClaimFirstLead(
      sb,
      candidates.map((c) => c.id),
      callerId
    );
    if (claimed) {
      return { lead: claimed, mode: "new" };
    }
    return { lead: null, mode: "empty" };
  }

  const afsprakenNormaal = await loadRecentAfsprakenForAnnuleringen(sb);

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
      if (!inNormaleBelQueue(l, appointmentLeadIds)) return false;
      if (inAnnuleringBelQueue(l, afsprakenNormaal, appointmentLeadIds)) {
        return false;
      }
      if (inPrioOmplannenBelQueue(l, afsprakenNormaal, appointmentLeadIds)) {
        return false;
      }
      // inNormaleBelQueue excludes herplan; keep inBelQueue safety for phone etc.
      if (!inBelQueue(l, appointmentLeadIds)) return false;
      if (provincie && !leadInProvincie(l, provincie)) return false;
      if (isBelClaimedByOther(l, callerId, now)) return false;
      return true;
    })
  );

  const claimed = await tryClaimFirstLead(
    sb,
    candidates.map((c) => c.id),
    callerId
  );
  if (claimed) {
    return { lead: claimed, mode: "new" };
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
