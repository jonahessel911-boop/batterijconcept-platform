import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Zorgt dat een offerte een track_token heeft (lazy backfill). */
export async function ensureOfferteTrackToken(
  sb: SupabaseClient,
  offerteId: string,
  existing?: string | null
): Promise<string | null> {
  if (existing) return existing;

  const token = randomBytes(24).toString("hex");
  const { data, error } = await sb
    .from("offertes")
    .update({ track_token: token })
    .eq("id", offerteId)
    .is("track_token", null)
    .select("track_token")
    .maybeSingle();

  if (!error && data?.track_token) return data.track_token as string;

  // Race: iemand anders zette hem al
  const { data: again } = await sb
    .from("offertes")
    .select("track_token")
    .eq("id", offerteId)
    .maybeSingle();

  if (again?.track_token) return again.track_token as string;

  // Kolom ontbreekt nog → null (migratie niet gedraaid)
  if (error?.code === "42703" || error?.message?.includes("track_token")) {
    console.warn("track_token kolom ontbreekt — draai migrate-track-token.sql");
    return null;
  }

  // Force set als is-null update niets deed maar token leeg was
  const { data: forced } = await sb
    .from("offertes")
    .update({ track_token: token })
    .eq("id", offerteId)
    .select("track_token")
    .maybeSingle();

  return (forced?.track_token as string | null) || token;
}

