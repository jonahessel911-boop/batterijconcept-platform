import type { SupabaseClient } from "@supabase/supabase-js";
import {
  heeftGeenAanbetalingNodig,
  isAanbetalingFactuurOmschrijving,
} from "@/lib/aanbetaling";
import {
  autoTakenVoorFinanciering,
  autoTakenVoorStatus,
  dueAtFromDays,
  type AutoTaakDef,
} from "@/lib/project-taken";
import { isSchouwdagDefinitief } from "@/lib/schouw-week";
import {
  remapLegacyProjectStatus,
  resolveBetaalwijze,
  type Betaalwijze,
} from "@/lib/project-status-config";
import {
  effectiveOperationalStatus,
  kanWfSchouwdagInplannen,
} from "@/lib/project-volgende-stap";
import {
  financieringStatusVoorAutoTaken,
  type FinancieringStatus,
} from "@/lib/financiering-status";
import type { Project } from "@/types/database";
import { REFERRAL_TAK_AUTO_KEY } from "@/lib/sales-referral-taak";
import { resolveSaleAdviseurId } from "@/lib/sale-adviseur";
import { OPLEVERING_AFTER_SALE_TAK_AUTO_KEY } from "@/lib/project-taken";
import { getDefaultBackofficeMedewerkerId } from "@/lib/admin-adviseur";
import { parseAanbetalingAfspraak } from "@/lib/aanbetaling-afspraak";

const SCHOUWDAG_INPLAN_KEY = "schouwweek:schouwdag_inplannen";
const CREDITFACTUUR_KEY = "annulering:creditfactuur";
const OPLEVERING_AUTO_PREFIX = "installatie_voltooid:";

/** Facturen waarvoor bij annulering een credit-actie nodig is. */
const CREDIT_ELIGIBLE_STATUSES = [
  "verzonden",
  "deels_betaald",
  "betaald",
] as const;

type ProjectSchouwFields = {
  status: string;
  verantwoordelijke_id?: string | null;
  materiaal_checks?: Record<string, unknown> | null;
  betaalwijze?: string | null;
  financiering_status?: string | null;
  warmtefonds_afspraak_at?: string | null;
  aanbetaling_te_innen_inc?: number | null;
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  schouw_at?: string | null;
  installatie_at?: string | null;
  installatie_voltooid_at?: string | null;
  btw_terugvragen_aangevraagd_at?: string | null;
  overstap_dynamische_leverancier_at?: string | null;
  review_gevraagd_at?: string | null;
  monteur_beoordeling_sterren?: number | null;
  leads?: { status?: string | null } | { status?: string | null }[] | null;
  offertes?:
    | {
        financiering_voorbehoud?: boolean | null;
        subtotaal_ex_btw?: number | null;
        btw_bedrag?: number | null;
        totaal_inc_btw?: number | null;
        aanbetaling_modus?: string | null;
        aanbetaling_bedrag_inc?: number | null;
        aanbetaling_te_innen_inc?: number | null;
      }
    | {
        financiering_voorbehoud?: boolean | null;
        subtotaal_ex_btw?: number | null;
        btw_bedrag?: number | null;
        totaal_inc_btw?: number | null;
        aanbetaling_modus?: string | null;
        aanbetaling_bedrag_inc?: number | null;
        aanbetaling_te_innen_inc?: number | null;
      }[]
    | null;
};

function leadStatusOf(project: ProjectSchouwFields): string | null {
  const l = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  return l?.status ?? null;
}

let defaultBoOwnerPromise: Promise<string | null> | null = null;

async function fallbackBackofficeOwnerId(
  sb: SupabaseClient
): Promise<string | null> {
  if (!defaultBoOwnerPromise) {
    defaultBoOwnerPromise = getDefaultBackofficeMedewerkerId(sb);
  }
  return defaultBoOwnerPromise;
}

async function verantwoordelijkeVoorAutoTaak(
  sb: SupabaseClient,
  project: ProjectSchouwFields,
  saleAdviseurId: string | null,
  isReferral: boolean
): Promise<string | null> {
  if (isReferral && saleAdviseurId) return saleAdviseurId;
  const gekoppeld = project.verantwoordelijke_id?.trim() || null;
  if (gekoppeld) return gekoppeld;
  return fallbackBackofficeOwnerId(sb);
}

function betaalwijzeOf(project: ProjectSchouwFields): Betaalwijze {
  const off = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;
  return resolveBetaalwijze({
    betaalwijze: project.betaalwijze,
    leadStatus: leadStatusOf(project),
    financieringVoorbehoud: off?.financiering_voorbehoud,
  });
}

/**
 * Bij annulering: open creditfactuur-taak als er nog verzonden/betaalde
 * facturen zijn zonder credit.
 */
async function creditfactuurTaakBijAnnulering(
  sb: SupabaseClient,
  projectId: string
): Promise<(AutoTaakDef & { dueAt?: string | null }) | null> {
  const { data: facturen, error } = await sb
    .from("facturen")
    .select("id, factuur_nummer, status, credit_van_factuur_id")
    .eq("project_id", projectId)
    .is("credit_van_factuur_id", null)
    .in("status", [...CREDIT_ELIGIBLE_STATUSES]);

  if (error || !facturen?.length) return null;

  const ids = facturen.map((f) => f.id);
  const { data: credits } = await sb
    .from("facturen")
    .select("credit_van_factuur_id")
    .in("credit_van_factuur_id", ids);

  const alreadyCredited = new Set(
    (credits || [])
      .map((c) => c.credit_van_factuur_id as string | null)
      .filter(Boolean)
  );

  const pending = facturen.filter((f) => !alreadyCredited.has(f.id));
  if (!pending.length) return null;

  const nrs = pending.map((f) => f.factuur_nummer).filter(Boolean);
  const titel =
    nrs.length === 1
      ? `Creditfactuur maken (${nrs[0]})`
      : `Creditfactuur maken (${nrs.join(", ")})`;

  return {
    autoKey: CREDITFACTUUR_KEY,
    titel,
    afdeling: "Facturatie",
    dueInDays: 1,
  };
}

/**
 * Zorgt dat open auto-taken bij de huidige status bestaan.
 * Eerdere open auto-taken die niet meer bij deze status horen → done.
 * Extra: bij geplande schouwweek (zonder exacte dag) taak 1 week eerder
 * om schouwdag + datum in te plannen.
 * Extra: bij annulering + verzonden factuur → taak Creditfactuur maken.
 * Extra: Warmtefonds-financieringstaken parallel via financiering_status.
 */
export async function syncAutoTakenVoorProject(
  sb: SupabaseClient,
  projectId: string,
  status: string,
  financieringStatusOverride?: FinancieringStatus | null
): Promise<void> {
  const { data: projectRow } = await sb
    .from("projecten")
    .select(
      "status, verantwoordelijke_id, materiaal_checks, betaalwijze, financiering_status, warmtefonds_afspraak_at, aanbetaling_te_innen_inc, schouw_jaar, schouw_week, schouw_at, installatie_at, installatie_voltooid_at, btw_terugvragen_aangevraagd_at, overstap_dynamische_leverancier_at, review_gevraagd_at, monteur_beoordeling_sterren, leads(status), offertes(financiering_voorbehoud, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, aanbetaling_modus, aanbetaling_bedrag_inc, aanbetaling_te_innen_inc)"
    )
    .eq("id", projectId)
    .maybeSingle();

  const project = (projectRow as ProjectSchouwFields | null) || {
    status,
    verantwoordelijke_id: null,
    betaalwijze: null,
    financiering_status: null,
    warmtefonds_afspraak_at: null,
    aanbetaling_te_innen_inc: null,
    schouw_jaar: null,
    schouw_week: null,
    schouw_at: null,
    installatie_at: null,
    installatie_voltooid_at: null,
  };

  const statusKey = remapLegacyProjectStatus(status);
  const defs: (AutoTaakDef & { dueAt?: string | null })[] = [];

  // Annulering: workflow-taken (schouw, installatie, WF, …) zijn niet meer
  // relevant — alleen eventueel creditfactuur. Overige open auto-taken → done.
  if (statusKey === "annulering") {
    const creditTaak = await creditfactuurTaakBijAnnulering(sb, projectId);
    if (creditTaak) defs.push(creditTaak);
  } else {
    const betaalwijze = betaalwijzeOf(project);
    const operational = effectiveOperationalStatus(project);
    const off = Array.isArray(project.offertes)
      ? project.offertes[0]
      : project.offertes;
    const geenAanbetalingNodig = heeftGeenAanbetalingNodig({
      aanbetalingTeInnenInc:
        project.aanbetaling_te_innen_inc ?? off?.aanbetaling_te_innen_inc,
      aanbetalingModus: off?.aanbetaling_modus,
      aanbetalingBedragInc: off?.aanbetaling_bedrag_inc,
      subtotaalExBtw: off?.subtotaal_ex_btw,
      btwBedrag: off?.btw_bedrag,
      totaalIncBtw: off?.totaal_inc_btw,
      financieringVoorbehoud: off?.financiering_voorbehoud,
    });
    let aanbetalingBetaald = geenAanbetalingNodig;
    if (
      !aanbetalingBetaald &&
      betaalwijze === "eigen_middelen" &&
      operational === "schouwweek_inplannen"
    ) {
      const { data: facturen } = await sb
        .from("facturen")
        .select("status, omschrijving, credit_van_factuur_id")
        .eq("project_id", projectId);
      aanbetalingBetaald = (facturen || []).some(
        (f) =>
          !f.credit_van_factuur_id &&
          isAanbetalingFactuurOmschrijving(f.omschrijving) &&
          f.status === "betaald"
      );
    }
    for (const d of autoTakenVoorStatus(operational, betaalwijze, {
      schouwAt: project.schouw_at,
      installatieAt: project.installatie_at,
      installatieVoltooidAt: project.installatie_voltooid_at,
      aanbetalingBetaald,
      geenAanbetalingNodig,
    })) {
      defs.push({ ...d });
    }

    // Nazorg (overstap/BTW/review) blijft open tot checklist-velden gezet zijn,
    // ook als status al review_gevraagd/service is.
    if (
      operational === "review_gevraagd" ||
      operational === "after_sale" ||
      operational === "afgerond" ||
      operational === "service" ||
      operational === "installatie_voltooid"
    ) {
      const afrondDefs = autoTakenVoorStatus(
        "installatie_voltooid",
        betaalwijze,
        {
          schouwAt: project.schouw_at,
          installatieAt: project.installatie_at,
          installatieVoltooidAt: project.installatie_voltooid_at,
        }
      );
      for (const d of afrondDefs) {
        if (defs.some((x) => x.autoKey === d.autoKey)) continue;
        if (
          d.autoKey === OPLEVERING_AFTER_SALE_TAK_AUTO_KEY &&
          project.overstap_dynamische_leverancier_at &&
          project.btw_terugvragen_aangevraagd_at &&
          project.review_gevraagd_at &&
          (typeof project.monteur_beoordeling_sterren === "number" ||
            operational === "afgerond" ||
            operational === "service")
        ) {
          continue;
        }
        defs.push({ ...d });
      }
    }

    const finStatus =
      financieringStatusOverride !== undefined
        ? financieringStatusOverride
        : financieringStatusVoorAutoTaken({
            financiering_status: project.financiering_status,
            status: project.status,
            warmtefonds_afspraak_at: project.warmtefonds_afspraak_at,
          });

    if (betaalwijze === "warmtefonds") {
      for (const d of autoTakenVoorFinanciering(finStatus)) {
        defs.push({ ...d });
      }
    }

    // Schouwweek is geen trigger — alleen klant-indicatie.
    // WF: schouwdag-taak pas ná goedkeuring (declaratie loopt via financiering-taken).
    // EM: schouwdag zit in kickoff-taken, geen aparte week-reminder.
    if (
      betaalwijze === "warmtefonds" &&
      !isSchouwdagDefinitief(project) &&
      kanWfSchouwdagInplannen(project as Project)
    ) {
      defs.push({
        autoKey: SCHOUWDAG_INPLAN_KEY,
        titel: "Schouw inplannen met de klant",
        afdeling: "Planning",
        dueInDays: 2,
      });
    }
  }

  if (parseAanbetalingAfspraak(project.materiaal_checks)) {
    for (let i = defs.length - 1; i >= 0; i -= 1) {
      if (defs[i]?.autoKey === "kickoff:aanbetaling") defs.splice(i, 1);
    }
  }

  const wantedKeys = new Set(defs.map((d) => d.autoKey));

  const saleAdviseurId =
    wantedKeys.has(REFERRAL_TAK_AUTO_KEY)
      ? await resolveSaleAdviseurId(sb, projectId)
      : null;

  const { data: existing, error } = await sb
    .from("project_taken")
    .select("id, auto_key, status, due_at, verantwoordelijke_id")
    .eq("project_id", projectId)
    .not("auto_key", "is", null);

  if (error) {
    if (
      error.code === "42P01" ||
      error.message?.includes("project_taken") ||
      error.code === "42703"
    ) {
      return;
    }
    console.error("syncAutoTaken load:", error.message);
    return;
  }

  const byKey = new Map<
    string,
    {
      id: string;
      status: string;
      due_at: string | null;
      verantwoordelijke_id: string | null;
    }
  >();
  const duplicateIds: string[] = [];
  for (const row of existing || []) {
    if (!row.auto_key) continue;
    const mapped = {
      id: row.id as string,
      status: row.status as string,
      due_at: (row.due_at as string | null) ?? null,
      verantwoordelijke_id:
        (row.verantwoordelijke_id as string | null) ?? null,
    };
    const prev = byKey.get(row.auto_key);
    if (prev) {
      if (prev.status !== "done" && mapped.status === "done") {
        duplicateIds.push(mapped.id);
      } else {
        duplicateIds.push(prev.id);
        byKey.set(row.auto_key, mapped);
      }
    } else {
      byKey.set(row.auto_key, mapped);
    }
  }

  for (const id of duplicateIds) {
    await sb
      .from("project_taken")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", id);
  }

  for (const row of existing || []) {
    if (!row.auto_key || wantedKeys.has(row.auto_key)) continue;
    if (row.status === "done") continue;
    await sb
      .from("project_taken")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", row.id);
  }

  for (const def of defs) {
    const cur = byKey.get(def.autoKey);
    const dueAt =
      def.dueAt !== undefined ? def.dueAt : dueAtFromDays(def.dueInDays);
    const isReferral = def.autoKey === REFERRAL_TAK_AUTO_KEY;
    const ownerId = await verantwoordelijkeVoorAutoTaak(
      sb,
      project,
      saleAdviseurId,
      isReferral
    );
    if (cur) {
      const patch: Record<string, unknown> = {};
      // Schouwweek-indicatie ≠ echte schouwdag: taak mag niet op done blijven.
      if (def.autoKey === SCHOUWDAG_INPLAN_KEY && cur.status === "done") {
        patch.status = "todo";
        patch.due_at = dueAt;
        patch.titel = def.titel;
      } else if (
        def.autoKey === SCHOUWDAG_INPLAN_KEY &&
        cur.status !== "done" &&
        cur.due_at !== dueAt
      ) {
        patch.due_at = dueAt;
        patch.titel = def.titel;
      } else if (
        def.autoKey.startsWith(OPLEVERING_AUTO_PREFIX) &&
        cur.status !== "done" &&
        dueAt &&
        cur.due_at !== dueAt
      ) {
        patch.due_at = dueAt;
        patch.titel = def.titel;
      } else if (
        def.autoKey === CREDITFACTUUR_KEY &&
        cur.status !== "done"
      ) {
        patch.titel = def.titel;
      }
      if (
        cur.status !== "done" &&
        ownerId &&
        cur.verantwoordelijke_id !== ownerId
      ) {
        patch.verantwoordelijke_id = ownerId;
      }
      if (Object.keys(patch).length > 0) {
        patch.updated_at = new Date().toISOString();
        await sb.from("project_taken").update(patch).eq("id", cur.id);
      }
      continue;
    }
    const insertRow: Record<string, unknown> = {
      project_id: projectId,
      titel: def.titel,
      status: "todo",
      afdeling: def.afdeling,
      categorie: "project",
      due_at: dueAt,
      auto_key: def.autoKey,
      ...(ownerId ? { verantwoordelijke_id: ownerId } : {}),
    };
    const { error: insertErr } = await sb
      .from("project_taken")
      .insert(insertRow);
    if (insertErr && /categorie/i.test(insertErr.message || "")) {
      delete insertRow.categorie;
      await sb.from("project_taken").insert(insertRow);
    }
  }
}
