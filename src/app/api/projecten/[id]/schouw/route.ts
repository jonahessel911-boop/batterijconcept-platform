import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import {
  schouwKlantEmail,
  schouwPartnerEmail,
} from "@/lib/email/templates";
import { adresRegel } from "@/lib/format";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/schouw
 * Plant schouw in, koppelt partner, mailt klant + installatiepartner.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    schouw_at?: string;
    installatie_partner_id?: string;
    schouw_notities?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.schouw_at || !body.installatie_partner_id) {
    return NextResponse.json(
      { error: "schouw_at en installatie_partner_id zijn verplicht" },
      { status: 400 }
    );
  }

  const schouwAt = new Date(body.schouw_at);
  if (Number.isNaN(schouwAt.getTime())) {
    return NextResponse.json({ error: "Ongeldige schouw_at" }, { status: 400 });
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

    const { data: partner, error: partnerErr } = await sb
      .from("installatie_partners")
      .select("id, naam, email, telefoon, portal_token, actief")
      .eq("id", body.installatie_partner_id)
      .single();

    if (partnerErr || !partner || !partner.actief) {
      return NextResponse.json(
        { error: "Installatiepartner niet gevonden of inactief" },
        { status: 404 }
      );
    }

    const schouwNotities = body.schouw_notities?.trim() || null;
    const { data: updated, error: updateErr } = await sb
      .from("projecten")
      .update({
        schouw_at: schouwAt.toISOString(),
        schouw_notities: schouwNotities,
        installatie_partner_id: partner.id,
        monteur: partner.naam,
        status: "schouw_gepland",
        schouw_herinnering_verstuurd: false,
      })
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon)"
      )
      .single();

    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: "Schouw opslaan mislukt",
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
      schouwNotities,
      lead?.notities?.trim(),
      project.notities?.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");

    const { data: fotoRows } = await sb
      .from("project_fotos")
      .select("storage_path, bestandsnaam")
      .eq("project_id", id)
      .order("created_at", { ascending: true });

    const fotoAttachments: {
      name: string;
      contentType: string;
      content: Buffer;
    }[] = [];
    for (const f of (fotoRows || []).slice(0, 8)) {
      const { data: file } = await sb.storage
        .from("project-fotos")
        .download(f.storage_path);
      if (!file) continue;
      const bytes = Buffer.from(await file.arrayBuffer());
      const name = f.bestandsnaam?.trim() || f.storage_path.split("/").pop() || "foto.jpg";
      fotoAttachments.push({
        name,
        contentType: file.type || "image/jpeg",
        content: bytes,
      });
    }

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
        subject: "Schouw gepland — Batterijconcept",
        html: schouwKlantEmail({
          naam: lead.naam || "klant",
          schouwAt,
          adres: adres !== "—" ? adres : null,
          projectNummer: updated.project_nummer,
        }),
        tag: "schouw-klant",
      });
    }

    if (partner.email?.trim()) {
      partnerMail = await sendEmail({
        to: partner.email.trim(),
        subject: `Nieuwe schouw: ${lead?.naam || updated.project_nummer}`,
        html: schouwPartnerEmail({
          partnerNaam: partner.naam,
          klantNaam: lead?.naam || "Klant",
          schouwAt,
          adres: adres !== "—" ? adres : null,
          telefoon: lead?.telefoon,
          email: lead?.email,
          projectNummer: updated.project_nummer,
          notities: combinedNotes || null,
          fotoCount: (fotoRows || []).length,
          portalUrl,
        }),
        tag: "schouw-partner",
        attachments: fotoAttachments,
      });
    }

    await sb
      .from("projecten")
      .update({
        schouw_mail_klant_verstuurd: klantMail.ok,
        schouw_mail_partner_verstuurd: partnerMail.ok,
      })
      .eq("id", id);

    return NextResponse.json({
      project: {
        ...updated,
        schouw_mail_klant_verstuurd: klantMail.ok,
        schouw_mail_partner_verstuurd: partnerMail.ok,
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
