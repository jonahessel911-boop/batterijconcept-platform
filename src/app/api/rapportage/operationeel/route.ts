import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { projectStatusLabel } from "@/lib/labels";
import {
  toOperationalStatus,
  type ProjectStatusKey,
} from "@/lib/project-status-config";

export const runtime = "nodejs";

/** Operationele pipeline-volgorde voor de staafgrafiek. */
const PIPELINE_ORDER: ProjectStatusKey[] = [
  "schouwweek_inplannen",
  "schouwdag_ingepland",
  "schouw_voltooid",
  "restfactuur_verstuurd",
  "restfactuur_betaald",
  "materiaal_besteld",
  "installatie_ingepland",
  "installatie_voltooid",
  "review_gevraagd",
  "service",
  "hold_sales_actie",
  "annulering",
];

const SHORT_LABEL: Partial<Record<ProjectStatusKey, string>> = {
  schouwweek_inplannen: "Opstarten",
  schouwdag_ingepland: "Schouw gepland",
  schouw_voltooid: "Schouw voltooid",
  restfactuur_verstuurd: "Restfactuur verstuurd",
  restfactuur_betaald: "Volledig betaald",
  materiaal_besteld: "Materiaal besteld",
  installatie_ingepland: "Installatie gepland",
  installatie_voltooid: "Installatie voltooid",
  review_gevraagd: "Review",
  service: "Service",
  hold_sales_actie: "HOLD",
  annulering: "Annulering",
};

export type OperationeelOrderRow = {
  id: string;
  project_nummer: string | null;
  titel: string | null;
  klant: string | null;
  plaats: string | null;
  verantwoordelijke_id: string | null;
  verantwoordelijke_naam: string | null;
};

type LeadJoin = {
  naam?: string | null;
  plaats?: string | null;
} | null;

type AdvJoin = { id?: string; naam?: string | null } | null;

/**
 * GET /api/rapportage/operationeel
 * Aantal orders per operationele status + orderlijst (klant + BO-medewerker).
 */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("projecten")
      .select(
        "id, status, project_nummer, titel, verantwoordelijke_id, leads(naam, plaats), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam)"
      )
      .order("project_nummer", { ascending: true });
    if (error) throw error;

    const byStatus = new Map<ProjectStatusKey, OperationeelOrderRow[]>();
    for (const key of PIPELINE_ORDER) byStatus.set(key, []);

    for (const row of data || []) {
      const r = row as {
        id: string;
        status?: string | null;
        project_nummer?: string | null;
        titel?: string | null;
        verantwoordelijke_id?: string | null;
        leads?: LeadJoin | LeadJoin[];
        verantwoordelijke?: AdvJoin | AdvJoin[];
      };
      const op = toOperationalStatus(r.status);
      const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
      const verd = Array.isArray(r.verantwoordelijke)
        ? r.verantwoordelijke[0]
        : r.verantwoordelijke;
      const list = byStatus.get(op) || [];
      list.push({
        id: r.id,
        project_nummer: r.project_nummer || null,
        titel: r.titel || null,
        klant: lead?.naam?.trim() || r.titel || null,
        plaats: lead?.plaats?.trim() || null,
        verantwoordelijke_id: r.verantwoordelijke_id || verd?.id || null,
        verantwoordelijke_naam: verd?.naam?.trim() || null,
      });
      byStatus.set(op, list);
    }

    const bars = PIPELINE_ORDER.map((status) => {
      const projects = byStatus.get(status) || [];
      return {
        status,
        label:
          SHORT_LABEL[status] ||
          projectStatusLabel[status as keyof typeof projectStatusLabel] ||
          status,
        count: projects.length,
        projects,
      };
    }).filter((b) => {
      if (
        b.status === "annulering" ||
        b.status === "hold_sales_actie" ||
        b.status === "service"
      ) {
        return b.count > 0;
      }
      return true;
    });

    const total = bars.reduce((s, b) => s + b.count, 0);
    const active = bars
      .filter((b) => b.status !== "annulering")
      .reduce((s, b) => s + b.count, 0);
    const max = Math.max(1, ...bars.map((b) => b.count));

    return NextResponse.json({
      ok: true,
      total,
      active,
      max,
      bars,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Operationele rapportage laden mislukt") },
      { status: 500 }
    );
  }
}
