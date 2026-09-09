import type { BackofficeActieEventSoort } from "@/types/database";

/** Client: log voltooide backoffice-actie (best-effort). */
export async function logBackofficeActieEvent(opts: {
  soort: BackofficeActieEventSoort;
  leadId?: string | null;
  projectId?: string | null;
  factuurId?: string | null;
  adviseurId?: string | null;
  deadlineAt?: string | null;
  completedAt?: string | null;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const completedAt = opts.completedAt || new Date().toISOString();
    const deadlineAt = opts.deadlineAt || null;
    const onTime =
      deadlineAt != null
        ? new Date(completedAt).getTime() <= new Date(deadlineAt).getTime()
        : null;
    await fetch("/api/backoffice-actie-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        soort: opts.soort,
        lead_id: opts.leadId || null,
        project_id: opts.projectId || null,
        factuur_id: opts.factuurId || null,
        adviseur_id: opts.adviseurId || null,
        deadline_at: deadlineAt,
        completed_at: completedAt,
        on_time: onTime,
        meta: opts.meta || null,
      }),
    });
  } catch {
    /* best-effort */
  }
}
