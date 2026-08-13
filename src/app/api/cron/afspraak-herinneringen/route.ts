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

export const runtime = "nodejs";

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
 * 1. Bevestiging — dag na inplannen (of direct bij korte termijn)
 * 2. Opwarm saldering — midpoint tussen bevestiging en 24u-reminder
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
        "id, start_at, created_at, manage_token, bevestiging_verstuurd, herinnering_verstuurd, opwarm_verstuurd, leads(naam, email, postcode, huisnummer, toevoeging, straat, plaats), adviseurs(naam)"
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
        return processBatch(
          sb,
          (retry.data || []).map((a) => ({
            ...a,
            opwarm_verstuurd: true, // skip opwarm tot migratie
          })),
          now
        );
      }
      throw error;
    }

    return processBatch(sb, afspraken || [], now);
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
    leads?: LeadRow | LeadRow[] | null;
    adviseurs?: { naam?: string | null } | { naam?: string | null }[] | null;
  }[],
  now: Date
) {
  let bevestiging = 0;
  let opwarm = 0;
  let herinnering = 0;

  for (const a of afspraken) {
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

  return NextResponse.json({
    ok: true,
    checked: afspraken.length,
    bevestiging,
    opwarm,
    herinnering,
  });
}
