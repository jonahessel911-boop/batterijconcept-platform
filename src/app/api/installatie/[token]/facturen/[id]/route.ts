import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { mailGoedgekeurdePartnerCreditfactuur } from "@/lib/creditfactuur-verstuur";

export const runtime = "nodejs";

async function resolvePartner(token: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("installatie_partners")
    .select("id, naam, email, actief, portal_token")
    .eq("portal_token", token)
    .single();
  if (error || !data || !data.actief) return null;
  return data;
}

/**
 * PATCH /api/installatie/[token]/facturen/[id]
 * Body: { action: "goedkeuren" }
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; id: string }> }
) {
  const { token, id } = await ctx.params;

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (body.action !== "goedkeuren") {
    return NextResponse.json(
      { error: "action=goedkeuren is verplicht" },
      { status: 400 }
    );
  }

  try {
    const partner = await resolvePartner(token);
    if (!partner) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: fac, error } = await sb
      .from("partner_creditfacturen")
      .select("id, partner_id, status, factuur_nummer, goedgekeurd_op")
      .eq("id", id)
      .maybeSingle();

    if (error || !fac) {
      return NextResponse.json(
        { error: "Factuur niet gevonden" },
        { status: 404 }
      );
    }
    if (fac.partner_id !== partner.id) {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }
    if (fac.status === "goedgekeurd" || fac.status === "betaald") {
      return NextResponse.json({ factuur: fac, already: true });
    }
    if (fac.status !== "verzonden") {
      return NextResponse.json(
        { error: "Alleen verstuurde facturen kunnen worden goedgekeurd" },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const { data: updated, error: updErr } = await sb
      .from("partner_creditfacturen")
      .update({
        status: "goedgekeurd",
        goedgekeurd_op: now,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (updErr || !updated) {
      return NextResponse.json(
        { error: updErr?.message || "Goedkeuren mislukt" },
        { status: 500 }
      );
    }

    let mail_sent = false;
    let mail_error: string | null = null;
    try {
      const mail = await mailGoedgekeurdePartnerCreditfactuur(sb, id);
      mail_sent = mail.ok;
      mail_error = mail.ok ? null : mail.error || "Mail mislukt";
    } catch (mailErr) {
      mail_error =
        mailErr instanceof Error ? mailErr.message : "Mail mislukt";
    }

    return NextResponse.json({
      factuur: updated,
      mail_sent,
      mail_error,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Goedkeuren mislukt") },
      { status: 500 }
    );
  }
}
