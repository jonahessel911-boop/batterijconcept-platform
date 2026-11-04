import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { logLeadEvent } from "@/lib/lead-events";
import {
  isFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";
import {
  isMissingWfProjectColumn,
  isWarmtefondsPortalProject,
  resolveWarmtefondsOperator,
  WF_PORTAL_PROJECT_SELECT,
  WF_PORTAL_PROJECT_SELECT_MIN,
  wfPortalStatusLabel,
  withPortalBedragen,
} from "@/lib/warmtefonds-portal";

export const runtime = "nodejs";

async function loadOrder(sb: ReturnType<typeof getSupabaseAdmin>, projectId: string) {
  let { data: order, error } = await sb
    .from("projecten")
    .select(WF_PORTAL_PROJECT_SELECT)
    .eq("id", projectId)
    .maybeSingle();

  if (error && isMissingWfProjectColumn(error)) {
    ({ data: order, error } = await sb
      .from("projecten")
      .select(WF_PORTAL_PROJECT_SELECT_MIN)
      .eq("id", projectId)
      .maybeSingle());
  }

  if (error && isMissingWfProjectColumn(error)) {
    ({ data: order, error } = await sb
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
      .eq("id", projectId)
      .maybeSingle());
  }

  if (error) throw error;
  if (!order || !isWarmtefondsPortalProject(order)) return null;
  return order;
}

/** GET /api/warmtefonds/[token]/orders/[projectId] */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const order = await loadOrder(sb, projectId);
    if (!order) {
      return NextResponse.json(
        { error: "Aanvraag niet gevonden" },
        { status: 404 }
      );
    }

    const leadId = (order as { lead_id?: string }).lead_id;
    let events: Array<{
      id: string;
      soort: string;
      titel: string;
      detail: string | null;
      created_at: string;
    }> = [];
    if (leadId) {
      const { data: ev } = await sb
        .from("lead_events")
        .select("id, soort, titel, detail, created_at")
        .eq("lead_id", leadId)
        .in("soort", ["notitie", "status", "afspraak"])
        .order("created_at", { ascending: false })
        .limit(40);
      events = (ev || []) as typeof events;
    }

    return NextResponse.json({
      operator: { id: operator.id, naam: operator.naam },
      order: withPortalBedragen(order),
      events,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH /api/warmtefonds/[token]/orders/[projectId] */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ token: string; projectId: string }> }
) {
  const { token, projectId } = await ctx.params;
  let body: {
    financiering_status?: FinancieringStatus | null;
    warmtefonds_afspraak_at?: string | null;
    warmtefonds_notities?: string | null;
    notitie?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const before = await loadOrder(sb, projectId);
    if (!before) {
      return NextResponse.json(
        { error: "Aanvraag niet gevonden" },
        { status: 404 }
      );
    }

    const patch: Record<string, unknown> = {};

    if (body.financiering_status !== undefined) {
      if (body.financiering_status === null) {
        patch.financiering_status = null;
      } else if (!isFinancieringStatus(body.financiering_status)) {
        return NextResponse.json(
          { error: "Ongeldige financieringsstatus" },
          { status: 400 }
        );
      } else {
        patch.financiering_status = body.financiering_status;
        if (
          (body.financiering_status === "aanvraag_gedaan" ||
            body.financiering_status === "in_behandeling" ||
            body.financiering_status === "documenten_aanleveren") &&
          !(before as { warmtefonds_aangevraagd_at?: string | null })
            .warmtefonds_aangevraagd_at
        ) {
          patch.warmtefonds_aangevraagd_at = new Date().toISOString();
        }
      }
    }

    if (body.warmtefonds_afspraak_at !== undefined) {
      if (body.warmtefonds_afspraak_at === null) {
        patch.warmtefonds_afspraak_at = null;
      } else {
        const d = new Date(body.warmtefonds_afspraak_at);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: "Ongeldige afspraakdatum" },
            { status: 400 }
          );
        }
        patch.warmtefonds_afspraak_at = d.toISOString();
        // Afspraak is geen pipeline-stap. Alleen als er nog geen status
        // staat, markeer dat de aanvraag bij de operator ligt.
        if (
          body.financiering_status === undefined &&
          !(before as { financiering_status?: string | null }).financiering_status
        ) {
          patch.financiering_status = "doorgestuurd_naar_edwin";
        }
      }
    }

    if (body.warmtefonds_notities !== undefined) {
      patch.warmtefonds_notities =
        body.warmtefonds_notities?.trim() || null;
    }

    if (Object.keys(patch).length > 0) {
      const { error: updErr } = await sb
        .from("projecten")
        .update(patch)
        .eq("id", projectId);
      if (updErr) {
        if (isMissingWfProjectColumn(updErr)) {
          const slim = { ...patch };
          if (updErr.message?.includes("warmtefonds_notities")) {
            delete slim.warmtefonds_notities;
          }
          if (updErr.message?.includes("warmtefonds_aangevraagd_at")) {
            delete slim.warmtefonds_aangevraagd_at;
          }
          if (updErr.message?.includes("warmtefonds_afspraak_at")) {
            delete slim.warmtefonds_afspraak_at;
          }
          if (Object.keys(slim).length === 0) {
            /* optionele kolom — update overslaan */
          } else if (Object.keys(slim).length < Object.keys(patch).length) {
            const { error: retryErr } = await sb
              .from("projecten")
              .update(slim)
              .eq("id", projectId);
            if (retryErr) {
              if (isMissingWfProjectColumn(retryErr)) {
                const slimmer = { ...slim };
                delete slimmer.warmtefonds_notities;
                delete slimmer.warmtefonds_aangevraagd_at;
                if (Object.keys(slimmer).length === 0) {
                  /* ok */
                } else {
                  const { error: third } = await sb
                    .from("projecten")
                    .update(slimmer)
                    .eq("id", projectId);
                  if (third) throw third;
                }
              } else {
                throw retryErr;
              }
            }
          } else {
            throw updErr;
          }
        } else {
          throw updErr;
        }
      }
    }

    const leadId = (before as { lead_id?: string }).lead_id;
    const projectNummer = (before as { project_nummer?: string }).project_nummer;

    const statusNaar =
      "financiering_status" in patch
        ? (patch.financiering_status as string | null)
        : undefined;
    if (
      leadId &&
      statusNaar !== undefined &&
      statusNaar !==
        (before as { financiering_status?: string | null }).financiering_status
    ) {
      await logLeadEvent({
        leadId,
        soort: "status",
        titel: `Warmtefonds: ${wfPortalStatusLabel(statusNaar)}`,
        detail: projectNummer
          ? `Project ${projectNummer} · via Warmtefonds-portaal (${operator.naam})`
          : `Via Warmtefonds-portaal (${operator.naam})`,
        meta: {
          project_id: projectId,
          veld: "financiering_status",
          van: (before as { financiering_status?: string | null })
            .financiering_status,
          naar: statusNaar,
          bron: "warmtefonds_portaal",
          operator_id: operator.id,
        },
      });
    }

    if (leadId && body.warmtefonds_afspraak_at) {
      await logLeadEvent({
        leadId,
        soort: "afspraak",
        titel: "Warmtefonds-afspraak gezet",
        detail: `Via Warmtefonds-portaal (${operator.naam})`,
        meta: {
          project_id: projectId,
          warmtefonds_afspraak_at: body.warmtefonds_afspraak_at,
          bron: "warmtefonds_portaal",
        },
      });
    }

    const notitieTekst = body.notitie?.trim();
    if (leadId && notitieTekst) {
      await logLeadEvent({
        leadId,
        soort: "notitie",
        titel: `Notitie Warmtefonds (${operator.naam})`,
        detail: notitieTekst,
        meta: {
          project_id: projectId,
          bron: "warmtefonds_portaal",
          operator_id: operator.id,
        },
      });
    }

    // Sync auto-taken bij statuswijziging (ook als de afspraak de eerste status zet)
    if ("financiering_status" in patch) {
      try {
        const { syncAutoTakenVoorProject } = await import(
          "@/lib/sync-auto-taken"
        );
        await syncAutoTakenVoorProject(
          sb,
          projectId,
          (before as { status?: string }).status || "schouwweek_inplannen"
        );
      } catch {
        /* best-effort */
      }
      if (
        statusNaar &&
        statusNaar !==
          (before as { financiering_status?: string | null }).financiering_status
      ) {
        try {
          const { verstuurWarmtefondsStapFlows } = await import(
            "@/lib/warmtefonds-automatisering"
          );
          const vanStatus =
            (before as { financiering_status?: string | null })
              .financiering_status ?? null;
          await verstuurWarmtefondsStapFlows({
            projectId,
            van: vanStatus,
            naar: statusNaar,
          });
          const { zorgEdergyFactuurBijStap } = await import(
            "@/lib/edergy-factuur"
          );
          await zorgEdergyFactuurBijStap({
            projectId,
            van: vanStatus,
            naar: statusNaar,
          });
        } catch {
          /* mail mag de stap niet blokkeren */
        }
      }
    }

    let bevestiging: "verzonden" | "geen_email" | "mislukt" | null = null;
    const nieuwAt = patch.warmtefonds_afspraak_at;
    const oudAt = (before as { warmtefonds_afspraak_at?: string | null })
      .warmtefonds_afspraak_at;
    if (typeof nieuwAt === "string" && nieuwAt) {
      const veranderd =
        !oudAt || new Date(nieuwAt).getTime() !== new Date(oudAt).getTime();
      if (veranderd) {
        try {
          const { verstuurWfAfspraakBevestiging } = await import(
            "@/lib/warmtefonds-automatisering"
          );
          bevestiging = await verstuurWfAfspraakBevestiging(projectId);
        } catch {
          bevestiging = "mislukt";
        }
      }
    }

    const order = await loadOrder(sb, projectId);
    return NextResponse.json({
      order: order ? withPortalBedragen(order) : null,
      bevestiging,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
