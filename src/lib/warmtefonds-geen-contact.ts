/**
 * "Geen contact" vanuit het Warmtefonds-portaal.
 * Na 4× → projectstatus HOLD WF (hold_sales_actie) terug naar backoffice.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { logLeadEvent } from "@/lib/lead-events";

export const WF_GEEN_CONTACT_MAX = 4;
export const WF_GEEN_CONTACT_TITEL = "Geen contact (Warmtefonds)";
export const WF_HOLD_TITEL = "HOLD WF — 4× geen contact";

export async function telWfGeenContact(
  sb: SupabaseClient,
  leadId: string,
  projectId: string
): Promise<number> {
  const { data } = await sb
    .from("lead_events")
    .select("id, titel, meta")
    .eq("lead_id", leadId)
    .eq("soort", "status")
    .order("created_at", { ascending: false })
    .limit(80);

  let n = 0;
  for (const ev of data || []) {
    const meta = (ev.meta || {}) as Record<string, unknown>;
    if (meta.geen_contact === true && meta.project_id === projectId) {
      n += 1;
      continue;
    }
    if (
      ev.titel === WF_GEEN_CONTACT_TITEL &&
      meta.project_id === projectId
    ) {
      n += 1;
    }
  }
  return n;
}

/**
 * Registreer één "geen contact". Bij de 4e → status hold_sales_actie (HOLD WF).
 */
export async function registreerWfGeenContact(opts: {
  sb: SupabaseClient;
  projectId: string;
  leadId: string;
  projectNummer?: string | null;
  huidigeStatus?: string | null;
  operatorNaam: string;
  operatorId: string;
}): Promise<{
  count: number;
  hold: boolean;
  max: number;
}> {
  const prev = await telWfGeenContact(
    opts.sb,
    opts.leadId,
    opts.projectId
  );
  const count = prev + 1;
  const hold = count >= WF_GEEN_CONTACT_MAX;

  await logLeadEvent({
    leadId: opts.leadId,
    soort: "status",
    titel: WF_GEEN_CONTACT_TITEL,
    detail: hold
      ? `${count}/${WF_GEEN_CONTACT_MAX} — project naar HOLD WF (via ${opts.operatorNaam})`
      : `${count}/${WF_GEEN_CONTACT_MAX} · via Warmtefonds-portaal (${opts.operatorNaam})`,
    meta: {
      project_id: opts.projectId,
      bron: "warmtefonds_portaal",
      operator_id: opts.operatorId,
      geen_contact: true,
      count,
      hold,
    },
  });

  if (hold) {
    const notitie = `HOLD WF — ${WF_GEEN_CONTACT_MAX}× geen contact via Warmtefonds-portaal (${opts.operatorNaam}).`;
    await opts.sb
      .from("projecten")
      .update({
        status: "hold_sales_actie",
        backoffice_notitie: notitie,
      })
      .eq("id", opts.projectId);

    await logLeadEvent({
      leadId: opts.leadId,
      soort: "status",
      titel: WF_HOLD_TITEL,
      detail: opts.projectNummer
        ? `Project ${opts.projectNummer} · was: ${opts.huidigeStatus || "—"}`
        : `Was: ${opts.huidigeStatus || "—"}`,
      meta: {
        project_id: opts.projectId,
        bron: "warmtefonds_portaal",
        operator_id: opts.operatorId,
        hold_wf: true,
        van_status: opts.huidigeStatus || null,
        naar_status: "hold_sales_actie",
        geen_contact_count: count,
      },
    });

    try {
      const { syncAutoTakenVoorProject } = await import(
        "@/lib/sync-auto-taken"
      );
      await syncAutoTakenVoorProject(
        opts.sb,
        opts.projectId,
        "hold_sales_actie"
      );
    } catch {
      /* taken mag hold niet blokkeren */
    }
  }

  return { count, hold, max: WF_GEEN_CONTACT_MAX };
}
