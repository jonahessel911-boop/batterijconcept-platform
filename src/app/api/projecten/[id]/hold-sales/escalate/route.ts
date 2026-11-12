import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { logLeadEvent } from "@/lib/lead-events";
import { appendStampedNotitie } from "@/lib/lead-notitie";
import { projectStatusLabel } from "@/lib/labels";
import {
  HOLD_SALES_VERLENG_DAGEN,
  extendHoldSalesDeadlineAt,
  inferResumeStatusAfterHold,
  isHoldSalesDeadlineVerlopen,
  resumeStatusFromHoldEvents,
} from "@/lib/hold-sales";
import type { ProjectStatus } from "@/types/database";

export const runtime = "nodejs";

type EscalateAction = "extend" | "await_bedenktijd" | "annulering";

/**
 * POST /api/projecten/[id]/hold-sales/escalate
 * BO-keuze nadat sales-HOLD-deadline is verlopen.
 * Body: { action: "extend" | "await_bedenktijd" | "annulering", author_naam?: string }
 *
 * - extend: +5 dagen, blijft HOLD
 * - await_bedenktijd: HOLD opheffen → vorige status
 * - annulering: alleen markeren dat UI annuleringsfactuur mag starten
 *   (factuur zelf via /annuleringsfactuur)
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { action?: string | null; author_naam?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = (body.action || "").trim() as EscalateAction;
  if (
    action !== "extend" &&
    action !== "await_bedenktijd" &&
    action !== "annulering"
  ) {
    return NextResponse.json(
      { error: "Ongeldige actie (extend | await_bedenktijd | annulering)" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: project, error: loadErr } = await sb
      .from("projecten")
      .select(
        "id, lead_id, status, project_nummer, notities, hold_sales_deadline_at, backoffice_notitie, schouw_at, schouw_jaar, schouw_week, warmtefonds_aangevraagd_at, warmtefonds_afspraak_at, installatie_at, installatie_voltooid_at, financiering_status, offertes(financiering_voorbehoud)"
      )
      .eq("id", id)
      .maybeSingle();

    if (loadErr) throw loadErr;
    if (!project) {
      return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
    }
    if (project.status !== "hold_sales_actie") {
      return NextResponse.json(
        { error: "Dit project staat niet op HOLD SALES ACTIE" },
        { status: 400 }
      );
    }

    const author = body.author_naam?.trim() || "Backoffice";
    const selectAfter =
      "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op)";

    if (action === "extend") {
      const nextDeadline = extendHoldSalesDeadlineAt(
        project.hold_sales_deadline_at
      );
      const noteText = `HOLD sales verlengd met ${HOLD_SALES_VERLENG_DAGEN} dagen`;
      const mergedNotities = appendStampedNotitie(
        (project as { notities?: string | null }).notities,
        noteText,
        new Date(),
        author
      );
      let { data: updated, error: updErr } = await sb
        .from("projecten")
        .update({
          hold_sales_deadline_at: nextDeadline,
          notities: mergedNotities,
        })
        .eq("id", id)
        .select(selectAfter)
        .single();
      if (
        updErr &&
        (updErr.code === "42703" ||
          updErr.message?.includes("hold_sales_deadline_at"))
      ) {
        return NextResponse.json(
          {
            error:
              "Kolom hold_sales_deadline_at ontbreekt — run migrate-hold-sales-deadline.sql",
          },
          { status: 500 }
        );
      }
      if (updErr || !updated) {
        return NextResponse.json(
          { error: updErr?.message || "Verlengen mislukt" },
          { status: 500 }
        );
      }
      if (project.lead_id) {
        await logLeadEvent({
          leadId: project.lead_id,
          soort: "notitie",
          titel: noteText,
          detail: author,
          meta: {
            project_id: id,
            project_nummer: project.project_nummer,
            hold_extended: true,
            hold_sales_deadline_at: nextDeadline,
            author,
          },
        });
      }
      return NextResponse.json({
        project: updated,
        action: "extend",
        hold_sales_deadline_at: nextDeadline,
        message: `HOLD verlengd met ${HOLD_SALES_VERLENG_DAGEN} dagen`,
      });
    }

    if (action === "await_bedenktijd") {
      let resume: ProjectStatus | null = null;
      if (project.lead_id) {
        const { data: events } = await sb
          .from("lead_events")
          .select("meta, created_at")
          .eq("lead_id", project.lead_id)
          .eq("soort", "status")
          .order("created_at", { ascending: false })
          .limit(40);
        resume = resumeStatusFromHoldEvents(events, id);
      }
      if (!resume) resume = inferResumeStatusAfterHold(project);

      const noteText =
        "Afwachten bedenktijd — klant heeft niet geannuleerd · HOLD opgeheven";
      const mergedNotities = appendStampedNotitie(
        (project as { notities?: string | null }).notities,
        noteText,
        new Date(),
        author
      );
      let { data: updated, error: updErr } = await sb
        .from("projecten")
        .update({
          status: resume,
          notities: mergedNotities,
          hold_sales_deadline_at: null,
        })
        .eq("id", id)
        .select(selectAfter)
        .single();
      if (
        updErr &&
        (updErr.code === "42703" ||
          updErr.message?.includes("hold_sales_deadline_at"))
      ) {
        const retry = await sb
          .from("projecten")
          .update({
            status: resume,
            notities: mergedNotities,
          })
          .eq("id", id)
          .select(selectAfter)
          .single();
        updated = retry.data;
        updErr = retry.error;
      }
      if (updErr || !updated) {
        return NextResponse.json(
          { error: updErr?.message || "Afwachten bedenktijd mislukt" },
          { status: 500 }
        );
      }
      if (project.lead_id) {
        await logLeadEvent({
          leadId: project.lead_id,
          soort: "status",
          titel: `Projectstatus: ${projectStatusLabel[resume] || resume}`,
          detail: `Was: HOLD SALES ACTIE · ${noteText}`,
          meta: {
            project_id: id,
            project_nummer: project.project_nummer,
            van: "hold_sales_actie",
            naar: resume,
            hold_await_bedenktijd: true,
          },
        });
        await logLeadEvent({
          leadId: project.lead_id,
          soort: "notitie",
          titel: noteText,
          detail: author,
          meta: {
            project_id: id,
            project_nummer: project.project_nummer,
            hold_await_bedenktijd: true,
            author,
          },
        });
      }
      return NextResponse.json({
        project: updated,
        action: "await_bedenktijd",
        resume_status: resume,
        message: `Afwachten bedenktijd · status ${projectStatusLabel[resume] || resume}`,
      });
    }

    // annulering: UI start /annuleringsfactuur; hier alleen check + hint
    if (!isHoldSalesDeadlineVerlopen(project.hold_sales_deadline_at)) {
      // Mag ook vóór deadline vanuit BO — geen harde blokkade
    }
    return NextResponse.json({
      action: "annulering",
      project_id: id,
      proceed_annuleringsfactuur: true,
      message: "Start annuleringsfactuur",
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
