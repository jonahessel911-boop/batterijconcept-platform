import type { SupabaseClient } from "@supabase/supabase-js";
import { afspraakBlokkeertAgenda } from "@/lib/afspraak-soort";
import type { BusySlot } from "@/lib/slots";

const SOORT_MISSING = (error: { message?: string; code?: string } | null) =>
  Boolean(
    error &&
      (error.code === "42703" || error.message?.includes("soort"))
  );

function isActief(status: string | null | undefined): boolean {
  return status !== "geannuleerd" && status !== "voltooid";
}

/** Busy-slots die de agenda blokkeren (fysiek). Soft-fail zonder `soort`-kolom. */
export async function blockingBusySlots(
  sb: SupabaseClient,
  adviseurId: string,
  excludeId?: string
): Promise<BusySlot[]> {
  let q = sb
    .from("afspraken")
    .select("id, start_at, end_at, soort, status")
    .eq("adviseur_id", adviseurId)
    .neq("status", "geannuleerd")
    .neq("status", "voltooid");
  if (excludeId) q = q.neq("id", excludeId);

  const { data, error } = await q;
  if (SOORT_MISSING(error)) {
    let retry = sb
      .from("afspraken")
      .select("start_at, end_at")
      .eq("adviseur_id", adviseurId)
      .neq("status", "geannuleerd")
      .neq("status", "voltooid");
    if (excludeId) retry = retry.neq("id", excludeId);
    const again = await retry;
    return (again.data || []) as BusySlot[];
  }
  if (error) throw error;
  return (data || [])
    .filter((r) => isActief(r.status) && afspraakBlokkeertAgenda(r.soort))
    .map((r) => ({ start_at: r.start_at, end_at: r.end_at }));
}

/** True als een fysieke afspraak botst met een andere fysieke. */
export async function hasBlockingOverlap(
  sb: SupabaseClient,
  opts: {
    adviseurId: string;
    start: Date;
    end: Date;
    excludeId?: string;
  }
): Promise<boolean> {
  let q = sb
    .from("afspraken")
    .select("id, soort, status")
    .eq("adviseur_id", opts.adviseurId)
    .neq("status", "geannuleerd")
    .neq("status", "voltooid")
    .lt("start_at", opts.end.toISOString())
    .gt("end_at", opts.start.toISOString());
  if (opts.excludeId) q = q.neq("id", opts.excludeId);

  const { data, error } = await q;
  if (SOORT_MISSING(error)) {
    let retry = sb
      .from("afspraken")
      .select("id")
      .eq("adviseur_id", opts.adviseurId)
      .neq("status", "geannuleerd")
      .neq("status", "voltooid")
      .lt("start_at", opts.end.toISOString())
      .gt("end_at", opts.start.toISOString());
    if (opts.excludeId) retry = retry.neq("id", opts.excludeId);
    const again = await retry;
    return (again.data?.length ?? 0) > 0;
  }
  if (error) throw error;
  return (data || []).some((r) => afspraakBlokkeertAgenda(r.soort));
}
