/**
 * Reply-To voor klantmails → gekoppelde adviseur.
 * Antwoorden van de klant landen bij de adviseur i.p.v. info@.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export function normalizeReplyToEmail(
  email: string | null | undefined
): string | null {
  const t = (email || "").trim();
  if (!t || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return null;
  return t;
}

/** Optioneel "Naam <email>" voor duidelijkere Reply-To in inboxen. */
export function formatReplyTo(
  email: string | null | undefined,
  naam?: string | null
): string | null {
  const addr = normalizeReplyToEmail(email);
  if (!addr) return null;
  const n = (naam || "").trim().replace(/[<>"]/g, "");
  if (!n) return addr;
  return `${n} <${addr}>`;
}

export function replyToFromAdviseurJoin(
  adviseur:
    | { email?: string | null; naam?: string | null }
    | { email?: string | null; naam?: string | null }[]
    | null
    | undefined
): string | null {
  const a = Array.isArray(adviseur) ? adviseur[0] : adviseur;
  return formatReplyTo(a?.email, a?.naam);
}

async function replyToForAdviseurId(
  sb: SupabaseClient,
  adviseurId: string | null | undefined
): Promise<string | null> {
  if (!adviseurId) return null;
  const { data } = await sb
    .from("adviseurs")
    .select("email, naam")
    .eq("id", adviseurId)
    .maybeSingle();
  return formatReplyTo(data?.email, data?.naam);
}

/** Sales-adviseur gekoppeld aan de lead. */
export async function replyToForLeadAdviseur(
  sb: SupabaseClient,
  leadId: string | null | undefined
): Promise<string | null> {
  if (!leadId) return null;

  const { data } = await sb
    .from("leads")
    .select("adviseur_id, adviseurs!adviseur_id(email, naam)")
    .eq("id", leadId)
    .maybeSingle();

  const fromJoin = replyToFromAdviseurJoin(
    data?.adviseurs as
      | { email?: string | null; naam?: string | null }
      | { email?: string | null; naam?: string | null }[]
      | null
  );
  if (fromJoin) return fromJoin;

  return replyToForAdviseurId(
    sb,
    (data as { adviseur_id?: string | null } | null)?.adviseur_id
  );
}

/**
 * Reply-To voor afspraakmails: eerst afspraak-adviseur, anders lead-adviseur.
 */
export async function replyToForAfspraak(
  sb: SupabaseClient,
  opts: {
    adviseurId?: string | null;
    leadId?: string | null;
    adviseurJoin?:
      | { email?: string | null; naam?: string | null }
      | { email?: string | null; naam?: string | null }[]
      | null;
  }
): Promise<string | null> {
  const fromJoin = replyToFromAdviseurJoin(opts.adviseurJoin);
  if (fromJoin) return fromJoin;

  const fromAfspraak = await replyToForAdviseurId(sb, opts.adviseurId);
  if (fromAfspraak) return fromAfspraak;

  return replyToForLeadAdviseur(sb, opts.leadId);
}
