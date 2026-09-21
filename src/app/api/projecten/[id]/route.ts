import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { ProjectStatus } from "@/types/database";
import { PROJECT_STATUSES, projectStatusLabel } from "@/lib/labels";
import {
  isValidSchouwWeek,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/** PATCH /api/projecten/[id] — status / projectkosten / bel-actie / schouwweek */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: {
    status?: ProjectStatus;
    projectkosten?: number;
    bel_schouw_aanbetaling_at?: string | null;
    financiering_geschakeld_at?: string | null;
    schouw_jaar?: number | null;
    schouw_week?: number | null;
    leveradres?: string | null;
    materiaal_checks?: Record<string, boolean> | null;
    notities?: string | null;
    backoffice_notitie?: string | null;
    installateur_notitie?: string | null;
    afdeling?: string | null;
    verantwoordelijke_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.status) {
    if (!PROJECT_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if (typeof body.projectkosten === "number") {
    if (Number.isNaN(body.projectkosten) || body.projectkosten < 0) {
      return NextResponse.json(
        { error: "Ongeldige projectkosten" },
        { status: 400 }
      );
    }
    patch.projectkosten = Math.round(body.projectkosten * 100) / 100;
  }
  if (body.bel_schouw_aanbetaling_at !== undefined) {
    if (body.bel_schouw_aanbetaling_at === null) {
      patch.bel_schouw_aanbetaling_at = null;
    } else {
      const d = new Date(body.bel_schouw_aanbetaling_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige bel-datum" },
          { status: 400 }
        );
      }
      patch.bel_schouw_aanbetaling_at = d.toISOString();
    }
  }
  if (body.financiering_geschakeld_at !== undefined) {
    if (body.financiering_geschakeld_at === null) {
      patch.financiering_geschakeld_at = null;
    } else {
      const d = new Date(body.financiering_geschakeld_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige datum" },
          { status: 400 }
        );
      }
      patch.financiering_geschakeld_at = d.toISOString();
    }
  }
  if (body.schouw_jaar !== undefined || body.schouw_week !== undefined) {
    if (body.schouw_jaar == null || body.schouw_week == null) {
      patch.schouw_jaar = null;
      patch.schouw_week = null;
      patch.schouw_at = null;
    } else if (!isValidSchouwWeek(body.schouw_jaar, body.schouw_week)) {
      return NextResponse.json(
        { error: "Ongeldige schouwweek" },
        { status: 400 }
      );
    } else {
      try {
        patch.schouw_jaar = body.schouw_jaar;
        patch.schouw_week = body.schouw_week;
        patch.schouw_at = schouwWeekToMondayIso(
          body.schouw_jaar,
          body.schouw_week
        );
      } catch {
        return NextResponse.json(
          { error: "Ongeldige schouwweek" },
          { status: 400 }
        );
      }
    }
  }
  if (body.leveradres !== undefined) {
    patch.leveradres = body.leveradres?.trim() || null;
  }
  if (body.materiaal_checks !== undefined) {
    patch.materiaal_checks =
      body.materiaal_checks && typeof body.materiaal_checks === "object"
        ? body.materiaal_checks
        : {};
  }
  if (body.notities !== undefined) {
    patch.notities = body.notities?.trim() || null;
  }
  if (body.backoffice_notitie !== undefined) {
    patch.backoffice_notitie = body.backoffice_notitie?.trim() || null;
  }
  if (body.installateur_notitie !== undefined) {
    patch.installateur_notitie = body.installateur_notitie?.trim() || null;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: before } = await sb
      .from("projecten")
      .select("id, lead_id, status, project_nummer, materiaal_checks")
      .eq("id", id)
      .maybeSingle();

    let { data, error } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc)"
      )
      .single();

    if (
      error &&
      (error.message?.includes("bel_schouw_aanbetaling_at") ||
        error.message?.includes("financiering_geschakeld_at") ||
        error.code === "42703")
    ) {
      return NextResponse.json(
        {
          error:
            "Voer supabase/migrate-bel-schouw-actie.sql en migrate-financiering-schakel-actie.sql uit in Supabase.",
        },
        { status: 500 }
      );
    }

    if (
      error &&
      (error.message?.includes("offertes") || error.code === "PGRST200")
    ) {
      const retry = await sb
        .from("projecten")
        .update(patch)
        .eq("id", id)
        .select("*, leads(naam, email, telefoon, lead_number)")
        .single();
      data = retry.data;
      error = retry.error;
    }

    if (error || !data) {
      return NextResponse.json(
        {
          error: "Bijwerken mislukt",
          detail: error?.message,
        },
        { status: 500 }
      );
    }

    const leadId = (before?.lead_id || data.lead_id) as string | undefined;
    if (leadId) {
      if (body.status && before?.status && body.status !== before.status) {
        await logLeadEvent({
          leadId,
          soort: "status",
          titel: `Projectstatus: ${projectStatusLabel[body.status] || body.status}`,
          detail: before.status
            ? `Was: ${projectStatusLabel[before.status as ProjectStatus] || before.status}`
            : null,
          meta: {
            project_id: id,
            project_nummer: data.project_nummer,
            van: before.status,
            naar: body.status,
          },
        });
      }

      if (body.materiaal_checks && typeof body.materiaal_checks === "object") {
        const prev = (before?.materiaal_checks || {}) as Record<string, boolean>;
        const next = body.materiaal_checks;
        const newlyChecked = Object.keys(next).filter(
          (key) => next[key] === true && prev[key] !== true
        );
        for (const key of newlyChecked) {
          const label = key.replace(/^std:/, "").replace(/[_-]/g, " ");
          await logLeadEvent({
            leadId,
            soort: "inkoop",
            titel: `Inkoop gemarkeerd: ${label}`,
            detail: data.project_nummer
              ? `Project ${data.project_nummer}`
              : null,
            meta: { project_id: id, check_key: key },
          });
        }
      }
    }

    if (body.status) {
      const { syncAutoTakenVoorProject } = await import(
        "@/lib/sync-auto-taken"
      );
      await syncAutoTakenVoorProject(sb, id, body.status);
    }

    return NextResponse.json({ project: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
