import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { adresRegel, formatDateTimeNl } from "@/lib/format";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/service
 * Plant een service-afspraak in (zichtbaar op planbord).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    service_at?: string;
    installatie_partner_id?: string;
    service_notities?: string | null;
    service_verzoek_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.service_at) {
    return NextResponse.json(
      { error: "service_at is verplicht" },
      { status: 400 }
    );
  }

  const serviceAt = new Date(body.service_at);
  if (Number.isNaN(serviceAt.getTime())) {
    return NextResponse.json(
      { error: "Ongeldige service_at" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: project, error: projErr } = await sb
      .from("projecten")
      .select("id, status, installatie_partner_id, lead_id, project_nummer")
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

    const serviceNotities = body.service_notities?.trim() || null;
    const whenIso = serviceAt.toISOString();

    const patch: Record<string, unknown> = {
      service_at: whenIso,
      service_notities: serviceNotities,
      installatie_partner_id: partner.id,
      monteur: partner.naam,
      status: "service",
    };

    let { data: updated, error: updateErr } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
      )
      .single();

    // Fallback als migratie service_at nog niet gedraaid is
    if (
      updateErr &&
      (updateErr.code === "42703" ||
        updateErr.message?.includes("service_at") ||
        updateErr.message?.includes("service_notities"))
    ) {
      return NextResponse.json(
        {
          error:
            "Kolom service_at ontbreekt. Voer supabase/migrate-project-service-at.sql uit.",
          detail: updateErr.message,
        },
        { status: 500 }
      );
    }

    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: "Service-afspraak opslaan mislukt",
          detail: updateErr?.message,
        },
        { status: 500 }
      );
    }

    if (body.service_verzoek_id) {
      const noteLine = `Service gepland: ${formatDateTimeNl(whenIso)}${
        serviceNotities ? ` — ${serviceNotities}` : ""
      }`;
      const { data: bestaande } = await sb
        .from("service_verzoeken")
        .select("id, interne_notitie")
        .eq("id", body.service_verzoek_id)
        .eq("project_id", id)
        .maybeSingle();
      if (bestaande) {
        const prev = (bestaande.interne_notitie || "").trim();
        await sb
          .from("service_verzoeken")
          .update({
            interne_notitie: prev ? `${prev}\n${noteLine}` : noteLine,
          })
          .eq("id", bestaande.id);
      }
    }

    const leadRaw = Array.isArray(updated.leads)
      ? updated.leads[0]
      : updated.leads;
    const lead = leadRaw as
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

    const adres = lead ? adresRegel(lead) : null;
    const mails: {
      partner: { ok: boolean; skipped?: boolean; error?: string };
    } = {
      partner: { ok: false, skipped: true },
    };

    if (partner.email?.trim()) {
      const portalUrl = partner.portal_token
        ? `${appBaseUrl()}/installatie/${partner.portal_token}`
        : null;
      const whenLabel = formatDateTimeNl(whenIso);
      const html = `
        <p>Hoi ${partner.naam},</p>
        <p>Er is een <strong>service-afspraak</strong> ingepland.</p>
        <ul>
          <li><strong>Klant:</strong> ${lead?.naam || "—"}</li>
          <li><strong>Wanneer:</strong> ${whenLabel}</li>
          <li><strong>Adres:</strong> ${adres || "—"}</li>
          <li><strong>Project:</strong> ${updated.project_nummer || "—"}</li>
          ${serviceNotities ? `<li><strong>Notitie:</strong> ${serviceNotities}</li>` : ""}
        </ul>
        ${portalUrl ? `<p><a href="${portalUrl}">Open installatieportal</a></p>` : ""}
        <p>Batterijconcept</p>
      `;
      const sent = await sendEmail({
        to: partner.email.trim(),
        subject: "Service-afspraak ingepland — Batterijconcept",
        html,
        tag: "service-partner",
      });
      mails.partner = sent.ok
        ? { ok: true }
        : { ok: false, error: sent.error || "Versturen mislukt" };
    } else {
      mails.partner = {
        ok: false,
        skipped: true,
        error: "Geen e-mailadres op partner",
      };
    }

    if (updated.lead_id) {
      await logLeadEvent({
        leadId: updated.lead_id,
        soort: "service",
        titel: "Service-afspraak gepland",
        detail: [
          formatDateTimeNl(whenIso),
          partner.naam ? `Partner: ${partner.naam}` : null,
          updated.project_nummer
            ? `Project ${updated.project_nummer}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        meta: {
          project_id: id,
          service_at: whenIso,
          installatie_partner_id: partner.id,
          service_verzoek_id: body.service_verzoek_id || null,
        },
      });
    }

    return NextResponse.json({
      project: updated,
      mails,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/projecten/[id]/service
 * Rond service-afspraak af: notitie verplicht, open tickets → afgehandeld.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    service_notities?: string | null;
    afronden?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const notitie = (body.service_notities || "").trim();
  if (!notitie) {
    return NextResponse.json(
      { error: "Notitie is verplicht bij afronden van service" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: project, error: projErr } = await sb
      .from("projecten")
      .select("id, lead_id, project_nummer, service_at, status")
      .eq("id", id)
      .single();

    if (projErr || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    if (!project.service_at) {
      return NextResponse.json(
        { error: "Geen service-afspraak om af te ronden" },
        { status: 400 }
      );
    }

    const { data: updated, error: updateErr } = await sb
      .from("projecten")
      .update({ service_notities: notitie })
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
      )
      .single();

    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: "Service-notitie opslaan mislukt",
          detail: updateErr?.message,
        },
        { status: 500 }
      );
    }

    if (body.afronden !== false) {
      const now = new Date().toISOString();
      const { data: openTickets } = await sb
        .from("service_verzoeken")
        .select("id, interne_notitie")
        .eq("project_id", id)
        .eq("status", "open");

      for (const t of openTickets || []) {
        const prev = (t.interne_notitie || "").trim();
        await sb
          .from("service_verzoeken")
          .update({
            status: "afgehandeld",
            afgehandeld_op: now,
            interne_notitie: prev
              ? `${prev}\n${notitie}`
              : notitie,
          })
          .eq("id", t.id);
      }

      const { syncProjectServiceStatus } = await import(
        "@/lib/service-verzoek"
      );
      await syncProjectServiceStatus(sb, id);
    }

    if (updated.lead_id) {
      await logLeadEvent({
        leadId: updated.lead_id,
        soort: "service",
        titel: "Service afgerond",
        detail: [
          notitie,
          updated.project_nummer
            ? `Project ${updated.project_nummer}`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
        meta: {
          project_id: id,
          service_at: project.service_at,
          afronden: body.afronden !== false,
        },
      });
    }

    const { data: refreshed } = await sb
      .from("projecten")
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon, portal_token), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
      )
      .eq("id", id)
      .single();

    return NextResponse.json({ project: refreshed || updated });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
