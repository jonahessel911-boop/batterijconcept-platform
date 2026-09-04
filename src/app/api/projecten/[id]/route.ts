import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { ProjectStatus } from "@/types/database";
import { PROJECT_STATUSES } from "@/lib/labels";
import {
  isValidSchouwWeek,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";

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

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
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

    return NextResponse.json({ project: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
