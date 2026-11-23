import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { replyToForAfspraak } from "@/lib/email/adviseur-reply-to";
import {
  afspraakBevestigingSequenceEmail,
  afspraakMailVars,
  afspraakOpwarmSalderingEmail,
  afspraakReminder24uEmail,
  shouldSendBevestigingNow,
  shouldSendOpwarmNow,
  shouldSendReminderNow,
} from "@/lib/email/afspraak-sequence";
import {
  afspraakStuurtMail,
  isVervolgMetHerinneringOptIn,
} from "@/lib/afspraak-soort";
import { isAbOpvolgingFlow } from "@/lib/afspraak-opvolging/assign";
import { logOpvolgingBericht } from "@/lib/afspraak-opvolging/log-bericht";
import { processAbFollowups } from "@/lib/afspraak-opvolging/process-ab";
import { sendOpvolgingBevestiging } from "@/lib/afspraak-opvolging/send-bevestiging";
import type { OpvolgingFlow } from "@/lib/afspraak-opvolging/types";

export const runtime = "nodejs";

const NA_AFSPRAAK_VAN = new Set([
  "afspraak",
  "vervolg_fysiek",
  "vervolg_tel",
]);

type LeadRow = {
  naam?: string | null;
  email?: string | null;
  telefoon?: string | null;
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
};

type AfspraakCronRow = {
  id: string;
  lead_id?: string | null;
  adviseur_id?: string | null;
  start_at: string;
  created_at: string;
  manage_token: string | null;
  bevestiging_verstuurd: boolean;
  herinnering_verstuurd: boolean;
  opwarm_verstuurd?: boolean;
  opvolging_flow?: string | null;
  bevestiging_sms_verstuurd?: boolean;
  social_proof_verstuurd?: boolean;
  reminder_48u_verstuurd?: boolean;
  avond_sms_verstuurd?: boolean;
  avond_mail_verstuurd?: boolean;
  soort?: string | null;
  leads?: LeadRow | LeadRow[] | null;
  adviseurs?:
    | { naam?: string | null; email?: string | null }
    | { naam?: string | null; email?: string | null }[]
    | null;
};

const SELECT_FULL =
  "id, lead_id, adviseur_id, start_at, created_at, manage_token, bevestiging_verstuurd, herinnering_verstuurd, opwarm_verstuurd, opvolging_flow, bevestiging_sms_verstuurd, social_proof_verstuurd, reminder_48u_verstuurd, avond_sms_verstuurd, avond_mail_verstuurd, soort, leads(naam, email, telefoon, postcode, huisnummer, toevoeging, straat, plaats), adviseurs!adviseur_id(naam, email)";

const SELECT_LEGACY =
  "id, lead_id, adviseur_id, start_at, created_at, manage_token, bevestiging_verstuurd, herinnering_verstuurd, opwarm_verstuurd, soort, leads(naam, email, telefoon, postcode, huisnummer, toevoeging, straat, plaats), adviseurs!adviseur_id(naam, email)";

/**
 * GET /api/cron/afspraak-herinneringen
 *
 * Legacy (opvolging_flow null/legacy):
 * 1. Bevestiging — direct / catch-up
 * 2. Opwarm saldering — ~48u voor
 * 3. Reminder — ~24u voor
 *
 * A/B intensief / rustig:
 * 1. Bevestiging mail+SMS catch-up
 * 2. Intensief: social proof, 48u mail+SMS
 * 3. Avond SMS (beide flows)
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    const q = new URL(req.url).searchParams.get("secret");
    if (auth !== `Bearer ${secret}` && q !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const sb = getSupabaseAdmin();
    const now = new Date();

    let afspraken: AfspraakCronRow[] = [];
    const { data, error } = await sb
      .from("afspraken")
      .select(SELECT_FULL)
      .in("status", ["gepland", "bevestigd", "verzet"])
      .gte("start_at", now.toISOString());

    if (error) {
      if (
        error.message?.includes("opvolging_flow") ||
        error.message?.includes("bevestiging_sms") ||
        error.message?.includes("social_proof") ||
        error.message?.includes("reminder_48u") ||
        error.message?.includes("avond_sms") ||
        error.message?.includes("avond_mail") ||
        error.code === "42703"
      ) {
        const retry = await sb
          .from("afspraken")
          .select(SELECT_LEGACY)
          .in("status", ["gepland", "bevestigd", "verzet"])
          .gte("start_at", now.toISOString());
        if (retry.error) {
          if (
            retry.error.message?.includes("opwarm_verstuurd") ||
            retry.error.code === "42703"
          ) {
            const bare = await sb
              .from("afspraken")
              .select(
                "id, lead_id, adviseur_id, start_at, created_at, manage_token, bevestiging_verstuurd, herinnering_verstuurd, soort, leads(naam, email, telefoon, postcode, huisnummer, toevoeging, straat, plaats), adviseurs!adviseur_id(naam, email)"
              )
              .in("status", ["gepland", "bevestigd", "verzet"])
              .gte("start_at", now.toISOString());
            if (bare.error) throw bare.error;
            afspraken = (bare.data || []).map((a) => ({
              ...a,
              opwarm_verstuurd: true,
              opvolging_flow: "legacy",
            }));
          } else {
            throw retry.error;
          }
        } else {
          afspraken = (retry.data || []).map((a) => ({
            ...a,
            opvolging_flow: "legacy",
          }));
        }
      } else {
        throw error;
      }
    } else {
      afspraken = data || [];
    }

    const mailResult = await processBatch(sb, afspraken, now);
    const voltooid = await markVoltooideAfspraken(sb, now);
    return NextResponse.json({ ...mailResult, ...voltooid });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function processBatch(
  sb: ReturnType<typeof getSupabaseAdmin>,
  afspraken: AfspraakCronRow[],
  now: Date
) {
  let bevestiging = 0;
  let bevestigingSms = 0;
  let opwarm = 0;
  let herinnering = 0;

  const abRows: Parameters<typeof processAbFollowups>[1] = [];

  for (const a of afspraken) {
    const fullSequence = afspraakStuurtMail(a.soort);
    const flow = (a.opvolging_flow || "legacy") as OpvolgingFlow | string;
    const isAb = isAbOpvolgingFlow(flow);

    const reminderOnly =
      !fullSequence &&
      isVervolgMetHerinneringOptIn(a.soort) &&
      !a.herinnering_verstuurd;
    if (!fullSequence && !reminderOnly) continue;

    const lead = Array.isArray(a.leads) ? a.leads[0] : a.leads;
    const adviseur = Array.isArray(a.adviseurs)
      ? a.adviseurs[0]
      : a.adviseurs;

    // —— A/B flows ——
    if (isAb && fullSequence && a.manage_token) {
      if (!a.bevestiging_verstuurd || !a.bevestiging_sms_verstuurd) {
        const sent = await sendOpvolgingBevestiging({
          sb,
          afspraakId: a.id,
          flow,
          leadId: a.lead_id,
          adviseurId: a.adviseur_id,
          manageToken: a.manage_token,
          startAt: new Date(a.start_at),
          lead,
          adviseur,
          alreadyMailSent: Boolean(a.bevestiging_verstuurd),
          alreadySmsSent: Boolean(a.bevestiging_sms_verstuurd),
        });
        if (sent.mailOk && !a.bevestiging_verstuurd) {
          a.bevestiging_verstuurd = true;
          bevestiging += 1;
        }
        if (sent.smsOk && !a.bevestiging_sms_verstuurd) {
          a.bevestiging_sms_verstuurd = true;
          bevestigingSms += 1;
        }
      }

      abRows.push({
        id: a.id,
        lead_id: a.lead_id,
        adviseur_id: a.adviseur_id,
        start_at: a.start_at,
        created_at: a.created_at,
        manage_token: a.manage_token,
        opvolging_flow: flow,
        bevestiging_verstuurd: Boolean(a.bevestiging_verstuurd),
        bevestiging_sms_verstuurd: Boolean(a.bevestiging_sms_verstuurd),
        social_proof_verstuurd: Boolean(a.social_proof_verstuurd),
        reminder_48u_verstuurd: Boolean(a.reminder_48u_verstuurd),
        avond_sms_verstuurd: Boolean(a.avond_sms_verstuurd),
        avond_mail_verstuurd: Boolean(a.avond_mail_verstuurd),
        leads: lead,
        adviseurs: adviseur,
      });
      continue;
    }

    // —— Legacy v1 (+ vervolg reminder-only) ——
    const email = lead?.email?.trim();
    if (!email || !a.manage_token) continue;

    const startAt = new Date(a.start_at);
    const createdAt = new Date(a.created_at);
    const manageUrl = `${appBaseUrl()}/afspraak/${a.manage_token}`;
    const replyTo = await replyToForAfspraak(sb, {
      adviseurId: a.adviseur_id,
      leadId: a.lead_id,
      adviseurJoin: adviseur,
    });
    const vars = afspraakMailVars({
      naam: lead?.naam || "klant",
      startAt,
      adviseurNaam: adviseur?.naam || "Batterijconcept",
      manageUrl,
      lead,
    });

    if (
      fullSequence &&
      shouldSendBevestigingNow({
        now,
        createdAt,
        startAt,
        alreadySent: Boolean(a.bevestiging_verstuurd),
      })
    ) {
      const subject = "Afspraak bevestigd — Batterijconcept";
      const tag = "afspraak-bevestiging";
      const result = await sendEmail({
        to: email,
        subject,
        html: afspraakBevestigingSequenceEmail(vars),
        tag,
        replyTo,
      });
      if (result.ok) {
        await sb
          .from("afspraken")
          .update({ bevestiging_verstuurd: true })
          .eq("id", a.id);
        a.bevestiging_verstuurd = true;
        bevestiging += 1;
        await logOpvolgingBericht(sb, {
          afspraakId: a.id,
          leadId: a.lead_id,
          opvolgingFlow: "legacy",
          step: "bevestiging",
          channel: "email",
          status: "sent",
          klantNaam: lead?.naam,
          toEmail: email,
          subject,
          provider: "postmark",
          providerMessageId: result.messageId,
          tag,
        });
      } else {
        await logOpvolgingBericht(sb, {
          afspraakId: a.id,
          leadId: a.lead_id,
          opvolgingFlow: "legacy",
          step: "bevestiging",
          channel: "email",
          status: "failed",
          klantNaam: lead?.naam,
          toEmail: email,
          subject,
          provider: "postmark",
          tag,
          error: result.error || "Mail versturen mislukt",
        });
      }
    }

    if (
      fullSequence &&
      shouldSendOpwarmNow({
        now,
        createdAt,
        startAt,
        bevestigingSent: Boolean(a.bevestiging_verstuurd),
        alreadySent: Boolean(a.opwarm_verstuurd),
      })
    ) {
      const subject = "Salderingsregeling stopt in 2027 — Batterijconcept";
      const tag = "afspraak-opwarm";
      const result = await sendEmail({
        to: email,
        subject,
        html: afspraakOpwarmSalderingEmail(vars),
        tag,
        replyTo,
      });
      if (result.ok) {
        const { error: upErr } = await sb
          .from("afspraken")
          .update({ opwarm_verstuurd: true })
          .eq("id", a.id);
        if (!upErr) {
          a.opwarm_verstuurd = true;
          opwarm += 1;
        }
        await logOpvolgingBericht(sb, {
          afspraakId: a.id,
          leadId: a.lead_id,
          opvolgingFlow: "legacy",
          step: "opwarm",
          channel: "email",
          status: "sent",
          klantNaam: lead?.naam,
          toEmail: email,
          subject,
          provider: "postmark",
          providerMessageId: result.messageId,
          tag,
        });
      } else {
        await logOpvolgingBericht(sb, {
          afspraakId: a.id,
          leadId: a.lead_id,
          opvolgingFlow: "legacy",
          step: "opwarm",
          channel: "email",
          status: "failed",
          klantNaam: lead?.naam,
          toEmail: email,
          subject,
          provider: "postmark",
          tag,
          error: result.error || "Mail versturen mislukt",
        });
      }
    }

    if (
      shouldSendReminderNow({
        now,
        startAt,
        alreadySent: Boolean(a.herinnering_verstuurd),
      })
    ) {
      const subject = "Morgen je adviesafspraak — Batterijconcept";
      const tag = "afspraak-herinnering";
      const result = await sendEmail({
        to: email,
        subject,
        html: afspraakReminder24uEmail(vars),
        tag,
        replyTo,
      });
      if (result.ok) {
        await sb
          .from("afspraken")
          .update({ herinnering_verstuurd: true })
          .eq("id", a.id);
        herinnering += 1;
        await logOpvolgingBericht(sb, {
          afspraakId: a.id,
          leadId: a.lead_id,
          opvolgingFlow: "legacy",
          step: "herinnering-24u",
          channel: "email",
          status: "sent",
          klantNaam: lead?.naam,
          toEmail: email,
          subject,
          provider: "postmark",
          providerMessageId: result.messageId,
          tag,
        });
      } else {
        await logOpvolgingBericht(sb, {
          afspraakId: a.id,
          leadId: a.lead_id,
          opvolgingFlow: "legacy",
          step: "herinnering-24u",
          channel: "email",
          status: "failed",
          klantNaam: lead?.naam,
          toEmail: email,
          subject,
          provider: "postmark",
          tag,
          error: result.error || "Mail versturen mislukt",
        });
      }
    }
  }

  const ab = await processAbFollowups(sb, abRows, now);

  return {
    ok: true,
    checked: afspraken.length,
    bevestiging,
    bevestiging_sms: bevestigingSms,
    opwarm,
    herinnering,
    ...ab,
  };
}

/** 2 uur na start: afspraak voltooid, lead naar “Na afspraak” als er geen nieuwe afspraak is. */
async function markVoltooideAfspraken(
  sb: ReturnType<typeof getSupabaseAdmin>,
  now: Date
) {
  const cutoff = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
  const { data: past, error } = await sb
    .from("afspraken")
    .select("id, lead_id")
    .in("status", ["gepland", "bevestigd", "verzet"])
    .lte("start_at", cutoff);

  if (error || !past?.length) {
    return { voltooid: 0, na_afspraak: 0 };
  }

  let voltooid = 0;
  let naAfspraak = 0;
  const nowIso = now.toISOString();

  for (const a of past) {
    const { error: upErr } = await sb
      .from("afspraken")
      .update({ status: "voltooid" })
      .eq("id", a.id);
    if (upErr) continue;
    voltooid += 1;

    const { data: remainingBel } = await sb
      .from("afspraken")
      .select("id")
      .eq("lead_id", a.lead_id)
      .in("soort", ["bel", "warme_bel"])
      .in("status", ["gepland", "bevestigd", "verzet"])
      .limit(1);
    if (!remainingBel?.length) {
      await sb
        .from("leads")
        .update({ terugbellen: false, terugbel_notitie: null })
        .eq("id", a.lead_id);
    }

    const { data: remaining } = await sb
      .from("afspraken")
      .select("id")
      .eq("lead_id", a.lead_id)
      .neq("status", "geannuleerd")
      .neq("status", "voltooid")
      .gt("start_at", nowIso)
      .limit(1);
    if (remaining && remaining.length > 0) continue;

    const { data: lead } = await sb
      .from("leads")
      .select("status")
      .eq("id", a.lead_id)
      .single();
    if (!lead || !NA_AFSPRAAK_VAN.has(lead.status)) continue;

    const { error: leadErr } = await sb
      .from("leads")
      .update({ status: "na_afspraak" })
      .eq("id", a.lead_id);
    if (!leadErr) {
      naAfspraak += 1;
      const { queueLeadMetaCapi } = await import("@/lib/meta-capi");
      queueLeadMetaCapi(a.lead_id);
    }
  }

  return { voltooid, na_afspraak: naAfspraak };
}
