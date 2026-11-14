import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  betalingVoorProjecten,
  isMissingWfProjectColumn,
  doorgestuurdAtVoorProjecten,
  isWarmtefondsPortalProject,
  isWarmtefondsRelatedProject,
  resolveWarmtefondsOperator,
  WF_PORTAL_PROJECT_SELECT,
  WF_PORTAL_PROJECT_SELECT_MIN,
  withPortalBedragen,
} from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

/** GET /api/warmtefonds/[token] — operator + Warmtefonds-aanvragen */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const primary = await sb
      .from("projecten")
      .select(WF_PORTAL_PROJECT_SELECT)
      .or("betaalwijze.eq.warmtefonds,financiering_status.not.is.null")
      .order("warmtefonds_afspraak_at", {
        ascending: true,
        nullsFirst: false,
      });

    let rows: unknown[] | null = primary.data;
    let error = primary.error;

    if (error && isMissingWfProjectColumn(error)) {
      const fallback = await sb
        .from("projecten")
        .select(WF_PORTAL_PROJECT_SELECT_MIN)
        .neq("status", "annulering")
        .or("betaalwijze.eq.warmtefonds,financiering_status.not.is.null")
        .order("warmtefonds_afspraak_at", {
          ascending: true,
          nullsFirst: false,
        });
      if (fallback.error && isMissingWfProjectColumn(fallback.error)) {
        const bare = await sb
          .from("projecten")
          .select(
            `
            id, project_nummer, titel, status, betaalwijze, lead_id, offerte_id,
            notities, created_at, updated_at,
            leads(
              id, naam, email, telefoon, lead_number,
              postcode, huisnummer, toevoeging, straat, plaats, notities
            ),
            offertes(id, offerte_nummer, status, ondertekend_op, financiering_voorbehoud)
          `
          )
          .neq("status", "annulering")
          .eq("betaalwijze", "warmtefonds")
          .order("created_at", { ascending: false });
        if (bare.error) throw bare.error;
        rows = bare.data;
        error = null;
      } else if (fallback.error) {
        throw fallback.error;
      } else {
        rows = fallback.data;
        error = null;
      }
    }

    if (error) throw error;

    type PortalListRow = Parameters<typeof isWarmtefondsPortalProject>[0] & {
      id: string;
      lead_id?: string | null;
      offertes?: unknown;
    };
    const related = ((rows || []) as PortalListRow[])
      .filter(isWarmtefondsRelatedProject)
      .map((row) => withPortalBedragen(row));
    const orders = related.filter(isWarmtefondsPortalProject);
    const archief = related.filter((row) => !isWarmtefondsPortalProject(row));

    const allForEnrich = [...orders, ...archief];
    const doorgestuurd = await doorgestuurdAtVoorProjecten(sb, allForEnrich);
    const betaling = await betalingVoorProjecten(
      sb,
      allForEnrich.map((row) => row.id)
    );
    function enrichRow(row: (typeof allForEnrich)[number]) {
      const enrich = betaling.get(row.id);
      return {
        ...row,
        doorgestuurd_at: doorgestuurd.get(row.id) ?? null,
        betaling: enrich?.betaling ?? {
          key: "geen" as const,
          label: "Nog geen factuur",
        },
        aanbetaling_factuur_status: enrich?.aanbetalingFactuurStatus ?? null,
        declaratie_factuur_status: enrich?.declaratieFactuurStatus ?? null,
      };
    }
    const metDoorgestuurd = orders.map(enrichRow);
    const archiefEnrich = archief.map(enrichRow);

    return NextResponse.json({
      operator: {
        id: operator.id,
        naam: operator.naam,
        email: operator.email,
      },
      orders: metDoorgestuurd,
      archief: archiefEnrich,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
