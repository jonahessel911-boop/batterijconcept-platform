import type { SupabaseClient } from "@supabase/supabase-js";

const FACTUUR_WITH_CREDIT =
  "*, credit_van:facturen!credit_van_factuur_id(id, factuur_nummer)";

const FACTUUR_WITH_CREDIT_AND_LEAD =
  "*, leads(naam, email, telefoon, lead_number, straat, huisnummer, toevoeging, postcode, plaats), credit_van:facturen!credit_van_factuur_id(id, factuur_nummer)";

function isMissingCreditColumn(message?: string, code?: string): boolean {
  if (code === "42703") return true;
  if (!message) return false;
  return (
    message.includes("credit_van_factuur_id") ||
    message.includes("relationship") ||
    message.includes("schema cache")
  );
}

/** Select facturen met credit-join; valt terug zonder join als migratie ontbreekt. */
export async function selectProjectFacturen(
  sb: SupabaseClient,
  projectId: string
) {
  const withCredit = await sb
    .from("facturen")
    .select(FACTUUR_WITH_CREDIT)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (!withCredit.error) {
    return { data: withCredit.data || [], creditSupported: true as const };
  }

  if (!isMissingCreditColumn(withCredit.error.message, withCredit.error.code)) {
    return { data: null, error: withCredit.error, creditSupported: false as const };
  }

  const plain = await sb
    .from("facturen")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (plain.error) {
    return { data: null, error: plain.error, creditSupported: false as const };
  }

  return {
    data: plain.data || [],
    creditSupported: false as const,
    warning: "Voer supabase/migrate-factuur-credit.sql uit voor creditfacturen.",
  };
}

export async function selectFactuurById(sb: SupabaseClient, id: string) {
  const withCredit = await sb
    .from("facturen")
    .select(FACTUUR_WITH_CREDIT_AND_LEAD)
    .eq("id", id)
    .single();

  if (!withCredit.error && withCredit.data) {
    return { data: withCredit.data, creditSupported: true as const };
  }

  if (
    withCredit.error &&
    !isMissingCreditColumn(withCredit.error.message, withCredit.error.code)
  ) {
    return { data: null, error: withCredit.error };
  }

  const plain = await sb
    .from("facturen")
    .select(
      "*, leads(naam, email, telefoon, lead_number, straat, huisnummer, toevoeging, postcode, plaats)"
    )
    .eq("id", id)
    .single();

  if (plain.error || !plain.data) {
    return { data: null, error: plain.error };
  }

  return { data: plain.data, creditSupported: false as const };
}

export { isMissingCreditColumn };
