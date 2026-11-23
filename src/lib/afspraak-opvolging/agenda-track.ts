/**
 * First-touch tracking voor "Zet in je agenda".
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const AGENDA_PROVIDERS = [
  "google",
  "outlook_live",
  "outlook_office",
  "ics",
] as const;

export type AgendaProvider = (typeof AGENDA_PROVIDERS)[number];

export function isAgendaProvider(v: unknown): v is AgendaProvider {
  return (
    typeof v === "string" &&
    (AGENDA_PROVIDERS as readonly string[]).includes(v)
  );
}

type AfspraakTrackRow = {
  id: string;
  agenda_link_opened_at?: string | null;
  agenda_added_at?: string | null;
  agenda_provider?: string | null;
};

export async function trackAgendaOpen(
  sb: SupabaseClient,
  afspraakId: string,
  current?: Pick<AfspraakTrackRow, "agenda_link_opened_at"> | null
): Promise<boolean> {
  if (current?.agenda_link_opened_at) return false;
  const { error } = await sb
    .from("afspraken")
    .update({ agenda_link_opened_at: new Date().toISOString() })
    .eq("id", afspraakId)
    .is("agenda_link_opened_at", null);
  if (error) {
    if (
      error.message?.includes("agenda_link_opened_at") ||
      error.code === "42703" ||
      error.code === "PGRST204"
    ) {
      return false;
    }
    throw new Error(error.message);
  }
  return true;
}

export async function trackAgendaAdd(
  sb: SupabaseClient,
  afspraakId: string,
  provider: AgendaProvider,
  current?: Pick<
    AfspraakTrackRow,
    "agenda_added_at" | "agenda_provider"
  > | null
): Promise<boolean> {
  if (current?.agenda_added_at) return false;
  const { error } = await sb
    .from("afspraken")
    .update({
      agenda_added_at: new Date().toISOString(),
      agenda_provider: provider,
    })
    .eq("id", afspraakId)
    .is("agenda_added_at", null);
  if (error) {
    if (
      error.message?.includes("agenda_added_at") ||
      error.message?.includes("agenda_provider") ||
      error.code === "42703" ||
      error.code === "PGRST204"
    ) {
      return false;
    }
    throw new Error(error.message);
  }
  return true;
}
