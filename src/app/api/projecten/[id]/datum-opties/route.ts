import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireBackofficeSession } from "@/lib/auth-require-backoffice";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { replyToForLeadAdviseur } from "@/lib/email/adviseur-reply-to";
import { datumOptieKlantEmail } from "@/lib/email/templates";
import { ensureOfferteTrackToken } from "@/lib/ensure-track-token";
import { logLeadEvent } from "@/lib/lead-events";
import {
  datumOptieSoortLabel,
  isDatumOptieSoort,
  parseSlotIso,
  type ProjectDatumOptie,
} from "@/lib/project-datum-opties";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/datum-opties
 * Body: { soort: "service"|"overstap", slots: [iso, iso, iso] }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireBackofficeSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id: projectId } = await ctx.params;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      soort?: unknown;
      slots?: unknown;
      service_notitie?: unknown;
    };

    if (!isDatumOptieSoort(body.soort)) {
      return NextResponse.json(
        { error: "Kies Service of Overstap" },
        { status: 400 }
      );
    }
    const soort = body.soort;

    const rawSlots = Array.isArray(body.slots) ? body.slots : [];
    if (rawSlots.length !== 3) {
      return NextResponse.json(
        { error: "Geef precies 3 datums/tijden op" },
        { status: 400 }
      );
    }
    const slots = rawSlots.map(parseSlotIso);
    if (slots.some((s) => !s)) {
      return NextResponse.json(
        { error: "Een of meer datums zijn ongeldig" },
        { status: 400 }
      );
    }
    const [slot_1, slot_2, slot_3] = slots as [string, string, string];

    const serviceNotitie =
      typeof body.service_notitie === "string"
        ? body.service_notitie.trim()
        : "";
    if (soort === "service" && serviceNotitie.length < 3) {
      return NextResponse.json(
        {
          error:
            "Notitie voor installateur is verplicht bij Service (zichtbaar op planbord/serviceverzoek)",
        },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, lead_id, offerte_id, leads(naam, email), offertes(id, offerte_nummer, track_token, status)"
      )
      .eq("id", projectId)
      .single();

    if (error || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
    const email = (lead as { email?: string | null } | null)?.email?.trim();
    const naam =
      (lead as { naam?: string | null } | null)?.naam?.trim() || "klant";
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
      status?: string;
    };
    const offJoin = Array.isArray(project.offertes)
      ? project.offertes[0]
      : project.offertes;
    let off: OffLite | null = (offJoin as OffLite | null) || null;

    if (!off?.id && project.offerte_id) {
      const { data: offRow } = await sb
        .from("offertes")
        .select("id, offerte_nummer, track_token, status")
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

    // Annuleer eerdere open uitnodigingen van dezelfde soort
    const { error: cancelErr } = await sb
      .from("project_datum_opties")
      .update({ status: "geannuleerd" })
      .eq("project_id", projectId)
      .eq("soort", soort)
      .eq("status", "open");

    if (cancelErr) {
      if (
        cancelErr.code === "42P01" ||
        cancelErr.message?.includes("project_datum_opties")
      ) {
        return NextResponse.json(
          {
            error:
              "Tabel ontbreekt — voer migrate-project-datum-opties.sql uit",
          },
          { status: 503 }
        );
      }
      throw cancelErr;
    }

    const now = new Date().toISOString();
    const insertRow: Record<string, unknown> = {
      project_id: projectId,
      soort,
      slot_1,
      slot_2,
      slot_3,
      status: "open",
      verstuurd_at: now,
      created_by: auth.session.adviseurId,
      service_notitie: soort === "service" ? serviceNotitie : null,
    };

    let { data: row, error: insertErr } = await sb
      .from("project_datum_opties")
      .insert(insertRow)
      .select("*")
      .single();

    if (
      insertErr &&
      (insertErr.message?.includes("service_notitie") ||
        insertErr.code === "42703")
    ) {
      delete insertRow.service_notitie;
      const retry = await sb
        .from("project_datum_opties")
        .insert(insertRow)
        .select("*")
        .single();
      row = retry.data;
      insertErr = retry.error;
      if (!insertErr && soort === "service") {
        // Kolom ontbreekt: bewaar notitie alvast op project voor planbord
        await sb
          .from("projecten")
          .update({ service_notities: serviceNotitie })
          .eq("id", projectId);
      }
    }

    if (insertErr || !row) {
      throw insertErr || new Error("Opslaan mislukt");
    }

    const soortLabel = datumOptieSoortLabel(soort);
    const portalUrl = `${appBaseUrl()}/track/${trackToken}?tab=${soort}`;
    const html = datumOptieKlantEmail({
      naam,
      soortLabel,
      slots: [slot_1, slot_2, slot_3],
      portalUrl,
      projectNummer: project.project_nummer,
    });

    const sent = await sendEmail({
      to: email,
      subject: `Kies een datum — ${soortLabel} · BatterijConcept`,
      html,
      tag: `datum-optie-${soort}`,
      replyTo: await replyToForLeadAdviseur(
        sb,
        project.lead_id as string | null
      ),
    });

    if (!sent.ok) {
      return NextResponse.json(
        {
          error: sent.error || "Mail versturen mislukt",
          optie: row as ProjectDatumOptie,
        },
        { status: 502 }
      );
    }

    if (project.lead_id) {
      void logLeadEvent({
        leadId: project.lead_id as string,
        soort: "datum_optie_verstuurd",
        titel: `Datum-opties ${soortLabel} verstuurd`,
        detail: `Drie tijden voorgesteld · klant kiest in Mijn portaal`,
        meta: {
          project_id: projectId,
          soort,
          optie_id: (row as ProjectDatumOptie).id,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      optie: row as ProjectDatumOptie,
      portalUrl,
    });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
