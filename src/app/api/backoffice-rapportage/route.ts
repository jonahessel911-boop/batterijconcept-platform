import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  buildBackofficeRapportage,
  type BackofficeRapportagePeriod,
} from "@/lib/backoffice-rapportage";

export const runtime = "nodejs";

const PERIODS: BackofficeRapportagePeriod[] = [
  "this_week",
  "last_week",
  "this_month",
  "last_7_days",
  "last_14_days",
  "last_30_days",
  "this_quarter",
];

function parsePeriod(v: string | null): BackofficeRapportagePeriod {
  if (v && PERIODS.includes(v as BackofficeRapportagePeriod)) {
    return v as BackofficeRapportagePeriod;
  }
  return "last_14_days";
}

/** GET /api/backoffice-rapportage?period=last_14_days */
export async function GET(req: NextRequest) {
  const period = parsePeriod(req.nextUrl.searchParams.get("period"));

  try {
    const sb = getSupabaseAdmin();

    const [
      leadsRes,
      takenRes,
      eventsRes,
      projectenRes,
      facturenRes,
      adviseursRes,
      afsprakenRes,
    ] = await Promise.all([
      sb
        .from("leads")
        .select(
          "id, created_at, eerste_gebeld_at, beller_id, belpogingen, naam, telefoon, plaats, status"
        ),
      sb
        .from("project_taken")
        .select(
          "id, status, verantwoordelijke_id, due_at, updated_at, created_at"
        ),
      sb
        .from("backoffice_actie_events")
        .select(
          "id, soort, adviseur_id, deadline_at, completed_at, on_time, project_id, factuur_id"
        ),
      sb.from("projecten").select(
        `*, leads(id, naam, telefoon, plaats, status),
         offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, ondertekend_op)`
      ),
      sb.from("facturen").select("*"),
      sb.from("adviseurs").select("id, naam, rol, actief"),
      sb
        .from("afspraken")
        .select("id, lead_id, start_at, status, soort, notities"),
    ]);

    // Tabel/kolom ontbreekt → graceful empty
    const leads = leadsRes.error
      ? ((await sb
          .from("leads")
          .select(
            "id, created_at, beller_id, belpogingen, naam, telefoon, plaats, status, laatst_gebeld_at"
          )).data || []).map((l) => ({
          ...l,
          eerste_gebeld_at:
            Number(l.belpogingen) === 1 && l.laatst_gebeld_at
              ? l.laatst_gebeld_at
              : null,
        }))
      : leadsRes.data || [];

    const taken = takenRes.error ? [] : takenRes.data || [];
    const actieEvents = eventsRes.error ? [] : eventsRes.data || [];
    const projecten = projectenRes.error ? [] : projectenRes.data || [];
    const facturen = facturenRes.error ? [] : facturenRes.data || [];
    const adviseurs = adviseursRes.error ? [] : adviseursRes.data || [];
    const afspraken = afsprakenRes.error ? [] : afsprakenRes.data || [];

    const dashboard = buildBackofficeRapportage(
      {
        leads,
        taken,
        actieEvents,
        projecten,
        facturen,
        adviseurs,
        afspraken,
      },
      period
    );

    return NextResponse.json({ dashboard });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Rapportage laden mislukt") },
      { status: 500 }
    );
  }
}
