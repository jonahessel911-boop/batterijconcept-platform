import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_COCKPIT_SETTINGS,
  parseCockpitSettings,
  type CockpitSettings,
} from "@/lib/sales-cockpit/settings";

export type StorageState = { ok: boolean; missing: string[] };

function missing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message || "";
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    msg.includes("sales_cockpit_") ||
    msg.includes("schema cache")
  );
}

export type TargetRow = {
  id: string;
  adviseur_id: string;
  week_key: string;
  gelopen_target: number | null;
  deals_target: number | null;
  conversie_target: number | null;
  verbeterafspraak: string | null;
  version: number;
  created_at: string;
  created_by_naam: string | null;
};

export type ActionRow = {
  id: string;
  signal_key: string;
  adviseur_id: string | null;
  soort: string;
  status: string;
  titel: string;
  observatie: string | null;
  kpi: string | null;
  uitgangswaarde: string | null;
  gewenste_verbetering: string | null;
  actie: string | null;
  verantwoordelijke: string | null;
  aandacht: string | null;
  evaluatie_op: string | null;
  uitgesteld_tot: string | null;
  resultaat: string | null;
  omstandigheden: string | null;
  oorzaak_buiten_sales: string | null;
  prioriteit: number | null;
  toelichting: string | null;
  version: number;
  updated_at: string;
};

export function expectedVersionConflict(latest: number | null, expected: number | null): boolean {
  const have = latest ?? 0;
  const seen = expected ?? 0;
  return have !== seen;
}

export async function readSettings(
  sb: SupabaseClient
): Promise<{ settings: CockpitSettings; version: number; updatedAt: string | null; missing: boolean }> {
  const { data, error } = await sb
    .from("sales_cockpit_settings")
    .select("waarden, version, updated_at")
    .eq("id", "default")
    .maybeSingle();
  if (missing(error)) {
    return { settings: DEFAULT_COCKPIT_SETTINGS, version: 0, updatedAt: null, missing: true };
  }
  if (error) throw error;
  return {
    settings: parseCockpitSettings(data?.waarden),
    version: Number(data?.version) || 0,
    updatedAt: (data?.updated_at as string) || null,
    missing: false,
  };
}

export async function writeSettings(
  sb: SupabaseClient,
  opts: { waarden: CockpitSettings; expectedVersion: number; actorId: string }
): Promise<{ ok: true; version: number } | { ok: false; conflict: true; version: number }> {
  const current = await readSettings(sb);
  if (current.missing) throw new Error("Cockpit-opslag is nog niet geïnstalleerd");
  if (expectedVersionConflict(current.version, opts.expectedVersion)) {
    return { ok: false, conflict: true, version: current.version };
  }
  const version = current.version + 1;
  const row = {
    id: "default",
    waarden: opts.waarden,
    version,
    updated_at: new Date().toISOString(),
    updated_by: opts.actorId,
  };
  const { error } = current.version === 0
    ? await sb.from("sales_cockpit_settings").insert(row)
    : await sb.from("sales_cockpit_settings").update(row).eq("id", "default").eq("version", current.version);
  if (error) throw error;
  return { ok: true, version };
}

export async function readTargets(sb: SupabaseClient, weekKey: string): Promise<{ rows: TargetRow[]; missing: boolean }> {
  const { data, error } = await sb
    .from("sales_cockpit_week_targets")
    .select(
      "id, adviseur_id, week_key, gelopen_target, deals_target, conversie_target, verbeterafspraak, version, created_at, created_by_naam"
    )
    .eq("week_key", weekKey)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (missing(error)) return { rows: [], missing: true };
  if (error) throw error;
  return { rows: (data || []) as TargetRow[], missing: false };
}

export function latestTargets(rows: TargetRow[]): TargetRow[] {
  const seen = new Set<string>();
  const out: TargetRow[] = [];
  for (const row of rows) {
    if (seen.has(row.adviseur_id)) continue;
    seen.add(row.adviseur_id);
    out.push(row);
  }
  return out;
}

export async function appendTarget(
  sb: SupabaseClient,
  opts: {
    adviseurId: string;
    weekKey: string;
    gelopen: number | null;
    deals: number | null;
    conversie: number | null;
    verbeterafspraak: string | null;
    expectedVersion: number;
    actorId: string;
    actorNaam: string;
  }
): Promise<{ ok: true; version: number } | { ok: false; conflict: true; version: number }> {
  const { rows, missing: gone } = await readTargets(sb, opts.weekKey);
  if (gone) throw new Error("Cockpit-opslag is nog niet geïnstalleerd");
  const latest = latestTargets(rows).find((r) => r.adviseur_id === opts.adviseurId) || null;
  const have = latest?.version ?? 0;
  if (expectedVersionConflict(have, opts.expectedVersion)) {
    return { ok: false, conflict: true, version: have };
  }
  const version = have + 1;
  const { error } = await sb.from("sales_cockpit_week_targets").insert({
    adviseur_id: opts.adviseurId,
    week_key: opts.weekKey,
    gelopen_target: opts.gelopen,
    deals_target: opts.deals,
    conversie_target: opts.conversie,
    verbeterafspraak: opts.verbeterafspraak,
    version,
    created_by: opts.actorId,
    created_by_naam: opts.actorNaam,
  });
  if (error) throw error;
  return { ok: true, version };
}

export async function readActions(sb: SupabaseClient): Promise<{ rows: ActionRow[]; missing: boolean }> {
  const { data, error } = await sb
    .from("sales_cockpit_actions")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (missing(error)) return { rows: [], missing: true };
  if (error) throw error;
  return { rows: (data || []) as ActionRow[], missing: false };
}

export async function saveAction(
  sb: SupabaseClient,
  patch: Partial<ActionRow> & { signal_key: string; expectedVersion: number; actorId: string }
): Promise<{ ok: true; version: number } | { ok: false; conflict: true; version: number }> {
  const { data, error } = await sb
    .from("sales_cockpit_actions")
    .select("id, version")
    .eq("signal_key", patch.signal_key)
    .maybeSingle();
  if (missing(error)) throw new Error("Cockpit-opslag is nog niet geïnstalleerd");
  if (error) throw error;
  const have = data ? Number(data.version) || 1 : 0;
  if (expectedVersionConflict(have, patch.expectedVersion)) {
    return { ok: false, conflict: true, version: have };
  }
  const version = have + 1;
  const row = {
    signal_key: patch.signal_key,
    adviseur_id: patch.adviseur_id ?? null,
    soort: patch.soort || "onderzoek",
    status: patch.status || "nieuw",
    titel: patch.titel || "Actie",
    observatie: patch.observatie ?? null,
    kpi: patch.kpi ?? null,
    uitgangswaarde: patch.uitgangswaarde ?? null,
    gewenste_verbetering: patch.gewenste_verbetering ?? null,
    actie: patch.actie ?? null,
    verantwoordelijke: patch.verantwoordelijke ?? null,
    aandacht: patch.aandacht ?? null,
    evaluatie_op: patch.evaluatie_op ?? null,
    uitgesteld_tot: patch.uitgesteld_tot ?? null,
    resultaat: patch.resultaat ?? null,
    omstandigheden: patch.omstandigheden ?? null,
    oorzaak_buiten_sales: patch.oorzaak_buiten_sales ?? null,
    prioriteit: patch.prioriteit ?? null,
    toelichting: patch.toelichting ?? null,
    version,
    updated_at: new Date().toISOString(),
    updated_by: patch.actorId,
  };
  const write = data
    ? await sb.from("sales_cockpit_actions").update(row).eq("id", data.id).eq("version", have)
    : await sb.from("sales_cockpit_actions").insert(row);
  if (write.error) throw write.error;
  return { ok: true, version };
}
