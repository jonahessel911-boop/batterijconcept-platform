/**
 * Reply-To voor klantmails → altijd info@.
 * Antwoorden landen in de AI-inbox, niet in een persoonlijke mailbox.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const INFO_REPLY_TO = "info@batterijconcept.nl";

export function normalizeReplyToEmail(
  email: string | null | undefined
): string | null {
  const t = (email || "").trim();
  if (!t || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t;
}

/** Alle klantmail: Reply-To is info@, ongeacht de adviseur. */
export function formatReplyTo(
  _email?: string | null,
  _naam?: string | null
): string {
  return INFO_REPLY_TO;
}

export function replyToFromAdviseurJoin(
  _adviseur?:
    | { email?: string | null; naam?: string | null }
    | { email?: string | null; naam?: string | null }[]
    | null
): string {
  return INFO_REPLY_TO;
}

/** Sales-adviseur gekoppeld aan de lead — reply blijft info@. */
export async function replyToForLeadAdviseur(
  _sb: SupabaseClient,
  _leadId: string | null | undefined
): Promise<string> {
  return INFO_REPLY_TO;
}

/**
 * Reply-To voor afspraakmails (huisbezoek, herinnering, verzetten).
 * Altijd info@, zodat het antwoord in de inbox binnenkomt.
 */
export async function replyToForAfspraak(
  _sb: SupabaseClient,
  _opts?: {
    adviseurId?: string | null;
    leadId?: string | null;
    adviseurJoin?:
      | { email?: string | null; naam?: string | null }
      | { email?: string | null; naam?: string | null }[]
      | null;
  }
): Promise<string> {
  return INFO_REPLY_TO;
}
