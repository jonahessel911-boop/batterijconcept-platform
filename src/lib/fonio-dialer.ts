/**
 * Fonio autodialer — werkt de bel-queue af binnen 08:00–22:00 (Amsterdam),
 * max N gelijktijdige gesprekken.
 */

import { formatInTimeZone } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AMSTERDAM_TZ } from "@/lib/format";
import { inBelQueue, sortBelQueue } from "@/lib/bel-queue";
import type { Afspraak, Lead } from "@/types/database";
import {
  buildFonioLeadContext,
  fonioConfigured,
  rememberFonioOutboundLead,
  toE164Nl,
  triggerFonioOutbound,
} from "@/lib/fonio";

const ACTIEVE_AFSPRAAK = new Set(["gepland", "bevestigd", "verzet"]);
const OPEN_CALL_STATUSES = ["ringing", "active"] as const;
/** Safety-net: gesprekken langer dan dit → slot vrij (after-webhook faalt soms). */
const STALE_CALL_MINUTES = 2;

export function fonioDialerEnabled(): boolean {
  const v = (process.env.FONIO_DIALER_ENABLED || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function fonioDialerMaxConcurrent(): number {
  const n = Number(process.env.FONIO_DIALER_MAX_CONCURRENT || 3);
  if (!Number.isFinite(n)) return 3;
  return Math.min(Math.max(Math.floor(n), 1), 10);
}

/** true als Amsterdam-tijd in [08:00, 22:00). */
export function isFonioDialerWindow(now = new Date()): boolean {
  const hm = formatInTimeZone(now, AMSTERDAM_TZ, "HH:mm");
  return hm >= "08:00" && hm < "22:00";
}

export type FonioDialerRunResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  window_ok: boolean;
  max_concurrent: number;
  active_before: number;
  stale_closed: number;
  started: number;
  failed_starts: number;
  queue_left_estimate?: number;
  errors?: string[];
};

async function closeStaleCalls(sb: SupabaseClient): Promise<number> {
  const cutoff = new Date(
    Date.now() - STALE_CALL_MINUTES * 60_000
  ).toISOString();
  const { data, error } = await sb
    .from("fonio_calls")
    .update({
      status: "timed_out",
      ended_at: new Date().toISOString(),
      outcome: "timed_out",
      updated_at: new Date().toISOString(),
    })
    .in("status", [...OPEN_CALL_STATUSES])
    .lt("started_at", cutoff)
    .select("id");
  if (error) {
    // Tabel nog niet gemigreerd
    if (error.code === "42P01" || error.message?.includes("fonio_calls")) {
      return 0;
    }
    console.warn("fonio dialer stale:", error.message);
    return 0;
  }
  return data?.length || 0;
}

/**
 * Fonio after stuurt vaak geen lead_id/telefoon.
 * Dan: oudste open call afsluiten (1 after ≈ 1 gesprek klaar).
 */
export async function closeOldestOpenFonioCall(
  sb: SupabaseClient,
  outcome = "after_webhook"
): Promise<string | null> {
  const { data: oldest } = await sb
    .from("fonio_calls")
    .select("id, lead_id")
    .in("status", [...OPEN_CALL_STATUSES])
    .order("started_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!oldest?.id) return null;

  const now = new Date().toISOString();
  await sb
    .from("fonio_calls")
    .update({
      status: "done",
      ended_at: now,
      outcome,
      updated_at: now,
    })
    .eq("id", oldest.id)
    .in("status", [...OPEN_CALL_STATUSES]);

  return oldest.lead_id || null;
}

async function countOpenCalls(sb: SupabaseClient): Promise<number | null> {
  const { count, error } = await sb
    .from("fonio_calls")
    .select("id", { count: "exact", head: true })
    .in("status", [...OPEN_CALL_STATUSES]);
  if (error) {
    if (error.code === "42P01" || error.message?.includes("fonio_calls")) {
      return null;
    }
    throw error;
  }
  return count ?? 0;
}

async function openCallLeadIds(sb: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await sb
    .from("fonio_calls")
    .select("lead_id")
    .in("status", [...OPEN_CALL_STATUSES]);
  if (error || !data) return new Set();
  return new Set(data.map((r) => r.lead_id).filter(Boolean));
}

async function loadAppointmentSets(sb: SupabaseClient): Promise<{
  appointmentLeadIds: Set<string>;
}> {
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const { data } = await sb
    .from("afspraken")
    .select("id, lead_id, start_at, end_at, status, soort, updated_at")
    .gte("start_at", from.toISOString())
    .limit(5000);

  const afspraken = (data || []) as Afspraak[];
  const appointmentLeadIds = new Set<string>();
  const now = Date.now();
  for (const a of afspraken) {
    if (!ACTIEVE_AFSPRAAK.has(a.status)) continue;
    // Actieve huisbezoek/terugbel → niet in bel-queue
    appointmentLeadIds.add(a.lead_id);
    void now;
  }
  return { appointmentLeadIds };
}

async function pickNextLeads(
  sb: SupabaseClient,
  limit: number,
  excludeLeadIds: Set<string>
): Promise<Lead[]> {
  if (limit <= 0) return [];

  const { appointmentLeadIds } = await loadAppointmentSets(sb);

  const { data, error } = await sb
    .from("leads")
    .select(
      "id, lead_number, naam, email, telefoon, straat, huisnummer, toevoeging, postcode, plaats, status, bron, notities, belpogingen, belpogingen_vandaag, laatst_gebeld_at, eerste_gebeld_at, created_at, updated_at, adviseur_id, terugbellen"
    )
    .in("status", ["nieuw", "geen_contact", "vervolg_geen_contact"])
    .not("telefoon", "is", null)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) throw error;

  const filtered = ((data || []) as Lead[]).filter((l) => {
    if (excludeLeadIds.has(l.id)) return false;
    return inBelQueue(l, appointmentLeadIds);
  });

  return sortBelQueue(filtered).slice(0, limit);
}

async function startCallForLead(
  sb: SupabaseClient,
  lead: Lead
): Promise<{ ok: true; callId: string } | { ok: false; error: string }> {
  const to = toE164Nl(lead.telefoon);
  if (!to) return { ok: false, error: "Ongeldig telefoonnummer" };

  const { data: row, error: insErr } = await sb
    .from("fonio_calls")
    .insert({
      lead_id: lead.id,
      to_number: to,
      status: "ringing",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr || !row) {
    return {
      ok: false,
      error: insErr?.message || "fonio_calls insert mislukt",
    };
  }

  const context = buildFonioLeadContext(lead);
  const result = await triggerFonioOutbound({ toNumber: to, context });

  if (!result.ok) {
    await sb
      .from("fonio_calls")
      .update({
        status: "failed",
        ended_at: new Date().toISOString(),
        error: result.error,
        outcome: "start_failed",
        updated_at: new Date().toISOString(),
        meta: { fonio: result.data ?? null },
      })
      .eq("id", row.id);
    return { ok: false, error: result.error };
  }

  await sb
    .from("fonio_calls")
    .update({
      status: "active",
      updated_at: new Date().toISOString(),
      meta: { fonio: result.data ?? null },
    })
    .eq("id", row.id);

  await rememberFonioOutboundLead({ leadId: lead.id, toNumber: to });

  return { ok: true, callId: row.id };
}

/**
 * Eén dialer-tick: stale opruimen, open slots vullen met volgende queue-leads.
 */
export async function runFonioDialerTick(
  sb: SupabaseClient
): Promise<FonioDialerRunResult> {
  const maxConcurrent = fonioDialerMaxConcurrent();
  const windowOk = isFonioDialerWindow();
  const base = {
    window_ok: windowOk,
    max_concurrent: maxConcurrent,
    active_before: 0,
    stale_closed: 0,
    started: 0,
    failed_starts: 0,
  };

  if (!fonioDialerEnabled()) {
    return {
      ok: true,
      skipped: true,
      reason: "FONIO_DIALER_ENABLED staat uit",
      ...base,
    };
  }

  if (!fonioConfigured()) {
    return {
      ok: false,
      skipped: true,
      reason: "Fonio niet geconfigureerd",
      ...base,
    };
  }

  if (!windowOk) {
    return {
      ok: true,
      skipped: true,
      reason: "Buiten belvenster (08:00–22:00 Amsterdam)",
      ...base,
    };
  }

  const staleClosed = await closeStaleCalls(sb);
  const activeBefore = await countOpenCalls(sb);
  if (activeBefore === null) {
    return {
      ok: false,
      skipped: true,
      reason:
        "Tabel fonio_calls ontbreekt — draai supabase/migrate-fonio-calls.sql",
      ...base,
      stale_closed: staleClosed,
    };
  }

  const slots = Math.max(0, maxConcurrent - activeBefore);
  if (slots === 0) {
    return {
      ok: true,
      skipped: true,
      reason: "Max concurrent bereikt",
      ...base,
      active_before: activeBefore,
      stale_closed: staleClosed,
    };
  }

  const busyLeads = await openCallLeadIds(sb);
  const next = await pickNextLeads(sb, slots, busyLeads);
  const errors: string[] = [];
  let started = 0;
  let failed = 0;

  for (const lead of next) {
    const res = await startCallForLead(sb, lead);
    if (res.ok) started += 1;
    else {
      failed += 1;
      errors.push(`${lead.lead_number || lead.id}: ${res.error}`);
    }
    // Fonio: max 1 outbound/sec per nummer
    await new Promise((r) => setTimeout(r, 1200));
  }

  return {
    ok: true,
    ...base,
    active_before: activeBefore,
    stale_closed: staleClosed,
    started,
    failed_starts: failed,
    queue_left_estimate: Math.max(0, next.length - started),
    errors: errors.length ? errors : undefined,
  };
}

/** Rond actieve call af na Fonio after-webhook. */
export async function completeFonioCallForLead(
  sb: SupabaseClient,
  leadId: string,
  opts?: {
    summary?: string | null;
    outcome?: string | null;
    booked?: boolean;
    toNumber?: string | null;
  }
): Promise<void> {
  const now = new Date().toISOString();
  const update: Record<string, unknown> = {
    status: "done",
    ended_at: now,
    outcome: opts?.booked ? "afspraak" : opts?.outcome || "completed",
    updated_at: now,
  };
  if (opts?.summary) update.meta = { summary: opts.summary };

  // Primair op lead_id
  const { data: byLead } = await sb
    .from("fonio_calls")
    .update(update)
    .eq("lead_id", leadId)
    .in("status", [...OPEN_CALL_STATUSES])
    .select("id");

  // Fallback: match op belnummer (Fonio after stuurt soms geen lead_id)
  if ((!byLead || byLead.length === 0) && opts?.toNumber) {
    const e164 = toE164Nl(opts.toNumber);
    if (e164) {
      await sb
        .from("fonio_calls")
        .update(update)
        .eq("to_number", e164)
        .in("status", [...OPEN_CALL_STATUSES]);
    }
  }

  // Geen afspraak geboekt → belpoging (zoals BelPanel "geen contact")
  if (opts?.booked) return;

  const { data: lead } = await sb
    .from("leads")
    .select(
      "id, status, belpogingen, belpogingen_vandaag, laatst_gebeld_at, eerste_gebeld_at"
    )
    .eq("id", leadId)
    .maybeSingle();

  if (!lead) return;
  // Al afspraak/deal etc. → niet overschrijven
  if (
    lead.status === "afspraak" ||
    lead.status === "na_afspraak" ||
    lead.status === "deal" ||
    String(lead.status || "").startsWith("sale_")
  ) {
    return;
  }

  const prev = Math.max(0, Number(lead.belpogingen) || 0);
  const { belpogingenVandaagOf } = await import("@/lib/bel-queue");
  const todayCount = belpogingenVandaagOf(lead) + 1;
  const patch: Record<string, unknown> = {
    status: "geen_contact",
    belpogingen: prev + 1,
    belpogingen_vandaag: todayCount,
    laatst_gebeld_at: now,
    terugbellen: false,
  };
  if (!lead.eerste_gebeld_at) patch.eerste_gebeld_at = now;

  await sb.from("leads").update(patch).eq("id", leadId);
}
