import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel } from "@/lib/format";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { schouwKlantEmail, schouwPartnerEmail } from "@/lib/email/templates";
import {
  isValidSchouwWeek,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { isWarmtefondsSale } from "@/lib/backoffice-acties";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/schouw
 * Plant schouw in op ISO-week (+ optioneel partner) en mailt klant (+ partner).
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
      .select("id, installatie_partner_id")
      .eq("id", id)
      .single();

    if (projErr || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

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

    let partnerNaam: string | null = null;
    let partnerEmail: string | null = null;
    let partnerToken: string | null = null;
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
      partnerNaam = partner.naam;
      partnerEmail = partner.email;
      partnerToken = partner.portal_token;
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
      monteur: partnerNaam,
      status: "schouw_in_afwachting",
    };

    const { data: updated, error: updateErr } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
      )
      .single();

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
      const klantHtml = schouwKlantEmail({
        naam: lead.naam || "klant",
        schouwJaar,
        schouwWeek,
        schouwAt: mailSchouwAt,
        adres,
        projectNummer: updated.project_nummer,
        warmtefonds,
      });
      const sent = await sendEmail({
        to: lead.email.trim(),
        subject: hasExactDay
          ? "Schouw gepland — Batterijconcept"
          : "Schouwweek gepland — Batterijconcept",
        html: klantHtml,
        tag: hasExactDay ? "schouw-klant-dag" : "schouw-klant-week",
      });
      mails.klant = sent.ok
        ? { ok: true }
        : { ok: false, error: sent.error || "Versturen mislukt" };
      if (sent.ok) mailPatch.schouw_mail_klant_verstuurd = true;
      else {
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

    if (partnerEmail?.trim() && partnerToken) {
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
      const sent = await sendEmail({
        to: partnerEmail.trim(),
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
      (updated.status as string) || "schouw_in_afwachting"
    );

    return NextResponse.json({
      project: { ...updated, ...mailPatch },
      mails,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

const SCHOUW_PLAN_STATUS = new Set([
  "schouw_aanbetaling",
  "aanbetaling_betaald",
  "schouw_in_afwachting",
  "schouw_voltooid",
  // legacy
  "schouw_inplannen",
  "schouwweek_gepland",
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
    const { data: project, error: projErr } = await sb
      .from("projecten")
      .select(
        "id, status, schouw_at, schouw_jaar, schouw_week"
      )
      .eq("id", id)
      .single();

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

    const patch: Record<string, unknown> = {
      schouw_at: null,
      schouw_jaar: null,
      schouw_week: null,
      schouw_herinnering_verstuurd: false,
      schouw_mail_klant_verstuurd: false,
      schouw_mail_partner_verstuurd: false,
    };
    if (SCHOUW_PLAN_STATUS.has(project.status)) {
      patch.status = "schouw_aanbetaling";
    }

    const { data: updated, error: updateErr } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
      )
      .single();

    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: "Schouw verwijderen mislukt",
          detail: updateErr?.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ project: updated, mailed: false });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
