import type { SupabaseClient } from "@supabase/supabase-js";
import { OPVOLGING_FLOW_LABELS, type OpvolgingFlowMetrics } from "./types";

type Row = {
  id: string;
  status: string;
  start_at: string;
  opvolging_flow: "intensief" | "rustig";
  bevestiging_verstuurd: boolean;
  bevestiging_sms_verstuurd: boolean | null;
  social_proof_verstuurd: boolean | null;
  reminder_48u_verstuurd: boolean | null;
  avond_sms_verstuurd: boolean | null;
  avond_mail_verstuurd?: boolean | null;
  opwarm_verstuurd?: boolean | null;
  herinnering_verstuurd?: boolean | null;
};

function emptyMetrics(flow: "intensief" | "rustig"): OpvolgingFlowMetrics {
  return {
    flow,
    label: OPVOLGING_FLOW_LABELS[flow],
    ingepland: 0,
    openstaand: 0,
    geannuleerd: 0,
    doorgegaan: 0,
    mails_verstuurd: 0,
    sms_verstuurd: 0,
  };
}

function countMails(row: Row): number {
  let n = 0;
  if (row.bevestiging_verstuurd) n += 1;
  if (row.opvolging_flow === "intensief") {
    if (row.social_proof_verstuurd) n += 1;
    if (row.reminder_48u_verstuurd) n += 1;
    if (row.avond_mail_verstuurd) n += 1;
  }
  return n;
}

function countSms(row: Row): number {
  let n = 0;
  if (row.bevestiging_sms_verstuurd) n += 1;
  if (row.opvolging_flow === "intensief" && row.reminder_48u_verstuurd) {
    // 48u SMS gaat samen met mail-flag; tel 1 als reminder verstuurd
    n += 1;
  }
  if (row.avond_sms_verstuurd) n += 1;
  return n;
}

export async function getOpvolgingAbMetrics(
  sb: SupabaseClient
): Promise<{
  intensief: OpvolgingFlowMetrics;
  rustig: OpvolgingFlowMetrics;
  since: string | null;
}> {
  const intensief = emptyMetrics("intensief");
  const rustig = emptyMetrics("rustig");

  const { data: settings } = await sb
    .from("afspraak_opvolging_ab")
    .select("started_at")
    .eq("id", 1)
    .maybeSingle();
  const since = settings?.started_at ?? null;

  let q = sb
    .from("afspraken")
    .select(
      "id, status, start_at, opvolging_flow, bevestiging_verstuurd, bevestiging_sms_verstuurd, social_proof_verstuurd, reminder_48u_verstuurd, avond_sms_verstuurd, avond_mail_verstuurd"
    )
    .in("opvolging_flow", ["intensief", "rustig"]);

  if (since) {
    q = q.gte("created_at", since);
  }

  const { data, error } = await q;
  if (error) {
    if (
      error.message?.includes("opvolging_flow") ||
      error.code === "42703" ||
      error.code === "42P01"
    ) {
      return { intensief, rustig, since };
    }
    throw new Error(error.message);
  }

  const now = Date.now();
  for (const raw of data || []) {
    const row = raw as Row;
    const bucket = row.opvolging_flow === "rustig" ? rustig : intensief;
    bucket.ingepland += 1;
    bucket.mails_verstuurd += countMails(row);
    bucket.sms_verstuurd += countSms(row);

    if (row.status === "geannuleerd") {
      bucket.geannuleerd += 1;
      continue;
    }

    const startMs = new Date(row.start_at).getTime();
    const open =
      ["gepland", "bevestigd", "verzet"].includes(row.status) && startMs >= now;
    if (open) {
      bucket.openstaand += 1;
    } else if (row.status === "voltooid" || startMs < now) {
      bucket.doorgegaan += 1;
    }
  }

  return { intensief, rustig, since };
}
