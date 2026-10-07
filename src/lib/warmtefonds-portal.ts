/**
 * Helpers voor het Warmtefonds-portaal (externe operator, magic token).
 */
import type { FinancieringStatus } from "@/lib/financiering-status";
import {
  FINANCIERING_PIPELINE,
  FINANCIERING_STATUS_LABEL,
  isFinancieringStatus,
} from "@/lib/financiering-status";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WarmtefondsOperator = {
  id: string;
  naam: string;
  email: string;
  telefoon: string | null;
  actief: boolean;
  portal_token: string;
};

export const WF_PORTAL_STATUSES: FinancieringStatus[] = [
  "doorgestuurd_naar_edwin",
  "afspraak_ingepland",
  "aanvraag_gedaan",
  "aanvraag_goedgekeurd",
  "uitbetaald",
  "afgewezen",
];

export function wfPortalStatusLabel(status: string | null | undefined): string {
  if (status && isFinancieringStatus(status)) {
    return FINANCIERING_STATUS_LABEL[status];
  }
  return "Nog niet gestart";
}

export function wfPortalStatusOptions(): {
  value: FinancieringStatus;
  label: string;
}[] {
  return [
    ...FINANCIERING_PIPELINE.map((s) => ({
      value: s,
      label: FINANCIERING_STATUS_LABEL[s],
    })),
    { value: "afgewezen", label: FINANCIERING_STATUS_LABEL.afgewezen },
  ];
}

export async function resolveWarmtefondsOperator(
  sb: SupabaseClient,
  token: string
): Promise<WarmtefondsOperator | null> {
  if (!token || token.length < 16) return null;
  const { data, error } = await sb
    .from("warmtefonds_operators")
    .select("id, naam, email, telefoon, actief, portal_token")
    .eq("portal_token", token)
    .maybeSingle();
  if (error || !data || !data.actief) return null;
  return data as WarmtefondsOperator;
}

/** Projecten die in het Warmtefonds-portaal horen. */
export const WF_PORTAL_PROJECT_SELECT = `
  id, project_nummer, titel, status, betaalwijze, lead_id, offerte_id,
  financiering_status, warmtefonds_afspraak_at, warmtefonds_aangevraagd_at,
  warmtefonds_notities, notities, created_at, updated_at,
  leads(
    id, naam, email, telefoon, lead_number,
    postcode, huisnummer, toevoeging, straat, plaats, notities
  ),
  offertes(id, offerte_nummer, status, ondertekend_op, financiering_voorbehoud)
`;

export function isWarmtefondsPortalProject(row: {
  betaalwijze?: string | null;
  financiering_status?: string | null;
  status?: string | null;
}): boolean {
  if (row.status === "annulering") return false;
  if (row.betaalwijze === "warmtefonds") return true;
  if (row.financiering_status) return true;
  return false;
}
