import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import {
  afspraakBevestigingSequenceEmail,
  afspraakMailVars,
  afspraakOpwarmSalderingEmail,
  afspraakReminder24uEmail,
  shouldSendBevestigingNow,
  shouldSendOpwarmNow,
  shouldSendReminderNow,
} from "@/lib/email/afspraak-sequence";
import { afspraakStuurtMail } from "@/lib/afspraak-soort";

export const runtime = "nodejs";

const NA_AFSPRAAK_VAN = new Set([
  "afspraak",
  "vervolg_fysiek",
  "vervolg_tel",
]);

type LeadRow = {
  naam?: string | null;
  email?: string | null;
  postcode?: string | null;
  huisnummer?: string | null;
  toevoeging?: string | null;
  straat?: string | null;
  plaats?: string | null;
};

/**
 * GET /api/cron/afspraak-herinneringen
 * Mailsequentie:
 * 1. Bevestiging — direct bij inplannen (cron vangt gemiste mails op)
 * 2. Opwarm saldering — ~2 dagen (48u) voor de afspraak
 * 3. Reminder — ~24 uur voor de afspraak
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

    // Alle actieve toekomstige afspraken (ruim genoeg voor de hele sequentie)
    const { data: afspraken, error } = await sb
      .from("afspraken")
      .select(
        "id, start_at, created_at, manage_token, bevestiging_verstuurd, herinnering_verstuurd, opwarm_verstuurd, soort, leads(naam, email, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam)"
      )
      .in("status", ["gepland", "bevestigd", "verzet"])
      .gte("start_at", now.toISOString());

    if (error) {
      // Soft-fail als opwarm-kolom nog ontbreekt
      if (
        error.message?.includes("opwarm_verstuurd") ||
        error.code === "42703"
      ) {
        const retry = await sb
          .from("afspraken")
          .select(
            "id, start_at, created_at, manage_token, bevestiging_verstuurd, herinnering_verstuurd, leads(naam, email, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam)"
          )
          .in("status", ["gepland", "bevestigd", "verzet"])
          .gte("start_at", now.toISOString());
        if (retry.error) throw retry.error;
        const mailResult = await processBatch(
          sb,
          (retry.data || []).map((a) => ({
            ...a,
            opwarm_verstuurd: true, // skip opwarm tot migratie
          })),
          now
        );
        const voltooid = await markVoltooideAfspraken(sb, now);
        return NextResponse.json({ ...mailResult, ...voltooid });
      }
      throw error;
    }

    const mailResult = await processBatch(sb, afspraken || [], now);
    const voltooid = await markVoltooideAfspraken(sb, now);
    return NextResponse.json({ ...mailResult, ...voltooid });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function processBatch(
  sb: ReturnType<typeof getSupabaseAdmin>,
  afspraken: {
    id: string;
    start_at: string;
    created_at: string;
    manage_token: string | null;
    bevestiging_verstuurd: boolean;
    herinnering_verstuurd: boolean;
    opwarm_verstuurd?: boolean;
    soort?: string | null;
    leads?: LeadRow | LeadRow[] | null;
    adviseurs?: { naam?: string | null } | { naam?: string | null }[] | null;
  }[],
  now: Date
) {
  let bevestiging = 0;
  let opwarm = 0;
  let herinnering = 0;

  for (const a of afspraken) {
    if (!afspraakStuurtMail(a.soort)) continue;
    const lead = Array.isArray(a.leads) ? a.leads[0] : a.leads;
    const adviseur = Array.isArray(a.adviseurs)
      ? a.adviseurs[0]
      : a.adviseurs;
    const email = lead?.email?.trim();
    if (!email || !a.manage_token) continue;

    const startAt = new Date(a.start_at);
    const createdAt = new Date(a.created_at);
    const manageUrl = `${appBaseUrl()}/afspraak/${a.manage_token}`;
    const vars = afspraakMailVars({
      naam: lead?.naam || "klant",
      startAt,
      adviseurNaam: adviseur?.naam || "Batterijconcept",
      manageUrl,
      lead,
    });

    // 1. Bevestiging
    if (
      shouldSendBevestigingNow({
        now,
        createdAt,
        startAt,
        alreadySent: Boolean(a.bevestiging_verstuurd),
      })
    ) {
      const result = await sendEmail({
        to: email,
        subject: "Afspraak bevestigd — Batterijconcept",
        html: afspraakBevestigingSequenceEmail(vars),
        tag: "afspraak-bevestiging",
      });
      if (result.ok) {
        await sb
          .from("afspraken")
          .update({ bevestiging_verstuurd: true })
          .eq("id", a.id);
        a.bevestiging_verstuurd = true;
        bevestiging += 1;
      }
    }

    // 2. Opwarm saldering
    if (
      shouldSendOpwarmNow({
        now,
        createdAt,
        startAt,
        bevestigingSent: Boolean(a.bevestiging_verstuurd),
        alreadySent: Boolean(a.opwarm_verstuurd),
      })
    ) {
      const result = await sendEmail({
        to: email,
        subject: "Salderingsregeling stopt in 2027 — Batterijconcept",
        html: afspraakOpwarmSalderingEmail(vars),
        tag: "afspraak-opwarm",
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
      }
    }

    // 3. 24u reminder
    if (
      shouldSendReminderNow({
        now,
        startAt,
        alreadySent: Boolean(a.herinnering_verstuurd),
      })
    ) {
      const result = await sendEmail({
        to: email,
        subject: "Morgen je adviesafspraak — Batterijconcept",
        html: afspraakReminder24uEmail(vars),
        tag: "afspraak-herinnering",
      });
      if (result.ok) {
        await sb
          .from("afspraken")
          .update({ herinnering_verstuurd: true })
          .eq("id", a.id);
        herinnering += 1;
      }
    }
  }

  return {
    ok: true,
    checked: afspraken.length,
    bevestiging,
    opwarm,
    herinnering,
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
    if (!leadErr) naAfspraak += 1;
  }

  return { voltooid, na_afspraak: naAfspraak };
}
