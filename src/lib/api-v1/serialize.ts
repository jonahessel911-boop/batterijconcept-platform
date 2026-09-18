import type { Factuur, Project } from "@/types/database";
import {
  factuurIsOpenstaand,
  factuurIsOverdue,
} from "@/lib/factuur-betaling";
import { round2 } from "@/lib/management-dashboard/periods";

export function serializeFactuur(f: Factuur) {
  const openstaand = factuurIsOpenstaand(f.status);
  const overdue = factuurIsOverdue(f);
  return {
    id: f.id,
    factuur_nummer: f.factuur_nummer,
    status: f.status,
    lead_id: f.lead_id,
    project_id: f.project_id,
    offerte_id: f.offerte_id,
    omschrijving: f.omschrijving,
    bedrag_ex_btw: Number(f.bedrag_ex_btw),
    btw_bedrag: Number(f.btw_bedrag),
    bedrag_inc_btw: Number(f.bedrag_inc_btw),
    factuurdatum: f.factuurdatum,
    vervaldatum: f.vervaldatum,
    betaald_op: f.betaald_op,
    notities: f.notities,
    credit_van_factuur_id: f.credit_van_factuur_id ?? null,
    openstaand,
    overdue,
    openstaand_bedrag: openstaand ? Number(f.bedrag_inc_btw) : 0,
    leads: f.leads
      ? {
          naam: f.leads.naam,
          email: f.leads.email,
          lead_number: f.leads.lead_number,
        }
      : null,
    created_at: f.created_at,
    updated_at: f.updated_at,
  };
}

export function serializeProject(
  p: Project,
  extra?: {
    facturen?: Factuur[];
  }
) {
  const facturen = extra?.facturen || [];
  const open = facturen.filter((f) => factuurIsOpenstaand(f.status));
  const openstaandBedrag = round2(
    open.reduce((s, f) => s + (Number(f.bedrag_inc_btw) || 0), 0)
  );
  const gefactureerd = round2(
    facturen
      .filter((f) => f.status !== "concept" && f.status !== "vervallen")
      .reduce((s, f) => s + (Number(f.bedrag_inc_btw) || 0), 0)
  );
  const betaald = round2(
    facturen
      .filter((f) => f.status === "betaald")
      .reduce((s, f) => s + (Number(f.bedrag_inc_btw) || 0), 0)
  );

  return {
    id: p.id,
    project_nummer: p.project_nummer,
    titel: p.titel,
    status: p.status,
    lead_id: p.lead_id,
    offerte_id: p.offerte_id,
    schouw_jaar: p.schouw_jaar ?? null,
    schouw_week: p.schouw_week ?? null,
    schouw_at: p.schouw_at ?? null,
    schouw_notities: p.schouw_notities ?? null,
    installatie_at: p.installatie_at ?? null,
    installatie_notities: p.installatie_notities ?? null,
    installatie_partner_id: p.installatie_partner_id ?? null,
    bel_schouw_aanbetaling_at: p.bel_schouw_aanbetaling_at ?? null,
    financiering_geschakeld_at: p.financiering_geschakeld_at ?? null,
    created_at: p.created_at,
    updated_at: p.updated_at,
    leads: p.leads
      ? {
          naam: (p.leads as { naam?: string }).naam ?? null,
          lead_number: (p.leads as { lead_number?: string }).lead_number ?? null,
        }
      : null,
    facturen_samenvatting: {
      aantal: facturen.length,
      openstaand_aantal: open.length,
      openstaand_bedrag: openstaandBedrag,
      gefactureerd_bedrag: gefactureerd,
      betaald_bedrag: betaald,
    },
  };
}

export function openstaandFromFacturen(facturen: Factuur[]) {
  const open = facturen.filter((f) => factuurIsOpenstaand(f.status));
  const overdue = open.filter((f) => factuurIsOverdue(f));
  return {
    openstaand_aantal: open.length,
    openstaand_bedrag: round2(
      open.reduce((s, f) => s + (Number(f.bedrag_inc_btw) || 0), 0)
    ),
    overdue_aantal: overdue.length,
    overdue_bedrag: round2(
      overdue.reduce((s, f) => s + (Number(f.bedrag_inc_btw) || 0), 0)
    ),
    facturen: open.map(serializeFactuur),
  };
}
