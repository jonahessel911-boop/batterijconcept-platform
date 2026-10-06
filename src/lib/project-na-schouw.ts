/**
 * Na schouwformulier-upload: status doorzetten.
 * - Nog openstaande facturen → Schouw voltooid (backoffice checkt Financieel)
 * - Alles betaald → Restfactuur betaald (= klaar om materiaal in te kopen)
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isAanbetalingFactuurOmschrijving,
  isRestantFactuurOmschrijving,
  nogTeFacturerenRestant,
} from "@/lib/aanbetaling";
import { isWarmtefondsSale } from "@/lib/backoffice-acties";
import { isSchouwFormulier } from "@/lib/project-documenten";
import { toOperationalStatus } from "@/lib/project-status-config";
import type { ProjectStatus } from "@/types/database";

type FactuurRow = {
  status: string;
  bedrag_inc_btw: number | null;
  omschrijving?: string | null;
  credit_van_factuur_id?: string | null;
};

const PIPELINE_RANK: Record<string, number> = {
  schouwweek_inplannen: 1,
  aanbetaling_verstuurd: 2,
  aanbetaling_betaald: 3,
  schouwdag_ingepland: 4,
  schouw_voltooid: 5,
  restfactuur_verstuurd: 6,
  restfactuur_betaald: 7,
  materiaal_besteld: 8,
  installatie_ingepland: 9,
  installatie_voltooid: 10,
  review_gevraagd: 11,
};

function rank(status: string | null | undefined): number {
  if (!status) return 0;
  const op = toOperationalStatus(status);
  return PIPELINE_RANK[op] ?? PIPELINE_RANK[status] ?? 0;
}

/** Geen openstaande klantfacturen + (WF: iets betaald) of (EM: order gedekt). */
export function isProjectKlaarVoorMateriaalInkopen(opts: {
  facturen: FactuurRow[];
  orderIncBtw?: number | null;
  warmtefonds: boolean;
}): boolean {
  const facs = opts.facturen.filter(
    (f) => !f.credit_van_factuur_id && f.status !== "vervallen"
  );

  const open = facs.filter(
    (f) => f.status === "verzonden" || f.status === "deels_betaald"
  );
  if (open.length > 0) return false;

  const paid = facs.filter((f) => f.status === "betaald");
  if (paid.length === 0) return false;

  if (paid.some((f) => isRestantFactuurOmschrijving(f.omschrijving))) {
    return true;
  }

  if (opts.warmtefonds) {
    // Warmtefonds: klantfacturen (meestal BTW/aanbetaling) betaald, geen open posten
    return paid.some((f) => isAanbetalingFactuurOmschrijving(f.omschrijving))
      ? true
      : paid.length > 0;
  }

  const orderInc = Number(opts.orderIncBtw) || 0;
  if (orderInc <= 0) return true;

  const teFactureren = nogTeFacturerenRestant({
    orderIncBtw: orderInc,
    facturen: facs.map((f) => ({
      status: f.status,
      bedrag_inc_btw: Number(f.bedrag_inc_btw) || 0,
      omschrijving: f.omschrijving,
    })),
  });
  return teFactureren <= 1;
}

export function targetStatusNaSchouw(klaarVoorMateriaal: boolean): ProjectStatus {
  return klaarVoorMateriaal ? "restfactuur_betaald" : "schouw_voltooid";
}

/**
 * Zet projectstatus na schouwformulier / betaling.
 * Gaat nooit achteruit; skip bij annulering / latere fases.
 */
export async function maybeAdvanceProjectNaSchouw(
  sb: SupabaseClient,
  projectId: string
): Promise<{
  advanced: boolean;
  from: string | null;
  to: ProjectStatus | null;
  klaarVoorMateriaal: boolean;
  project?: Record<string, unknown> | null;
}> {
  const { data: project, error } = await sb
    .from("projecten")
    .select(
      "id, status, lead_id, project_nummer, betaalwijze, offerte_id, leads(status), offertes(id, totaal_inc_btw, financiering_voorbehoud)"
    )
    .eq("id", projectId)
    .maybeSingle();

  if (error || !project) {
    return {
      advanced: false,
      from: null,
      to: null,
      klaarVoorMateriaal: false,
    };
  }

  const current = (project.status as string) || "";
  if (current === "annulering" || current === "service") {
    return {
      advanced: false,
      from: current,
      to: null,
      klaarVoorMateriaal: false,
    };
  }

  // Al voorbij materiaal-fase → niets doen
  if (rank(current) >= rank("materiaal_besteld")) {
    return {
      advanced: false,
      from: current,
      to: null,
      klaarVoorMateriaal: true,
    };
  }

  const { data: fotos } = await sb
    .from("project_fotos")
    .select("id, omschrijving")
    .eq("project_id", projectId);

  const hasSchouwForm = (fotos || []).some((f) =>
    isSchouwFormulier(f.omschrijving)
  );
  if (!hasSchouwForm) {
    return {
      advanced: false,
      from: current,
      to: null,
      klaarVoorMateriaal: false,
    };
  }

  const { data: facturen } = await sb
    .from("facturen")
    .select(
      "status, bedrag_inc_btw, omschrijving, credit_van_factuur_id, project_id, offerte_id, lead_id"
    )
    .eq("lead_id", project.lead_id);

  const related = (facturen || []).filter(
    (f) =>
      f.project_id === projectId ||
      (project.offerte_id && f.offerte_id === project.offerte_id) ||
      f.project_id == null
  );

  const lead = Array.isArray(project.leads) ? project.leads[0] : project.leads;
  const off = Array.isArray(project.offertes)
    ? project.offertes[0]
    : project.offertes;

  const warmtefonds =
    project.betaalwijze === "warmtefonds"
      ? true
      : project.betaalwijze === "eigen_middelen"
        ? false
        : isWarmtefondsSale({
            leadStatus: lead?.status,
            financieringVoorbehoud: off?.financiering_voorbehoud,
          });

  const klaar = isProjectKlaarVoorMateriaalInkopen({
    facturen: related,
    orderIncBtw: off?.totaal_inc_btw,
    warmtefonds,
  });

  const target = targetStatusNaSchouw(klaar);

  // restfactuur_verstuurd + nog niet klaar → blijven wachten op betaling
  if (!klaar && rank(current) >= rank("restfactuur_verstuurd")) {
    return {
      advanced: false,
      from: current,
      to: null,
      klaarVoorMateriaal: false,
    };
  }

  if (rank(current) >= rank(target)) {
    return {
      advanced: false,
      from: current,
      to: null,
      klaarVoorMateriaal: klaar,
    };
  }

  const { data: updated, error: updErr } = await sb
    .from("projecten")
    .update({ status: target })
    .eq("id", projectId)
    .select(
      "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, adviseur_id, status), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, totaal_inc_btw, ondertekend_op)"
    )
    .maybeSingle();

  if (updErr || !updated) {
    console.error("maybeAdvanceProjectNaSchouw:", updErr?.message);
    return {
      advanced: false,
      from: current,
      to: null,
      klaarVoorMateriaal: klaar,
    };
  }

  try {
    const { syncAutoTakenVoorProject } = await import("@/lib/sync-auto-taken");
    await syncAutoTakenVoorProject(sb, projectId, target);
  } catch {
    /* best-effort */
  }

  try {
    const { logLeadEvent } = await import("@/lib/lead-events");
    await logLeadEvent({
      leadId: project.lead_id,
      soort: "project",
      titel: klaar
        ? "Status: Restfactuur betaald (materiaal inkopen)"
        : "Status: Schouw voltooid",
      detail: klaar
        ? "Schouwformulier binnen + alles betaald → klaar voor materiaalinkoop"
        : "Schouwformulier binnen — check Financieel (nog niet alles betaald)",
      meta: {
        project_id: projectId,
        project_nummer: project.project_nummer,
        van: current,
        naar: target,
        klaar_voor_materiaal: klaar,
      },
    });
  } catch {
    /* best-effort */
  }

  return {
    advanced: true,
    from: current,
    to: target,
    klaarVoorMateriaal: klaar,
    project: updated as Record<string, unknown>,
  };
}
