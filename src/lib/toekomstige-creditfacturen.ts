/**
 * Preview: eerstvolgende woensdag-commissieronde (aanbetaalde orders → tranche A).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAanbetalingFactuurOmschrijving } from "@/lib/aanbetaling";
import {
  creditWeekFromDate,
  previousCreditWeek,
  type CreditWeek,
  VERKOPER_AANBETALING_FEE,
} from "@/lib/adviseur-creditfactuur";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  commissieTrancheA,
  NETTO_AANBETALING_COMMISSIE,
} from "@/lib/netto-boord";
import { addDays } from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

export type ToekomstigeCfRegel = {
  factuurId: string;
  factuurNummer: string;
  leadId: string;
  leadNaam: string | null;
  offerteNummer: string | null;
  adviseurId: string;
  adviseurNaam: string;
  betaaldOp: string;
  bedragExBtw: number;
  status: "nieuw" | "concept_bestaat" | "zzp_incompleet" | "geen_adviseur";
  creditfactuurId: string | null;
  creditfactuurNummer: string | null;
};

export type ToekomstigeCreditfacturenPreview = {
  betaalDag: string;
  betaalLabel: string;
  week: CreditWeek;
  feeCap: number;
  regels: ToekomstigeCfRegel[];
  totals: {
    orders: number;
    bedragExBtw: number;
    nieuw: number;
    alConcept: number;
    geblokkeerd: number;
  };
  perAdviseur: {
    id: string;
    naam: string;
    orders: number;
    bedragExBtw: number;
    /** Orders waarvoor morgen nog geen CF kan (ZZP incompleet e.d.) — bedrag telt wél mee. */
    geblokkeerdOrders: number;
  }[];
};

function ymdAmsterdam(d: Date): string {
  return formatInTimeZone(d, AMSTERDAM_TZ, "yyyy-MM-dd");
}

/**
 * Eerstvolgende woensdag-betaalmoment + ISO-week die dan verwerkt wordt.
 * Di → morgen (vorige week). Do → volgende wo (huidige week).
 */
export function nextVerkoperCommissieMoment(now = new Date()): {
  week: CreditWeek;
  betaalDag: string;
  isMorgen: boolean;
  isVandaag: boolean;
} {
  const today = ymdAmsterdam(now);
  const morgen = ymdAmsterdam(addDays(toZonedTime(now, AMSTERDAM_TZ), 1));
  const prev = previousCreditWeek(now);
  if (today <= prev.betaalWoensdag) {
    return {
      week: prev,
      betaalDag: prev.betaalWoensdag,
      isMorgen: prev.betaalWoensdag === morgen,
      isVandaag: prev.betaalWoensdag === today,
    };
  }
  const current = creditWeekFromDate(now);
  return {
    week: current,
    betaalDag: current.betaalWoensdag,
    isMorgen: current.betaalWoensdag === morgen,
    isVandaag: current.betaalWoensdag === today,
  };
}

export async function buildToekomstigeVerkoperCreditfacturen(
  sb: SupabaseClient,
  now = new Date()
): Promise<ToekomstigeCreditfacturenPreview> {
  const moment = nextVerkoperCommissieMoment(now);
  const week = moment.week;

  const { data: facs } = await sb
    .from("facturen")
    .select(
      "id, factuur_nummer, lead_id, status, omschrijving, betaald_op, offerte_id"
    )
    .eq("status", "betaald")
    .gte("betaald_op", week.van)
    .lte("betaald_op", week.tot)
    .limit(2000);

  const aanbetalingen = (facs || []).filter((f) =>
    isAanbetalingFactuurOmschrijving(f.omschrijving)
  );

  const facIds = aanbetalingen.map((f) => f.id as string);
  const leadIds = [
    ...new Set(
      aanbetalingen.map((f) => f.lead_id as string).filter(Boolean)
    ),
  ];
  const offIds = [
    ...new Set(
      aanbetalingen
        .map((f) => f.offerte_id as string | null)
        .filter((x): x is string => Boolean(x))
    ),
  ];

  const [{ data: already }, { data: leads }, { data: offertes }] =
    await Promise.all([
      facIds.length
        ? sb
            .from("adviseur_creditfactuur_regels")
            .select(
              "factuur_id, creditfactuur_id, adviseur_creditfacturen(id, factuur_nummer, status)"
            )
            .in("factuur_id", facIds)
        : Promise.resolve({ data: [] as unknown[] }),
      leadIds.length
        ? sb
            .from("leads")
            .select("id, naam, adviseur_id")
            .in("id", leadIds)
        : Promise.resolve({ data: [] as unknown[] }),
      offIds.length
        ? sb
            .from("offertes")
            .select("id, offerte_nummer, subtotaal_ex_btw, totaal_inc_btw")
            .in("id", offIds)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);

  const alreadyByFac = new Map<
    string,
    { cfId: string; cfNummer: string | null }
  >();
  for (const r of already || []) {
    const row = r as {
      factuur_id: string;
      creditfactuur_id: string;
      adviseur_creditfacturen?:
        | { id: string; factuur_nummer?: string; status?: string }
        | { id: string; factuur_nummer?: string; status?: string }[]
        | null;
    };
    const cfRaw = row.adviseur_creditfacturen;
    const cf = Array.isArray(cfRaw) ? cfRaw[0] : cfRaw;
    alreadyByFac.set(row.factuur_id, {
      cfId: row.creditfactuur_id,
      cfNummer: cf?.factuur_nummer ?? null,
    });
  }

  const leadById = new Map(
    (leads || []).map((l) => [
      l.id as string,
      l as { id: string; naam: string | null; adviseur_id: string | null },
    ])
  );
  const offById = new Map(
    (offertes || []).map((o) => [
      o.id as string,
      o as {
        id: string;
        offerte_nummer: string | null;
        subtotaal_ex_btw: number | null;
        totaal_inc_btw: number | null;
      },
    ])
  );

  const advIds = [
    ...new Set(
      [...leadById.values()]
        .map((l) => l.adviseur_id)
        .filter((x): x is string => Boolean(x))
    ),
  ];
  const { data: adviseurs } = advIds.length
    ? await sb
        .from("adviseurs")
        .select(
          "id, naam, bedrijfsnaam, kvk_nummer, iban, max_factuur_bedrag, commissie_pct"
        )
        .in("id", advIds)
    : { data: [] as unknown[] };
  const advById = new Map(
    (adviseurs || []).map((a) => [
      (a as { id: string }).id,
      a as {
        id: string;
        naam: string;
        bedrijfsnaam: string | null;
        kvk_nummer: string | null;
        iban: string | null;
        max_factuur_bedrag: number | null;
        commissie_pct: number | null;
      },
    ])
  );

  const regels: ToekomstigeCfRegel[] = [];

  for (const fac of aanbetalingen) {
    const lead = leadById.get(fac.lead_id as string);
    const off = fac.offerte_id
      ? offById.get(fac.offerte_id as string)
      : undefined;
    const existing = alreadyByFac.get(fac.id as string);

    let omzetEx = Number(off?.subtotaal_ex_btw) || 0;
    if (!(omzetEx > 0) && Number(off?.totaal_inc_btw) > 0) {
      omzetEx = Math.round((Number(off!.totaal_inc_btw) / 1.21) * 100) / 100;
    }

    if (!lead?.adviseur_id) {
      regels.push({
        factuurId: fac.id as string,
        factuurNummer: fac.factuur_nummer as string,
        leadId: (fac.lead_id as string) || "",
        leadNaam: lead?.naam ?? null,
        offerteNummer: off?.offerte_nummer ?? null,
        adviseurId: "",
        adviseurNaam: "—",
        betaaldOp: String(fac.betaald_op || "").slice(0, 10),
        bedragExBtw: NETTO_AANBETALING_COMMISSIE,
        status: "geen_adviseur",
        creditfactuurId: existing?.cfId ?? null,
        creditfactuurNummer: existing?.cfNummer ?? null,
      });
      continue;
    }

    const adv = advById.get(lead.adviseur_id);
    let fee =
      omzetEx > 0
        ? commissieTrancheA(omzetEx, adv?.commissie_pct)
        : NETTO_AANBETALING_COMMISSIE;
    const max =
      adv?.max_factuur_bedrag != null && Number(adv.max_factuur_bedrag) > 0
        ? Number(adv.max_factuur_bedrag)
        : null;
    if (max != null && fee > max) fee = max;

    let status: ToekomstigeCfRegel["status"] = "nieuw";
    if (existing) status = "concept_bestaat";
    else if (!adv?.bedrijfsnaam || !adv.kvk_nummer || !adv.iban) {
      status = "zzp_incompleet";
    }

    regels.push({
      factuurId: fac.id as string,
      factuurNummer: fac.factuur_nummer as string,
      leadId: lead.id,
      leadNaam: lead.naam,
      offerteNummer: off?.offerte_nummer ?? null,
      adviseurId: lead.adviseur_id,
      adviseurNaam: adv?.naam || "Adviseur",
      betaaldOp: String(fac.betaald_op || "").slice(0, 10),
      bedragExBtw: Math.round(fee * 100) / 100,
      status,
      creditfactuurId: existing?.cfId ?? null,
      creditfactuurNummer: existing?.cfNummer ?? null,
    });
  }

  regels.sort(
    (a, b) =>
      a.adviseurNaam.localeCompare(b.adviseurNaam, "nl") ||
      a.betaaldOp.localeCompare(b.betaaldOp)
  );

  const perMap = new Map<
    string,
    {
      id: string;
      naam: string;
      orders: number;
      bedragExBtw: number;
      geblokkeerdOrders: number;
    }
  >();
  for (const r of regels) {
    if (r.status === "geen_adviseur") continue;
    const cur = perMap.get(r.adviseurId) || {
      id: r.adviseurId,
      naam: r.adviseurNaam,
      orders: 0,
      bedragExBtw: 0,
      geblokkeerdOrders: 0,
    };
    cur.orders += 1;
    cur.bedragExBtw = Math.round((cur.bedragExBtw + r.bedragExBtw) * 100) / 100;
    if (r.status === "zzp_incompleet") cur.geblokkeerdOrders += 1;
    perMap.set(r.adviseurId, cur);
  }

  const betaalLabel = moment.isVandaag
    ? "Vandaag (woensdag)"
    : moment.isMorgen
      ? "Morgen (woensdag)"
      : `Woensdag ${moment.betaalDag}`;

  return {
    betaalDag: moment.betaalDag,
    betaalLabel,
    week,
    feeCap: VERKOPER_AANBETALING_FEE,
    regels,
    totals: {
      orders: regels.length,
      bedragExBtw: Math.round(
        regels.reduce((s, r) => s + r.bedragExBtw, 0) * 100
      ) / 100,
      nieuw: regels.filter((r) => r.status === "nieuw").length,
      alConcept: regels.filter((r) => r.status === "concept_bestaat").length,
      geblokkeerd: regels.filter(
        (r) => r.status === "zzp_incompleet" || r.status === "geen_adviseur"
      ).length,
    },
    perAdviseur: [...perMap.values()].sort((a, b) =>
      a.naam.localeCompare(b.naam, "nl")
    ),
  };
}
