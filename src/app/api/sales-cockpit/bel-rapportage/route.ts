import { NextResponse } from "next/server";
import { fromZonedTime } from "date-fns-tz";
import { requireSalesCockpitAdmin } from "@/lib/sales-cockpit/auth";
import { buildBelCockpitOverview } from "@/lib/sales-cockpit/bel-rapportage";
import {
  isHuisbezoekAfspraak,
  type BelConversieAfspraak,
  type BelConversieLead,
} from "@/lib/bel-conversie";
import { AMSTERDAM_TZ } from "@/lib/format";
import { addYmd, todayYmd } from "@/lib/sales-cockpit/range";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

function amsDayBounds(ymd: string): { start: Date; end: Date } {
  const [y, m, d] = ymd.split("-").map(Number);
  return {
    start: fromZonedTime(new Date(y, m - 1, d, 0, 0, 0, 0), AMSTERDAM_TZ),
    end: fromZonedTime(new Date(y, m - 1, d, 23, 59, 59, 999), AMSTERDAM_TZ),
  };
}

/**
 * GET /api/sales-cockpit/bel-rapportage
 * Vandaag / week / maand bel-KPI's + vorige periode + dagseries.
 */
export async function GET() {
  const auth = await requireSalesCockpitAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = auth.sb;
    const today = todayYmd();
    // Ruim genoeg voor trend w26 / dit jaar + vorige maand.
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const w26From = addYmd(today, -(26 * 7 + 14));
    const loadFrom = yearStart < w26From ? yearStart : w26From;
    const loadTo = today;
    const { start } = amsDayBounds(loadFrom);
    const { end } = amsDayBounds(loadTo);
    const padStart = new Date(start.getTime() - 12 * 3600 * 1000).toISOString();
    const padEnd = new Date(end.getTime() + 12 * 3600 * 1000).toISOString();

    const leadsSelectFull =
      "id, naam, lead_number, status, postcode, bron, laatst_gebeld_at, laatst_gebeld_door, bel_claimed_by, beller_id";
    const leadsSelectBasic =
      "id, naam, lead_number, status, postcode, bron, laatst_gebeld_at, bel_claimed_by, beller_id";

    async function loadGebeldLeads(): Promise<BelConversieLead[]> {
      try {
        return await fetchAllRows<BelConversieLead>((fromIdx, toIdx) =>
          sb
            .from("leads")
            .select(leadsSelectFull)
            .gte("laatst_gebeld_at", padStart)
            .lte("laatst_gebeld_at", padEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string })?.code;
        if (
          !msg.includes("laatst_gebeld_door") &&
          !msg.includes("beller_id") &&
          code !== "42703"
        ) {
          throw e;
        }
        const rows = await fetchAllRows<BelConversieLead>((fromIdx, toIdx) =>
          sb
            .from("leads")
            .select(leadsSelectBasic)
            .gte("laatst_gebeld_at", padStart)
            .lte("laatst_gebeld_at", padEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
        return rows.map((l) => ({
          ...l,
          laatst_gebeld_door: null,
        }));
      }
    }

    const afspraakSelectFull =
      "id, lead_id, created_at, updated_at, start_at, status, soort, adviseur_id, ingepland_door_id, annulering_code, herpland_van_afspraak_id";
    const afspraakSelectBasic =
      "id, lead_id, created_at, start_at, status, soort, adviseur_id";

    async function loadAfsprakenByField(
      field: "created_at" | "start_at"
    ): Promise<BelConversieAfspraak[]> {
      try {
        return await fetchAllRows<BelConversieAfspraak>((fromIdx, toIdx) =>
          sb
            .from("afspraken")
            .select(afspraakSelectFull)
            .gte(field, padStart)
            .lte(field, padEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: string })?.code;
        if (
          !msg.includes("ingepland_door_id") &&
          !msg.includes("annulering_code") &&
          !msg.includes("herpland_van") &&
          code !== "42703"
        ) {
          throw e;
        }
        return fetchAllRows<BelConversieAfspraak>((fromIdx, toIdx) =>
          sb
            .from("afspraken")
            .select(afspraakSelectBasic)
            .gte(field, padStart)
            .lte(field, padEnd)
            .order("id", { ascending: true })
            .range(fromIdx, toIdx)
        );
      }
    }

    const [leadsRows, afsprakenByCreated, afsprakenByStart, adviseursRes] =
      await Promise.all([
        loadGebeldLeads(),
        loadAfsprakenByField("created_at"),
        loadAfsprakenByField("start_at"),
        sb
          .from("adviseurs")
          .select("id, naam, rol, actief, email")
          .eq("actief", true)
          .order("naam"),
      ]);

    if (adviseursRes.error) throw adviseursRes.error;

    const afspraakById = new Map<string, BelConversieAfspraak>();
    for (const a of [...afsprakenByCreated, ...afsprakenByStart]) {
      if (a?.id) afspraakById.set(a.id, a);
    }
    const afsprakenDag = [...afspraakById.values()];

    let leads: BelConversieLead[] = leadsRows;
    const huisbezoekIds = new Set(
      afsprakenDag
        .filter((a) => isHuisbezoekAfspraak(a))
        .map((a) => a.lead_id)
    );
    const missingLeadIds = [...huisbezoekIds].filter(
      (id) => !leads.some((l) => l.id === id)
    );
    for (let i = 0; i < missingLeadIds.length; i += 200) {
      const chunk = missingLeadIds.slice(i, i + 200);
      const { data: extra } = await sb
        .from("leads")
        .select(leadsSelectFull)
        .in("id", chunk);
      if (extra?.length) {
        leads = leads.concat(extra as BelConversieLead[]);
      }
    }

    const periodeNieuwLeadIds = [
      ...new Set(
        afsprakenDag
          .filter((a) => (a.soort || "").trim() === "nieuw")
          .map((a) => a.lead_id)
      ),
    ];
    let huisbezoekHistorie = afsprakenDag;
    if (periodeNieuwLeadIds.length > 0) {
      const hist: BelConversieAfspraak[] = [];
      for (let i = 0; i < periodeNieuwLeadIds.length; i += 200) {
        const chunk = periodeNieuwLeadIds.slice(i, i + 200);
        const { data: histRows } = await sb
          .from("afspraken")
          .select(
            "id, lead_id, created_at, updated_at, start_at, status, soort, adviseur_id, ingepland_door_id, annulering_code, herpland_van_afspraak_id"
          )
          .eq("soort", "nieuw")
          .in("lead_id", chunk);
        if (histRows?.length) {
          hist.push(...(histRows as BelConversieAfspraak[]));
        }
      }
      if (hist.length > 0) huisbezoekHistorie = hist;
    }

    const adviseurs = (adviseursRes.data || []).map((a) => ({
      id: a.id as string,
      naam: a.naam as string,
      rol: (a as { rol?: string | null }).rol ?? null,
      actief: Boolean(a.actief),
      email: (a as { email?: string | null }).email ?? null,
    }));

    const overview = buildBelCockpitOverview({
      leads,
      afspraken: afsprakenDag,
      huisbezoekHistorie,
      adviseurs,
    });

    return NextResponse.json({ ok: true, ...overview });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Bel rapportage laden mislukt") },
      { status: 500 }
    );
  }
}
