import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { Betaalwijze, Project, ProjectStatus } from "@/types/database";
import {
  PROJECT_STATUSES,
  resolveProjectStatusLabel,
} from "@/lib/labels";
import {
  FINANCIERING_STATUS_LABEL,
  isFinancieringStatus,
  type FinancieringStatus,
} from "@/lib/financiering-status";
import {
  isSchouwdagDefinitief,
  isValidSchouwWeek,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { maybePromoteToSchouwInplannen } from "@/lib/project-volgende-stap";
import { logLeadEvent, logProjectKlantMail } from "@/lib/lead-events";
import { resolveBetaalwijze } from "@/lib/project-status-config";
import { ensurePartnerInstallatieCreditfactuur } from "@/lib/partner-installatie-creditfactuur";
import {
  ensureAdviseurCommissieTrancheB,
  stripHoldSalesFromOpenSalesCreditfacturen,
} from "@/lib/netto-creditfactuur";
import { fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  isMateriaalLeverdatumColumnError,
  withLeverdatumInChecks,
} from "@/lib/materiaal-leverdatum";
import {
  isInkoopLeverancierColumnError,
  withLeverancierBetalingInChecks,
} from "@/lib/inkoop-leverancier-betaling";
import type { InkoopLeverancierStatus } from "@/lib/project-inkoop-checklist";
import { holdSalesDeadlineAt } from "@/lib/hold-sales";

export const runtime = "nodejs";

const PROJECT_SELECT =
  "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, terugbellen, terugbel_notitie, beller_id, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), installatie_teamgenoot:installatie_partner_teamgenoten!installatie_teamgenoot_id(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op, track_token, track_mail_verstuurd_at, track_last_seen_at, track_view_count)";

const PROJECT_SELECT_NO_TG =
  "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, terugbellen, terugbel_notitie, beller_id, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op, track_token, track_mail_verstuurd_at, track_last_seen_at, track_view_count)";

function isTeamgenootSelectError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error?.message) return false;
  return (
    error.message.includes("installatie_teamgenoot") ||
    error.message.includes("installatie_partner_teamgenoten") ||
    (error.code === "42703" &&
      error.message.includes("installatie_teamgenoot_id"))
  );
}

/** PostgREST/Postgres: welke kolom ontbreekt (42703 / PGRST204). */
function postgresUndefinedColumn(error: {
  message?: string;
  code?: string;
} | null): string | null {
  const msg = error?.message || "";
  if (!msg) return null;
  const m =
    msg.match(/column\s+"([a-z][a-z0-9_]*)"/i) ||
    msg.match(
      /column\s+(?:[\w]+\.)?["']?([a-z][a-z0-9_]*)["']?\s+does not exist/i
    ) ||
    msg.match(/could not find the ['"]([a-z][a-z0-9_]*)['"] column/i);
  return m?.[1] ?? null;
}

function messageHasExactColumn(message: string | undefined, column: string): boolean {
  if (!message) return false;
  return postgresUndefinedColumn({ message }) === column || message.includes(column);
}

/** Kolommen die we mogen weglaten bij retry; de rest van de PATCH blijft staan. */
const OPTIONAL_PATCH_COLUMNS = new Set([
  "financiering_status_at",
  "backoffice_notitie_door",
  "hold_sales_deadline_at",
]);

function migrationHintForProjectColumn(column: string | null): string | null {
  if (!column) return null;
  if (column === "bel_schouw_aanbetaling_at") {
    return "Voer supabase/migrate-bel-schouw-actie.sql uit in Supabase.";
  }
  if (column === "installatie_voltooid_at") {
    return "Voer supabase/migrate-installatie-voltooid-at.sql uit in Supabase.";
  }
  if (column === "financiering_status_at") {
    return "Voer supabase/migrate-financiering-status-at.sql uit in Supabase.";
  }
  if (
    column === "btw_terugvragen_aangevraagd_at" ||
    column === "overstap_dynamische_leverancier_at" ||
    column === "review_gevraagd_at"
  ) {
    return "Voer supabase/migrate-project-afronding.sql uit in Supabase.";
  }
  if (column === "aangetekende_brief_verstuurd_at") {
    return "Voer supabase/migrate-aangetekende-brief.sql uit in Supabase.";
  }
  if (column.startsWith("monteur_beoordeling")) {
    return "Voer supabase/migrate-monteur-beoordeling.sql uit in Supabase.";
  }
  if (column.startsWith("klantvriendelijkheid")) {
    return "Voer supabase/migrate-klantvriendelijkheid.sql uit in Supabase.";
  }
  return `Databasekolom ${column} ontbreekt. Voer de bijbehorende supabase/migrate-*.sql uit.`;
}

/** WF kickoff klaar maar status nog Opstarten → DB repareren vóór response. */
async function applyKickoffStatusRepair(
  sb: ReturnType<typeof getSupabaseAdmin>,
  project: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const { kickoffCompletionPatch } = await import("@/lib/project-kickoff");
    const projectId = String(project.id || "");
    if (!projectId) return project;
    const { data: facRows } = await sb
      .from("facturen")
      .select("status, omschrijving, credit_van_factuur_id")
      .eq("project_id", projectId);
    const patch = kickoffCompletionPatch(
      project as unknown as Project,
      (facRows || []) as import("@/types/database").Factuur[]
    );
    if (!patch) return project;
    const tryUpdate = async (body: Record<string, unknown>) => {
      const full = await sb
        .from("projecten")
        .update(body)
        .eq("id", projectId)
        .select(PROJECT_SELECT)
        .maybeSingle();
      if (!full.error && full.data) return full.data as Record<string, unknown>;
      const soft = await sb
        .from("projecten")
        .update(body)
        .eq("id", projectId)
        .select(PROJECT_SELECT_NO_TG)
        .maybeSingle();
      if (!soft.error && soft.data) return soft.data as Record<string, unknown>;
      return null;
    };

    let updated = await tryUpdate(patch as Record<string, unknown>);
    // Kolom bel_schouw ontbreekt → alleen status zetten
    if (
      !updated &&
      patch.status &&
      patch.bel_schouw_aanbetaling_at
    ) {
      updated = await tryUpdate({ status: patch.status });
    }
    return updated || project;
  } catch {
    return project;
  }
}

/** Opleverformulier aanwezig maar status nog niet doorgeschakeld. */
async function applyOpleveringStatusRepair(
  sb: ReturnType<typeof getSupabaseAdmin>,
  project: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const status = String(project.status || "");
  if (
    status === "annulering" ||
    status === "hold_sales_actie" ||
    status === "after_sale" ||
    status === "afgerond"
  ) {
    return project;
  }
  try {
    const { maybeAdvanceProjectNaOplevering } = await import(
      "@/lib/project-na-oplevering"
    );
    const result = await maybeAdvanceProjectNaOplevering(
      sb,
      String(project.id || ""),
      { sendKlantMail: !project.installatie_voltooid_at }
    );
    if (!result.advanced || !result.to) return project;
    const next = (result.project || {}) as Record<string, unknown>;
    return {
      ...project,
      status: result.to,
      installatie_voltooid_at:
        next.installatie_voltooid_at ?? new Date().toISOString(),
    };
  } catch {
    return project;
  }
}

/** GET /api/projecten/[id] — projectdetail (ook via lead_id als fallback). */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Ontbrekend id" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    let byId = await sb
      .from("projecten")
      .select(PROJECT_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (byId.error && isTeamgenootSelectError(byId.error)) {
      byId = await sb
        .from("projecten")
        .select(PROJECT_SELECT_NO_TG)
        .eq("id", id)
        .maybeSingle();
    }

    if (byId.error) {
      return NextResponse.json(
        { error: "Laden mislukt", detail: byId.error.message },
        { status: 500 }
      );
    }
    if (byId.data) {
      const afterKickoff = await applyKickoffStatusRepair(
        sb,
        byId.data as Record<string, unknown>
      );
      const repaired = await applyOpleveringStatusRepair(sb, afterKickoff);
      return NextResponse.json({ project: repaired });
    }

    // Soms wordt per ongeluk een lead-id gebruikt — stuur door naar het project.
    let byLead = await sb
      .from("projecten")
      .select(PROJECT_SELECT)
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (byLead.error && isTeamgenootSelectError(byLead.error)) {
      byLead = await sb
        .from("projecten")
        .select(PROJECT_SELECT_NO_TG)
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    }

    if (byLead.error) {
      return NextResponse.json(
        { error: "Laden mislukt", detail: byLead.error.message },
        { status: 500 }
      );
    }
    if (byLead.data) {
      const afterKickoff = await applyKickoffStatusRepair(
        sb,
        byLead.data as Record<string, unknown>
      );
      const repaired = await applyOpleveringStatusRepair(sb, afterKickoff);
      return NextResponse.json({
        project: repaired,
        redirectTo: (repaired as { id: string }).id,
      });
    }

    return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

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
    warmtefonds_aangevraagd_at?: string | null;
    /** Aparte Warmtefonds-fase; null = reset. */
    financiering_status?: FinancieringStatus | null;
    /** Interne datum/tijd WF-afspraak (geen mail). */
    warmtefonds_afspraak_at?: string | null;
    schouw_jaar?: number | null;
    schouw_week?: number | null;
    leveradres?: string | null;
    materiaal_checks?: Record<string, boolean | string> | null;
    /** Verwachte leverdatum inkoop (Planbord). */
    materiaal_leverdatum?: string | null;
    /** Leverancierbetaling: geen | betaald | op_krediet. */
    inkoop_leverancier_status?: "geen" | "betaald" | "op_krediet" | null;
    inkoop_leverancier_betaald_op?: string | null;
    /** Client signaleert: alle inkoop-vinkjes net afgevinkt. */
    materiaal_volledig_afgevinkt?: boolean;
    notities?: string | null;
    titel?: string | null;
    backoffice_notitie?: string | null;
    backoffice_notitie_door?: string | null;
    installateur_notitie?: string | null;
    afdeling?: string | null;
    verantwoordelijke_id?: string | null;
    installatie_partner_id?: string | null;
    /** Monteur van de gekozen installatiepartner. */
    installatie_teamgenoot_id?: string | null;
    /** Koppel voor de installatie (niet de schouw). */
    installatie_koppel_id?: string | null;
    service_teamgenoot_id?: string | null;
    betaalwijze?: Betaalwijze;
    betaalwijze_reden?: string | null;
    schouw_notities?: string | null;
    installatie_notities?: string | null;
    service_notities?: string | null;
    monteur_beoordeling_sterren?: number | string | null;
    monteur_beoordeling_notitie?: string | null;
    monteur_beoordeling_door?: string | null;
    klantvriendelijkheid_sterren?: number | string | null;
    klantvriendelijkheid_notitie?: string | null;
    klantvriendelijkheid_door?: string | null;
    /** AlphaESS systeem SIN (15 tekens, AL…). */
    systeem_sin?: string | null;
    btw_terugvragen_aangevraagd_at?: string | null;
    overstap_dynamische_leverancier_at?: string | null;
    review_gevraagd_at?: string | null;
    aangetekende_brief_verstuurd_at?: string | null;
    annulering_keuze_gecontroleerd_at?: string | null;
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
    patch.status =
      body.status === "installatie_voltooid" ? "after_sale" : body.status;
    // Annulering → van planbord af (schouw/installatie wissen)
    if (body.status === "annulering") {
      patch.schouw_at = null;
      patch.schouw_jaar = null;
      patch.schouw_week = null;
      patch.installatie_at = null;
      patch.service_at = null;
      patch.materiaal_leverdatum = null;
    }
  }
  if (body.betaalwijze !== undefined) {
    if (
      body.betaalwijze !== "warmtefonds" &&
      body.betaalwijze !== "eigen_middelen"
    ) {
      return NextResponse.json(
        { error: "Ongeldige betaalwijze" },
        { status: 400 }
      );
    }
    patch.betaalwijze = body.betaalwijze;
    patch.betaalwijze_gewijzigd_at = new Date().toISOString();
    patch.betaalwijze_reden =
      body.betaalwijze_reden?.trim() ||
      (body.status === "warmtefonds_afgewezen"
        ? "Warmtefonds afgewezen"
        : null);
  }
  if (body.titel !== undefined) {
    patch.titel = body.titel?.trim() || null;
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
  if (body.warmtefonds_aangevraagd_at !== undefined) {
    if (body.warmtefonds_aangevraagd_at === null) {
      patch.warmtefonds_aangevraagd_at = null;
    } else {
      const d = new Date(body.warmtefonds_aangevraagd_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige Warmtefonds-aanvraagdatum" },
          { status: 400 }
        );
      }
      patch.warmtefonds_aangevraagd_at = d.toISOString();
    }
  }
  for (const key of [
    "btw_terugvragen_aangevraagd_at",
    "overstap_dynamische_leverancier_at",
    "review_gevraagd_at",
    "aangetekende_brief_verstuurd_at",
    "annulering_keuze_gecontroleerd_at",
  ] as const) {
    const val = body[key];
    if (val === undefined) continue;
    if (val === null) {
      patch[key] = null;
      continue;
    }
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Ongeldige datum" }, { status: 400 });
    }
    patch[key] = d.toISOString();
  }
  if (
    (body.status === "review_gevraagd" || body.status === "afgerond") &&
    patch.review_gevraagd_at === undefined
  ) {
    patch.review_gevraagd_at = new Date().toISOString();
  }
  if (body.financiering_status !== undefined) {
    if (body.financiering_status === null) {
      patch.financiering_status = null;
      if (body.warmtefonds_afspraak_at === undefined) {
        patch.warmtefonds_afspraak_at = null;
      }
    } else if (!isFinancieringStatus(body.financiering_status)) {
      return NextResponse.json(
        { error: "Ongeldige financieringsstatus" },
        { status: 400 }
      );
    } else {
      patch.financiering_status = body.financiering_status;
    }
    patch.financiering_status_at =
      body.financiering_status === null ? null : new Date().toISOString();
  }
  if (body.warmtefonds_afspraak_at !== undefined) {
    if (body.warmtefonds_afspraak_at === null) {
      patch.warmtefonds_afspraak_at = null;
    } else {
      const d = new Date(body.warmtefonds_afspraak_at);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json(
          { error: "Ongeldige Warmtefonds-afspraakdatum" },
          { status: 400 }
        );
      }
      patch.warmtefonds_afspraak_at = d.toISOString();
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
  if (body.materiaal_leverdatum !== undefined) {
    if (body.materiaal_leverdatum === null || body.materiaal_leverdatum === "") {
      patch.materiaal_leverdatum = null;
    } else {
      const raw = String(body.materiaal_leverdatum).trim();
      // yyyy-MM-dd → 09:00 Amsterdam
      let iso: string;
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        iso = fromZonedTime(`${raw}T09:00:00`, AMSTERDAM_TZ).toISOString();
      } else {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: "Ongeldige leverdatum" },
            { status: 400 }
          );
        }
        iso = d.toISOString();
      }
      patch.materiaal_leverdatum = iso;
    }
  }
  if (body.inkoop_leverancier_status !== undefined) {
    const raw = body.inkoop_leverancier_status;
    if (raw === null || raw === "geen" || raw === "betaald" || raw === "op_krediet") {
      const status = raw === null ? "geen" : raw;
      patch.inkoop_leverancier_status = status;
      if (status === "betaald") {
        if (body.inkoop_leverancier_betaald_op !== undefined) {
          patch.inkoop_leverancier_betaald_op =
            body.inkoop_leverancier_betaald_op?.trim() || new Date().toISOString();
        } else if (!patch.inkoop_leverancier_betaald_op) {
          patch.inkoop_leverancier_betaald_op = new Date().toISOString();
        }
      } else {
        patch.inkoop_leverancier_betaald_op = null;
      }
    } else {
      return NextResponse.json(
        { error: "Ongeldige inkoop_leverancier_status" },
        { status: 400 }
      );
    }
  } else if (body.inkoop_leverancier_betaald_op !== undefined) {
    patch.inkoop_leverancier_betaald_op =
      body.inkoop_leverancier_betaald_op?.trim() || null;
  }
  if (body.notities !== undefined) {
    patch.notities = body.notities?.trim() || null;
  }
  if (body.backoffice_notitie !== undefined) {
    patch.backoffice_notitie = body.backoffice_notitie?.trim() || null;
  }
  if (body.backoffice_notitie_door !== undefined) {
    patch.backoffice_notitie_door =
      body.backoffice_notitie_door?.trim() || null;
  }
  if (body.installateur_notitie !== undefined) {
    patch.installateur_notitie = body.installateur_notitie?.trim() || null;
  }
  if (body.verantwoordelijke_id !== undefined) {
    patch.verantwoordelijke_id = body.verantwoordelijke_id?.trim() || null;
  }
  if (body.installatie_partner_id !== undefined) {
    patch.installatie_partner_id =
      body.installatie_partner_id?.trim() || null;
    // Partner-wissel: schouw-persoon én installatie-koppel opnieuw kiezen
    patch.installatie_teamgenoot_id = null;
    patch.installatie_koppel_id = null;
    patch.service_teamgenoot_id = null;
    patch.monteur = null;
  }
  if (body.installatie_teamgenoot_id !== undefined) {
    // Wordt hieronder gevalideerd t.o.v. partner (na before-load).
    patch.installatie_teamgenoot_id =
      body.installatie_teamgenoot_id?.trim() || null;
  }
  if (body.installatie_koppel_id !== undefined) {
    patch.installatie_koppel_id = body.installatie_koppel_id?.trim() || null;
  }
  if (body.service_teamgenoot_id !== undefined) {
    patch.service_teamgenoot_id = body.service_teamgenoot_id?.trim() || null;
  }
  if (body.schouw_notities !== undefined) {
    patch.schouw_notities = body.schouw_notities?.trim() || null;
  }
  if (body.installatie_notities !== undefined) {
    patch.installatie_notities = body.installatie_notities?.trim() || null;
  }
  if (body.service_notities !== undefined) {
    patch.service_notities = body.service_notities?.trim() || null;
  }
  if (body.systeem_sin !== undefined) {
    const { normalizeSysteemSin, validateSysteemSin } = await import(
      "@/lib/systeem-sin"
    );
    if (body.systeem_sin === null || String(body.systeem_sin).trim() === "") {
      patch.systeem_sin = null;
    } else {
      const sin = normalizeSysteemSin(String(body.systeem_sin));
      const sinErr = validateSysteemSin(sin);
      if (sinErr) {
        return NextResponse.json({ error: sinErr }, { status: 400 });
      }
      const { data: dupes } = await getSupabaseAdmin()
        .from("projecten")
        .select("id, project_nummer")
        .eq("systeem_sin", sin)
        .neq("id", id)
        .limit(1);
      if (dupes && dupes.length > 0) {
        return NextResponse.json(
          {
            error: `Dit SIN staat al op ${dupes[0].project_nummer || "ander project"}.`,
          },
          { status: 409 }
        );
      }
      patch.systeem_sin = sin;
    }
  }

  if (body.monteur_beoordeling_sterren !== undefined) {
    const raw = body.monteur_beoordeling_sterren;
    if (raw === null || raw === "") {
      patch.monteur_beoordeling_sterren = null;
      patch.monteur_beoordeling_op = null;
      patch.monteur_beoordeling_door = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 5) {
        return NextResponse.json(
          { error: "Beoordeling moet 0 t/m 5 sterren zijn" },
          { status: 400 }
        );
      }
      patch.monteur_beoordeling_sterren = n;
      patch.monteur_beoordeling_op = new Date().toISOString();
      if (body.monteur_beoordeling_door !== undefined) {
        patch.monteur_beoordeling_door =
          typeof body.monteur_beoordeling_door === "string"
            ? body.monteur_beoordeling_door.trim() || null
            : null;
      }
    }
  }
  if (body.monteur_beoordeling_notitie !== undefined) {
    patch.monteur_beoordeling_notitie =
      typeof body.monteur_beoordeling_notitie === "string"
        ? body.monteur_beoordeling_notitie.trim() || null
        : null;
    if (
      body.monteur_beoordeling_sterren === undefined &&
      patch.monteur_beoordeling_notitie
    ) {
      patch.monteur_beoordeling_op = new Date().toISOString();
      if (body.monteur_beoordeling_door !== undefined) {
        patch.monteur_beoordeling_door =
          typeof body.monteur_beoordeling_door === "string"
            ? body.monteur_beoordeling_door.trim() || null
            : null;
      }
    }
  }
  if (
    body.monteur_beoordeling_door !== undefined &&
    body.monteur_beoordeling_sterren === undefined &&
    body.monteur_beoordeling_notitie === undefined
  ) {
    patch.monteur_beoordeling_door =
      typeof body.monteur_beoordeling_door === "string"
        ? body.monteur_beoordeling_door.trim() || null
        : null;
  }

  if (body.klantvriendelijkheid_sterren !== undefined) {
    const raw = body.klantvriendelijkheid_sterren;
    if (raw === null || raw === "") {
      patch.klantvriendelijkheid_sterren = null;
      patch.klantvriendelijkheid_op = null;
      patch.klantvriendelijkheid_door = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 5) {
        return NextResponse.json(
          { error: "Klantvriendelijkheid moet 0 t/m 5 sterren zijn" },
          { status: 400 }
        );
      }
      patch.klantvriendelijkheid_sterren = n;
      patch.klantvriendelijkheid_op = new Date().toISOString();
      if (body.klantvriendelijkheid_door !== undefined) {
        patch.klantvriendelijkheid_door =
          typeof body.klantvriendelijkheid_door === "string"
            ? body.klantvriendelijkheid_door.trim() || null
            : null;
      }
    }
  }
  if (body.klantvriendelijkheid_notitie !== undefined) {
    patch.klantvriendelijkheid_notitie =
      typeof body.klantvriendelijkheid_notitie === "string"
        ? body.klantvriendelijkheid_notitie.trim() || null
        : null;
    if (
      body.klantvriendelijkheid_sterren === undefined &&
      patch.klantvriendelijkheid_notitie
    ) {
      patch.klantvriendelijkheid_op = new Date().toISOString();
      if (body.klantvriendelijkheid_door !== undefined) {
        patch.klantvriendelijkheid_door =
          typeof body.klantvriendelijkheid_door === "string"
            ? body.klantvriendelijkheid_door.trim() || null
            : null;
      }
    }
  }
  if (
    body.klantvriendelijkheid_door !== undefined &&
    body.klantvriendelijkheid_sterren === undefined &&
    body.klantvriendelijkheid_notitie === undefined
  ) {
    patch.klantvriendelijkheid_door =
      typeof body.klantvriendelijkheid_door === "string"
        ? body.klantvriendelijkheid_door.trim() || null
        : null;
  }

  if (body.afdeling !== undefined) {
    patch.afdeling = body.afdeling?.trim() || null;
  }

  // Datum Warmtefonds aangevraagd: alleen auto-zetten als die nog ontbreekt
  const autoWfAangevraagdAt =
    (body.status === "warmtefonds_aangevraagd" ||
      body.financiering_status === "aanvraag_gedaan" ||
      body.financiering_status === "in_behandeling" ||
      body.financiering_status === "documenten_aanleveren") &&
    body.warmtefonds_aangevraagd_at === undefined;

  if (Object.keys(patch).length === 0 && !autoWfAangevraagdAt) {
    return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    let beforeQuery = await sb
      .from("projecten")
      .select(
        "id, lead_id, status, project_nummer, betaalwijze, materiaal_checks, warmtefonds_aangevraagd_at, warmtefonds_afspraak_at, financiering_status, bel_schouw_aanbetaling_at, schouw_jaar, schouw_week, installatie_voltooid_at, review_gevraagd_at, btw_terugvragen_aangevraagd_at, overstap_dynamische_leverancier_at, monteur_beoordeling_sterren, installatie_partner_id, leads(status), offertes(financiering_voorbehoud)"
      )
      .eq("id", id)
      .maybeSingle();
    if (
      beforeQuery.error &&
      postgresUndefinedColumn(beforeQuery.error) === "bel_schouw_aanbetaling_at"
    ) {
      beforeQuery = await sb
        .from("projecten")
        .select(
          "id, lead_id, status, project_nummer, betaalwijze, materiaal_checks, warmtefonds_aangevraagd_at, warmtefonds_afspraak_at, financiering_status, schouw_jaar, schouw_week, installatie_voltooid_at, review_gevraagd_at, installatie_partner_id, leads(status), offertes(financiering_voorbehoud)"
        )
        .eq("id", id)
        .maybeSingle();
    }
    const before = beforeQuery.data;

    // Medewerker koppelen: moet bij de (nieuwe) partner horen + sync monteur-tekst
    if (body.installatie_teamgenoot_id !== undefined) {
      const tgId =
        typeof patch.installatie_teamgenoot_id === "string"
          ? patch.installatie_teamgenoot_id
          : null;
      const partnerIdForTg =
        (typeof patch.installatie_partner_id === "string"
          ? patch.installatie_partner_id
          : null) ||
        (before as { installatie_partner_id?: string | null } | null)
          ?.installatie_partner_id ||
        null;
      if (tgId) {
        if (!partnerIdForTg) {
          return NextResponse.json(
            { error: "Kies eerst een installateur" },
            { status: 400 }
          );
        }
        let tgQ = await sb
          .from("installatie_partner_teamgenoten")
          .select("id, naam, actief, kan_schouw")
          .eq("id", tgId)
          .eq("partner_id", partnerIdForTg)
          .maybeSingle();
        if (
          tgQ.error &&
          (tgQ.error.code === "42703" ||
            tgQ.error.message?.includes("kan_schouw"))
        ) {
          tgQ = await sb
            .from("installatie_partner_teamgenoten")
            .select("id, naam, actief")
            .eq("id", tgId)
            .eq("partner_id", partnerIdForTg)
            .maybeSingle();
        }
        const tg = tgQ.data as {
          id: string;
          naam: string;
          actief?: boolean | null;
          kan_schouw?: boolean | null;
        } | null;
        if (!tg || tg.actief === false) {
          return NextResponse.json(
            { error: "Medewerker niet gevonden bij deze installateur" },
            { status: 400 }
          );
        }
        if ("kan_schouw" in (tg as object) && tg.kan_schouw !== true) {
          return NextResponse.json(
            { error: "Kies iemand die mag schouwen (vinkje Schouw)" },
            { status: 400 }
          );
        }
        patch.installatie_teamgenoot_id = tg.id;
        if (body.installatie_koppel_id === undefined) {
          patch.monteur = tg.naam;
        }
      } else {
        patch.installatie_teamgenoot_id = null;
        if (body.installatie_koppel_id === undefined) {
          patch.monteur = null;
        }
      }
    }

    if (body.installatie_koppel_id !== undefined) {
      const koppelId =
        typeof patch.installatie_koppel_id === "string"
          ? patch.installatie_koppel_id
          : null;
      const partnerIdForKoppel =
        (typeof patch.installatie_partner_id === "string"
          ? patch.installatie_partner_id
          : null) ||
        (before as { installatie_partner_id?: string | null } | null)
          ?.installatie_partner_id ||
        null;
      if (koppelId) {
        if (!partnerIdForKoppel) {
          return NextResponse.json(
            { error: "Kies eerst een installateur" },
            { status: 400 }
          );
        }
        const { resolveKoppelVanPartner, koppelWeergaveNaam } = await import(
          "@/lib/installatie-koppel"
        );
        const koppel = await resolveKoppelVanPartner(
          partnerIdForKoppel,
          koppelId
        );
        if (!koppel) {
          return NextResponse.json(
            { error: "Koppel niet gevonden bij deze installateur" },
            { status: 400 }
          );
        }
        patch.installatie_koppel_id = koppel.id;
        patch.monteur = koppelWeergaveNaam(koppel);
      } else {
        patch.installatie_koppel_id = null;
      }
    }

    if (body.service_teamgenoot_id !== undefined) {
      const tgId =
        typeof patch.service_teamgenoot_id === "string"
          ? patch.service_teamgenoot_id
          : null;
      const partnerIdForSvc =
        (typeof patch.installatie_partner_id === "string"
          ? patch.installatie_partner_id
          : null) ||
        (before as { installatie_partner_id?: string | null } | null)
          ?.installatie_partner_id ||
        null;
      if (tgId) {
        if (!partnerIdForSvc) {
          return NextResponse.json(
            { error: "Kies eerst een installateur" },
            { status: 400 }
          );
        }
        let tgQ = await sb
          .from("installatie_partner_teamgenoten")
          .select("id, naam, actief, kan_service")
          .eq("id", tgId)
          .eq("partner_id", partnerIdForSvc)
          .maybeSingle();
        if (
          tgQ.error &&
          (tgQ.error.code === "42703" ||
            tgQ.error.message?.includes("kan_service"))
        ) {
          tgQ = await sb
            .from("installatie_partner_teamgenoten")
            .select("id, naam, actief")
            .eq("id", tgId)
            .eq("partner_id", partnerIdForSvc)
            .maybeSingle();
        }
        const tg = tgQ.data as {
          id: string;
          naam: string;
          actief?: boolean | null;
          kan_service?: boolean | null;
        } | null;
        if (!tg || tg.actief === false) {
          return NextResponse.json(
            { error: "Medewerker niet gevonden bij deze installateur" },
            { status: 400 }
          );
        }
        if ("kan_service" in (tg as object) && tg.kan_service !== true) {
          return NextResponse.json(
            { error: "Kies iemand die Service heeft aangevinkt" },
            { status: 400 }
          );
        }
        patch.service_teamgenoot_id = tg.id;
        if (body.installatie_koppel_id === undefined) {
          patch.monteur = tg.naam;
        }
      } else {
        patch.service_teamgenoot_id = null;
      }
    }

    // Eigen middelen: schouwweek via PATCH pas ná 50% betaling
    const settingSchouwWeek =
      typeof patch.schouw_jaar === "number" &&
      typeof patch.schouw_week === "number";
    if (settingSchouwWeek && before) {
      const leadRaw = Array.isArray(
        (before as { leads?: unknown }).leads
      )
        ? (before as { leads: { status?: string | null }[] }).leads[0]
        : (before as { leads?: { status?: string | null } }).leads;
      const offRaw = Array.isArray(
        (before as { offertes?: unknown }).offertes
      )
        ? (
            before as {
              offertes: { financiering_voorbehoud?: boolean | null }[];
            }
          ).offertes[0]
        : (
            before as {
              offertes?: { financiering_voorbehoud?: boolean | null };
            }
          ).offertes;
      const betaalwijze = resolveBetaalwijze({
        betaalwijze: (before as { betaalwijze?: string | null }).betaalwijze,
        leadStatus: leadRaw?.status,
        financieringVoorbehoud: offRaw?.financiering_voorbehoud,
      });
      if (betaalwijze === "eigen_middelen") {
        const { data: facturenRows } = await sb
          .from("facturen")
          .select("status, omschrijving, credit_van_factuur_id")
          .eq("project_id", id);
        const { isAanbetalingBetaald } = await import("@/lib/project-kickoff");
        if (!isAanbetalingBetaald(facturenRows || [])) {
          return NextResponse.json(
            {
              error:
                "Eigen middelen: schouwdag pas inplannen nadat de 50%-aanbetaling is betaald.",
            },
            { status: 400 }
          );
        }
      }
    }

    // After sale: pas als BTW + overstap + review + monteurbeoordeling gezet zijn
    const beforeRow = before as {
      status?: string | null;
      btw_terugvragen_aangevraagd_at?: string | null;
      overstap_dynamische_leverancier_at?: string | null;
      review_gevraagd_at?: string | null;
      monteur_beoordeling_sterren?: number | null;
    } | null;
    const mergedBtw =
      patch.btw_terugvragen_aangevraagd_at !== undefined
        ? patch.btw_terugvragen_aangevraagd_at
        : beforeRow?.btw_terugvragen_aangevraagd_at;
    const mergedOverstap =
      patch.overstap_dynamische_leverancier_at !== undefined
        ? patch.overstap_dynamische_leverancier_at
        : beforeRow?.overstap_dynamische_leverancier_at;
    const mergedReview =
      patch.review_gevraagd_at !== undefined
        ? patch.review_gevraagd_at
        : beforeRow?.review_gevraagd_at;
    /** Eerste keer review afgevinkt → mail + Trustpilot. */
    const reviewAtComing = Boolean(
      mergedReview && !beforeRow?.review_gevraagd_at
    );
    /** Eerste keer overstap afgevinkt → Batterijconcept × Frank-mail. */
    const overstapAtComing = Boolean(
      mergedOverstap && !beforeRow?.overstap_dynamische_leverancier_at
    );
    const mergedSterren =
      patch.monteur_beoordeling_sterren !== undefined
        ? patch.monteur_beoordeling_sterren
        : beforeRow?.monteur_beoordeling_sterren;
    const beoordelingOk =
      typeof mergedSterren === "number" &&
      Number.isFinite(mergedSterren) &&
      mergedSterren >= 0 &&
      mergedSterren <= 5;
    const allAfterSaleDone = Boolean(
      mergedBtw && mergedOverstap && mergedReview && beoordelingOk
    );
    if (
      allAfterSaleDone &&
      patch.status === undefined &&
      beforeRow?.status !== "afgerond" &&
      beforeRow?.status !== "service" &&
      beforeRow?.status !== "annulering" &&
      beforeRow?.status !== "hold_sales_actie"
    ) {
      patch.status = "afgerond";
    }
    if (patch.status === "review_gevraagd") {
      patch.status = allAfterSaleDone ? "afgerond" : "after_sale";
    }
    if (patch.status === "after_sale" && allAfterSaleDone) {
      patch.status = "afgerond";
    }

    if (
      autoWfAangevraagdAt &&
      !(before as { warmtefonds_aangevraagd_at?: string | null } | null)
        ?.warmtefonds_aangevraagd_at
    ) {
      patch.warmtefonds_aangevraagd_at = new Date().toISOString();
    }

    // Kickoff afronden: bel_schouw gezet of Edwin-afvink → WF niet op Opstarten laten hangen
    if (
      patch.status === undefined &&
      before &&
      (patch.bel_schouw_aanbetaling_at ||
        body.financiering_status !== undefined)
    ) {
      const { isWarmtefondsProject } = await import("@/lib/backoffice-acties");
      const { toOperationalStatus } = await import(
        "@/lib/project-status-config"
      );
      const mergedForKickoff = {
        ...before,
        ...patch,
        bel_schouw_aanbetaling_at:
          patch.bel_schouw_aanbetaling_at ??
          (before as { bel_schouw_aanbetaling_at?: string | null })
            .bel_schouw_aanbetaling_at,
        financiering_status:
          patch.financiering_status !== undefined
            ? patch.financiering_status
            : (before as { financiering_status?: string | null })
                .financiering_status,
      } as unknown as import("@/types/database").Project;
      if (
        isWarmtefondsProject(mergedForKickoff) &&
        toOperationalStatus(
          (mergedForKickoff.status as string) || before.status
        ) === "schouwweek_inplannen"
      ) {
        // bel_schouw expliciet → altijd afwachten WF
        if (patch.bel_schouw_aanbetaling_at) {
          patch.status = "opstarten_voltooid_afwachten_wf";
        } else if (body.financiering_status !== undefined) {
          // Edwin-afvink: alleen als overige kickoff-stappen ook klaar zijn
          const { kickoffCompletionPatch } = await import(
            "@/lib/project-kickoff"
          );
          const { data: facRows } = await sb
            .from("facturen")
            .select("status, omschrijving, credit_van_factuur_id")
            .eq("project_id", id);
          const kp = kickoffCompletionPatch(
            {
              ...mergedForKickoff,
              schouw_jaar:
                (before as { schouw_jaar?: number | null }).schouw_jaar ?? null,
              schouw_week:
                (before as { schouw_week?: number | null }).schouw_week ?? null,
            } as import("@/types/database").Project,
            (facRows || []) as import("@/types/database").Factuur[]
          );
          if (kp?.status) patch.status = kp.status;
          if (kp?.bel_schouw_aanbetaling_at) {
            patch.bel_schouw_aanbetaling_at = kp.bel_schouw_aanbetaling_at;
          }
        }
      }
    }

    // WF aanbod ondertekenen (goedgekeurd) → orderstatus Schouw inplannen
    {
      const mergedFs =
        patch.financiering_status !== undefined
          ? (patch.financiering_status as string | null)
          : ((before as { financiering_status?: string | null } | null)
              ?.financiering_status ?? null);
      const currentForPromote =
        (typeof patch.status === "string" ? patch.status : null) ||
        (before as { status?: string } | null)?.status ||
        null;
      const promoted = maybePromoteToSchouwInplannen({
        currentStatus: currentForPromote,
        financieringStatus: mergedFs,
        exacteSchouwdag: isSchouwdagDefinitief(
          (before as {
            schouw_at?: string | null;
            schouw_jaar?: number | null;
            schouw_week?: number | null;
          }) || {}
        ),
      });
      if (
        promoted &&
        (body.status === undefined ||
          patch.status === "opstarten_voltooid_afwachten_wf" ||
          patch.status === "schouwweek_inplannen")
      ) {
        patch.status = promoted;
      }
    }

    // Bewaar schouw/inkoop-meta (__…) als client alleen regelstatussen stuurt.
    if (
      patch.materiaal_checks &&
      typeof patch.materiaal_checks === "object"
    ) {
      const prev = ((before as { materiaal_checks?: Record<string, unknown> | null } | null)
        ?.materiaal_checks || {}) as Record<string, unknown>;
      const next = {
        ...(patch.materiaal_checks as Record<string, unknown>),
      };
      for (const [k, v] of Object.entries(prev)) {
        if (k.startsWith("__") && next[k] === undefined) {
          next[k] = v;
        }
      }
      patch.materiaal_checks = next;
    }

    if (
      (body.status === "installatie_voltooid" ||
        body.status === "after_sale") &&
      before?.status !== "installatie_voltooid" &&
      before?.status !== "after_sale"
    ) {
      if (
        !(before as { installatie_voltooid_at?: string | null } | null)
          ?.installatie_voltooid_at
      ) {
        patch.installatie_voltooid_at = new Date().toISOString();
      }
    }

    // HOLD SALES: deadline 4 kalenderdagen; clear bij verlaten HOLD.
    const nextStatusForHold =
      (patch.status as string | undefined) ||
      (body.status as string | undefined) ||
      "";
    const beforeStatus = (before as { status?: string } | null)?.status || "";
    if (
      nextStatusForHold === "hold_sales_actie" &&
      beforeStatus !== "hold_sales_actie"
    ) {
      patch.hold_sales_deadline_at = holdSalesDeadlineAt();
    } else if (
      nextStatusForHold &&
      nextStatusForHold !== "hold_sales_actie" &&
      beforeStatus === "hold_sales_actie"
    ) {
      patch.hold_sales_deadline_at = null;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Niets om bij te werken" }, { status: 400 });
    }

    const PROJECT_PATCH_SELECT =
      "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, terugbellen, terugbel_notitie, beller_id, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), installatie_teamgenoot:installatie_partner_teamgenoten!installatie_teamgenoot_id(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op, track_token, track_mail_verstuurd_at, track_last_seen_at, track_view_count)";
    const PROJECT_PATCH_SELECT_NO_TG =
      "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, terugbellen, terugbel_notitie, beller_id, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op, track_token, track_mail_verstuurd_at, track_last_seen_at, track_view_count)";

    let { data, error } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", id)
      .select(PROJECT_PATCH_SELECT)
      .single();

    if (error && isTeamgenootSelectError(error)) {
      const fallbackPatch = { ...patch };
      const missingTg = postgresUndefinedColumn(error);
      if (
        missingTg === "installatie_teamgenoot_id" ||
        error.message?.includes("installatie_teamgenoot_id")
      ) {
        delete fallbackPatch.installatie_teamgenoot_id;
      }
      if (
        missingTg === "installatie_koppel_id" ||
        error.message?.includes("installatie_koppel_id")
      ) {
        delete fallbackPatch.installatie_koppel_id;
      }
      const retryTg = await sb
        .from("projecten")
        .update(fallbackPatch)
        .eq("id", id)
        .select(PROJECT_PATCH_SELECT_NO_TG)
        .single();
      data = retryTg.data;
      error = retryTg.error;
    }

    if (error && messageHasExactColumn(error.message, "backoffice_notitie_door")) {
      const { backoffice_notitie_door: _dropDoor, ...restDoor } = patch;
      void _dropDoor;
      const retryDoor = await sb
        .from("projecten")
        .update(restDoor)
        .eq("id", id)
        .select(PROJECT_PATCH_SELECT_NO_TG)
        .single();
      data = retryDoor.data;
      error = retryDoor.error;
    }

    // Kolom hold_sales_deadline_at nog niet gemigreerd.
    if (error && messageHasExactColumn(error.message, "hold_sales_deadline_at")) {
      const { hold_sales_deadline_at: _drop, ...rest } = patch;
      void _drop;
      const retryHold = await sb
        .from("projecten")
        .update(rest)
        .eq("id", id)
        .select(PROJECT_PATCH_SELECT_NO_TG)
        .single();
      data = retryHold.data;
      error = retryHold.error;
    }

    if (
      error &&
      patch.status === "after_sale" &&
      (error.code === "23514" ||
        error.message?.includes("after_sale") ||
        error.message?.includes("projecten_status_check"))
    ) {
      const fallbackPatch = { ...patch, status: "installatie_voltooid" };
      const retryAs = await sb
        .from("projecten")
        .update(fallbackPatch)
        .eq("id", id)
        .select(PROJECT_PATCH_SELECT_NO_TG)
        .single();
      data = retryAs.data;
      error = retryAs.error;
    }

    // Kolommen monteur_beoordeling_* / klantvriendelijkheid_* nog niet gemigreerd.
    if (error) {
      const missingBeoordeling = postgresUndefinedColumn(error);
      if (
        missingBeoordeling?.startsWith("monteur_beoordeling") ||
        missingBeoordeling?.startsWith("klantvriendelijkheid")
      ) {
        return NextResponse.json(
          {
            error: migrationHintForProjectColumn(missingBeoordeling),
            migration_required: true,
          },
          { status: 503 }
        );
      }
    }

    // Kolom materiaal_leverdatum nog niet gemigreerd → bewaar in materiaal_checks.
    if (error && isMateriaalLeverdatumColumnError(error)) {
      const { materiaal_leverdatum: leverIso, ...rest } = patch;
      const prevChecks =
        (rest.materiaal_checks as Record<string, unknown> | undefined) ||
        ((before as { materiaal_checks?: Record<string, unknown> | null } | null)
          ?.materiaal_checks as Record<string, unknown> | null) ||
        {};
      const fallbackPatch = {
        ...rest,
        materiaal_checks: withLeverdatumInChecks(
          prevChecks,
          typeof leverIso === "string" || leverIso === null
            ? (leverIso as string | null)
            : null
        ),
      };
      const retryLever = await sb
        .from("projecten")
        .update(fallbackPatch)
        .eq("id", id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, terugbellen, terugbel_notitie, beller_id, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op)"
        )
        .single();
      data = retryLever.data;
      error = retryLever.error;
      if (!error && data) {
        // Virtualiseer kolom voor clients
        (data as { materiaal_leverdatum?: string | null }).materiaal_leverdatum =
          typeof leverIso === "string" ? leverIso : null;
      }
    }

    // Kolommen inkoop_leverancier_* nog niet gemigreerd → bewaar in materiaal_checks.
    if (error && isInkoopLeverancierColumnError(error)) {
      const {
        inkoop_leverancier_status: levStatus,
        inkoop_leverancier_betaald_op: levBetaaldOp,
        ...rest
      } = patch;
      const prevChecks =
        (rest.materiaal_checks as Record<string, unknown> | undefined) ||
        ((before as { materiaal_checks?: Record<string, unknown> | null } | null)
          ?.materiaal_checks as Record<string, unknown> | null) ||
        {};
      const status: InkoopLeverancierStatus =
        levStatus === "betaald" ||
        levStatus === "op_krediet" ||
        levStatus === "geen"
          ? levStatus
          : "geen";
      const betaaldOp =
        typeof levBetaaldOp === "string" ? levBetaaldOp : null;
      const fallbackPatch = {
        ...rest,
        materiaal_checks: withLeverancierBetalingInChecks(
          prevChecks,
          status,
          betaaldOp
        ),
      };
      const retryLev = await sb
        .from("projecten")
        .update(fallbackPatch)
        .eq("id", id)
        .select(
          "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status, terugbellen, terugbel_notitie, beller_id, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam, email, telefoon), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, aanbetaling_modus, aanbetaling_bedrag_inc, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, ondertekend_op)"
        )
        .single();
      data = retryLev.data;
      error = retryLev.error;
      if (!error && data) {
        (
          data as {
            inkoop_leverancier_status?: string | null;
            inkoop_leverancier_betaald_op?: string | null;
          }
        ).inkoop_leverancier_status = status;
        (
          data as { inkoop_leverancier_betaald_op?: string | null }
        ).inkoop_leverancier_betaald_op = betaaldOp;
      }
    }

    // Ontbrekende optionele kolommen: retry zonder die ene kolom (niet de hele PATCH).
    if (error) {
      const missingCol = postgresUndefinedColumn(error);
      const looksLikeMissingColumn =
        Boolean(missingCol) ||
        error.code === "42703" ||
        error.code === "PGRST204";
      if (looksLikeMissingColumn) {
        const softPatch = { ...patch };
        if (missingCol && OPTIONAL_PATCH_COLUMNS.has(missingCol)) {
          delete softPatch[missingCol];
        }
        const droppedOptional =
          missingCol != null &&
          Object.keys(softPatch).length < Object.keys(patch).length;
        if (droppedOptional && Object.keys(softPatch).length > 0) {
          const retrySoft = await sb
            .from("projecten")
            .update(softPatch)
            .eq("id", id)
            .select(PROJECT_PATCH_SELECT_NO_TG)
            .single();
          if (!retrySoft.error && retrySoft.data) {
            data = retrySoft.data;
            error = null;
          } else {
            error = retrySoft.error || error;
          }
        } else if (missingCol) {
          const hint = migrationHintForProjectColumn(missingCol);
          if (hint) {
            return NextResponse.json(
              { error: hint, detail: error.message, column: missingCol },
              { status: 500 }
            );
          }
        }
      }
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

    // Overstap afgevinkt → Batterijconcept × Frank Energie-mail
    if (overstapAtComing) {
      try {
        const { sendOverstapFrankKlantMail } = await import(
          "@/lib/overstap-frank-mail"
        );
        const sent = await sendOverstapFrankKlantMail(
          sb,
          id,
          data as Record<string, unknown>
        );
        const leadIdForOverstap =
          (before?.lead_id || (data as { lead_id?: string }).lead_id) as
            | string
            | undefined;
        await logProjectKlantMail({
          leadId: leadIdForOverstap,
          projectId: id,
          projectNummer: (data as { project_nummer?: string }).project_nummer,
          to: sent.to,
          subject: sent.subject,
          bericht: sent.ok
            ? "Batterijconcept × Frank Energie-uitnodiging"
            : sent.error || "Onbekende fout",
          ok: sent.ok,
          messageId: sent.messageId,
          tag: "overstap-frank",
          titel: sent.ok
            ? "Overstap-mail verstuurd (Frank Energie)"
            : "Overstap-mail mislukt",
        });
      } catch (e) {
        console.error("sendOverstapFrankKlantMail:", e);
      }
    }

    // Review afgevinkt → aparte review-mail + Trustpilot AFS (verified)
    if (reviewAtComing) {
      try {
        const { sendReviewVerzoekKlantMail } = await import(
          "@/lib/review-verzoek-mail"
        );
        const sent = await sendReviewVerzoekKlantMail(
          sb,
          id,
          data as Record<string, unknown>
        );
        const leadIdForReview =
          (before?.lead_id || (data as { lead_id?: string }).lead_id) as
            | string
            | undefined;
        await logProjectKlantMail({
          leadId: leadIdForReview,
          projectId: id,
          projectNummer: (data as { project_nummer?: string }).project_nummer,
          to: sent.to,
          subject: sent.subject,
          bericht: sent.ok
            ? "Klantmail + BCC Trustpilot AFS (verified review)"
            : sent.error || "Onbekende fout",
          ok: sent.ok,
          messageId: sent.messageId,
          tag: "review-verzoek",
          titel: sent.ok
            ? "Reviewverzoek verstuurd (Trustpilot)"
            : "Reviewverzoek mail mislukt",
        });
      } catch (e) {
        console.error("sendReviewVerzoekKlantMail:", e);
      }
    }

    if (
      body.btw_terugvragen_aangevraagd_at !== undefined ||
      body.overstap_dynamische_leverancier_at !== undefined ||
      body.review_gevraagd_at !== undefined
    ) {
      try {
        const { syncAutoTakenVoorProject } = await import(
          "@/lib/sync-auto-taken"
        );
        await syncAutoTakenVoorProject(
          sb,
          id,
          (data as { status?: string }).status ||
            (before as { status?: string } | null)?.status ||
            "after_sale"
        );
      } catch (e) {
        console.error("syncAutoTakenVoorProject after-sale:", e);
      }
    }

    if (
      (body.status === "installatie_voltooid" ||
        patch.status === "after_sale" ||
        body.status === "after_sale") &&
      before?.status !== "installatie_voltooid" &&
      before?.status !== "after_sale"
    ) {
      try {
        await ensurePartnerInstallatieCreditfactuur(sb, id);
      } catch (e) {
        console.error("ensurePartnerInstallatieCreditfactuur:", e);
      }
      try {
        await ensureAdviseurCommissieTrancheB(sb, id);
      } catch (e) {
        console.error("ensureAdviseurCommissieTrancheB:", e);
      }
      // Eigen middelen: 50% restantfactuur ná installatie
      try {
        const { ensureRestantDraftFactuur } = await import(
          "@/lib/ensure-btw-factuur"
        );
        const { isWarmtefondsProject } = await import(
          "@/lib/backoffice-acties"
        );
        const projectRow = data as Project & {
          offertes?:
            | {
                id?: string;
                offerte_nummer?: string;
                totaal_inc_btw?: number | null;
                subtotaal_ex_btw?: number | null;
              }
            | {
                id?: string;
                offerte_nummer?: string;
                totaal_inc_btw?: number | null;
                subtotaal_ex_btw?: number | null;
              }[]
            | null;
        };
        if (!isWarmtefondsProject(projectRow)) {
          const off = Array.isArray(projectRow.offertes)
            ? projectRow.offertes[0]
            : projectRow.offertes;
          const offerteId =
            (off?.id as string | undefined) ||
            (projectRow.offerte_id as string | undefined);
          if (offerteId && projectRow.lead_id) {
            await ensureRestantDraftFactuur(sb, {
              offerteId,
              leadId: projectRow.lead_id as string,
              projectId: id,
              offerteNummer:
                (off?.offerte_nummer as string | undefined) ||
                (projectRow.project_nummer as string) ||
                "order",
              orderIncBtw: Number(off?.totaal_inc_btw) || 0,
              orderExBtw:
                off?.subtotaal_ex_btw != null
                  ? Number(off.subtotaal_ex_btw)
                  : null,
              warmtefonds: false,
            });
          }
        }
      } catch (e) {
        console.error("ensureRestantDraftFactuur (eigen middelen):", e);
      }
    }

    const leadId = (before?.lead_id || data.lead_id) as string | undefined;
    if (leadId) {
      if (body.status && before?.status && body.status !== before.status) {
        const aangevraagdAt =
          body.status === "warmtefonds_aangevraagd"
            ? ((patch.warmtefonds_aangevraagd_at as string | undefined) ||
                (data as { warmtefonds_aangevraagd_at?: string | null })
                  .warmtefonds_aangevraagd_at ||
                null)
            : null;
        await logLeadEvent({
          leadId,
          soort: "status",
          titel: `Projectstatus: ${resolveProjectStatusLabel(body.status, data) || body.status}`,
          detail: [
            before.status
              ? `Was: ${resolveProjectStatusLabel(before.status, before) || before.status}`
              : null,
            aangevraagdAt
              ? `Aangevraagd op ${new Date(aangevraagdAt).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
          meta: {
            project_id: id,
            project_nummer: data.project_nummer,
            van: before.status,
            naar: body.status,
            ...(aangevraagdAt
              ? { warmtefonds_aangevraagd_at: aangevraagdAt }
              : {}),
          },
        });
      }

      if (body.financiering_status !== undefined) {
        const prevFs =
          (before as { financiering_status?: string | null } | null)
            ?.financiering_status ?? null;
        const nextFs = body.financiering_status;
        if (prevFs !== nextFs) {
          const nextLabel = nextFs
            ? FINANCIERING_STATUS_LABEL[nextFs]
            : "Gerereset";
          const prevLabel = prevFs
            ? isFinancieringStatus(prevFs)
              ? FINANCIERING_STATUS_LABEL[prevFs]
              : prevFs
            : "Nog niet gestart";
          await logLeadEvent({
            leadId,
            soort: "status",
            titel: `Financiering: ${nextLabel}`,
            detail: `Was: ${prevLabel}`,
            meta: {
              project_id: id,
              project_nummer: data.project_nummer,
              veld: "financiering_status",
              van: prevFs,
              naar: nextFs,
            },
          });
        }

        // Na goedkeuring / aanbod: concept-restantfactuur Warmtefonds klaarzetten
        if (
          (nextFs === "aanvraag_goedgekeurd" ||
            nextFs === "aanbod_ondertekenen") &&
          prevFs !== "aanvraag_goedgekeurd" &&
          prevFs !== "aanbod_ondertekenen"
        ) {
          const offRaw = data.offertes;
          const off = Array.isArray(offRaw) ? offRaw[0] : offRaw;
          if (off?.id && off.financiering_voorbehoud) {
            const { ensureRestantDraftFactuur } = await import(
              "@/lib/ensure-btw-factuur"
            );
            await ensureRestantDraftFactuur(sb, {
              offerteId: off.id,
              leadId,
              projectId: id,
              offerteNummer: off.offerte_nummer || data.project_nummer || "",
              orderIncBtw: Number(off.totaal_inc_btw) || 0,
              orderExBtw: Number(off.subtotaal_ex_btw) || 0,
              warmtefonds: true,
            });
          }
        }
      }

      if (body.materiaal_checks && typeof body.materiaal_checks === "object") {
        const prev = (before?.materiaal_checks || {}) as Record<
          string,
          boolean | string
        >;
        const next = body.materiaal_checks;
        const isOrdered = (v: boolean | string | undefined) =>
          v === true || v === "besteld" || v === "geleverd";
        const newlyChecked = Object.keys(next).filter(
          (key) => isOrdered(next[key]) && !isOrdered(prev[key])
        );
        for (const key of newlyChecked) {
          const label = key.replace(/^std:/, "").replace(/[_-]/g, " ");
          const statusLabel =
            next[key] === "geleverd" ? "geleverd" : "besteld";
          await logLeadEvent({
            leadId,
            soort: "inkoop",
            titel: `Inkoop ${statusLabel}: ${label}`,
            detail: data.project_nummer
              ? `Project ${data.project_nummer}`
              : null,
            meta: { project_id: id, check_key: key, status: next[key] },
          });
        }
        if (body.materiaal_volledig_afgevinkt === true) {
          await logLeadEvent({
            leadId,
            soort: "inkoop",
            titel: "Bestelling volledig afgevinkt",
            detail: data.project_nummer
              ? `Alle artikelen besteld · Project ${data.project_nummer}`
              : "Alle artikelen besteld",
            meta: {
              project_id: id,
              project_nummer: data.project_nummer,
              volledig: true,
            },
          });
        }
      }
    }

    const statusForSync =
      (patch.status as string | undefined) ||
      body.status ||
      (data as { status?: string }).status ||
      before?.status ||
      "";
    if (
      body.status ||
      patch.status ||
      body.financiering_status !== undefined ||
      reviewAtComing
    ) {
      const { syncAutoTakenVoorProject } = await import(
        "@/lib/sync-auto-taken"
      );
      await syncAutoTakenVoorProject(
        sb,
        id,
        statusForSync,
        body.financiering_status !== undefined
          ? body.financiering_status
          : undefined
      );
    }

    // HOLD SALES / annulering → open sales-commissieregels uit uitbetalingsconcepten
    const nextStatus =
      (patch.status as string | undefined) ||
      (body.status as string | undefined) ||
      "";
    if (
      (nextStatus === "hold_sales_actie" ||
        nextStatus === "hold_sales" ||
        nextStatus === "annulering") &&
      before?.status !== nextStatus
    ) {
      try {
        await stripHoldSalesFromOpenSalesCreditfacturen(sb, id);
      } catch (stripErr) {
        console.error("stripHoldSalesFromOpenSalesCreditfacturen:", stripErr);
      }
    }

    // Geen automatische annuleringsmail meer — knop op projectpagina.
    if (
      body.financiering_status !== undefined &&
      body.financiering_status !==
        (before as { financiering_status?: string | null } | null)
          ?.financiering_status
    ) {
      try {
        const { verstuurWarmtefondsStapFlows } = await import(
          "@/lib/warmtefonds-automatisering"
        );
        const vanStatus =
          (before as { financiering_status?: string | null } | null)
            ?.financiering_status ?? null;
        const naarStatus =
          typeof body.financiering_status === "string"
            ? body.financiering_status
            : null;
        await verstuurWarmtefondsStapFlows({
          projectId: id,
          van: vanStatus,
          naar: naarStatus,
        });
        const { zorgEdergyFactuurBijStap } = await import(
          "@/lib/edergy-factuur"
        );
        await zorgEdergyFactuurBijStap({
          projectId: id,
          van: vanStatus,
          naar: naarStatus,
        });
      } catch {
        /* mail mag de status niet blokkeren */
      }
    }

    const nieuwAfspraak = patch.warmtefonds_afspraak_at;
    const oudAfspraak = (
      before as { warmtefonds_afspraak_at?: string | null } | null
    )?.warmtefonds_afspraak_at;
    if (typeof nieuwAfspraak === "string" && nieuwAfspraak) {
      const veranderd =
        !oudAfspraak ||
        new Date(nieuwAfspraak).getTime() !== new Date(oudAfspraak).getTime();
      if (veranderd) {
        try {
          const { verstuurWfAfspraakBevestiging } = await import(
            "@/lib/warmtefonds-automatisering"
          );
          await verstuurWfAfspraakBevestiging(id);
        } catch {
          /* bevestiging mag de afspraak niet blokkeren */
        }
      }
    }
    return NextResponse.json({ project: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/projecten/[id]
 * Verwijdert project (+ cascaded taken/foto's/service). Conceptfacturen worden
 * ontkoppeld; verstuurde/betaalde facturen blokkeren.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Ontbrekend id" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: project, error: projErr } = await sb
      .from("projecten")
      .select("id, project_nummer, titel, lead_id")
      .eq("id", id)
      .maybeSingle();

    if (projErr) throw projErr;
    if (!project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const { data: facturen, error: facErr } = await sb
      .from("facturen")
      .select("id, factuur_nummer, status")
      .eq("project_id", id);
    if (facErr && facErr.code !== "42P01") throw facErr;

    const blockedFac = (facturen || []).find((f) => {
      const s = String(f.status || "").toLowerCase();
      return s === "betaald" || s === "verstuurd" || s === "deels_betaald";
    });
    if (blockedFac) {
      return NextResponse.json(
        {
          error: `Project heeft factuur ${blockedFac.factuur_nummer} (${blockedFac.status}) — die moet eerst weg of op concept.`,
        },
        { status: 409 }
      );
    }

    // Concept-/overige facturen ontkoppelen (blijven op de lead)
    if ((facturen || []).length > 0) {
      const { error: unlinkFac } = await sb
        .from("facturen")
        .update({ project_id: null })
        .eq("project_id", id);
      if (unlinkFac) {
        if (
          unlinkFac.code === "23503" ||
          /foreign key|violates foreign key/i.test(unlinkFac.message || "")
        ) {
          return NextResponse.json(
            {
              error:
                "Facturen blokkeren verwijderen. Zet ze op concept of ontkoppel ze eerst.",
              detail: unlinkFac.message,
            },
            { status: 409 }
          );
        }
        throw unlinkFac;
      }
    }

    // Optioneel: inkomende facturen / actie-events ontkoppelen als cascade ontbreekt
    for (const table of ["inkomende_facturen", "backoffice_actie_events"] as const) {
      const { error: unlink } = await sb
        .from(table)
        .update({ project_id: null })
        .eq("project_id", id);
      if (
        unlink &&
        unlink.code !== "42P01" &&
        !/does not exist|schema cache/i.test(unlink.message || "")
      ) {
        // Geen harde fail — cascade/SET NULL kan al genoeg zijn
        console.warn(`Unlink ${table} bij project-delete:`, unlink.message);
      }
    }

    const { error: delProj } = await sb.from("projecten").delete().eq("id", id);
    if (delProj) {
      if (
        delProj.code === "23503" ||
        /foreign key|violates foreign key/i.test(delProj.message || "")
      ) {
        return NextResponse.json(
          {
            error:
              "Project is gekoppeld aan andere gegevens en kan niet worden verwijderd.",
            detail: delProj.message,
          },
          { status: 409 }
        );
      }
      throw delProj;
    }

    if (project.lead_id) {
      await logLeadEvent({
        leadId: project.lead_id,
        soort: "status",
        titel: "Project verwijderd",
        detail: project.project_nummer
          ? `Project ${project.project_nummer} verwijderd`
          : "Project verwijderd",
        meta: {
          project_id: id,
          project_nummer: project.project_nummer,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      deleted: {
        id: project.id,
        project_nummer: project.project_nummer,
        titel: project.titel,
        lead_id: project.lead_id,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}
