import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import { normalizeProjectStatus } from "@/lib/labels";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import { isSchouwFormulierBewijs } from "@/lib/project-documenten";
import {
  boardStatusOf,
  buildNettoFases,
  isNettoGeannuleerd,
  resolveNettoCommissie,
  resolveNettoVorm,
  summarizeFases,
  type NettoBoardRow,
} from "@/lib/netto-boord";
import { isSchouwdagDefinitief } from "@/lib/schouw-week";

export const runtime = "nodejs";

async function requireSession() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  const rol = normalizeRol(session.rol);
  if (rol !== "admin" && rol !== "adviseur") {
    return {
      error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }),
    };
  }
  return { session, rol };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type LeadJoin = {
  id: string;
  naam: string;
  plaats: string | null;
  adviseur_id: string | null;
  status: string | null;
  adviseurs?:
    | { id: string; naam: string }
    | { id: string; naam: string }[]
    | null;
};

type Fac = {
  id: string;
  lead_id: string;
  offerte_id: string | null;
  project_id: string | null;
  status: string;
  omschrijving: string | null;
  factuurdatum: string | null;
  betaald_op: string | null;
  bedrag_inc_btw: number | null;
};

type ProjectRow = {
  id: string;
  offerte_id: string | null;
  lead_id: string | null;
  project_nummer: string | null;
  status: string;
  betaalwijze: string | null;
  schouw_at: string | null;
  schouw_jaar: number | null;
  schouw_week: number | null;
  installatie_at: string | null;
  warmtefonds_aangevraagd_at?: string | null;
  warmtefonds_afspraak_at?: string | null;
  btw_terugvragen_aangevraagd_at?: string | null;
  overstap_dynamische_leverancier_at?: string | null;
  review_gevraagd_at?: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const PROJECT_SELECT_FULL =
  "id, offerte_id, lead_id, project_nummer, status, betaalwijze, schouw_at, schouw_jaar, schouw_week, installatie_at, warmtefonds_aangevraagd_at, warmtefonds_afspraak_at, btw_terugvragen_aangevraagd_at, overstap_dynamische_leverancier_at, review_gevraagd_at, created_at, updated_at";

/** Zonder optionele migratie-kolommen — altijd beschikbaar voor Planbord-data. */
const PROJECT_SELECT_CORE =
  "id, offerte_id, lead_id, project_nummer, status, betaalwijze, schouw_at, schouw_jaar, schouw_week, installatie_at, created_at, updated_at";

const WF_STATUSES = new Set([
  "warmtefonds_afspraak_ingepland",
  "warmtefonds_aangevraagd",
  "warmtefonds_in_behandeling",
  "warmtefonds_goedgekeurd",
  "warmtefonds_afgewezen",
]);

/**
 * GET /api/netto-boord
 * ?adviseur_id=…&status=alles|netto|actief|geannuleerd&vorm=EM|WF&q=
 */
export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  let adviseurFilter = sp.get("adviseur_id")?.trim() || "";
  const statusFilter = sp.get("status")?.trim() || "alles";
  const vormFilter = sp.get("vorm")?.trim().toUpperCase() || "";
  const q = sp.get("q")?.trim().toLowerCase() || "";

  // Adviseurs zien alleen eigen deals
  if (auth.rol === "adviseur") {
    adviseurFilter = auth.session.adviseurId;
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: offertes, error: offErr } = await sb
      .from("offertes")
      .select(
        "id, offerte_nummer, lead_id, status, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud, ondertekend_op, created_at, updated_at, leads(id, naam, plaats, adviseur_id, status, adviseurs!adviseur_id(id, naam))"
      )
      .in("status", ["ondertekend", "afgewezen"])
      .order("ondertekend_op", { ascending: false, nullsFirst: false })
      .limit(800);

    if (offErr) {
      return NextResponse.json(
        { error: "Offertes laden mislukt", detail: offErr.message },
        { status: 500 }
      );
    }

    const offerteIds = (offertes || []).map((o) => o.id as string);
    const leadIds = [
      ...new Set(
        (offertes || [])
          .map((o) => o.lead_id as string | null)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    let [
      { data: projecten, error: projErr },
      { data: facturen },
      { data: creditRegels },
      { data: wfEvents },
    ] = await Promise.all([
      offerteIds.length
        ? sb
            .from("projecten")
            .select(PROJECT_SELECT_FULL)
            .in("offerte_id", offerteIds)
        : Promise.resolve({ data: [] as ProjectRow[], error: null }),
      leadIds.length
        ? sb
            .from("facturen")
            .select(
              "id, lead_id, offerte_id, project_id, status, omschrijving, factuurdatum, betaald_op, bedrag_inc_btw, created_at"
            )
            .in("lead_id", leadIds)
        : Promise.resolve({ data: [] as Fac[] }),
      sb
        .from("adviseur_creditfactuur_regels")
        .select("factuur_id, creditfactuur_id")
        .limit(8000),
      leadIds.length
        ? sb
            .from("lead_events")
            .select("lead_id, meta")
            .in("lead_id", leadIds)
            .eq("soort", "status")
            .limit(8000)
        : Promise.resolve({ data: [] as { lead_id: string; meta: unknown }[] }),
    ]);

    // Ontbrekende migratie-kolommen mogen Planbord-data (schouw/installatie) niet blokkeren.
    if (projErr?.code === "42703" || projErr?.message?.includes("column")) {
      const retry = offerteIds.length
        ? await sb
            .from("projecten")
            .select(PROJECT_SELECT_CORE)
            .in("offerte_id", offerteIds)
        : { data: [] as ProjectRow[], error: null };
      if (!retry.error) {
        projecten = retry.data;
        projErr = null;
      }
    }

    if (projErr) {
      return NextResponse.json(
        { error: "Projecten laden mislukt", detail: projErr.message },
        { status: 500 }
      );
    }

    const projectIds = (projecten || []).map((p) => (p as ProjectRow).id);
    const { data: schouwFotos } = projectIds.length
      ? await sb
          .from("project_fotos")
          .select("project_id, omschrijving, bestandsnaam, storage_path, created_at")
          .in("project_id", projectIds)
      : { data: [] as { project_id: string; omschrijving: string | null; created_at: string }[] };

    const projectByOfferte = new Map<string, ProjectRow>();
    const projectByLead = new Map<string, ProjectRow>();
    for (const p of (projecten || []) as ProjectRow[]) {
      if (p.offerte_id) projectByOfferte.set(p.offerte_id, p);
      if (p.lead_id && !projectByLead.has(p.lead_id)) {
        projectByLead.set(p.lead_id, p);
      }
    }

    const wfHistoryByLead = new Map<string, Set<string>>();
    for (const ev of wfEvents || []) {
      const row = ev as { lead_id: string; meta: { naar?: string } | null };
      const naar = row.meta?.naar;
      if (!naar || !WF_STATUSES.has(naar)) continue;
      const set = wfHistoryByLead.get(row.lead_id) || new Set<string>();
      set.add(naar);
      wfHistoryByLead.set(row.lead_id, set);
    }

    const schouwFormByProject = new Map<
      string,
      { geupload: boolean; at: string | null }
    >();
    for (const f of schouwFotos || []) {
      const row = f as {
        project_id: string;
        omschrijving: string | null;
        bestandsnaam?: string | null;
        storage_path?: string | null;
        created_at: string;
      };
      if (
        !isSchouwFormulierBewijs(
          row.omschrijving,
          row.bestandsnaam,
          row.storage_path
        )
      )
        continue;
      const prev = schouwFormByProject.get(row.project_id);
      if (!prev || row.created_at < (prev.at || "")) {
        schouwFormByProject.set(row.project_id, {
          geupload: true,
          at: row.created_at,
        });
      }
    }

    const creditByFactuur = new Map<string, string>();
    for (const r of creditRegels || []) {
      const row = r as { factuur_id: string; creditfactuur_id: string };
      if (row.factuur_id) {
        creditByFactuur.set(row.factuur_id, row.creditfactuur_id);
      }
    }

    const creditIds = [...new Set([...creditByFactuur.values()])];
    const creditNummerById = new Map<string, string>();
    if (creditIds.length) {
      const { data: cfs } = await sb
        .from("adviseur_creditfacturen")
        .select("id, factuur_nummer")
        .in("id", creditIds);
      for (const cf of cfs || []) {
        const row = cf as { id: string; factuur_nummer: string };
        creditNummerById.set(row.id, row.factuur_nummer);
      }
    }

    const facByLead = new Map<string, Fac[]>();
    for (const f of (facturen || []) as Fac[]) {
      const list = facByLead.get(f.lead_id) || [];
      list.push(f);
      facByLead.set(f.lead_id, list);
    }

    const adviseursMap = new Map<string, string>();
    const rows: NettoBoardRow[] = [];

    for (const o of offertes || []) {
      const leadRaw = o.leads as LeadJoin | LeadJoin[] | null;
      const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
      if (!lead) continue;

      const advRaw = lead.adviseurs;
      const adv = Array.isArray(advRaw) ? advRaw[0] : advRaw;
      const adviseurId = lead.adviseur_id || adv?.id || null;
      const adviseurNaam = adv?.naam || null;
      if (adviseurId && adviseurNaam) {
        adviseursMap.set(adviseurId, adviseurNaam);
      }

      const project =
        projectByOfferte.get(o.id as string) ||
        projectByLead.get(lead.id) ||
        undefined;
      const geannuleerd = isNettoGeannuleerd({
        projectStatus: project?.status,
        offerteStatus: o.status as string,
      });

      const vorm = resolveNettoVorm({
        betaalwijze: project?.betaalwijze,
        financieringVoorbehoud: o.financiering_voorbehoud as boolean | null,
        leadStatus: lead.status,
      });

      const facs = facByLead.get(lead.id) || [];
      const related = facs.filter(
        (f) =>
          f.offerte_id === o.id ||
          f.project_id === project?.id ||
          (!f.offerte_id && !f.project_id)
      );

      const aanbetalingen = related.filter((f) =>
        isAanbetalingFactuurOmschrijving(f.omschrijving)
      );
      const restFacturen = related.filter(
        (f) => !isAanbetalingFactuurOmschrijving(f.omschrijving)
      );

      const aanbetalingBetaald = aanbetalingen.find(
        (f) => f.status === "betaald"
      );
      const aanbetalingVerstuurd = aanbetalingen.some(
        (f) => f.status === "verzonden" || f.status === "betaald"
      );
      const restBetaald = restFacturen.find((f) => f.status === "betaald");
      const restVerstuurd = restFacturen.find(
        (f) => f.status === "verzonden" || f.status === "betaald"
      );

      const schouwForm = project?.id
        ? schouwFormByProject.get(project.id)
        : null;

      const fases = buildNettoFases({
        projectStatus: project?.status || null,
        vorm,
        geannuleerd,
        aanbetalingVerstuurd,
        aanbetalingVerstuurdOp:
          aanbetalingen.find((f) => f.factuurdatum)?.factuurdatum || null,
        aanbetalingBetaald: Boolean(aanbetalingBetaald),
        aanbetalingBetaaldOp: aanbetalingBetaald?.betaald_op || null,
        restVerstuurd: Boolean(restVerstuurd),
        restBetaald: Boolean(restBetaald),
        restBetaaldOp: restBetaald?.betaald_op || null,
        restVerstuurdOp: restVerstuurd?.factuurdatum || null,
        schouwAt: project?.schouw_at || null,
        schouwJaar: project?.schouw_jaar || null,
        schouwWeek: project?.schouw_week || null,
        installatieAt: project?.installatie_at || null,
        warmtefondsAfgewezen:
          normalizeProjectStatus(project?.status) === "warmtefonds_afgewezen",
        warmtefondsAangevraagdOp: project?.warmtefonds_aangevraagd_at || null,
        warmtefondsHistory: wfHistoryByLead.get(lead.id),
        schouwFormulierGeupload: Boolean(schouwForm?.geupload),
        schouwFormulierAt: schouwForm?.at || null,
        btwTerugvragenAt: project?.btw_terugvragen_aangevraagd_at || null,
        overstapDynamischeLeverancierAt:
          project?.overstap_dynamische_leverancier_at || null,
        reviewGevraagdAt: project?.review_gevraagd_at || null,
      });

      const progress = summarizeFases(fases);
      const board_status = boardStatusOf({ geannuleerd, fases });
      const bedragEx = Number(o.subtotaal_ex_btw || 0);
      const bedragInc = Number(o.totaal_inc_btw || 0);
      const projStatus = project
        ? normalizeProjectStatus(project.status)
        : null;
      const installatieVoltooid =
        projStatus === "installatie_voltooid" ||
        projStatus === "review_gevraagd" ||
        projStatus === "service";
      const commissie = resolveNettoCommissie({
        omzetExBtw: bedragEx,
        geannuleerd,
        aanbetalingBetaald: Boolean(aanbetalingBetaald),
        restOfInstallatieDone:
          Boolean(restBetaald) ||
          installatieVoltooid ||
          projStatus === "restfactuur_betaald",
      });

      const creditId = aanbetalingBetaald
        ? creditByFactuur.get(aanbetalingBetaald.id) || null
        : null;

      const statusSinds = geannuleerd
        ? project?.updated_at || (o.updated_at as string | null)
        : board_status === "netto"
          ? project?.updated_at || (o.ondertekend_op as string | null)
          : (o.ondertekend_op as string | null) ||
            (o.created_at as string | null);

      rows.push({
        id: o.id as string,
        offerte_id: o.id as string,
        project_id: project?.id || null,
        lead_id: lead.id,
        klant_naam: lead.naam || "Onbekend",
        plaats: lead.plaats || null,
        vorm,
        bedrag_ex_btw: bedragEx,
        bedrag_inc_btw: bedragInc,
        adviseur_id: adviseurId,
        adviseur_naam: adviseurNaam,
        board_status,
        status_sinds: statusSinds || null,
        schouw_at:
          project &&
          isSchouwdagDefinitief({
            schouw_at: project.schouw_at,
            schouw_jaar: project.schouw_jaar,
            schouw_week: project.schouw_week,
          })
            ? project.schouw_at
            : null,
        schouw_jaar: project?.schouw_jaar ?? null,
        schouw_week: project?.schouw_week ?? null,
        installatie_at: project?.installatie_at || null,
        factuur_verstuurd_at:
          restVerstuurd?.factuurdatum ||
          aanbetalingen.find((f) => f.factuurdatum)?.factuurdatum ||
          null,
        factuur_betaald_at:
          restBetaald?.betaald_op || aanbetalingBetaald?.betaald_op || null,
        aanbetaling_betaald: Boolean(aanbetalingBetaald),
        aanbetaling_factuur_id: aanbetalingBetaald?.id || null,
        creditfactuur_id: creditId,
        creditfactuur_nummer: creditId
          ? creditNummerById.get(creditId) || null
          : null,
        commissie_verwacht: commissie.verwacht,
        commissie_tranche_a: commissie.tranche_a,
        commissie_tranche_b: commissie.tranche_b,
        commissie_tranche_a_triggered: commissie.tranche_a_triggered,
        commissie_tranche_b_triggered: commissie.tranche_b_triggered,
        commissie_verdiend: commissie.verdiend,
        fases,
        progress_done: progress.done,
        progress_total: progress.total,
        progress_pct: progress.pct,
        offerte_nummer: (o.offerte_nummer as string | null) || null,
        project_nummer: project?.project_nummer || null,
        project_status: projStatus,
        ondertekend_op: (o.ondertekend_op as string | null) || null,
        geannuleerd,
      });
    }

    let scoped = rows;

    if (adviseurFilter) {
      scoped = scoped.filter((r) => r.adviseur_id === adviseurFilter);
    }
    if (vormFilter === "EM" || vormFilter === "WF") {
      scoped = scoped.filter((r) => r.vorm === vormFilter);
    }
    if (q) {
      scoped = scoped.filter((r) =>
        [
          r.klant_naam,
          r.plaats,
          r.offerte_nummer,
          r.project_nummer,
          r.adviseur_naam,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }

    const annuleringenCount = scoped.filter((r) => r.geannuleerd).length;

    // Standaard ("alles"): annuleringen eruit — die horen niet in het Netto-overzicht.
    // Filter "geannuleerd" = alleen annuleringen (label: Annulering door klant).
    let filtered = scoped;
    if (statusFilter === "netto") {
      filtered = scoped.filter((r) => r.board_status === "netto");
    } else if (statusFilter === "actief") {
      filtered = scoped.filter((r) => r.board_status === "actief");
    } else if (statusFilter === "geannuleerd") {
      filtered = scoped.filter((r) => r.board_status === "geannuleerd");
    } else {
      // alles → actief + netto, géén annulering
      filtered = scoped.filter((r) => r.board_status !== "geannuleerd");
    }

    const actiefRows = filtered.filter((r) => !r.geannuleerd);
    const totals = {
      aantal: actiefRows.length,
      omzet_ex_btw: round2(actiefRows.reduce((s, r) => s + r.bedrag_ex_btw, 0)),
      commissie_verwacht: round2(
        actiefRows.reduce((s, r) => s + r.commissie_verwacht, 0)
      ),
      commissie_verdiend: round2(
        actiefRows.reduce((s, r) => s + r.commissie_verdiend, 0)
      ),
      geannuleerd: annuleringenCount,
      netto: scoped.filter((r) => r.board_status === "netto").length,
      actief: scoped.filter((r) => r.board_status === "actief").length,
    };

    const adviseurs = [...adviseursMap.entries()]
      .map(([id, naam]) => ({ id, naam }))
      .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));

    return NextResponse.json({
      items: filtered,
      totals,
      adviseurs,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Laden mislukt", detail: errMessage(e) },
      { status: 500 }
    );
  }
}
