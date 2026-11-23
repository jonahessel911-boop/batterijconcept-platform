import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import { appBaseUrl, monteurCcEmail, sendEmail } from "@/lib/email/postmark";
import { replyToForLeadAdviseur } from "@/lib/email/adviseur-reply-to";
import {
  installatieKlantEmail,
  installatieKlantWijzigingEmail,
  installatiePartnerEmail,
} from "@/lib/email/templates";
import { logLeadEvent } from "@/lib/lead-events";
import { feestdagPlanningFout } from "@/lib/nl-feestdagen";
import { statusNaInstallatieInplannen } from "@/lib/project-status-config";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/installatie
 * Plant installatie in en mailt klant + partner.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    installatie_at?: string;
    installatie_partner_id?: string;
    installatie_teamgenoot_id?: string | null;
    installatie_koppel_id?: string | null;
    installatie_notities?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.installatie_at) {
    return NextResponse.json(
      { error: "installatie_at is verplicht" },
      { status: 400 }
    );
  }

  const installatieAt = new Date(body.installatie_at);
  if (Number.isNaN(installatieAt.getTime())) {
    return NextResponse.json(
      { error: "Ongeldige installatie_at" },
      { status: 400 }
    );
  }
  const feestdagFout = feestdagPlanningFout(installatieAt);
  if (feestdagFout) {
    return NextResponse.json({ error: feestdagFout }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: project, error: projErr } = await sb
      .from("projecten")
      .select(
        "id, status, betaalwijze, installatie_partner_id, installatie_at, installatie_koppel_id, monteur, installatie_gcal_event_id, installatie_notities"
      )
      .eq("id", id)
      .single();

    if (projErr || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const vorigeInstallatieAt =
      (project as { installatie_at?: string | null }).installatie_at || null;
    const vorigePartnerId =
      (project as { installatie_partner_id?: string | null })
        .installatie_partner_id || null;
    const vorigeGcalEventId =
      (project as { installatie_gcal_event_id?: string | null })
        .installatie_gcal_event_id || null;

    const partnerId =
      body.installatie_partner_id || project.installatie_partner_id;
    if (!partnerId) {
      return NextResponse.json(
        { error: "Kies een installatiepartner" },
        { status: 400 }
      );
    }

    const { data: partner, error: partnerErr } = await sb
      .from("installatie_partners")
      .select("id, naam, email, actief, portal_token")
      .eq("id", partnerId)
      .single();

    if (partnerErr || !partner || !partner.actief) {
      return NextResponse.json(
        { error: "Installatiepartner niet gevonden of inactief" },
        { status: 404 }
      );
    }

    const { resolveKoppelVanPartner, koppelWeergaveNaam, koppelEmails } =
      await import("@/lib/installatie-koppel");
    const koppelIdExplicit = body.installatie_koppel_id !== undefined;
    let koppelId = koppelIdExplicit
      ? body.installatie_koppel_id?.trim() || null
      : (project as { installatie_koppel_id?: string | null })
          .installatie_koppel_id || null;
    let monteurNaam: string | null =
      (project as { monteur?: string | null }).monteur || null;
    let extraMonteurEmails: string[] = [];
    if (koppelId) {
      const koppel = await resolveKoppelVanPartner(partner.id, koppelId);
      if (!koppel) {
        if (koppelIdExplicit) {
          return NextResponse.json(
            { error: "Koppel niet gevonden bij deze installateur" },
            { status: 400 }
          );
        }
        koppelId = null;
        monteurNaam = null;
      } else {
        monteurNaam = koppelWeergaveNaam(koppel);
        extraMonteurEmails = koppelEmails(koppel);
      }
    }

    const tijdGewijzigd =
      Boolean(vorigeInstallatieAt) &&
      Math.abs(
        new Date(vorigeInstallatieAt as string).getTime() -
          installatieAt.getTime()
      ) > 60_000;
    const partnerGewijzigd =
      Boolean(vorigePartnerId) && vorigePartnerId !== partner.id;
    const isWijziging = tijdGewijzigd || partnerGewijzigd;

    const nextStatus = statusNaInstallatieInplannen({
      currentStatus: (project as { status?: string | null }).status,
      betaalwijze: (project as { betaalwijze?: string | null }).betaalwijze,
    });

    const installatieNotities =
      body.installatie_notities !== undefined
        ? body.installatie_notities?.trim() || null
        : (project as { installatie_notities?: string | null })
            .installatie_notities || null;
    const updatePatch: Record<string, unknown> = {
      installatie_at: installatieAt.toISOString(),
      installatie_notities: installatieNotities,
      installatie_partner_id: partner.id,
      monteur: monteurNaam,
      installatie_koppel_id: koppelId,
      status: nextStatus,
      installatie_herinnering_verstuurd: false,
      installatie_mail_klant_verstuurd: false,
      installatie_mail_partner_verstuurd: false,
    };

    let { data: updated, error: updateErr } = await sb
      .from("projecten")
      .update(updatePatch)
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, track_token)"
      )
      .single();

    if (updateErr && updateErr.message?.includes("installatie_koppel_id")) {
      return NextResponse.json(
        {
          error:
            "Voer supabase/migrate-project-installatie-koppel.sql uit in Supabase (kolom installatie_koppel_id).",
          detail: updateErr.message,
        },
        { status: 500 }
      );
    }
    if (
      updateErr &&
      (updateErr.message?.includes("installatie_teamgenoot_id") ||
        updateErr.code === "42703")
    ) {
      const fallback = { ...updatePatch };
      delete fallback.installatie_teamgenoot_id;
      const retry = await sb
        .from("projecten")
        .update(fallback)
        .eq("id", id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, track_token)"
        )
        .single();
      updated = retry.data;
      updateErr = retry.error;
    }

    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: "Installatie opslaan mislukt",
          detail: updateErr?.message,
        },
        { status: 500 }
      );
    }

    const leadRaw = Array.isArray(updated.leads)
      ? updated.leads[0]
      : updated.leads;
    let lead = leadRaw as
      | {
          naam?: string | null;
          email?: string | null;
          telefoon?: string | null;
          postcode?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          straat?: string | null;
          plaats?: string | null;
        }
      | null;

    if (!lead?.email?.trim() && updated.lead_id) {
      const { data: leadRow } = await sb
        .from("leads")
        .select(
          "naam, email, telefoon, postcode, huisnummer, toevoeging, straat, plaats"
        )
        .eq("id", updated.lead_id)
        .maybeSingle();
      if (leadRow) lead = leadRow;
    }

    const adres = lead ? adresRegel(lead) : null;
    const whenIso = installatieAt.toISOString();

    const mails: {
      klant: {
        ok: boolean;
        skipped?: boolean;
        error?: string;
        wijziging?: boolean;
      };
      partner: { ok: boolean; skipped?: boolean; error?: string };
    } = {
      klant: { ok: false, skipped: true },
      partner: { ok: false, skipped: true },
    };
    const mailPatch: Record<string, boolean> = {};

    if (lead?.email?.trim()) {
      let trackUrl: string | null = null;
      try {
        const offJoin = Array.isArray(updated.offertes)
          ? updated.offertes[0]
          : updated.offertes;
        const { ensureOfferteTrackToken } = await import(
          "@/lib/ensure-track-token"
        );
        if (offJoin?.id) {
          const trackToken = await ensureOfferteTrackToken(
            sb,
            offJoin.id,
            (offJoin as { track_token?: string | null }).track_token
          );
          if (trackToken) trackUrl = `${appBaseUrl()}/track/${trackToken}`;
        }
      } catch {
        /* track optioneel */
      }
      const html = isWijziging
        ? installatieKlantWijzigingEmail({
            naam: lead.naam || "klant",
            installatieAt: whenIso,
            vorigeInstallatieAt,
            adres,
            projectNummer: updated.project_nummer,
            trackUrl,
          })
        : installatieKlantEmail({
            naam: lead.naam || "klant",
            installatieAt: whenIso,
            adres,
            projectNummer: updated.project_nummer,
            trackUrl,
          });
      const sent = await sendEmail({
        to: lead.email.trim(),
        subject: isWijziging
          ? "Wijziging installatieafspraak — Batterijconcept"
          : "Installatie gepland — Batterijconcept",
        html,
        tag: isWijziging ? "installatie-klant-wijziging" : "installatie-klant",
        replyTo: await replyToForLeadAdviseur(
          sb,
          updated.lead_id as string | null
        ),
      });
      mails.klant = sent.ok
        ? { ok: true, wijziging: isWijziging }
        : { ok: false, error: sent.error || "Versturen mislukt" };
      if (sent.ok) mailPatch.installatie_mail_klant_verstuurd = true;
    } else {
      mails.klant = {
        ok: false,
        skipped: true,
        error: "Geen e-mailadres op de lead",
      };
    }

    const monteurCc = monteurCcEmail(
      partner.email,
      extraMonteurEmails[0] || null
    );
    if ((partner.email?.trim() || monteurCc) && partner.portal_token) {
      const portalUrl = `${appBaseUrl()}/installatie/${partner.portal_token}`;
      const html = installatiePartnerEmail({
        partnerNaam: partner.naam,
        klantNaam: lead?.naam || "Klant",
        installatieAt: whenIso,
        adres,
        telefoon: lead?.telefoon || null,
        email: lead?.email || null,
        projectNummer: updated.project_nummer,
        notities: installatieNotities,
        portalUrl,
        wijziging: isWijziging,
      });
      const to = partner.email?.trim() || monteurCc!;
      const cc =
        partner.email?.trim() && monteurCc ? monteurCc : null;
      const sent = await sendEmail({
        to,
        cc,
        subject: isWijziging
          ? "Installatieafspraak gewijzigd — Batterijconcept"
          : "Nieuwe installatie ingepland — Batterijconcept",
        html,
        tag: isWijziging
          ? "installatie-partner-wijziging"
          : "installatie-partner",
      });
      mails.partner = sent.ok
        ? { ok: true }
        : { ok: false, error: sent.error || "Versturen mislukt" };
      if (sent.ok) mailPatch.installatie_mail_partner_verstuurd = true;
    } else {
      mails.partner = {
        ok: false,
        skipped: true,
        error: partner.portal_token
          ? partner.email?.trim() || monteurCc
            ? "Onbekende mailfout"
            : "Geen e-mailadres op partner of monteur"
          : "Geen portal-token voor partner",
      };
    }

    if (Object.keys(mailPatch).length > 0) {
      await sb.from("projecten").update(mailPatch).eq("id", id);
    }

    const { syncAutoTakenVoorProject } = await import(
      "@/lib/sync-auto-taken"
    );
    await syncAutoTakenVoorProject(
      sb,
      id,
      (updated.status as string) || "installatie_ingepland"
    );

    if (updated.lead_id) {
      await logLeadEvent({
        leadId: updated.lead_id,
        soort: "installatie",
        titel: isWijziging
          ? "Installatieafspraak gewijzigd"
          : "Installatie gepland",
        detail: isWijziging
          ? `Installatie verzet naar ${formatDateTimeNl(whenIso)}${
              vorigeInstallatieAt
                ? ` (was ${formatDateTimeNl(vorigeInstallatieAt)})`
                : ""
            }`
          : [
              formatDateTimeNl(whenIso),
              updated.project_nummer
                ? `Project ${updated.project_nummer}`
                : null,
            ]
              .filter(Boolean)
              .join(" · "),
        meta: {
          project_id: id,
          installatie_at: whenIso,
          installatie_partner_id: partner.id,
        },
      });
    }

    const { deletePartnerGoogleEvent, syncPartnerGoogleEvent } = await import(
      "@/lib/google-calendar"
    );
    if (partnerGewijzigd && vorigePartnerId && vorigeGcalEventId) {
      await deletePartnerGoogleEvent({
        partnerId: vorigePartnerId,
        projectId: id,
        kind: "installatie",
        eventId: vorigeGcalEventId,
      });
    }
    const googleCalendar = await syncPartnerGoogleEvent({
      partnerId: partner.id,
      projectId: id,
      kind: "installatie",
      startIso: whenIso,
      projectNummer: updated.project_nummer,
      titel: updated.titel,
      notities: installatieNotities,
      lead,
      existingEventId: partnerGewijzigd
        ? null
        : vorigeGcalEventId ||
          (updated as { installatie_gcal_event_id?: string | null })
            .installatie_gcal_event_id ||
          null,
    });

    return NextResponse.json({
      project: { ...updated, ...mailPatch },
      mails,
      googleCalendar,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
