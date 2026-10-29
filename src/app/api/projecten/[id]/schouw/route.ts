import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import { appBaseUrl, monteurCcEmail, sendEmail } from "@/lib/email/postmark";
import { replyToForLeadAdviseur } from "@/lib/email/adviseur-reply-to";
import { schouwKlantEmail, schouwPartnerEmail } from "@/lib/email/templates";
import {
  isValidSchouwWeek,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { isWarmtefondsSale } from "@/lib/backoffice-acties";
import { statusNaSchouwInplannen } from "@/lib/project-status-config";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/schouw
 * Plant schouw in op ISO-week (+ optioneel partner) en mailt klant.
 * Partner/monteur alleen bij definitieve schouwdag (niet bij week-only).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    schouw_jaar?: number;
    schouw_week?: number;
    /** Legacy: exacte datetime — wordt omgezet naar week. */
    schouw_at?: string;
    installatie_partner_id?: string | null;
    installatie_teamgenoot_id?: string | null;
    schouw_notities?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  let schouwJaar = body.schouw_jaar;
  let schouwWeek = body.schouw_week;
  const exactSchouwAt = body.schouw_at?.trim() || null;
  if (exactSchouwAt) {
    const parsed = new Date(exactSchouwAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Ongeldige schouw_at" }, { status: 400 });
    }
    const derived = schouwWeekFromDate(parsed);
    schouwJaar = derived.jaar;
    schouwWeek = derived.week;
  } else if ((schouwJaar == null || schouwWeek == null) && body.schouw_at) {
    const derived = schouwWeekFromDate(body.schouw_at);
    schouwJaar = derived.jaar;
    schouwWeek = derived.week;
  }

  if (
    schouwJaar == null ||
    schouwWeek == null ||
    !isValidSchouwWeek(schouwJaar, schouwWeek)
  ) {
    return NextResponse.json(
      { error: "Kies een geldige schouwweek (jaar + weeknummer)" },
      { status: 400 }
    );
  }

  let schouwAtIso: string;
  try {
    schouwAtIso = exactSchouwAt
      ? new Date(exactSchouwAt).toISOString()
      : schouwWeekToMondayIso(schouwJaar, schouwWeek);
  } catch {
    return NextResponse.json({ error: "Ongeldige schouwweek" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: project, error: projErr } = await sb
      .from("projecten")
      .select(
        "id, installatie_partner_id, betaalwijze, lead_id, offertes(financiering_voorbehoud), leads(status)"
      )
      .eq("id", id)
      .single();

    if (projErr || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const offRaw = Array.isArray(
      (project as { offertes?: unknown }).offertes
    )
      ? (project as { offertes: { financiering_voorbehoud?: boolean | null }[] })
          .offertes[0]
      : (project as { offertes?: { financiering_voorbehoud?: boolean | null } })
          .offertes;
    const leadRawPre = Array.isArray((project as { leads?: unknown }).leads)
      ? (project as { leads: { status?: string | null }[] }).leads[0]
      : (project as { leads?: { status?: string | null } }).leads;
    const betaalwijze = (project as { betaalwijze?: string | null })
      .betaalwijze;
    const warmtefondsForStatus =
      leadRawPre?.status === "sale_eigen_middelen"
        ? false
        : leadRawPre?.status === "sale_financiering"
          ? true
          : betaalwijze === "eigen_middelen"
            ? false
            : betaalwijze === "warmtefonds"
              ? true
              : isWarmtefondsSale({
                  leadStatus: leadRawPre?.status,
                  financieringVoorbehoud: offRaw?.financiering_voorbehoud,
                });

    // Eigen middelen: schouwweek pas ná 50% betaling (tenzij handmatig €0)
    if (!warmtefondsForStatus) {
      const { data: projectFull } = await sb
        .from("projecten")
        .select(
          "aanbetaling_te_innen_inc, offertes(aanbetaling_modus, aanbetaling_bedrag_inc, aanbetaling_te_innen_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, financiering_voorbehoud)"
        )
        .eq("id", id)
        .maybeSingle();
      const {
        isAanbetalingBetaald,
        projectHeeftGeenAanbetalingNodig,
      } = await import("@/lib/project-kickoff");
      const geenAanbetaling = projectHeeftGeenAanbetalingNodig(
        (projectFull || project) as unknown as Parameters<
          typeof projectHeeftGeenAanbetalingNodig
        >[0]
      );
      if (!geenAanbetaling) {
        const { data: facturenRows } = await sb
          .from("facturen")
          .select("status, omschrijving, credit_van_factuur_id")
          .eq("project_id", id);
        if (!isAanbetalingBetaald(facturenRows || [])) {
          return NextResponse.json(
            {
              error:
                "Eigen middelen: schouwweek pas inplannen nadat de 50%-aanbetaling is betaald.",
            },
            { status: 400 }
          );
        }
      }
    }

    const exacteDag = Boolean(exactSchouwAt);
    const nextStatus = statusNaSchouwInplannen({
      exacteDag,
      warmtefonds: warmtefondsForStatus,
    });

    let partnerId =
      body.installatie_partner_id || project.installatie_partner_id || null;

    // Geen partner meegegeven: als er maar één actieve is, die gebruiken
    if (!partnerId) {
      const { data: actieve } = await sb
        .from("installatie_partners")
        .select("id, naam, actief")
        .eq("actief", true);
      if (actieve?.length === 1) {
        partnerId = actieve[0].id;
      }
    }

    if (!partnerId) {
      return NextResponse.json(
        {
          error:
            "Kies een installatiepartner — anders verschijnt de schouw niet in hun portaal",
        },
        { status: 400 }
      );
    }

    let partnerEmail: string | null = null;
    let partnerToken: string | null = null;
    let partnerNaam: string | null = null;
    {
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
      partnerEmail = partner.email;
      partnerToken = partner.portal_token;
      partnerNaam = partner.naam;
    }

    let teamgenootId: string | null =
      body.installatie_teamgenoot_id?.trim() || null;
    let monteurNaam: string | null = null;
    let monteurEmail: string | null = null;
    if (teamgenootId) {
      const { data: tg } = await sb
        .from("installatie_partner_teamgenoten")
        .select("id, naam, email, actief")
        .eq("id", teamgenootId)
        .eq("partner_id", partnerId)
        .maybeSingle();
      if (!tg || tg.actief === false) {
        return NextResponse.json(
          { error: "Medewerker niet gevonden bij deze installateur" },
          { status: 400 }
        );
      }
      teamgenootId = tg.id;
      monteurNaam = tg.naam;
      monteurEmail = tg.email?.trim() || null;
    }

    const schouwNotities = body.schouw_notities?.trim() || null;
    const patch: Record<string, unknown> = {
      schouw_at: schouwAtIso,
      schouw_jaar: schouwJaar,
      schouw_week: schouwWeek,
      schouw_notities: schouwNotities,
      schouw_herinnering_verstuurd: false,
      schouw_mail_klant_verstuurd: false,
      schouw_mail_partner_verstuurd: false,
      installatie_partner_id: partnerId,
      installatie_teamgenoot_id: teamgenootId,
      monteur: monteurNaam,
      status: nextStatus,
    };

    let { data: updated, error: updateErr } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, track_token)"
      )
      .single();

    if (
      updateErr &&
      (updateErr.message?.includes("installatie_teamgenoot_id") ||
        updateErr.code === "42703")
    ) {
      const fallback = { ...patch };
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
      const missingWeek =
        updateErr?.message?.includes("schouw_jaar") ||
        updateErr?.message?.includes("schouw_week") ||
        updateErr?.code === "42703";
      return NextResponse.json(
        {
          error: missingWeek
            ? "Run migrate-schouw-week.sql in Supabase."
            : "Schouw opslaan mislukt",
          detail: updateErr?.message,
        },
        { status: missingWeek ? 400 : 500 }
      );
    }

    // Kickoff compleet (WF) → in één response naar afwachten WF, geen UI-flash op Opstarten
    if (!exacteDag) {
      const { kickoffCompletionPatch } = await import("@/lib/project-kickoff");
      const { data: facRows } = await sb
        .from("facturen")
        .select("status, omschrijving, credit_van_factuur_id")
        .eq("project_id", id);
      const kp = kickoffCompletionPatch(
        updated as import("@/types/database").Project,
        (facRows || []) as import("@/types/database").Factuur[]
      );
      if (kp) {
        const { data: finalized } = await sb
          .from("projecten")
          .update(kp)
          .eq("id", id)
          .select(
            "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, track_token)"
          )
          .single();
        if (finalized) updated = finalized;
      }
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

    // Zekerheid: haal e-mail opnieuw op als join leeg is
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

    const offerte = Array.isArray(updated.offertes)
      ? updated.offertes[0]
      : updated.offertes;

    let leadStatus: string | null = null;
    if (updated.lead_id) {
      const { data: leadStatusRow } = await sb
        .from("leads")
        .select("status")
        .eq("id", updated.lead_id)
        .maybeSingle();
      leadStatus = (leadStatusRow as { status?: string } | null)?.status || null;
    }
    // Eigen middelen → nooit Warmtefonds-tekst in de mail (ook als offerte-flag nog fout staat)
    const warmtefonds = isWarmtefondsSale({
      leadStatus,
      financieringVoorbehoud: offerte?.financiering_voorbehoud,
    });
    const adres = lead ? adresRegel(lead) : null;
    /** Alleen echte schouwdag (niet week-placeholder maandag 12:00) in de mail. */
    const mailSchouwAt = exactSchouwAt;

    const mails: {
      klant: { ok: boolean; skipped?: boolean; error?: string };
      partner: { ok: boolean; skipped?: boolean; error?: string };
    } = {
      klant: { ok: false, skipped: true },
      partner: { ok: false, skipped: true },
    };

    const mailPatch: Record<string, boolean> = {};

    if (lead?.email?.trim()) {
      const hasExactDay = Boolean(mailSchouwAt);
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
      const klantHtml = schouwKlantEmail({
        naam: lead.naam || "klant",
        schouwJaar,
        schouwWeek,
        schouwAt: mailSchouwAt,
        adres,
        projectNummer: updated.project_nummer,
        warmtefonds,
        trackUrl,
      });
      const sent = await sendEmail({
        to: lead.email.trim(),
        subject: hasExactDay
          ? "Schouw gepland — Batterijconcept"
          : "Schouwweek gepland — Batterijconcept",
        html: klantHtml,
        tag: hasExactDay ? "schouw-klant-dag" : "schouw-klant-week",
        replyTo: await replyToForLeadAdviseur(
          sb,
          updated.lead_id as string | null
        ),
      });
      mails.klant = sent.ok
        ? { ok: true }
        : { ok: false, error: sent.error || "Versturen mislukt" };
      if (sent.ok) {
        mailPatch.schouw_mail_klant_verstuurd = true;
        // Track & trace zit in de schouwweek/-dag mail — geen aparte taak
        if (trackUrl) {
          const offJoin = Array.isArray(updated.offertes)
            ? updated.offertes[0]
            : updated.offertes;
          if (offJoin?.id) {
            await sb
              .from("offertes")
              .update({ track_mail_verstuurd_at: new Date().toISOString() })
              .eq("id", offJoin.id)
              .is("track_mail_verstuurd_at", null);
          }
        }
      } else {
        console.error(
          "Schouw klantmail mislukt:",
          sent.error,
          "project",
          id,
          "to",
          lead.email
        );
      }
    } else {
      mails.klant = {
        ok: false,
        skipped: true,
        error: "Geen e-mailadres op de lead",
      };
      console.warn("Schouw gepland zonder klantmail — geen e-mailadres", id);
    }

    // Partner/monteur alleen bij definitieve schouwdag — niet bij week-placeholder.
    const monteurCc = monteurCcEmail(partnerEmail, monteurEmail);
    if (
      exactSchouwAt &&
      (partnerEmail?.trim() || monteurCc) &&
      partnerToken
    ) {
      const portalUrl = `${appBaseUrl()}/installatie/${partnerToken}`;
      const partnerHtml = schouwPartnerEmail({
        partnerNaam: partnerNaam || "partner",
        klantNaam: lead?.naam || "Klant",
        schouwJaar,
        schouwWeek,
        schouwAt: mailSchouwAt,
        adres,
        telefoon: lead?.telefoon || null,
        email: lead?.email || null,
        projectNummer: updated.project_nummer,
        notities: schouwNotities,
        portalUrl,
      });
      const to = partnerEmail?.trim() || monteurCc!;
      const cc =
        partnerEmail?.trim() && monteurCc ? monteurCc : null;
      const sent = await sendEmail({
        to,
        cc,
        subject: "Nieuwe schouw gepland — Batterijconcept",
        html: partnerHtml,
        tag: "schouw-partner",
      });
      mails.partner = sent.ok
        ? { ok: true }
        : { ok: false, error: sent.error || "Versturen mislukt" };
      if (sent.ok) mailPatch.schouw_mail_partner_verstuurd = true;
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
      (updated.status as string) || "schouwdag_ingepland"
    );

    if (updated.lead_id) {
      await logLeadEvent({
        leadId: updated.lead_id,
        soort: "schouw",
        titel: exactSchouwAt
          ? "Schouwdatum gepland"
          : `Schouwweek gezet (W${schouwWeek})`,
        detail: exactSchouwAt
          ? `Schouwdatum is gepland op ${formatDateTimeNl(schouwAtIso)}`
          : [
              schouwJaar && schouwWeek
                ? `${schouwJaar}-W${String(schouwWeek).padStart(2, "0")}`
                : null,
              updated.project_nummer
                ? `Project ${updated.project_nummer}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ") || null,
        meta: {
          project_id: id,
          schouw_jaar: schouwJaar,
          schouw_week: schouwWeek,
          schouw_at: schouwAtIso,
        },
      });
    }

    let googleCalendar: unknown = null;
    if (exactSchouwAt && partnerId) {
      const { syncPartnerGoogleEvent, leadFromProjectJoin } = await import(
        "@/lib/google-calendar"
      );
      googleCalendar = await syncPartnerGoogleEvent({
        partnerId,
        projectId: id,
        kind: "schouw",
        startIso: schouwAtIso,
        projectNummer: updated.project_nummer,
        titel: updated.titel,
        notities: schouwNotities,
        lead,
        existingEventId:
          (updated as { schouw_gcal_event_id?: string | null })
            .schouw_gcal_event_id || null,
      });
    }

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

const SCHOUW_PLAN_STATUS = new Set([
  "schouwweek_inplannen",
  "aanbetaling_verstuurd",
  "aanbetaling_betaald",
  "warmtefonds_afspraak_ingepland",
  "warmtefonds_aangevraagd",
  "warmtefonds_in_behandeling",
  "warmtefonds_goedgekeurd",
  "opstarten_voltooid_afwachten_wf",
  "schouwdag_ingepland",
  "schouw_voltooid",
  // legacy
  "schouwweek_gepland",
  "schouw_aanbetaling",
  "schouw_in_afwachting",
  "schouw_inplannen",
  "schouwdag_plannen",
  "schouw_gepland",
]);

/**
 * DELETE /api/projecten/[id]/schouw
 * Haalt schouw uit de agenda. Geen mail naar klant of partner.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;

  try {
    const sb = getSupabaseAdmin();
    let { data: project, error: projErr } = await sb
      .from("projecten")
      .select(
        "id, status, schouw_at, schouw_jaar, schouw_week, installatie_partner_id, schouw_gcal_event_id"
      )
      .eq("id", id)
      .single();

    if (
      projErr &&
      (projErr.code === "42703" ||
        projErr.message?.includes("schouw_gcal_event_id"))
    ) {
      const retry = await sb
        .from("projecten")
        .select(
          "id, status, schouw_at, schouw_jaar, schouw_week, installatie_partner_id"
        )
        .eq("id", id)
        .single();
      project = retry.data as typeof project;
      projErr = retry.error;
    }

    if (projErr || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    if (!project.schouw_at && !project.schouw_jaar && !project.schouw_week) {
      return NextResponse.json(
        { error: "Geen schouw gepland om te verwijderen" },
        { status: 400 }
      );
    }

    const gcalEventId =
      (project as { schouw_gcal_event_id?: string | null }).schouw_gcal_event_id ||
      null;
    const partnerIdForGcal =
      (project as { installatie_partner_id?: string | null })
        .installatie_partner_id || null;

    const patch: Record<string, unknown> = {
      schouw_at: null,
      schouw_jaar: null,
      schouw_week: null,
      schouw_herinnering_verstuurd: false,
      schouw_mail_klant_verstuurd: false,
      schouw_mail_partner_verstuurd: false,
    };
    if (gcalEventId) patch.schouw_gcal_event_id = null;
    if (SCHOUW_PLAN_STATUS.has(project.status)) {
      patch.status = "schouwweek_inplannen";
    }

    let { data: updated, error: updateErr } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
      )
      .single();

    if (
      updateErr &&
      patch.schouw_gcal_event_id === null &&
      (updateErr.code === "42703" ||
        updateErr.message?.includes("schouw_gcal_event_id"))
    ) {
      delete patch.schouw_gcal_event_id;
      const retry = await sb
        .from("projecten")
        .update(patch)
        .eq("id", id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
        )
        .single();
      updated = retry.data;
      updateErr = retry.error;
    }

    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: "Schouw verwijderen mislukt",
          detail: updateErr?.message,
        },
        { status: 500 }
      );
    }

    if (partnerIdForGcal && gcalEventId) {
      const { deletePartnerGoogleEvent } = await import(
        "@/lib/google-calendar"
      );
      await deletePartnerGoogleEvent({
        partnerId: partnerIdForGcal,
        projectId: id,
        kind: "schouw",
        eventId: gcalEventId,
      });
    }

    return NextResponse.json({ project: updated, mailed: false });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
