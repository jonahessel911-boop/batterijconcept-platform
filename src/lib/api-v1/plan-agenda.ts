/**
 * Project-agenda plannen via API type-codes (schouw / installatie).
 * Hergebruikt dezelfde DB-velden als /api/projecten/[id]/schouw|installatie.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isValidSchouwWeek,
  schouwWeekFromDate,
  schouwWeekToMondayIso,
} from "@/lib/schouw-week";
import { parseAfspraakStartAt } from "@/lib/plan-afspraak";
import type { AgendaTypeCode } from "./agenda-types";

export type PlanAgendaInput = {
  type: AgendaTypeCode;
  project_id: string;
  /** Type 1: ISO-jaar */
  schouw_jaar?: number;
  /** Type 1: ISO-week */
  schouw_week?: number;
  /** Type 2: exacte schouw datetime (Amsterdam of ISO) */
  start_at?: string;
  schouw_at?: string;
  /** Type 3: installatie datetime */
  installatie_at?: string;
  installatie_partner_id?: string | null;
  notities?: string | null;
};

export type PlanAgendaResult =
  | { ok: true; project: Record<string, unknown>; agenda: Record<string, unknown> }
  | { ok: false; status: number; error: string; detail?: string };

async function loadProject(sb: SupabaseClient, id: string) {
  const { data, error } = await sb
    .from("projecten")
    .select(
      "id, project_nummer, status, lead_id, schouw_jaar, schouw_week, schouw_at, installatie_at, installatie_partner_id, schouw_notities, installatie_notities"
    )
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: error.message, project: null };
  return { error: null, project: data };
}

async function resolvePartner(
  sb: SupabaseClient,
  preferred: string | null | undefined,
  existing: string | null | undefined
): Promise<string | null> {
  if (preferred) return preferred;
  if (existing) return existing;
  const { data } = await sb
    .from("installatie_partners")
    .select("id")
    .eq("actief", true)
    .limit(2);
  if (data?.length === 1) return data[0]!.id;
  return null;
}

export async function planProjectAgenda(
  sb: SupabaseClient,
  input: PlanAgendaInput
): Promise<PlanAgendaResult> {
  const loaded = await loadProject(sb, input.project_id);
  if (loaded.error) {
    return { ok: false, status: 500, error: "Project laden mislukt", detail: loaded.error };
  }
  if (!loaded.project) {
    return { ok: false, status: 404, error: "Project niet gevonden" };
  }
  const project = loaded.project;

  if (input.type === 1 || input.type === 2) {
    let schouwJaar = input.schouw_jaar;
    let schouwWeek = input.schouw_week;
    let exactAt: string | null = null;

    if (input.type === 2) {
      const raw = input.schouw_at || input.start_at;
      if (!raw) {
        return {
          ok: false,
          status: 400,
          error: "type=2 vereist schouw_at of start_at (datetime)",
        };
      }
      const parsed = parseAfspraakStartAt(raw) || new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, status: 400, error: "Ongeldige schouw_at / start_at" };
      }
      exactAt = parsed.toISOString();
      const derived = schouwWeekFromDate(parsed);
      schouwJaar = derived.jaar;
      schouwWeek = derived.week;
    } else {
      if (schouwJaar == null || schouwWeek == null) {
        return {
          ok: false,
          status: 400,
          error: "type=1 vereist schouw_jaar + schouw_week",
        };
      }
      if (!isValidSchouwWeek(schouwJaar, schouwWeek)) {
        return { ok: false, status: 400, error: "Ongeldige schouwweek" };
      }
      try {
        exactAt = schouwWeekToMondayIso(schouwJaar, schouwWeek);
      } catch {
        return { ok: false, status: 400, error: "Ongeldige schouwweek" };
      }
    }

    const partnerId = await resolvePartner(
      sb,
      input.installatie_partner_id,
      project.installatie_partner_id
    );

    const patch: Record<string, unknown> = {
      schouw_jaar: schouwJaar,
      schouw_week: schouwWeek,
      schouw_at: exactAt,
      status: "schouwdag_ingepland",
      updated_at: new Date().toISOString(),
    };
    if (input.notities !== undefined) {
      patch.schouw_notities = input.notities?.trim() || null;
    }
    if (partnerId) patch.installatie_partner_id = partnerId;

    const { data: updated, error } = await sb
      .from("projecten")
      .update(patch)
      .eq("id", project.id)
      .select(
        "id, project_nummer, status, schouw_jaar, schouw_week, schouw_at, schouw_notities, installatie_partner_id, installatie_at"
      )
      .single();

    if (error || !updated) {
      return {
        ok: false,
        status: 500,
        error: "Schouw plannen mislukt",
        detail: error?.message,
      };
    }

    return {
      ok: true,
      project: updated,
      agenda: {
        type: input.type,
        kind: input.type === 1 ? "schouwweek" : "schouwdag",
        schouw_jaar: updated.schouw_jaar,
        schouw_week: updated.schouw_week,
        schouw_at: updated.schouw_at,
        note:
          input.type === 1
            ? "Week gepland (maandag 12:00 placeholder tot dag/tijd bekend is)"
            : "Exacte schouwdag/tijd gepland",
      },
    };
  }

  // type 3 — installatie
  const raw = input.installatie_at || input.start_at;
  if (!raw) {
    return {
      ok: false,
      status: 400,
      error: "type=3 vereist installatie_at of start_at",
    };
  }
  const parsed = parseAfspraakStartAt(raw) || new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, status: 400, error: "Ongeldige installatie_at" };
  }

  const partnerId = await resolvePartner(
    sb,
    input.installatie_partner_id,
    project.installatie_partner_id
  );
  if (!partnerId) {
    return {
      ok: false,
      status: 400,
      error:
        "installatie_partner_id is verplicht (of koppel eerst een partner aan het project)",
    };
  }

  const patch: Record<string, unknown> = {
    installatie_at: parsed.toISOString(),
    installatie_partner_id: partnerId,
    status: "installatie_ingepland",
    updated_at: new Date().toISOString(),
  };
  if (input.notities !== undefined) {
    patch.installatie_notities = input.notities?.trim() || null;
  }

  const { data: updated, error } = await sb
    .from("projecten")
    .update(patch)
    .eq("id", project.id)
    .select(
      "id, project_nummer, status, schouw_jaar, schouw_week, schouw_at, installatie_at, installatie_notities, installatie_partner_id"
    )
    .single();

  if (error || !updated) {
    return {
      ok: false,
      status: 500,
      error: "Installatie plannen mislukt",
      detail: error?.message,
    };
  }

  return {
    ok: true,
    project: updated,
    agenda: {
      type: 3,
      kind: "installatie",
      installatie_at: updated.installatie_at,
      installatie_partner_id: updated.installatie_partner_id,
    },
  };
}
