import type { SupabaseClient } from "@supabase/supabase-js";
import type { OpvolgingAbSettings } from "./types";

const DEFAULT: OpvolgingAbSettings = {
  enabled: false,
  started_at: null,
  updated_at: null,
};

export async function getOpvolgingAbSettings(
  sb: SupabaseClient
): Promise<OpvolgingAbSettings> {
  const { data, error } = await sb
    .from("afspraak_opvolging_ab")
    .select("enabled, started_at, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    // Tabel nog niet gemigreerd → veilig uit
    if (
      error.message?.includes("afspraak_opvolging_ab") ||
      error.code === "42P01" ||
      error.code === "42703"
    ) {
      return DEFAULT;
    }
    console.error("getOpvolgingAbSettings", error.message);
    return DEFAULT;
  }

  if (!data) return DEFAULT;
  return {
    enabled: Boolean(data.enabled),
    started_at: data.started_at ?? null,
    updated_at: data.updated_at ?? null,
  };
}

export async function setOpvolgingAbEnabled(
  sb: SupabaseClient,
  enabled: boolean
): Promise<OpvolgingAbSettings> {
  const now = new Date().toISOString();
  const current = await getOpvolgingAbSettings(sb);
  const patch: Record<string, unknown> = {
    enabled,
    updated_at: now,
  };
  // started_at alleen zetten bij eerste aanzetten (of opnieuw als nog nooit)
  if (enabled && !current.started_at) {
    patch.started_at = now;
  }

  const { data, error } = await sb
    .from("afspraak_opvolging_ab")
    .upsert({ id: 1, ...patch }, { onConflict: "id" })
    .select("enabled, started_at, updated_at")
    .single();

  if (error) throw new Error(error.message);
  return {
    enabled: Boolean(data.enabled),
    started_at: data.started_at ?? null,
    updated_at: data.updated_at ?? null,
  };
}
