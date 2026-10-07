import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { trackAndTraceIntroEmail } from "@/lib/email/templates";
import { ensureOfferteTrackToken } from "@/lib/ensure-track-token";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/track-mail
 * Stuurt de track & trace-intromail naar de klant.
 * Normaal via schouwweek-mail (POST /schouw); dit endpoint is fallback/handmatig.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  try {
    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, lead_id, offerte_id, leads(naam, email), offertes(id, offerte_nummer, track_token, track_mail_verstuurd_at, status)"
      )
      .eq("id", id)
      .single();

    if (error || !project) {
      return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
    }

    const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
    const email = lead?.email?.trim();
    if (!email) {
      return NextResponse.json(
        { error: "Lead heeft geen e-mailadres" },
        { status: 400 }
      );
    }

    type OffLite = {
      id: string;
      offerte_nummer: string;
      track_token?: string | null;
      track_mail_verstuurd_at?: string | null;
      status?: string;
    };
    const offJoin = Array.isArray(project.offertes)
      ? project.offertes[0]
      : project.offertes;
    let off: OffLite | null = (offJoin as OffLite | null) || null;

    if (!off?.id && project.offerte_id) {
      const { data: offRow } = await sb
        .from("offertes")
        .select(
          "id, offerte_nummer, track_token, track_mail_verstuurd_at, status"
        )
        .eq("id", project.offerte_id)
        .maybeSingle();
      off = (offRow as OffLite | null) || null;
    }

    if (!off?.id) {
      return NextResponse.json(
        { error: "Geen offerte gekoppeld aan dit project" },
        { status: 400 }
      );
    }

    const trackToken = await ensureOfferteTrackToken(
      sb,
      off.id,
      off.track_token
    );
    if (!trackToken) {
      return NextResponse.json(
        {
          error:
            "Track-token ontbreekt — draai migrate-track-token.sql in Supabase",
        },
        { status: 503 }
      );
    }

    const trackUrl = `${appBaseUrl()}/track/${trackToken}`;
    const html = trackAndTraceIntroEmail({
      naam: lead?.naam || "klant",
      projectNummer: project.project_nummer,
      offerteNummer: off.offerte_nummer,
      trackUrl,
    });

    const sent = await sendEmail({
      to: email,
      subject: "Volg je order — BatterijConcept",
      html,
      tag: "track-trace-intro",
    });

    if (!sent.ok) {
      return NextResponse.json(
        { error: sent.error || "Mail versturen mislukt" },
        { status: 502 }
      );
    }

    const now = new Date().toISOString();
    const { data: updatedOff, error: upErr } = await sb
      .from("offertes")
      .update({ track_mail_verstuurd_at: now })
      .eq("id", off.id)
      .select(
        "id, offerte_nummer, track_token, track_mail_verstuurd_at, track_last_seen_at, track_view_count"
      )
      .single();

    if (upErr) {
      console.error("track_mail_verstuurd_at:", upErr);
      if (upErr.code === "42703" || upErr.message?.includes("track_mail")) {
        return NextResponse.json(
          {
            error:
              "Kolom ontbreekt — draai migrate-track-mail-seen.sql in Supabase",
            mailed: true,
            trackUrl,
          },
          { status: 503 }
        );
      }
    }

    if (project.lead_id) {
      await logLeadEvent({
        leadId: project.lead_id,
        soort: "notitie",
        titel: "Track & trace verstuurd",
        detail: `Intromail naar ${email} · ${project.project_nummer}`,
        meta: {
          project_id: id,
          track_url: trackUrl,
          offerte_id: off.id,
        },
      });
    }

    const { data: refreshed } = await sb
      .from("projecten")
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op, track_token, track_mail_verstuurd_at, track_last_seen_at, track_view_count)"
      )
      .eq("id", id)
      .single();

    return NextResponse.json({
      ok: true,
      trackUrl,
      mailed_at: updatedOff?.track_mail_verstuurd_at || now,
      project: refreshed,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
