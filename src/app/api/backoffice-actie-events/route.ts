import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import type { BackofficeActieEventSoort } from "@/types/database";

export const runtime = "nodejs";

const SOORTEN: BackofficeActieEventSoort[] = [
  "bel_schouw_aanbetaling",
  "schakel_financiering",
  "nabellen_factuur",
  "herplan_afspraak",
];

/** POST /api/backoffice-actie-events — log voltooide actie */
export async function POST(req: Request) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);

    let body: {
      soort?: string;
      lead_id?: string | null;
      project_id?: string | null;
      factuur_id?: string | null;
      adviseur_id?: string | null;
      deadline_at?: string | null;
      completed_at?: string | null;
      on_time?: boolean | null;
      meta?: Record<string, unknown> | null;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }

    const soort = body.soort as BackofficeActieEventSoort | undefined;
    if (!soort || !SOORTEN.includes(soort)) {
      return NextResponse.json({ error: "Ongeldige soort" }, { status: 400 });
    }

    const completedAt = body.completed_at || new Date().toISOString();
    const deadlineAt = body.deadline_at || null;
    let onTime = body.on_time;
    if (onTime === undefined || onTime === null) {
      onTime =
        deadlineAt != null
          ? new Date(completedAt).getTime() <= new Date(deadlineAt).getTime()
          : null;
    }

    const adviseurId = body.adviseur_id || session?.adviseurId || null;

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("backoffice_actie_events")
      .insert({
        soort,
        lead_id: body.lead_id || null,
        project_id: body.project_id || null,
        factuur_id: body.factuur_id || null,
        adviseur_id: adviseurId,
        deadline_at: deadlineAt,
        completed_at: completedAt,
        on_time: onTime,
        meta: body.meta || null,
      })
      .select("*")
      .single();

    if (error) {
      if (
        error.code === "42P01" ||
        error.message?.includes("backoffice_actie_events")
      ) {
        return NextResponse.json({
          ok: false,
          skipped: true,
          detail:
            "Tabel ontbreekt — voer migrate-backoffice-actie-events.sql uit",
        });
      }
      return NextResponse.json(
        { error: "Opslaan mislukt", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ event: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
