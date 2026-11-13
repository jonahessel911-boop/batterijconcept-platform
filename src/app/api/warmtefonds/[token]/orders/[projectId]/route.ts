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
  isWarmtefondsRelatedProject,
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
  if (!order || !isWarmtefondsRelatedProject(order)) return null;
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
      meta?: Record<string, unknown> | null;
    }> = [];
    if (leadId) {
      const { data: ev } = await sb
        .from("lead_events")
        .select("id, soort, titel, detail, created_at, meta")
        .eq("lead_id", leadId)
        .in("soort", [
          "notitie",
          "status",
          "afspraak",
          "financiering",
          "mail",
          "contact",
          "bel",
        ])
        .order("created_at", { ascending: false })
        .limit(80);
      events = (ev || []) as typeof events;
    }

    type FactuurRow = {
      id: string;
      factuur_nummer?: string | null;
      status?: string | null;
      omschrijving?: string | null;
      bedrag_inc_btw?: number | null;
      credit_van_factuur_id?: string | null;
      created_at?: string | null;
    };

    const { isRestantFactuurOmschrijving } = await import("@/lib/aanbetaling");

    function factuurStatusLabel(status: string | null | undefined): string {
      if (status === "betaald") return "Betaald";
      if (status === "deels_betaald" || status === "verzonden") return "Onbetaald";
      if (status === "vervallen") return "Vervallen";
      if (status === "concept") return "Concept";
      return status || "Onbekend";
    }

    let facturen: Array<{
      id: string;
      nummer: string;
      status: string;
      statusLabel: string;
      bedragInc: number | null;
      omschrijving: string | null;
      isCredit: boolean;
      isRestant: boolean;
      pdf: string;
    }> = [];

    const facRes = await sb
      .from("facturen")
      .select(
        "id, factuur_nummer, status, omschrijving, bedrag_inc_btw, credit_van_factuur_id, created_at"
      )
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    let facRows = (facRes.data || []) as FactuurRow[];
    if (facRes.error) {
      if (facRes.error.message?.includes("credit_van_factuur_id")) {
        const plain = await sb
          .from("facturen")
          .select(
            "id, factuur_nummer, status, omschrijving, bedrag_inc_btw, created_at"
          )
          .eq("project_id", projectId)
          .order("created_at", { ascending: true });
        if (plain.error) throw plain.error;
        facRows = (plain.data || []) as FactuurRow[];
      } else if (facRes.error.message?.includes("bedrag_inc_btw")) {
        const plain = await sb
          .from("facturen")
          .select(
            "id, factuur_nummer, status, omschrijving, credit_van_factuur_id, created_at"
          )
          .eq("project_id", projectId)
          .order("created_at", { ascending: true });
        if (plain.error) throw plain.error;
        facRows = (plain.data || []) as FactuurRow[];
      } else {
        throw facRes.error;
      }
    }

    facturen = facRows.map((f) => ({
      id: f.id,
      nummer: f.factuur_nummer || "—",
      status: f.status || "concept",
      statusLabel: factuurStatusLabel(f.status),
      bedragInc:
        f.bedrag_inc_btw != null && Number.isFinite(Number(f.bedrag_inc_btw))
          ? Number(f.bedrag_inc_btw)
          : null,
      omschrijving: f.omschrijving?.trim() || null,
      isCredit: Boolean(f.credit_van_factuur_id),
      isRestant: isRestantFactuurOmschrijving(f.omschrijving),
      pdf: `/api/warmtefonds/${token}/facturen/${f.id}/pdf`,
    }));

    // Als dossier al op aanbod staat maar nog geen restant-concept: alsnog klaarzetten
    const fs = (order as { financiering_status?: string | null })
      .financiering_status;
    const heeftRestant = facturen.some((f) => f.isRestant);
    if (
      (fs === "aanbod_ondertekenen" || fs === "aanvraag_goedgekeurd") &&
      !heeftRestant
    ) {
      try {
        const offRaw = (order as { offertes?: unknown }).offertes;
        const off = Array.isArray(offRaw) ? offRaw[0] : offRaw;
        const offerte = off as {
          id?: string;
          offerte_nummer?: string | null;
          financiering_voorbehoud?: boolean | null;
          totaal_inc_btw?: number | null;
          subtotaal_ex_btw?: number | null;
        } | null;
        const leadIdForFactuur = (order as { lead_id?: string }).lead_id;
        if (
          offerte?.id &&
          offerte.financiering_voorbehoud &&
          leadIdForFactuur
        ) {
          const { ensureRestantDraftFactuur } = await import(
            "@/lib/ensure-btw-factuur"
          );
          await ensureRestantDraftFactuur(sb, {
            offerteId: offerte.id,
            leadId: leadIdForFactuur,
            projectId,
            offerteNummer:
              offerte.offerte_nummer ||
              (order as { project_nummer?: string }).project_nummer ||
              "",
            orderIncBtw: Number(offerte.totaal_inc_btw) || 0,
            orderExBtw: Number(offerte.subtotaal_ex_btw) || 0,
            warmtefonds: true,
          });

          const again = await sb
            .from("facturen")
            .select(
              "id, factuur_nummer, status, omschrijving, bedrag_inc_btw, credit_van_factuur_id, created_at"
            )
            .eq("project_id", projectId)
            .order("created_at", { ascending: true });
          if (!again.error && again.data) {
            facRows = again.data as FactuurRow[];
            facturen = facRows.map((f) => ({
              id: f.id,
              nummer: f.factuur_nummer || "—",
              status: f.status || "concept",
              statusLabel: factuurStatusLabel(f.status),
              bedragInc:
                f.bedrag_inc_btw != null &&
                Number.isFinite(Number(f.bedrag_inc_btw))
                  ? Number(f.bedrag_inc_btw)
                  : null,
              omschrijving: f.omschrijving?.trim() || null,
              isCredit: Boolean(f.credit_van_factuur_id),
              isRestant: isRestantFactuurOmschrijving(f.omschrijving),
              pdf: `/api/warmtefonds/${token}/facturen/${f.id}/pdf`,
            }));
          }
        }
      } catch (e) {
        console.error(
          "ensureRestantDraftFactuur (warmtefonds portaal GET):",
          e
        );
      }
    }

    return NextResponse.json({
      operator: { id: operator.id, naam: operator.naam },
      order: withPortalBedragen(order),
      events,
      facturen,
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
    /** Contact-knop: +1 poging + status contact_verstuurd */
    contact_poging?: boolean;
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

    if (body.contact_poging === true) {
      const prev = Number(
        (before as { warmtefonds_contact_pogingen?: number | null })
          .warmtefonds_contact_pogingen || 0
      );
      const nextCount = (Number.isFinite(prev) ? prev : 0) + 1;
      patch.warmtefonds_contact_pogingen = nextCount;
      // Alleen naar contact_verstuurd als nog vroeg in de pipeline
      const curFs = (before as { financiering_status?: string | null })
        .financiering_status;
      const early =
        !curFs ||
        curFs === "doorgestuurd_naar_edwin" ||
        curFs === "documenten_aanleveren" ||
        curFs === "contact_verstuurd" ||
        curFs === "afspraak_ingepland";
      if (early && body.financiering_status === undefined) {
        patch.financiering_status = "contact_verstuurd";
      }
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
          if (updErr.message?.includes("warmtefonds_contact_pogingen")) {
            delete slim.warmtefonds_contact_pogingen;
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

    let declaratieFactuur: {
      id: string;
      nummer: string;
      bedragInc: number;
      created: boolean;
      pdf: string;
    } | null = null;

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

    if (leadId && body.contact_poging === true) {
      const pogingen = Number(patch.warmtefonds_contact_pogingen) || null;
      await logLeadEvent({
        leadId,
        soort: "contact",
        titel: pogingen
          ? `WF-contactpoging ×${pogingen}`
          : "WF-contactpoging",
        detail: `Via Warmtefonds-portaal (${operator.naam})`,
        meta: {
          project_id: projectId,
          warmtefonds_contact_pogingen: pogingen,
          bron: "warmtefonds_portaal",
          operator_id: operator.id,
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
        const vanStatus =
          (before as { financiering_status?: string | null })
            .financiering_status ?? null;
        try {
          const { verstuurWarmtefondsStapFlows } = await import(
            "@/lib/warmtefonds-automatisering"
          );
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
            operatorTariefInc: operator.tarief_inc ?? null,
          });
        } catch {
          /* mail mag de stap niet blokkeren */
        }

        // Zelfde als BO: bij aanbod_ondertekenen concept-restantfactuur klaarzetten
        if (
          (statusNaar === "aanbod_ondertekenen" ||
            statusNaar === "aanvraag_goedgekeurd") &&
          vanStatus !== "aanbod_ondertekenen" &&
          vanStatus !== "aanvraag_goedgekeurd"
        ) {
          try {
            const offRaw = (before as { offertes?: unknown }).offertes;
            const off = Array.isArray(offRaw) ? offRaw[0] : offRaw;
            const offerte = off as {
              id?: string;
              offerte_nummer?: string | null;
              financiering_voorbehoud?: boolean | null;
              totaal_inc_btw?: number | null;
              subtotaal_ex_btw?: number | null;
            } | null;
            const leadIdForFactuur = (before as { lead_id?: string }).lead_id;
            if (
              offerte?.id &&
              offerte.financiering_voorbehoud &&
              leadIdForFactuur
            ) {
              const { ensureRestantDraftFactuur } = await import(
                "@/lib/ensure-btw-factuur"
              );
              const created = await ensureRestantDraftFactuur(sb, {
                offerteId: offerte.id,
                leadId: leadIdForFactuur,
                projectId,
                offerteNummer:
                  offerte.offerte_nummer ||
                  (before as { project_nummer?: string }).project_nummer ||
                  "",
                orderIncBtw: Number(offerte.totaal_inc_btw) || 0,
                orderExBtw: Number(offerte.subtotaal_ex_btw) || 0,
                warmtefonds: true,
              });
              if (created) {
                declaratieFactuur = {
                  id: created.id,
                  nummer: created.factuur_nummer,
                  bedragInc: created.bedragIncBtw,
                  created: created.created,
                  pdf: `/api/warmtefonds/${token}/facturen/${created.id}/pdf`,
                };
              }
            }
          } catch (e) {
            console.error(
              "ensureRestantDraftFactuur (warmtefonds portaal):",
              e
            );
          }
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
      declaratieFactuur,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
