import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/installatie
 * Plant installatie in. Geen e-mails.
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
      .select("id, naam, actief")
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
        installatie_mail_klant_verstuurd: false,
        installatie_mail_partner_verstuurd: false,
      })
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam, email, telefoon), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
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

    return NextResponse.json({
      project: updated,
      mails: { klant: { ok: false, skipped: true }, partner: { ok: false, skipped: true } },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
