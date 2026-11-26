import type { SupabaseClient } from "@supabase/supabase-js";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import { isProjectHoldSales } from "@/lib/backoffice-acties";
import { isUitgeslotenVanSalesCommissie } from "@/lib/rollen";

export type AanbetalingNaCreditRij = {
  factuurId: string;
  factuurNummer: string;
  creditFactuurNummer: string | null;
  gecrediteerdFactuurNummer: string;
  projectId: string | null;
  projectNummer: string | null;
  projectStatus: string | null;
  leadId: string | null;
  klantNaam: string | null;
  adviseurId: string | null;
  adviseurNaam: string | null;
  betaaldOp: string;
  bedragInc: number;
  reden: "origineel_betaald_daarna_credit" | "vervangende_aanbetaling_betaald";
  /** Klant-credit administratief afgehandeld (status betaald). */
  terugbetaald: boolean;
  /** Mag een verkoper-concept krijgen. */
  kanUitbetalen: boolean;
  alUitbetaaldAanAdviseur: boolean;
};

type FacRow = {
  id: string;
  factuur_nummer: string | null;
  project_id: string | null;
  lead_id: string | null;
  offerte_id: string | null;
  status: string | null;
  omschrijving: string | null;
  betaald_op: string | null;
  bedrag_inc_btw: number | string | null;
  credit_van_factuur_id: string | null;
  bunq_payment_id?: number | null;
};

function isBetaaldAanbetaling(f: FacRow): boolean {
  if (!isAanbetalingFactuurOmschrijving(f.omschrijving)) return false;
  if (f.credit_van_factuur_id) return false;
  if (f.status === "betaald" && f.betaald_op) return true;
  return Boolean(f.bunq_payment_id && f.betaald_op);
}

/**
 * Aanbetalingen die gecrediteerd zijn, maar waar wél geld binnen is
 * (origineel betaald of later een nieuwe aanbetaling) en nog geen
 * verkoper-uitbetaling op hangt.
 */
export async function listAanbetalingNaCreditUitbetaling(
  sb: SupabaseClient
): Promise<AanbetalingNaCreditRij[]> {
  const { data: credits, error: cErr } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, credit_van_factuur_id, status, betaald_op, created_at"
    )
    .not("credit_van_factuur_id", "is", null)
    .limit(2000);
  if (cErr) throw cErr;

  const parentIds = [
    ...new Set(
      (credits || [])
        .map((c) => c.credit_van_factuur_id as string)
        .filter(Boolean)
    ),
  ];
  if (parentIds.length === 0) return [];

  const { data: parents, error: pErr } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, project_id, lead_id, offerte_id, status, omschrijving, betaald_op, bedrag_inc_btw, credit_van_factuur_id, bunq_payment_id"
    )
    .in("id", parentIds);
  if (pErr) {
    const retry = await sb
      .from("facturen")
      .select(
        "id, factuur_nummer, project_id, lead_id, offerte_id, status, omschrijving, betaald_op, bedrag_inc_btw, credit_van_factuur_id"
      )
      .in("id", parentIds);
    if (retry.error) throw retry.error;
    return listFromRows(
      sb,
      (retry.data || []) as FacRow[],
      (credits || []) as CreditRow[]
    );
  }

  return listFromRows(
    sb,
    (parents || []) as FacRow[],
    (credits || []) as CreditRow[]
  );
}

type CreditRow = {
  factuur_nummer: string | null;
  credit_van_factuur_id: string;
  status: string | null;
  betaald_op?: string | null;
};

async function listFromRows(
  sb: SupabaseClient,
  parents: FacRow[],
  credits: CreditRow[]
): Promise<AanbetalingNaCreditRij[]> {
  const aanbetalingParents = parents.filter((p) =>
    isAanbetalingFactuurOmschrijving(p.omschrijving)
  );
  if (aanbetalingParents.length === 0) return [];

  const creditNrByParent = new Map<string, string[]>();
  const creditTerugbetaald = new Set<string>();
  for (const c of credits) {
    if (!c.credit_van_factuur_id) continue;
    const nrs = creditNrByParent.get(c.credit_van_factuur_id) || [];
    if (c.factuur_nummer && !nrs.includes(c.factuur_nummer)) {
      nrs.push(c.factuur_nummer);
    }
    creditNrByParent.set(c.credit_van_factuur_id, nrs);
    if (c.status === "betaald" && c.betaald_op) {
      creditTerugbetaald.add(c.credit_van_factuur_id);
    }
  }

  const leadIds = [
    ...new Set(
      aanbetalingParents.map((p) => p.lead_id).filter((x): x is string => Boolean(x))
    ),
  ];
  const projectIds = [
    ...new Set(
      aanbetalingParents
        .map((p) => p.project_id)
        .filter((x): x is string => Boolean(x))
    ),
  ];

  let siblings: FacRow[] = [];
  if (leadIds.length) {
    const sib = await sb
      .from("facturen")
      .select(
        "id, factuur_nummer, project_id, lead_id, offerte_id, status, omschrijving, betaald_op, bedrag_inc_btw, credit_van_factuur_id, bunq_payment_id"
      )
      .in("lead_id", leadIds)
      .is("credit_van_factuur_id", null)
      .limit(2000);
    if (
      sib.error &&
      (sib.error.code === "42703" ||
        sib.error.message?.includes("bunq_payment_id"))
    ) {
      const retry = await sb
        .from("facturen")
        .select(
          "id, factuur_nummer, project_id, lead_id, offerte_id, status, omschrijving, betaald_op, bedrag_inc_btw, credit_van_factuur_id"
        )
        .in("lead_id", leadIds)
        .is("credit_van_factuur_id", null)
        .limit(2000);
      siblings = (retry.data || []) as FacRow[];
    } else if (sib.error) {
      throw sib.error;
    } else {
      siblings = (sib.data || []) as FacRow[];
    }
  }

  const siblingByLead = new Map<string, FacRow[]>();
  const siblingByProject = new Map<string, FacRow[]>();
  for (const s of siblings) {
    if (s.lead_id) {
      const list = siblingByLead.get(s.lead_id) || [];
      list.push(s);
      siblingByLead.set(s.lead_id, list);
    }
    if (s.project_id) {
      const list = siblingByProject.get(s.project_id) || [];
      list.push(s);
      siblingByProject.set(s.project_id, list);
    }
  }

  const candidateIds: string[] = [];
  type Draft = {
    parent: FacRow;
    target: FacRow;
    reden: AanbetalingNaCreditRij["reden"];
  };
  const drafts: Draft[] = [];

  for (const parent of aanbetalingParents) {
    const related = [
      ...(parent.lead_id ? siblingByLead.get(parent.lead_id) || [] : []),
      ...(parent.project_id
        ? siblingByProject.get(parent.project_id) || []
        : []),
    ].filter((s, i, arr) => arr.findIndex((x) => x.id === s.id) === i);

    const paidReplacement = related.find(
      (s) => s.id !== parent.id && isBetaaldAanbetaling(s)
    );
    const parentPaid = isBetaaldAanbetaling(parent);

    if (!parentPaid && !paidReplacement) continue;

    const target = parentPaid ? parent : paidReplacement!;
    drafts.push({
      parent,
      target,
      reden: parentPaid
        ? "origineel_betaald_daarna_credit"
        : "vervangende_aanbetaling_betaald",
    });
    candidateIds.push(parent.id, target.id, ...related.map((r) => r.id));
  }

  const uniqueCandidateIds = [...new Set(candidateIds)];
  const { data: regels } = uniqueCandidateIds.length
    ? await sb
        .from("adviseur_creditfactuur_regels")
        .select(
          "factuur_id, creditfactuur_id, adviseur_creditfacturen(id, status)"
        )
        .in("factuur_id", uniqueCandidateIds)
    : { data: [] as unknown[] };

  const paidOutFactuurIds = new Set<string>();
  for (const r of regels || []) {
    const row = r as {
      factuur_id: string;
      adviseur_creditfacturen?:
        | { status?: string | null }
        | { status?: string | null }[]
        | null;
    };
    const cf = Array.isArray(row.adviseur_creditfacturen)
      ? row.adviseur_creditfacturen[0]
      : row.adviseur_creditfacturen;
    if (cf?.status === "geannuleerd") continue;
    paidOutFactuurIds.add(row.factuur_id);
  }

  const [{ data: leads }, { data: projects }] = await Promise.all([
    leadIds.length
      ? sb.from("leads").select("id, naam, adviseur_id").in("id", leadIds)
      : Promise.resolve({ data: [] as unknown[] }),
    (leadIds.length || projectIds.length)
      ? sb
          .from("projecten")
          .select("id, project_nummer, lead_id, offerte_id, status")
          .or(
            [
              leadIds.length ? `lead_id.in.(${leadIds.join(",")})` : "",
              projectIds.length ? `id.in.(${projectIds.join(",")})` : "",
            ]
              .filter(Boolean)
              .join(",")
          )
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const leadById = new Map(
    ((leads || []) as { id: string; naam: string | null; adviseur_id: string | null }[]).map(
      (l) => [l.id, l]
    )
  );
  const projectRows = (projects || []) as {
    id: string;
    project_nummer: string | null;
    lead_id: string | null;
    offerte_id: string | null;
    status: string | null;
  }[];

  const blockedLead = new Set<string>();
  const blockedOfferte = new Set<string>();
  const blockedProject = new Set<string>();
  for (const p of projectRows) {
    // HOLD: geen uitbetaling. Annulering ná ontvangen aanbetaling wél tonen.
    if (!isProjectHoldSales(p)) continue;
    if (p.lead_id) blockedLead.add(p.lead_id);
    if (p.offerte_id) blockedOfferte.add(p.offerte_id);
    blockedProject.add(p.id);
  }

  const advIds = [
    ...new Set(
      [...leadById.values()]
        .map((l) => l.adviseur_id)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const { data: adviseurs } = advIds.length
    ? await sb.from("adviseurs").select("id, naam, rol").in("id", advIds)
    : { data: [] as unknown[] };
  const advById = new Map(
    ((adviseurs || []) as { id: string; naam: string; rol: string | null }[]).map(
      (a) => [a.id, a]
    )
  );

  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const out: AanbetalingNaCreditRij[] = [];
  const seenTarget = new Set<string>();

  for (const d of drafts) {
    if (seenTarget.has(d.target.id)) continue;

    const clusterIds = [
      d.parent.id,
      d.target.id,
      ...(d.parent.lead_id
        ? (siblingByLead.get(d.parent.lead_id) || []).map((s) => s.id)
        : []),
    ];
    const alUitbetaald = clusterIds.some((id) => paidOutFactuurIds.has(id));
    const hold =
      (d.parent.lead_id && blockedLead.has(d.parent.lead_id)) ||
      (d.parent.offerte_id && blockedOfferte.has(d.parent.offerte_id)) ||
      (d.parent.project_id && blockedProject.has(d.parent.project_id));

    const lead = d.parent.lead_id ? leadById.get(d.parent.lead_id) : null;
    const adv = lead?.adviseur_id ? advById.get(lead.adviseur_id) : null;
    const excluded = Boolean(
      adv && isUitgeslotenVanSalesCommissie(adv)
    );

    const project =
      (d.parent.project_id && projectById.get(d.parent.project_id)) ||
      projectRows.find((p) => p.lead_id && p.lead_id === d.parent.lead_id) ||
      null;

    seenTarget.add(d.target.id);
    if (alUitbetaald) continue;
    out.push({
      factuurId: d.target.id,
      factuurNummer: d.target.factuur_nummer || d.parent.factuur_nummer || "—",
      creditFactuurNummer:
        (creditNrByParent.get(d.parent.id) || []).join(", ") || null,
      gecrediteerdFactuurNummer: d.parent.factuur_nummer || "—",
      projectId: project?.id || d.parent.project_id,
      projectNummer: project?.project_nummer || null,
      projectStatus: project?.status || null,
      leadId: d.parent.lead_id,
      klantNaam: lead?.naam || null,
      adviseurId: lead?.adviseur_id || null,
      adviseurNaam: adv?.naam || null,
      betaaldOp: String(d.target.betaald_op || "").slice(0, 10),
      bedragInc: Number(d.target.bedrag_inc_btw) || 0,
      reden: d.reden,
      terugbetaald: creditTerugbetaald.has(d.parent.id),
      alUitbetaaldAanAdviseur: alUitbetaald,
      kanUitbetalen:
        !alUitbetaald && !hold && !excluded && Boolean(lead?.adviseur_id),
    });
  }

  out.sort((a, b) => {
    if (a.terugbetaald !== b.terugbetaald) return a.terugbetaald ? 1 : -1;
    return (b.betaaldOp || "").localeCompare(a.betaaldOp || "");
  });
  return out;
}
