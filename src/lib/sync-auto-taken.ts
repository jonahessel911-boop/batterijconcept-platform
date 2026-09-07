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

const SCHOUWDAG_INPLAN_KEY = "schouwweek:schouwdag_inplannen";

type ProjectSchouwFields = {
  status: string;
  schouw_jaar?: number | null;
  schouw_week?: number | null;
  schouw_at?: string | null;
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

/**
 * Zorgt dat open auto-taken bij de huidige status bestaan.
 * Eerdere open auto-taken die niet meer bij deze status horen → done.
 * Extra: bij geplande schouwweek (zonder exacte dag) taak 1 week eerder
 * om schouwdag + datum in te plannen.
 */
export async function syncAutoTakenVoorProject(
  sb: SupabaseClient,
  projectId: string,
  status: string
): Promise<void> {
  const { data: projectRow } = await sb
    .from("projecten")
    .select("status, schouw_jaar, schouw_week, schouw_at")
    .eq("id", projectId)
    .maybeSingle();

  const project = (projectRow as ProjectSchouwFields | null) || {
    status,
    schouw_jaar: null,
    schouw_week: null,
    schouw_at: null,
  };

  const defs: (AutoTaakDef & { dueAt?: string })[] = autoTakenVoorStatus(
    status
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
  for (const row of existing || []) {
    if (row.auto_key) byKey.set(row.auto_key, row);
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
    const dueAt = def.dueAt || dueAtFromDays(def.dueInDays);
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
