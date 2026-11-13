/**
 * Finance: alle uitgaande betalingen in één lijst.
 * Bronnen → te_goedkeuren → goedkeuren → (concept) auto-afschrijven.
 * Server-only (importeert o.a. edergy/pdf → fs). Client: finance-uitbetalingen-types.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { lijstEdergyFacturen } from "@/lib/edergy-factuur";
import {
  type FinanceBetaling,
  type FinanceBron,
  type FinanceCategorie,
  type FinanceStatus,
} from "@/lib/finance-uitbetalingen-types";
import { resolveInkoopLeverancierStatus } from "@/lib/inkoop-leverancier-betaling";
import { INKOOP_LEVERANCIER } from "@/lib/project-inkoop-checklist";

export type {
  FinanceBetaling,
  FinanceBron,
  FinanceCategorie,
  FinanceStatus,
} from "@/lib/finance-uitbetalingen-types";
export {
  FINANCE_CATEGORIE_LABEL,
  FINANCE_STATUS_LABEL,
} from "@/lib/finance-uitbetalingen-types";

function mapRelatieStatus(status: string): FinanceStatus {
  if (status === "concept") return "concept";
  if (status === "verzonden") return "concept"; // wacht nog op relatie-goedkeuring
  if (status === "goedgekeurd") return "te_goedkeuren";
  if (status === "betaald") return "betaald";
  if (status === "geannuleerd") return "geannuleerd";
  return "concept";
}

function keyOf(bron: FinanceBron, bronId: string) {
  return `${bron}:${bronId}`;
}

type TrackedRow = {
  id: string;
  categorie: FinanceCategorie;
  bron: FinanceBron;
  bron_id: string;
  begunstigde: string;
  iban: string | null;
  omschrijving: string | null;
  referentie: string | null;
  bedrag_ex_btw: number | null;
  bedrag_inc_btw: number;
  status: FinanceStatus;
  goedgekeurd_op: string | null;
  betaald_op: string | null;
  bunq_payment_id: string | null;
  foutmelding: string | null;
};

function fromTracked(t: TrackedRow): FinanceBetaling {
  return {
    id: t.id,
    categorie: t.categorie,
    bron: t.bron,
    bron_id: t.bron_id,
    begunstigde: t.begunstigde,
    iban: t.iban,
    omschrijving: t.omschrijving || "",
    referentie: t.referentie,
    bedrag_ex_btw: t.bedrag_ex_btw,
    bedrag_inc_btw: Number(t.bedrag_inc_btw) || 0,
    status: t.status,
    goedgekeurd_op: t.goedgekeurd_op,
    betaald_op: t.betaald_op,
    bunq_payment_id: t.bunq_payment_id,
    foutmelding: t.foutmelding,
    tracked: true,
  };
}

export async function listFinanceBetalingen(
  sb: SupabaseClient
): Promise<{ betalingen: FinanceBetaling[]; hint?: string }> {
  let tracked: TrackedRow[] = [];
  let hint: string | undefined;
  {
    const { data, error } = await sb
      .from("finance_uitbetalingen")
      .select(
        "id, categorie, bron, bron_id, begunstigde, iban, omschrijving, referentie, bedrag_ex_btw, bedrag_inc_btw, status, goedgekeurd_op, betaald_op, bunq_payment_id, foutmelding"
      )
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      if (
        error.code === "42P01" ||
        /finance_uitbetalingen|schema cache/i.test(error.message || "")
      ) {
        hint = "Run supabase/migrate-finance-uitbetalingen.sql";
      } else {
        throw error;
      }
    } else {
      tracked = (data || []) as TrackedRow[];
    }
  }

  const byKey = new Map(tracked.map((t) => [keyOf(t.bron, t.bron_id), t]));
  const out: FinanceBetaling[] = [];
  const seen = new Set<string>();

  // 1) Adviseur-commissie (selfbilling)
  {
    const { data, error } = await sb
      .from("adviseur_creditfacturen")
      .select(
        "id, factuur_nummer, status, bedrag_ex_btw, bedrag_inc_btw, omschrijving, goedgekeurd_op, betaald_op, adviseurs!adviseur_id(id, naam, iban, rol)"
      )
      .neq("status", "geannuleerd")
      .order("created_at", { ascending: false })
      .limit(300);
    if (!error) {
      for (const row of data || []) {
        const adv = row.adviseurs as
          | { id?: string; naam?: string; iban?: string | null; rol?: string | null }
          | { id?: string; naam?: string; iban?: string | null; rol?: string | null }[]
          | null;
        const a = Array.isArray(adv) ? adv[0] : adv;
        const bron: FinanceBron = "adviseur_creditfactuur";
        const k = keyOf(bron, row.id as string);
        seen.add(k);
        const trackedRow = byKey.get(k);
        if (trackedRow) {
          out.push({
            ...fromTracked(trackedRow),
            link: a?.id ? `/?tab=adviseurs&adviseur=${a.id}` : null,
          });
          continue;
        }
        const rol = (a?.rol || "").toLowerCase();
        const isOps =
          rol.includes("backoffice") ||
          rol.includes("operation") ||
          rol.includes("admin");
        out.push({
          id: `virt:${k}`,
          categorie: isOps ? "operations" : "adviseur",
          bron,
          bron_id: row.id as string,
          begunstigde: a?.naam || "Adviseur",
          iban: a?.iban || null,
          omschrijving: (row.omschrijving as string) || "Commissie / fee",
          referentie: (row.factuur_nummer as string) || null,
          bedrag_ex_btw: Number(row.bedrag_ex_btw) || null,
          bedrag_inc_btw: Number(row.bedrag_inc_btw) || 0,
          status: mapRelatieStatus(String(row.status)),
          goedgekeurd_op: (row.goedgekeurd_op as string) || null,
          betaald_op: (row.betaald_op as string) || null,
          bunq_payment_id: null,
          foutmelding: null,
          tracked: false,
          link: a?.id ? `/?tab=adviseurs&adviseur=${a.id}` : null,
        });
      }
    }
  }

  // 2) Installatiepartners
  {
    const { data, error } = await sb
      .from("partner_creditfacturen")
      .select(
        "id, factuur_nummer, status, bedrag_ex_btw, bedrag_inc_btw, omschrijving, goedgekeurd_op, betaald_op, installatie_partners!partner_id(id, naam, iban)"
      )
      .neq("status", "geannuleerd")
      .order("created_at", { ascending: false })
      .limit(300);
    if (!error) {
      for (const row of data || []) {
        const part = row.installatie_partners as
          | { id?: string; naam?: string; iban?: string | null }
          | { id?: string; naam?: string; iban?: string | null }[]
          | null;
        const p = Array.isArray(part) ? part[0] : part;
        const bron: FinanceBron = "partner_creditfactuur";
        const k = keyOf(bron, row.id as string);
        seen.add(k);
        const trackedRow = byKey.get(k);
        if (trackedRow) {
          out.push({
            ...fromTracked(trackedRow),
            link: p?.id ? `/?tab=partners&partner=${p.id}` : null,
          });
          continue;
        }
        out.push({
          id: `virt:${k}`,
          categorie: "installatie_partner",
          bron,
          bron_id: row.id as string,
          begunstigde: p?.naam || "Installatiepartner",
          iban: p?.iban || null,
          omschrijving: (row.omschrijving as string) || "Installatie",
          referentie: (row.factuur_nummer as string) || null,
          bedrag_ex_btw: Number(row.bedrag_ex_btw) || null,
          bedrag_inc_btw: Number(row.bedrag_inc_btw) || 0,
          status: mapRelatieStatus(String(row.status)),
          goedgekeurd_op: (row.goedgekeurd_op as string) || null,
          betaald_op: (row.betaald_op as string) || null,
          bunq_payment_id: null,
          foutmelding: null,
          tracked: false,
          link: p?.id ? `/?tab=partners&partner=${p.id}` : null,
        });
      }
    }
  }

  // 3) Edergy (WF selfbilling)
  try {
    const facturen = await lijstEdergyFacturen();
    for (const f of facturen) {
      const bron: FinanceBron = "edergy_factuur";
      const k = keyOf(bron, f.id);
      seen.add(k);
      const trackedRow = byKey.get(k);
      if (trackedRow) {
        out.push(fromTracked(trackedRow));
        continue;
      }
      out.push({
        id: `virt:${k}`,
        categorie: "edergy",
        bron,
        bron_id: f.id,
        begunstigde: "Edergy",
        iban: "NL13INGB0119293684",
        omschrijving: `WF ${f.project_nummer || ""} · ${f.klant}`.trim(),
        referentie: f.nummer,
        bedrag_ex_btw: f.bedrag_ex,
        bedrag_inc_btw: f.bedrag_inc,
        status:
          f.status === "verzonden"
            ? "te_goedkeuren"
            : f.status === "concept"
              ? "concept"
              : "te_goedkeuren",
        goedgekeurd_op: null,
        betaald_op: null,
        bunq_payment_id: null,
        foutmelding: null,
        tracked: false,
        link: f.project_id ? `/?tab=projecten&project=${f.project_id}` : null,
      });
    }
  } catch {
    /* ignore */
  }

  // 4) Inkoop product (open leverancier-betaling)
  {
    const { data, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, titel, inkoop_leverancier_status, inkoop_leverancier_betaald_op, materiaal_checks, leads(naam)"
      )
      .order("updated_at", { ascending: false })
      .limit(200);
    if (!error) {
      for (const row of data || []) {
        const status = resolveInkoopLeverancierStatus(row);
        if (status !== "op_krediet") continue;
        const bron: FinanceBron = "inkoop_project";
        const k = keyOf(bron, row.id as string);
        seen.add(k);
        const trackedRow = byKey.get(k);
        if (trackedRow) {
          out.push({
            ...fromTracked(trackedRow),
            link: `/?tab=projecten&project=${row.id}`,
          });
          continue;
        }
        const lead = row.leads as
          | { naam?: string | null }
          | { naam?: string | null }[]
          | null;
        const leadNaam = Array.isArray(lead) ? lead[0]?.naam : lead?.naam;
        out.push({
          id: `virt:${k}`,
          categorie: "inkoop",
          bron,
          bron_id: row.id as string,
          begunstigde: INKOOP_LEVERANCIER,
          iban: null,
          omschrijving: `Materiaal · ${row.project_nummer || ""} · ${leadNaam || row.titel || ""}`.trim(),
          referentie: (row.project_nummer as string) || null,
          bedrag_ex_btw: null,
          bedrag_inc_btw: 0,
          status: "te_goedkeuren",
          goedgekeurd_op: null,
          betaald_op: null,
          bunq_payment_id: null,
          foutmelding: null,
          tracked: false,
          link: `/?tab=projecten&project=${row.id}`,
        });
      }
    }
  }

  // 5) Tracked rows zonder bron-match (manual / operations concepten)
  for (const t of tracked) {
    const k = keyOf(t.bron, t.bron_id);
    if (seen.has(k)) continue;
    out.push(fromTracked(t));
  }

  const rank: Record<FinanceStatus, number> = {
    te_goedkeuren: 0,
    goedgekeurd: 1,
    in_behandeling: 2,
    mislukt: 3,
    concept: 4,
    betaald: 5,
    geannuleerd: 6,
  };
  out.sort((a, b) => {
    const rs = rank[a.status] - rank[b.status];
    if (rs !== 0) return rs;
    return b.bedrag_inc_btw - a.bedrag_inc_btw;
  });

  return { betalingen: out, hint };
}

async function markBronBetaald(
  sb: SupabaseClient,
  bron: FinanceBron,
  bronId: string,
  betaaldOp: string
) {
  if (bron === "adviseur_creditfactuur") {
    await sb
      .from("adviseur_creditfacturen")
      .update({ status: "betaald", betaald_op: betaaldOp })
      .eq("id", bronId)
      .in("status", ["goedgekeurd", "verzonden", "concept"]);
  } else if (bron === "partner_creditfactuur") {
    await sb
      .from("partner_creditfacturen")
      .update({ status: "betaald", betaald_op: betaaldOp })
      .eq("id", bronId)
      .in("status", ["goedgekeurd", "verzonden", "concept"]);
  } else if (bron === "inkoop_project") {
    await sb
      .from("projecten")
      .update({
        inkoop_leverancier_status: "betaald",
        inkoop_leverancier_betaald_op: betaaldOp.slice(0, 10),
      })
      .eq("id", bronId);
  }
  // edergy: store update later; tracked row is source of truth for payout
}

export async function goedkeurEnBetaal(
  sb: SupabaseClient,
  opts: {
    ownerId: string;
    betaling: Pick<
      FinanceBetaling,
      | "categorie"
      | "bron"
      | "bron_id"
      | "begunstigde"
      | "iban"
      | "omschrijving"
      | "referentie"
      | "bedrag_ex_btw"
      | "bedrag_inc_btw"
    >;
    /** true = direct als betaald boeken (concept auto-uitbetaling) */
    autoBetaal?: boolean;
  }
): Promise<FinanceBetaling> {
  const now = new Date().toISOString();
  const auto = opts.autoBetaal !== false;
  const status: FinanceStatus = auto ? "betaald" : "goedgekeurd";

  const payload = {
    categorie: opts.betaling.categorie,
    bron: opts.betaling.bron,
    bron_id: opts.betaling.bron_id,
    begunstigde: opts.betaling.begunstigde,
    iban: opts.betaling.iban,
    omschrijving: opts.betaling.omschrijving,
    referentie: opts.betaling.referentie,
    bedrag_ex_btw: opts.betaling.bedrag_ex_btw,
    bedrag_inc_btw: opts.betaling.bedrag_inc_btw,
    status,
    goedgekeurd_door: opts.ownerId,
    goedgekeurd_op: now,
    betaald_op: auto ? now : null,
    bunq_payment_id: auto ? `concept-${Date.now()}` : null,
    foutmelding: auto
      ? null
      : null,
    updated_at: now,
  };

  const { data, error } = await sb
    .from("finance_uitbetalingen")
    .upsert(payload, { onConflict: "bron,bron_id" })
    .select(
      "id, categorie, bron, bron_id, begunstigde, iban, omschrijving, referentie, bedrag_ex_btw, bedrag_inc_btw, status, goedgekeurd_op, betaald_op, bunq_payment_id, foutmelding"
    )
    .single();

  if (error) {
    if (
      error.code === "42P01" ||
      /finance_uitbetalingen|schema cache/i.test(error.message || "")
    ) {
      throw new Error(
        "Tabel finance_uitbetalingen ontbreekt — run supabase/migrate-finance-uitbetalingen.sql"
      );
    }
    throw error;
  }

  if (auto) {
    await markBronBetaald(sb, opts.betaling.bron, opts.betaling.bron_id, now);
  }

  return fromTracked(data as TrackedRow);
}
