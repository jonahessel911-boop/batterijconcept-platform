import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import {
  installatieKlantEmail,
  installatiePartnerEmail,
} from "@/lib/email/templates";
import { adresRegel } from "@/lib/format";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/installatie
 * Plant installatie in, mailt klant + installatiepartner.
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
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats)"
      )
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
      .select("id, naam, email, telefoon, portal_token, actief")
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
        status: "installatie_gepland",
        installatie_herinnering_verstuurd: false,
      })
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon)"
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

    const lead = Array.isArray(updated.leads)
      ? updated.leads[0]
      : updated.leads;
    const adres = lead ? adresRegel(lead) : null;
    const portalUrl = `${appBaseUrl()}/installatie/${partner.portal_token}`;

    const combinedNotes = [
      installatieNotities,
      project.installateur_notitie?.trim(),
      lead?.notities?.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");

    let klantMail: { ok: boolean; error?: string } = {
      ok: false,
      error: "Geen klant-e-mail",
    };
    let partnerMail: { ok: boolean; error?: string } = {
      ok: false,
      error: "Geen partner-e-mail",
    };

    if (lead?.email?.trim()) {
      klantMail = await sendEmail({
        to: lead.email.trim(),
        subject: "Installatie gepland — Batterijconcept",
        html: installatieKlantEmail({
          naam: lead.naam || "klant",
          installatieAt,
          adres: adres !== "—" ? adres : null,
          projectNummer: updated.project_nummer,
        }),
        tag: "installatie-klant",
      });
    }

    if (partner.email?.trim()) {
      partnerMail = await sendEmail({
        to: partner.email.trim(),
        subject: `Nieuwe installatie: ${lead?.naam || updated.project_nummer}`,
        html: installatiePartnerEmail({
          partnerNaam: partner.naam,
          klantNaam: lead?.naam || "Klant",
          installatieAt,
          adres: adres !== "—" ? adres : null,
          telefoon: lead?.telefoon,
          email: lead?.email,
          projectNummer: updated.project_nummer,
          notities: combinedNotes || null,
          portalUrl,
        }),
        tag: "installatie-partner",
      });
    }

    await sb
      .from("projecten")
      .update({
        installatie_mail_klant_verstuurd: klantMail.ok,
        installatie_mail_partner_verstuurd: partnerMail.ok,
      })
      .eq("id", id);

    return NextResponse.json({
      project: {
        ...updated,
        installatie_mail_klant_verstuurd: klantMail.ok,
        installatie_mail_partner_verstuurd: partnerMail.ok,
      },
      mails: {
        klant: klantMail,
        partner: partnerMail,
      },
      portal_url: portalUrl,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
