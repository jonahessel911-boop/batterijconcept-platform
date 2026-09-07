import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel } from "@/lib/format";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import {
  installatieKlantEmail,
  installatiePartnerEmail,
} from "@/lib/email/templates";

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

    const installatieNotities = body.installatie_notities?.trim() || null;
    const { data: updated, error: updateErr } = await sb
      .from("projecten")
      .update({
        installatie_at: installatieAt.toISOString(),
        installatie_notities: installatieNotities,
        installatie_partner_id: partner.id,
        monteur: partner.naam,
        status: "materiaal_installatie",
        installatie_herinnering_verstuurd: false,
        installatie_mail_klant_verstuurd: false,
        installatie_mail_partner_verstuurd: false,
      })
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
      )
      .single();

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
      klant: { ok: boolean; skipped?: boolean; error?: string };
      partner: { ok: boolean; skipped?: boolean; error?: string };
    } = {
      klant: { ok: false, skipped: true },
      partner: { ok: false, skipped: true },
    };
    const mailPatch: Record<string, boolean> = {};

    if (lead?.email?.trim()) {
      const html = installatieKlantEmail({
        naam: lead.naam || "klant",
        installatieAt: whenIso,
        adres,
        projectNummer: updated.project_nummer,
      });
      const sent = await sendEmail({
        to: lead.email.trim(),
        subject: "Installatie gepland — Batterijconcept",
        html,
        tag: "installatie-klant",
      });
      mails.klant = sent.ok
        ? { ok: true }
        : { ok: false, error: sent.error || "Versturen mislukt" };
      if (sent.ok) mailPatch.installatie_mail_klant_verstuurd = true;
    } else {
      mails.klant = {
        ok: false,
        skipped: true,
        error: "Geen e-mailadres op de lead",
      };
    }

    if (partner.email?.trim() && partner.portal_token) {
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
      });
      const sent = await sendEmail({
        to: partner.email.trim(),
        subject: "Nieuwe installatie ingepland — Batterijconcept",
        html,
        tag: "installatie-partner",
      });
      mails.partner = sent.ok
        ? { ok: true }
        : { ok: false, error: sent.error || "Versturen mislukt" };
      if (sent.ok) mailPatch.installatie_mail_partner_verstuurd = true;
    } else {
      mails.partner = {
        ok: false,
        skipped: true,
        error: partner.email?.trim()
          ? "Geen portal-token voor partner"
          : "Geen e-mailadres op partner",
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
      (updated.status as string) || "materiaal_installatie"
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
