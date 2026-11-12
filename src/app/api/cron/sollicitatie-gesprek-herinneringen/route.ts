import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendEmail } from "@/lib/email/postmark";
import { INFO_REPLY_TO } from "@/lib/email/adviseur-reply-to";
import {
  shouldSendSollicitatieGesprekHerinneringNow,
  sollicitatieGesprekHerinneringEmail,
} from "@/lib/email/templates";

export const runtime = "nodejs";

/**
 * GET /api/cron/sollicitatie-gesprek-herinneringen
 * ~2 dagen vóór sollicitatiegesprek: herinneringsmail met adres, interviewer, tijd, ±30 min.
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
    // Ruim genoeg voor het 40–50u-venster
    const windowStart = new Date(
      now.getTime() + 36 * 60 * 60 * 1000
    ).toISOString();
    const windowEnd = new Date(
      now.getTime() + 54 * 60 * 60 * 1000
    ).toISOString();

    const selectWithLocatie =
      "id, start_at, end_at, soort, locatie, interviewer_id, herinnering_verstuurd, sollicitaties(id, naam, email, functie), adviseurs:interviewer_id(id, naam, email)";
    const selectWithoutLocatie =
      "id, start_at, end_at, soort, interviewer_id, herinnering_verstuurd, sollicitaties(id, naam, email, functie), adviseurs:interviewer_id(id, naam, email)";

    let rowsQuery = await sb
      .from("sollicitatie_afspraken")
      .select(selectWithLocatie)
      .gte("start_at", windowStart)
      .lte("start_at", windowEnd);

    if (
      rowsQuery.error &&
      (rowsQuery.error.code === "42703" ||
        rowsQuery.error.message?.includes("locatie"))
    ) {
      rowsQuery = await sb
        .from("sollicitatie_afspraken")
        .select(selectWithoutLocatie)
        .gte("start_at", windowStart)
        .lte("start_at", windowEnd);
    }

    const { data: rows, error } = rowsQuery;

    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("sollicitatie_afspraken")
      ) {
        return NextResponse.json({
          ok: true,
          skipped: true,
          reason: "tabel ontbreekt",
        });
      }
      if (
        error.code === "42703" ||
        error.message?.includes("herinnering_verstuurd")
      ) {
        return NextResponse.json({
          ok: false,
          error:
            "Voer supabase/migrate-sollicitatie-afspraak-herinnering.sql uit in Supabase.",
        });
      }
      throw error;
    }

    let sent = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const row of rows || []) {
      const solRaw = row.sollicitaties as
        | {
            id?: string;
            naam?: string | null;
            email?: string | null;
            functie?: string | null;
          }
        | {
            id?: string;
            naam?: string | null;
            email?: string | null;
            functie?: string | null;
          }[]
        | null;
      const sol = Array.isArray(solRaw) ? solRaw[0] : solRaw;
      const advRaw = row.adviseurs as
        | { id?: string; naam?: string | null; email?: string | null }
        | { id?: string; naam?: string | null; email?: string | null }[]
        | null;
      const interviewer = Array.isArray(advRaw) ? advRaw[0] : advRaw;

      const email = sol?.email?.trim();
      if (!email) {
        skipped += 1;
        continue;
      }

      const startAt = new Date(row.start_at as string);
      if (
        !shouldSendSollicitatieGesprekHerinneringNow({
          now,
          startAt,
          alreadySent: Boolean(row.herinnering_verstuurd),
        })
      ) {
        skipped += 1;
        continue;
      }

      const soort =
        row.soort === "fysiek" || row.soort === "telefonisch"
          ? row.soort
          : "telefonisch";

      let duurMin = 30;
      if (row.end_at) {
        const endAt = new Date(row.end_at as string);
        const mins = Math.round(
          (endAt.getTime() - startAt.getTime()) / 60_000
        );
        if (mins > 0 && mins < 180) duurMin = mins;
      }

      const html = sollicitatieGesprekHerinneringEmail({
        naam: sol?.naam || "kandidaat",
        startAt,
        soort,
        functie: sol?.functie || null,
        interviewerNaam: interviewer?.naam || null,
        duurMin,
        locatie:
          "locatie" in row
            ? ((row as { locatie?: string | null }).locatie ?? null)
            : null,
      });

      const result = await sendEmail({
        to: email,
        subject: "Over 2 dagen je gesprek met Batterijconcept",
        html,
        tag: "sollicitatie-gesprek-herinnering",
        replyTo: INFO_REPLY_TO,
      });

      if (!result.ok) {
        errors.push(`${row.id}: ${result.error || "mailfout"}`);
        continue;
      }

      const { error: upErr } = await sb
        .from("sollicitatie_afspraken")
        .update({ herinnering_verstuurd: true })
        .eq("id", row.id);

      if (upErr) {
        errors.push(`${row.id}: flag ${upErr.message}`);
        continue;
      }
      sent += 1;
    }

    return NextResponse.json({
      ok: true,
      checked: (rows || []).length,
      sent,
      skipped,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
