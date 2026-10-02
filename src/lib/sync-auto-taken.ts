import type { SupabaseClient } from "@supabase/supabase-js";
import {
  autoTakenVoorStatus,
  dueAtFromDays,
  type AutoTaakDef,
} from "@/lib/project-taken";
import {
  dueAtVoorSchouwdagInplan,
  isSchouwdagDefinitief,
  schouwWeekFromDate,
} from "@/lib/schouw-week";
import {
  remapLegacyProjectStatus,
  resolveBetaalwijze,
  type Betaalwijze,
} from "@/lib/project-status-config";

const SCHOUWDAG_INPLAN_KEY = "schouwweek:schouwdag_inplannen";
const CREDITFACTUUR_KEY = "annulering:creditfactuur";

/** Facturen waarvoor bij annulering een credit-actie nodig is. */
const CREDIT_ELIGIBLE_STATUSES = [
  "verzonden",
  "deels_betaald",
  "betaald",
] as const;

type ProjectSchouwFields = {
  status: string;
  betaalwijze?: string | null;
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  schouw_at?: string | null;
  installatie_at?: string | null;
  leads?: { status?: string | null } | { status?: string | null }[] | null;
  offertes?: {
    financiering_voorbehoud?: boolean | null;
  } | null;
};

function schouwWeekOf(project: ProjectSchouwFields): {
  jaar: number;
  week: number;
} | null {
  if (project.schouw_jaar && project.schouw_week) {
    return { jaar: project.schouw_jaar, week: project.schouw_week };
  }
  if (project.schouw_at) {
    return schouwWeekFromDate(project.schouw_at);
  }
  return null;
}

function leadStatusOf(project: ProjectSchouwFields): string | null {
  const l = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  return l?.status ?? null;
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
 */
export async function syncAutoTakenVoorProject(
  sb: SupabaseClient,
  projectId: string,
  status: string
): Promise<void> {
  const { data: projectRow } = await sb
    .from("projecten")
    .select(
      "status, betaalwijze, schouw_jaar, schouw_week, schouw_at, installatie_at, leads(status), offertes(financiering_voorbehoud)"
    )
    .eq("id", projectId)
    .maybeSingle();

  const project = (projectRow as ProjectSchouwFields | null) || {
    status,
    betaalwijze: null,
    schouw_jaar: null,
    schouw_week: null,
    schouw_at: null,
    installatie_at: null,
  };

  const betaalwijze = betaalwijzeOf(project);
  const defs: (AutoTaakDef & { dueAt?: string | null })[] = autoTakenVoorStatus(
    status,
    betaalwijze,
    {
      schouwAt: project.schouw_at,
      installatieAt: project.installatie_at,
    }
  ).map((d) => ({ ...d }));

  const week = schouwWeekOf(project);
  if (week && !isSchouwdagDefinitief(project)) {
    defs.push({
      autoKey: SCHOUWDAG_INPLAN_KEY,
      titel: `Schouwdag + schouwdatum inplannen (week ${week.week})`,
      afdeling: "Planning",
      dueInDays: 0,
      dueAt: dueAtVoorSchouwdagInplan(week.jaar, week.week),
    });
  }

  const statusKey = remapLegacyProjectStatus(status);
  if (statusKey === "annulering") {
    const creditTaak = await creditfactuurTaakBijAnnulering(sb, projectId);
    if (creditTaak) defs.push(creditTaak);
  }

  const wantedKeys = new Set(defs.map((d) => d.autoKey));

  const { data: existing, error } = await sb
    .from("project_taken")
    .select("id, auto_key, status, due_at")
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
    { id: string; status: string; due_at: string | null }
  >();
  const duplicateIds: string[] = [];
  for (const row of existing || []) {
    if (!row.auto_key) continue;
    const prev = byKey.get(row.auto_key);
    if (prev) {
      if (prev.status !== "done" && row.status === "done") {
        duplicateIds.push(row.id);
      } else {
        duplicateIds.push(prev.id);
        byKey.set(row.auto_key, row);
      }
    } else {
      byKey.set(row.auto_key, row);
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
    if (cur) {
      if (
        def.autoKey === SCHOUWDAG_INPLAN_KEY &&
        cur.status !== "done" &&
        cur.due_at !== dueAt
      ) {
        await sb
          .from("project_taken")
          .update({
            due_at: dueAt,
            titel: def.titel,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cur.id);
      } else if (
        def.autoKey === CREDITFACTUUR_KEY &&
        cur.status !== "done"
      ) {
        await sb
          .from("project_taken")
          .update({
            titel: def.titel,
            updated_at: new Date().toISOString(),
          })
          .eq("id", cur.id);
      }
      continue;
    }
    await sb.from("project_taken").insert({
      project_id: projectId,
      titel: def.titel,
      status: "todo",
      afdeling: def.afdeling,
      due_at: dueAt,
      auto_key: def.autoKey,
    });
  }
}
