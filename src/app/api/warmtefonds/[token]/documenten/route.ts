import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  isMissingWfProjectColumn,
  isWarmtefondsPortalProject,
  resolveWarmtefondsOperator,
} from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

type Doc = {
  id: string;
  soort: "offerte" | "factuur";
  naam: string;
  status: string;
  statusLabel: string;
  pdf: string;
  projectId: string;
  projectNummer: string;
  klant: string | null;
  toelichting: string | null;
};

const PROJECT_SELECT = `
  id, project_nummer, status, betaalwijze, financiering_status, offerte_id,
  leads(naam),
  offertes(id, offerte_nummer, status, ondertekend_op)
`;

function offerteDocStatus(
  status: string | null | undefined,
  ondertekendOp: string | null | undefined
): { status: string; statusLabel: string } {
  if (ondertekendOp || status === "ondertekend") {
    return { status: "ondertekend", statusLabel: "Ondertekend" };
  }
  if (status === "verzonden") {
    return { status: "verzonden", statusLabel: "Verzonden" };
  }
  if (status === "verlopen") return { status: "verlopen", statusLabel: "Verlopen" };
  if (status === "afgewezen") return { status: "afgewezen", statusLabel: "Afgewezen" };
  return { status: "concept", statusLabel: "Concept" };
}

function factuurDocStatus(status: string | null | undefined): {
  status: string;
  statusLabel: string;
} {
  if (status === "betaald") return { status: "betaald", statusLabel: "Betaald" };
  if (status === "deels_betaald") {
    return { status: "deels_betaald", statusLabel: "Deels betaald" };
  }
  if (status === "verzonden") {
    return { status: "verzonden", statusLabel: "Verzonden" };
  }
  if (status === "vervallen") return { status: "vervallen", statusLabel: "Vervallen" };
  return { status: "concept", statusLabel: "Concept" };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** GET /api/warmtefonds/[token]/documenten — offerte + facturen van de aanvragen. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json({ error: "Portaal niet gevonden" }, { status: 404 });
    }

    const primary = await sb
      .from("projecten")
      .select(PROJECT_SELECT)
      .neq("status", "annulering")
      .or("betaalwijze.eq.warmtefonds,financiering_status.not.is.null");

    let rows = primary.data as Record<string, unknown>[] | null;
    if (primary.error && isMissingWfProjectColumn(primary.error)) {
      const fallback = await sb
        .from("projecten")
        .select(
          "id, project_nummer, status, betaalwijze, offerte_id, leads(naam), offertes(id, offerte_nummer, status, ondertekend_op)"
        )
        .neq("status", "annulering")
        .eq("betaalwijze", "warmtefonds");
      if (fallback.error) throw fallback.error;
      rows = fallback.data as Record<string, unknown>[] | null;
    } else if (primary.error) {
      throw primary.error;
    }

    const projecten = (rows || []).filter((row) =>
      isWarmtefondsPortalProject(
        row as {
          betaalwijze?: string | null;
          financiering_status?: string | null;
          status?: string | null;
        }
      )
    );

    const documenten: Doc[] = [];
    const projectIds: string[] = [];

    for (const row of projecten) {
      const id = String(row.id);
      projectIds.push(id);
      const nummer = String(row.project_nummer || "");
      const leadRaw = row.leads as { naam?: string | null } | { naam?: string | null }[] | null;
      const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
      const klant = lead?.naam || null;
      const offRaw = row.offertes as
        | {
            id?: string;
            offerte_nummer?: string | null;
            status?: string | null;
            ondertekend_op?: string | null;
          }
        | {
            id?: string;
            offerte_nummer?: string | null;
            status?: string | null;
            ondertekend_op?: string | null;
          }[]
        | null;
      const off = Array.isArray(offRaw) ? offRaw[0] : offRaw;
      if (!off?.id) continue;
      const st = offerteDocStatus(off.status, off.ondertekend_op);
      documenten.push({
        id: `offerte-${off.id}`,
        soort: "offerte",
        naam: off.offerte_nummer ? `Offerte ${off.offerte_nummer}` : "Offerte",
        status: st.status,
        statusLabel: st.statusLabel,
        pdf: `/api/warmtefonds/${token}/orders/${id}/offerte`,
        projectId: id,
        projectNummer: nummer,
        klant,
        toelichting: null,
      });
    }

    type FactuurRow = {
      id: string;
      factuur_nummer?: string | null;
      status?: string | null;
      omschrijving?: string | null;
      project_id?: string | null;
      offerte_id?: string | null;
      credit_van_factuur_id?: string | null;
    };

    const facturen: FactuurRow[] = [];
    for (const ids of chunk(projectIds, 80)) {
      if (ids.length === 0) continue;
      const res = await sb
        .from("facturen")
        .select(
          "id, factuur_nummer, status, omschrijving, project_id, offerte_id, credit_van_factuur_id"
        )
        .in("project_id", ids);
      if (res.error) {
        if (res.error.message?.includes("credit_van_factuur_id")) {
          const plain = await sb
            .from("facturen")
            .select("id, factuur_nummer, status, omschrijving, project_id, offerte_id")
            .in("project_id", ids);
          if (plain.error) throw plain.error;
          facturen.push(...((plain.data || []) as FactuurRow[]));
          continue;
        }
        throw res.error;
      }
      facturen.push(...((res.data || []) as FactuurRow[]));
    }

    const byId = new Map(projecten.map((p) => [String(p.id), p]));
    for (const f of facturen) {
      const project = f.project_id ? byId.get(f.project_id) : undefined;
      if (!project) continue;
      const leadRaw = project.leads as
        | { naam?: string | null }
        | { naam?: string | null }[]
        | null;
      const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
      const st = factuurDocStatus(f.status);
      const credit = Boolean(f.credit_van_factuur_id);
      const nummer = f.factuur_nummer || "factuur";
      documenten.push({
        id: `factuur-${f.id}`,
        soort: "factuur",
        naam: credit ? `Creditfactuur ${nummer}` : `Factuur ${nummer}`,
        status: st.status,
        statusLabel: st.statusLabel,
        pdf: `/api/warmtefonds/${token}/facturen/${f.id}/pdf`,
        projectId: String(project.id),
        projectNummer: String(project.project_nummer || ""),
        klant: lead?.naam || null,
        toelichting: f.omschrijving?.trim() || null,
      });
    }

    documenten.sort((a, b) => {
      const pn = b.projectNummer.localeCompare(a.projectNummer, "nl");
      if (pn !== 0) return pn;
      if (a.soort !== b.soort) return a.soort === "offerte" ? -1 : 1;
      return a.naam.localeCompare(b.naam, "nl");
    });

    return NextResponse.json({ documenten });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Documenten laden mislukt") },
      { status: 500 }
    );
  }
}
