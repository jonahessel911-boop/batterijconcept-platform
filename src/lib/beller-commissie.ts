/**
 * Belcommissie per kalenderweek: €10 × netto (1e nieuw huisbezoek, niet geannuleerd).
 * Factuur: maandag na de week (vorige week factureren).
 */

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  creditWeekByYearWeek,
  creditWeekFromDate,
  formatCreditFactuurNummerWeek,
  previousCreditWeek,
  type CreditWeek,
} from "@/lib/adviseur-creditfactuur";
import { AMSTERDAM_TZ } from "@/lib/format";
import { isBelAfspraakUitvalLeadStatus } from "@/lib/labels";
import {
  BELLER_PER_INGEPLANDE_AFSPRAAK,
  eersteNieuwHuisbezoekIdPerLead,
  type OpsCommissieAfspraak,
} from "@/lib/ops-commissie";
import { bedragenMetBtw } from "@/lib/relatie-btw";
import { normalizeRol } from "@/lib/rollen";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { formatSchouwWeekLabel } from "@/lib/schouw-week";

export type BellerNettoRegel = {
  id: string;
  leadNaam: string;
  geplandOp: string;
  startAt: string | null;
};

export { isBelcommissieCreditfactuur } from "@/lib/callcenter-creditfactuur";

function encodeBelRegelsJson(
  regels: { omschrijving: string; bedrag: number }[]
) {
  return `REGELS_JSON:${JSON.stringify(regels)}`;
}

export type BellerWeekCommissie = {
  jaar: number;
  week: number;
  label: string;
  van: string;
  tot: string;
  /** Maandag waarop we factureren (week erna) */
  factuurMaandag: string;
  afspraken: number;
  bedragExBtw: number;
  isVorigeWeek: boolean;
  /** Alleen gevuld voor vorige week: de afspraken achter het totaal. */
  regels: BellerNettoRegel[];
  creditfactuurId: string | null;
  creditfactuurNummer: string | null;
  creditfactuurStatus: string | null;
};

type BellerAfspraakRow = OpsCommissieAfspraak & { start_at?: string | null };

function nettoAfsprakenVoorBeller(opts: {
  bellerId: string;
  afspraken: BellerAfspraakRow[];
  historie: OpsCommissieAfspraak[];
  startYmd: string;
  endYmd: string;
  leadStatusById: ReadonlyMap<string, string | null>;
  leadNaamById: ReadonlyMap<string, string>;
}): BellerNettoRegel[] {
  const eersteIds = eersteNieuwHuisbezoekIdPerLead(opts.historie);
  const regels: BellerNettoRegel[] = [];
  for (const a of opts.afspraken) {
    if ((a.soort || "").trim() !== "nieuw" || a.status === "geannuleerd") {
      continue;
    }
    if (!a.created_at) continue;
    if (eersteIds.get(a.lead_id) !== a.id) continue;
    if (
      isBelAfspraakUitvalLeadStatus(opts.leadStatusById.get(a.lead_id) ?? null)
    ) {
      continue;
    }
    const ymd = formatInTimeZone(
      new Date(a.created_at),
      AMSTERDAM_TZ,
      "yyyy-MM-dd"
    );
    if (ymd < opts.startYmd || ymd > opts.endYmd) continue;
    if ((a.ingepland_door_id || "").trim() !== opts.bellerId) continue;
    regels.push({
      id: a.id,
      leadNaam: opts.leadNaamById.get(a.lead_id) || "Lead",
      geplandOp: a.created_at,
      startAt: a.start_at || null,
    });
  }
  regels.sort(
    (a, b) => new Date(b.geplandOp).getTime() - new Date(a.geplandOp).getTime()
  );
  return regels;
}

function shiftYmd(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function listRecentCreditWeeks(count: number, now = new Date()): CreditWeek[] {
  const out: CreditWeek[] = [];
  let ymd = formatInTimeZone(now, AMSTERDAM_TZ, "yyyy-MM-dd");
  for (let i = 0; i < count; i++) {
    out.push(
      creditWeekFromDate(fromZonedTime(`${ymd}T12:00:00`, AMSTERDAM_TZ))
    );
    ymd = shiftYmd(ymd, -7);
  }
  return out;
}

export async function loadBellerWeekCommissie(
  sb: SupabaseClient,
  opts: { bellerId: string; weeks?: number; now?: Date }
): Promise<{
  beller: { id: string; naam: string };
  perAfspraak: number;
  weeks: BellerWeekCommissie[];
  vorigeWeek: CreditWeek;
}> {
  const weeksN = Math.min(Math.max(opts.weeks ?? 12, 1), 26);
  const now = opts.now ?? new Date();
  const vorige = previousCreditWeek(now);
  const weekFrames = listRecentCreditWeeks(weeksN, now);
  const rangeStart = weekFrames[weekFrames.length - 1]!.van;
  const rangeEnd = weekFrames[0]!.tot;

  const { data: beller, error: bErr } = await sb
    .from("adviseurs")
    .select("id, naam, email, rol, actief")
    .eq("id", opts.bellerId)
    .maybeSingle();
  if (bErr || !beller) {
    throw new Error("Beller niet gevonden");
  }
  if (normalizeRol(beller.rol) !== "beller") {
    throw new Error("Alleen voor rol Beller");
  }

  const [afspraken, { data: cfs }] = await Promise.all([
    fetchAllRows<BellerAfspraakRow>((fromIdx, toIdx) =>
      sb
        .from("afspraken")
        .select("id, lead_id, created_at, start_at, status, soort, ingepland_door_id")
        .eq("soort", "nieuw")
        .eq("ingepland_door_id", opts.bellerId)
        .gte("created_at", `${rangeStart}T00:00:00.000Z`)
        .lte("created_at", `${rangeEnd}T23:59:59.999Z`)
        .order("created_at", { ascending: true })
        .range(fromIdx, toIdx)
    ).catch(() => [] as BellerAfspraakRow[]),
    sb
      .from("adviseur_creditfacturen")
      .select("id, factuur_nummer, status, week_jaar, week_nummer")
      .eq("adviseur_id", opts.bellerId)
      .gte("week_jaar", weekFrames[weekFrames.length - 1]!.jaar - 1),
  ]);

  // Historie: alle nieuw-huisbezoeken van leads die in dit venster voorkomen
  const leadIds = [...new Set(afspraken.map((a) => a.lead_id).filter(Boolean))];
  let historie = afspraken;
  const leadStatusById = new Map<string, string | null>();
  const leadNaamById = new Map<string, string>();
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
        .select("id, status, naam")
        .in("id", chunk);
      for (const row of leadRows || []) {
        leadStatusById.set(
          row.id as string,
          (row.status as string | null) ?? null
        );
        leadNaamById.set(row.id as string, (row.naam as string) || "Lead");
      }
    }
    historie = histChunks.length > 0 ? histChunks : afspraken;
  }

  const cfByWeek = new Map<
    string,
    { id: string; factuur_nummer: string; status: string }
  >();
  for (const cf of cfs || []) {
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

  const weeks: BellerWeekCommissie[] = weekFrames.map((w) => {
    const isVorigeWeek = w.jaar === vorige.jaar && w.week === vorige.week;
    const regels = nettoAfsprakenVoorBeller({
      bellerId: opts.bellerId,
      afspraken,
      historie,
      startYmd: w.van,
      endYmd: w.tot,
      leadStatusById,
      leadNaamById,
    });
    const afsprakenN = regels.length;
    const bedrag =
      Math.round(afsprakenN * BELLER_PER_INGEPLANDE_AFSPRAAK * 100) / 100;
    const cf = cfByWeek.get(`${w.jaar}-W${w.week}`);
    return {
      jaar: w.jaar,
      week: w.week,
      label: formatSchouwWeekLabel(w.jaar, w.week),
      van: w.van,
      tot: w.tot,
      factuurMaandag: w.betaalMaandag,
      afspraken: afsprakenN,
      bedragExBtw: bedrag,
      isVorigeWeek,
      regels: isVorigeWeek ? regels : [],
      creditfactuurId: cf?.id ?? null,
      creditfactuurNummer: cf?.factuur_nummer ?? null,
      creditfactuurStatus: cf?.status ?? null,
    };
  });

  return {
    beller: { id: beller.id as string, naam: (beller.naam as string) || "Beller" },
    perAfspraak: BELLER_PER_INGEPLANDE_AFSPRAAK,
    weeks,
    vorigeWeek: vorige,
  };
}

/** Maak creditfactuur-concept voor belcommissie van één ISO-week. */
export async function createBellerWeekCreditfactuur(
  sb: SupabaseClient,
  opts: { bellerId: string; jaar?: number; week?: number; now?: Date }
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

  const { data: adviseur, error: advErr } = await sb
    .from("adviseurs")
    .select(
      "id, naam, email, rol, bedrijfsnaam, kvk_nummer, btw_nummer, iban, max_factuur_bedrag"
    )
    .eq("id", opts.bellerId)
    .maybeSingle();

  if (advErr || !adviseur) {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: 0,
      error: "Beller niet gevonden",
    };
  }
  if (normalizeRol(adviseur.rol) !== "beller") {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: 0,
      error: "Alleen voor rol Beller",
    };
  }
  if (!adviseur.bedrijfsnaam || !adviseur.kvk_nummer || !adviseur.iban) {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: 0,
      error: "Vul eerst ZZP-gegevens in: bedrijfsnaam, KvK en IBAN.",
    };
  }
  if (!adviseur.email?.trim()) {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: 0,
      error: "Vul eerst een e-mailadres in.",
    };
  }

  const { data: existingRows } = await sb
    .from("adviseur_creditfacturen")
    .select("id, factuur_nummer, status, bedrag_ex_btw")
    .eq("adviseur_id", opts.bellerId)
    .eq("week_jaar", weekInfo.jaar)
    .eq("week_nummer", weekInfo.week);
  const existing = (existingRows || []).find(
    (f) => f.status !== "geannuleerd"
  );
  if (existing) {
    return {
      created: false,
      factuur: existing as Record<string, unknown>,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: Number(existing.bedrag_ex_btw) || 0,
      error: `Er bestaat al een factuur voor week ${weekInfo.week}: ${existing.factuur_nummer}`,
    };
  }

  const report = await loadBellerWeekCommissie(sb, {
    bellerId: opts.bellerId,
    weeks: 8,
    now: opts.now,
  });
  const row = report.weeks.find(
    (w) => w.jaar === weekInfo.jaar && w.week === weekInfo.week
  );
  const afsprakenN = row?.afspraken ?? 0;
  if (afsprakenN <= 0) {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: 0,
      bedragExBtw: 0,
      error: `Geen netto afspraken in week ${weekInfo.week}.`,
    };
  }

  let bedrag = row!.bedragExBtw;
  const max =
    adviseur.max_factuur_bedrag != null && Number(adviseur.max_factuur_bedrag) > 0
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
      omschrijving: `${afsprakenN}× €${BELLER_PER_INGEPLANDE_AFSPRAAK} netto huisbezoeken (${weekInfo.van} t/m ${weekInfo.tot}, 1e huisbezoek, niet geannuleerd)`,
      bedrag: row!.bedragExBtw,
    },
  ];
  const humanNotes = [
    `Belcommissie ${adviseur.naam}.`,
    `Week ${weekInfo.week} (${weekInfo.van} t/m ${weekInfo.tot}).`,
    `${afsprakenN}× €${BELLER_PER_INGEPLANDE_AFSPRAAK} netto huisbezoeken (1e huisbezoek, niet geannuleerd).`,
    `Factuurdatum maandag ${weekInfo.betaalMaandag}.`,
    `KvK ${adviseur.kvk_nummer}, IBAN ${adviseur.iban}.`,
    `BTW 21%.`,
  ].join(" ");

  const { data: created, error: insErr } = await sb
    .from("adviseur_creditfacturen")
    .insert({
      adviseur_id: opts.bellerId,
      factuur_nummer: factuurNummer,
      status: "concept",
      week_jaar: weekInfo.jaar,
      week_nummer: weekInfo.week,
      periode_van: weekInfo.van,
      periode_tot: weekInfo.tot,
      aantal_aanbetalingen: afsprakenN,
      bedrag_ex_btw: withBtw.bedrag_ex_btw,
      btw_bedrag: withBtw.btw_bedrag,
      bedrag_inc_btw: withBtw.bedrag_inc_btw,
      max_bedrag_toegepast: max != null && row!.bedragExBtw > max ? max : null,
      factuurdatum: weekInfo.betaalMaandag,
      notities: `${encodeBelRegelsJson(regels)}\n${humanNotes}`,
    })
    .select("*")
    .single();

  if (insErr || !created) {
    return {
      created: false,
      factuur: null,
      week: weekInfo,
      afspraken: afsprakenN,
      bedragExBtw: bedrag,
      error: insErr?.message || "Aanmaken mislukt",
    };
  }

  return {
    created: true,
    factuur: created as Record<string, unknown>,
    week: weekInfo,
    afspraken: afsprakenN,
    bedragExBtw: bedrag,
  };
}
