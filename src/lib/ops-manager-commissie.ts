/**
 * Ops-manager (Rik/Tarik) weekcommissie:
 * - vaste weekfee (€3.750/mnd → /52)
 * - €2,50 × Simon netto 1e huisbezoeken (zelfde weekvenster als Simon: ma–zo)
 */

import { addDays, subWeeks } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  creditWeekByYearWeek,
  creditWeekFromDate,
  formatCreditFactuurNummerWeek,
  previousCreditWeek,
  type CreditWeek,
} from "@/lib/adviseur-creditfactuur";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isOpsCommissieCreditfactuur } from "@/lib/callcenter-creditfactuur";
import {
  OPS_MANAGER_FIXED_PER_WEEK,
  OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK,
  computeOpsCommissieForWindow,
  isOpsManagerAdviseur,
  type OpsCommissieAfspraak,
  type OpsCommissieAdviseur,
} from "@/lib/ops-commissie";
import { isSimonBeller } from "@/lib/ops-namen";
import { bedragenMetBtw } from "@/lib/relatie-btw";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { formatSchouwWeekLabel } from "@/lib/schouw-week";

export { isOpsCommissieCreditfactuur } from "@/lib/callcenter-creditfactuur";

export type OpsManagerWeekCommissie = {
  jaar: number;
  week: number;
  label: string;
  van: string;
  tot: string;
  /** Einddatum netto-telling (= zelfde als Simon: week.tot). */
  nettoTot: string;
  factuurMaandag: string;
  afspraken: number;
  vastExBtw: number;
  bonusExBtw: number;
  bedragExBtw: number;
  isVorigeWeek: boolean;
  creditfactuurId: string | null;
  creditfactuurNummer: string | null;
  creditfactuurStatus: string | null;
};

/** Woensdag van de ISO-week (Amsterdam-ymd). */
export function creditWeekWednesdayYmd(week: Pick<CreditWeek, "van">): string {
  const mondayNoon = fromZonedTime(`${week.van}T12:00:00`, AMSTERDAM_TZ);
  return formatInTimeZone(addDays(mondayNoon, 2), AMSTERDAM_TZ, "yyyy-MM-dd");
}

/**
 * Netto-einddag voor ops-bonus: zelfde als Simon (hele ISO-week t/m zondag).
 * (Oude facturen tot W45 konden t/m woensdag tellen — niet meer.)
 */
export function opsNettoEindYmd(week: CreditWeek): string {
  return week.tot;
}

function listRecentCreditWeeks(count: number, now = new Date()): CreditWeek[] {
  const out: CreditWeek[] = [];
  let cursor = toZonedTime(now, AMSTERDAM_TZ);
  for (let i = 0; i < count; i++) {
    out.push(creditWeekFromDate(cursor));
    cursor = subWeeks(cursor, 1);
  }
  return out;
}

function encodeOpsRegelsJson(regels: { omschrijving: string; bedrag: number }[]) {
  return `REGELS_JSON:${JSON.stringify(regels)}`;
}

export async function loadOpsManagerWeekCommissie(
  sb: SupabaseClient,
  opts: { opsManagerId: string; weeks?: number; now?: Date }
): Promise<{
  opsManager: { id: string; naam: string };
  perAfspraak: number;
  vastPerWeek: number;
  weeks: OpsManagerWeekCommissie[];
  vorigeWeek: CreditWeek;
}> {
  const weeksN = Math.min(Math.max(opts.weeks ?? 12, 1), 26);
  const now = opts.now ?? new Date();
  const vorige = previousCreditWeek(now);
  const weekFrames = listRecentCreditWeeks(weeksN, now);
  const rangeStart = weekFrames[weekFrames.length - 1]!.van;
  const rangeEnd = weekFrames[0]!.tot;

  const { data: person, error: pErr } = await sb
    .from("adviseurs")
    .select("id, naam, email, rol, actief")
    .eq("id", opts.opsManagerId)
    .maybeSingle();
  if (pErr || !person) {
    throw new Error("Ops-manager niet gevonden");
  }
  if (!isOpsManagerAdviseur(person)) {
    throw new Error("Alleen voor ops-manager (Rik/Tarik)");
  }

  const { data: simonRows } = await sb
    .from("adviseurs")
    .select("id, naam, rol, actief")
    .eq("actief", true);

  const simon =
    (simonRows || []).find((a) => isSimonBeller(a)) ||
    null;
  if (!simon) {
    throw new Error("Simon (beller) niet gevonden");
  }

  const [afspraken, { data: cfs }] = await Promise.all([
    fetchAllRows<OpsCommissieAfspraak>((fromIdx, toIdx) =>
      sb
        .from("afspraken")
        .select("id, lead_id, created_at, status, soort, ingepland_door_id")
        .eq("soort", "nieuw")
        .eq("ingepland_door_id", simon.id)
        .gte("created_at", `${rangeStart}T00:00:00.000Z`)
        .lte("created_at", `${rangeEnd}T23:59:59.999Z`)
        .order("created_at", { ascending: true })
        .range(fromIdx, toIdx)
    ).catch(() => [] as OpsCommissieAfspraak[]),
    sb
      .from("adviseur_creditfacturen")
      .select("id, factuur_nummer, status, week_jaar, week_nummer, notities")
      .eq("adviseur_id", opts.opsManagerId)
      .gte("week_jaar", weekFrames[weekFrames.length - 1]!.jaar - 1),
  ]);

  const leadIds = [...new Set(afspraken.map((a) => a.lead_id).filter(Boolean))];
  let historie = afspraken;
  const leadStatusById = new Map<string, string | null>();
  if (leadIds.length > 0) {
    const histChunks: OpsCommissieAfspraak[] = [];
    const chunkSize = 200;
    for (let i = 0; i < leadIds.length; i += chunkSize) {
      const chunk = leadIds.slice(i, i + chunkSize);
      const rows = await fetchAllRows<OpsCommissieAfspraak>((fromIdx, toIdx) =>
        sb
          .from("afspraken")
          .select("id, lead_id, created_at, status, soort, ingepland_door_id")
          .eq("soort", "nieuw")
          .in("lead_id", chunk)
          .order("created_at", { ascending: true })
          .range(fromIdx, toIdx)
      ).catch(() => [] as OpsCommissieAfspraak[]);
      histChunks.push(...rows);
      const { data: leadRows } = await sb
        .from("leads")
        .select("id, status")
        .in("id", chunk);
      for (const row of leadRows || []) {
        leadStatusById.set(
          row.id as string,
          (row.status as string | null) ?? null
        );
      }
    }
    historie = histChunks.length > 0 ? histChunks : afspraken;
  }

  const adviseurs: OpsCommissieAdviseur[] = [
    {
      id: simon.id as string,
      naam: (simon.naam as string) || "Simon",
      rol: "beller",
      actief: simon.actief !== false,
    },
  ];

  const cfByWeek = new Map<
    string,
    { id: string; factuur_nummer: string; status: string }
  >();
  for (const cf of cfs || []) {
    if (!isOpsCommissieCreditfactuur(cf)) continue;
    if (cf.status === "geannuleerd") continue;
    const key = `${cf.week_jaar}-W${cf.week_nummer}`;
    if (!cfByWeek.has(key)) {
      cfByWeek.set(key, {
        id: cf.id as string,
        factuur_nummer: cf.factuur_nummer as string,
        status: cf.status as string,
      });
    }
  }

  const weeks: OpsManagerWeekCommissie[] = weekFrames.map((w) => {
    const nettoTot = opsNettoEindYmd(w);
    const detail = computeOpsCommissieForWindow({
      afspraken,
      historie,
      adviseurs,
      startYmd: w.van,
      endYmd: nettoTot,
      tarikId: opts.opsManagerId,
      tarikNaam: (person.naam as string) || "Rik",
      includeVast: true,
      leadStatusById,
    });
    const afsprakenN = detail.tarikAfspraken;
    const vast = detail.tarikVast;
    const bonus = detail.tarikBonus;
    const cf = cfByWeek.get(`${w.jaar}-W${w.week}`);
    return {
      jaar: w.jaar,
      week: w.week,
      label: formatSchouwWeekLabel(w.jaar, w.week),
      van: w.van,
      tot: w.tot,
      nettoTot,
      factuurMaandag: w.betaalMaandag,
      afspraken: afsprakenN,
      vastExBtw: vast,
      bonusExBtw: bonus,
      bedragExBtw: Math.round((vast + bonus) * 100) / 100,
      isVorigeWeek: w.jaar === vorige.jaar && w.week === vorige.week,
      creditfactuurId: cf?.id ?? null,
      creditfactuurNummer: cf?.factuur_nummer ?? null,
      creditfactuurStatus: cf?.status ?? null,
    };
  });

  return {
    opsManager: {
      id: person.id as string,
      naam: (person.naam as string) || "Rik",
    },
    perAfspraak: OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK,
    vastPerWeek: OPS_MANAGER_FIXED_PER_WEEK,
    weeks,
    vorigeWeek: vorige,
  };
}

/** Maak creditfactuur-concept voor ops-manager van één ISO-week. */
export async function createOpsManagerWeekCreditfactuur(
  sb: SupabaseClient,
  opts: { opsManagerId: string; jaar?: number; week?: number; now?: Date }
): Promise<{
  created: boolean;
  factuur: Record<string, unknown> | null;
  week: CreditWeek;
  afspraken: number;
  bedragExBtw: number;
  error?: string;
}> {
  const weekInfo =
    opts.jaar && opts.week
      ? creditWeekByYearWeek(opts.jaar, opts.week)
      : previousCreditWeek(opts.now);
  const nettoTot = opsNettoEindYmd(weekInfo);

  const { data: adviseur, error: advErr } = await sb
    .from("adviseurs")
    .select(
      "id, naam, email, rol, bedrijfsnaam, kvk_nummer, btw_nummer, iban, max_factuur_bedrag"
    )
    .eq("id", opts.opsManagerId)
    .maybeSingle();

  if (advErr || !adviseur) {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: 0,
      error: "Ops-manager niet gevonden",
    };
  }
  if (!isOpsManagerAdviseur(adviseur)) {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: 0,
      error: "Alleen voor ops-manager (Rik/Tarik)",
    };
  }

  const { data: existing } = await sb
    .from("adviseur_creditfacturen")
    .select("id, factuur_nummer, status, bedrag_ex_btw, notities")
    .eq("adviseur_id", opts.opsManagerId)
    .eq("week_jaar", weekInfo.jaar)
    .eq("week_nummer", weekInfo.week);

  const existingOps = (existing || []).find(
    (f) => isOpsCommissieCreditfactuur(f) && f.status !== "geannuleerd"
  );
  if (existingOps) {
    return {
      created: false,
      factuur: existingOps as Record<string, unknown>,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: Number(existingOps.bedrag_ex_btw) || 0,
      error: `Er bestaat al een ops-factuur voor week ${weekInfo.week}: ${existingOps.factuur_nummer}`,
    };
  }

  const report = await loadOpsManagerWeekCommissie(sb, {
    opsManagerId: opts.opsManagerId,
    weeks: 8,
    now: opts.now,
  });
  const row = report.weeks.find(
    (w) => w.jaar === weekInfo.jaar && w.week === weekInfo.week
  );
  if (!row) {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: 0,
      error: `Geen weekdata voor week ${weekInfo.week}.`,
    };
  }

  let bedrag = row.bedragExBtw;
  const max =
    adviseur.max_factuur_bedrag != null &&
    Number(adviseur.max_factuur_bedrag) > 0
      ? Number(adviseur.max_factuur_bedrag)
      : null;
  if (max != null && bedrag > max) bedrag = max;
  const withBtw = bedragenMetBtw(bedrag);

  const { count } = await sb
    .from("adviseur_creditfacturen")
    .select("id", { count: "exact", head: true })
    .eq("week_jaar", weekInfo.jaar)
    .eq("week_nummer", weekInfo.week);

  const factuurNummer = formatCreditFactuurNummerWeek(
    weekInfo.jaar,
    weekInfo.week,
    (count || 0) + 1
  );

  const regels = [
    {
      omschrijving: `Weekvergoeding ops-manager (${weekInfo.van} t/m ${weekInfo.tot})`,
      bedrag: row.vastExBtw,
    },
    {
      omschrijving: `${row.afspraken}× €${OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} teamlead-bonus op Simon netto huisbezoeken (${weekInfo.van} t/m ${nettoTot})`,
      bedrag: row.bonusExBtw,
    },
  ].filter((r) => r.bedrag > 0);

  const humanNotes = [
    `Opscommissie ${adviseur.naam}.`,
    `Week ${weekInfo.week} (${weekInfo.van} t/m ${weekInfo.tot}).`,
    `Weekvergoeding €${row.vastExBtw.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.`,
    `${row.afspraken}× €${OPS_MANAGER_PER_INGEPLANDE_AFSPRAAK.toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} netto afspraken Simon (${weekInfo.van} t/m ${nettoTot}, zelfde telling als Simon, 1e huisbezoek, niet geannuleerd).`,
    `Factuurdatum maandag ${weekInfo.betaalMaandag}.`,
    adviseur.kvk_nummer && adviseur.iban
      ? `KvK ${adviseur.kvk_nummer}, IBAN ${adviseur.iban}.`
      : "ZZP-gegevens (KvK/IBAN) nog aanvullen.",
    `BTW 21%.`,
  ].join(" ");

  const { data: created, error: insErr } = await sb
    .from("adviseur_creditfacturen")
    .insert({
      adviseur_id: opts.opsManagerId,
      factuur_nummer: factuurNummer,
      status: "concept",
      week_jaar: weekInfo.jaar,
      week_nummer: weekInfo.week,
      periode_van: weekInfo.van,
      periode_tot: weekInfo.tot,
      aantal_aanbetalingen: row.afspraken,
      bedrag_ex_btw: withBtw.bedrag_ex_btw,
      btw_bedrag: withBtw.btw_bedrag,
      bedrag_inc_btw: withBtw.bedrag_inc_btw,
      max_bedrag_toegepast: max != null && row.bedragExBtw > max ? max : null,
      factuurdatum: weekInfo.betaalMaandag,
      notities: `${encodeOpsRegelsJson(regels)}\n${humanNotes}`,
    })
    .select("*")
    .single();

  if (insErr || !created) {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: row.afspraken,
      bedragExBtw: bedrag,
      error: insErr?.message || "Aanmaken mislukt",
    };
  }

  return {
    created: true,
    factuur: created as Record<string, unknown>,
    week: weekInfo,
    afspraken: row.afspraken,
    bedragExBtw: bedrag,
  };
}
