import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { logLeadEvent } from "@/lib/lead-events";
import { appendStampedNotitie } from "@/lib/lead-notitie";
import { projectStatusLabel } from "@/lib/labels";
import {
  inferResumeStatusAfterHold,
  resumeStatusFromHoldEvents,
} from "@/lib/hold-sales";
import type { ProjectStatus } from "@/types/database";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/hold-sales/release
 * Sales stuurt HOLD terug naar backoffice + voegt een projectnotitie toe.
 * Body: { reply: string, author_naam?: string }
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { reply?: string | null; author_naam?: string | null } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const reply = body.reply?.trim() || "";
  if (!reply) {
    return NextResponse.json(
      { error: "Notitie is verplicht bij terugsturen naar backoffice" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: project, error: loadErr } = await sb
      .from("projecten")
      .select(
        "id, lead_id, status, project_nummer, notities, backoffice_notitie, schouw_at, schouw_jaar, schouw_week, warmtefonds_aangevraagd_at, warmtefonds_afspraak_at, installatie_at, installatie_voltooid_at, financiering_status, offertes(financiering_voorbehoud)"
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

    // Zoek vorige status uit lead-activiteit (meta.van bij HOLD)
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

    if (!resume) {
      resume = inferResumeStatusAfterHold(project);
    }

    const author = body.author_naam?.trim() || "Sales";
    const noteText = `HOLD teruggestuurd door sales\n${reply}`;
    const mergedNotities = appendStampedNotitie(
      (project as { notities?: string | null }).notities,
      noteText,
      new Date(),
      author
    );
    // Zichtbaar op project (zelfde plek als BO-notitie) — sales-antwoord voor BO.
    const boNotitie = `HOLD teruggestuurd door ${author}:\n${reply}`;

    const selectAfter =
      "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op)";
    const patchBase = {
      status: resume,
      notities: mergedNotities,
      backoffice_notitie: boNotitie,
      backoffice_notitie_door: author,
      hold_sales_deadline_at: null as string | null,
    };
    let { data: updated, error: updErr } = await sb
      .from("projecten")
      .update(patchBase)
      .eq("id", id)
      .select(selectAfter)
      .single();

    if (
      updErr &&
      (updErr.code === "42703" ||
        updErr.message?.includes("hold_sales_deadline_at"))
    ) {
      const { hold_sales_deadline_at: _drop, ...withoutDeadline } = patchBase;
      void _drop;
      const retry = await sb
        .from("projecten")
        .update(withoutDeadline)
        .eq("id", id)
        .select(selectAfter)
        .single();
      updated = retry.data;
      updErr = retry.error;
    }

    if (updErr || !updated) {
      return NextResponse.json(
        { error: updErr?.message || "Bijwerken mislukt" },
        { status: 500 }
      );
    }

    if (project.lead_id) {
      await logLeadEvent({
        leadId: project.lead_id,
        soort: "status",
        titel: `HOLD teruggestuurd door sales → ${projectStatusLabel[resume] || resume}`,
        detail: `${author}: ${reply}`,
        meta: {
          project_id: id,
          project_nummer: project.project_nummer,
          van: "hold_sales_actie",
          naar: resume,
          hold_released: true,
          author,
          reply,
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
          hold_released: true,
          author,
          reply,
        },
      });
    }

    return NextResponse.json({
      project: updated,
      resume_status: resume,
      message: `Terug naar backoffice · status ${projectStatusLabel[resume] || resume}`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
