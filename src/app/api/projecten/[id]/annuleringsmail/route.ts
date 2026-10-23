import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/email/postmark";
import { replyToForLeadAdviseur } from "@/lib/email/adviseur-reply-to";
import { projectGeannuleerdKlantEmail } from "@/lib/email/templates";
import { logLeadEvent } from "@/lib/lead-events";
import {
  AV_ANNULERING_ARTIKEL,
  AV_ANNULERING_PCT,
  annuleringskostenIncBtw,
} from "@/lib/av-annulering";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/annuleringsmail
 * Verstuur bevestiging van order-annulering naar de klant.
 * Body: { binnenBedenktijd?: boolean } — true = geen annuleringskosten in de mail.
 * Alleen toegestaan als projectstatus = annulering.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      binnenBedenktijd?: boolean;
    };
    const binnenBedenktijd = Boolean(body.binnenBedenktijd);

    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select(
        "id, status, project_nummer, lead_id, offerte_id, leads(naam, email), offertes(id, offerte_nummer, totaal_inc_btw)"
      )
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;
    if (!project) {
      return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
    }
    if (project.status !== "annulering") {
      return NextResponse.json(
        { error: "Annuleringsmail alleen bij status Annulering" },
        { status: 400 }
      );
    }

    const leadRaw = project.leads;
    const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
    const to =
      lead && typeof lead === "object" && typeof lead.email === "string"
        ? lead.email.trim()
        : "";
    const naam =
      lead && typeof lead === "object" && typeof lead.naam === "string"
        ? lead.naam
        : "klant";

    if (!to) {
      return NextResponse.json(
        { error: "Geen e-mailadres op de lead" },
        { status: 400 }
      );
    }

    const offRaw = project.offertes;
    let offerte =
      offRaw && typeof offRaw === "object"
        ? (Array.isArray(offRaw) ? offRaw[0] : offRaw)
        : null;

    if (
      (!offerte || !(Number((offerte as { totaal_inc_btw?: number }).totaal_inc_btw) > 0)) &&
      project.offerte_id
    ) {
      const { data: off } = await sb
        .from("offertes")
        .select("id, offerte_nummer, totaal_inc_btw")
        .eq("id", project.offerte_id as string)
        .maybeSingle();
      if (off) offerte = off;
    }

    const orderTotaal = Number(
      (offerte as { totaal_inc_btw?: number | null } | null)?.totaal_inc_btw
    );
    const kosten =
      !binnenBedenktijd &&
      Number.isFinite(orderTotaal) &&
      orderTotaal > 0
        ? annuleringskostenIncBtw(orderTotaal)
        : 0;
    const offerteNummer =
      (offerte as { offerte_nummer?: string | null } | null)?.offerte_nummer ||
      null;

    const html = projectGeannuleerdKlantEmail({
      naam,
      projectNummer: (project.project_nummer as string) || null,
      offerteNummer,
      orderTotaalIncBtw:
        Number.isFinite(orderTotaal) && orderTotaal > 0 ? orderTotaal : null,
      annuleringskostenIncBtw: kosten > 0 ? kosten : null,
      avArtikel: AV_ANNULERING_ARTIKEL,
      annuleringsPctLabel: Math.round(AV_ANNULERING_PCT * 100),
      binnenBedenktijd,
    });
    const leadId = project.lead_id as string | null;
    const mail = await sendEmail({
      to,
      subject: binnenBedenktijd
        ? "Bestelling geannuleerd (binnen bedenktijd) — BatterijConcept"
        : "Bestelling geannuleerd — BatterijConcept",
      html,
      tag: "project-annulering",
      replyTo: await replyToForLeadAdviseur(sb, leadId),
    });

    if (leadId) {
      await logLeadEvent({
        leadId,
        soort: "email",
        titel: mail.ok
          ? binnenBedenktijd
            ? "Annuleringsmail verstuurd (binnen bedenktijd, geen kosten)"
            : "Annuleringsmail verstuurd naar klant"
          : "Annuleringsmail mislukt",
        detail: mail.ok
          ? `Naar ${to}${
              binnenBedenktijd
                ? " · geen annuleringskosten (bedenktijd)"
                : kosten > 0
                  ? ` · annuleringskosten € ${kosten.toFixed(2)} (art. ${AV_ANNULERING_ARTIKEL})`
                  : ""
            }`
          : mail.error || "Onbekende fout",
        meta: {
          project_id: id,
          project_nummer: project.project_nummer,
          to,
          ok: mail.ok,
          binnen_bedenktijd: binnenBedenktijd,
          order_totaal_inc_btw: Number.isFinite(orderTotaal) ? orderTotaal : null,
          annuleringskosten_inc_btw: kosten > 0 ? kosten : null,
          av_artikel: AV_ANNULERING_ARTIKEL,
        },
      });
    }

    if (!mail.ok) {
      return NextResponse.json(
        { error: mail.error || "Mailen mislukt", sent: false },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      sent: true,
      to,
      binnenBedenktijd,
      orderTotaalIncBtw:
        Number.isFinite(orderTotaal) && orderTotaal > 0 ? orderTotaal : null,
      annuleringskostenIncBtw: kosten > 0 ? kosten : null,
      avArtikel: AV_ANNULERING_ARTIKEL,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
