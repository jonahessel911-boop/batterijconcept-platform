import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  buildAttributionTree,
  buildGeoBreakdown,
  buildRapportageTree,
  type RapportageLead,
} from "@/lib/rapportage";
import {
  buildFinancialDashboard,
  parseFinancialRange,
  type CommissieMap,
} from "@/lib/financial-dashboard";
import { isSchouwFormulier } from "@/lib/project-documenten";
import {
  buildInkoopChecklist,
  inkoopTeBestellenTotaalExBtw,
  type MateriaalChecks,
} from "@/lib/project-inkoop-checklist";
import {
  PRODUCT_SELECT_BASE,
  PRODUCT_SELECT_INKOOP,
  defaultInkoopVoorSku,
  hasInkoopProductColumns,
  isMissingInkoopSchema,
  markInkoopSchemaMissing,
  type ProductInkoop,
} from "@/lib/inkoop";
import {
  parseConversiePeriod,
  resolveConversiePeriod,
  type ConversiePeriod,
} from "@/lib/conversie-period";
import { amsDayBounds, inAmsterdamDayRange } from "@/lib/lead-conversie";

export const runtime = "nodejs";

function parseGeoPeriod(raw: string | null): ConversiePeriod {
  if (!raw?.trim()) return "all_time";
  return parseConversiePeriod(raw);
}

/** GET /api/rapportage?adviseur_id=&financial_range=last_30_days&geo_period=last_7_days */
export async function GET(req: NextRequest) {
  const adviseurId = req.nextUrl.searchParams.get("adviseur_id");
  const financialRange = parseFinancialRange(
    req.nextUrl.searchParams.get("financial_range")
  );
  const geoPeriod = parseGeoPeriod(req.nextUrl.searchParams.get("geo_period"));
  const geoResolved = resolveConversiePeriod(geoPeriod);

  try {
    const sb = getSupabaseAdmin();

    const [leadsRes, afsprakenRes, offertesRes, projectenRes, facturenRes, kostenRes] =
      await Promise.all([
        sb
          .from("leads")
          .select(
            "id, created_at, status, adviseur_id, lander, campaign_name, utm_campaign, ad_name, utm_content, postcode, plaats"
          ),
        sb
          .from("afspraken")
          .select(
            "id, lead_id, adviseur_id, start_at, created_at, status, soort, ingepland_door_id"
          ),
        sb
          .from("offertes")
          .select(
            "id, lead_id, status, ondertekend_op, created_at, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, financiering_voorbehoud, offerte_nummer, leads(adviseur_id, naam), offerte_regels(id, omschrijving, aantal, product_id)"
          )
          .eq("status", "ondertekend"),
        sb
          .from("projecten")
          .select(
            "id, lead_id, offerte_id, created_at, projectkosten, installatie_at, installatie_voltooid_at, schouw_at, status, project_nummer, materiaal_checks, leads(adviseur_id)"
          ),
        sb
          .from("facturen")
          .select(
            "id, lead_id, offerte_id, status, bedrag_ex_btw, btw_bedrag, bedrag_inc_btw, betaald_op, factuurdatum, factuur_nummer, omschrijving, credit_van_factuur_id, leads(adviseur_id)"
          ),
        sb
          .from("rapportage_kosten")
          .select("datum, soort, bedrag, adviseur_id")
          .order("datum", { ascending: true }),
      ]);

    let leads: RapportageLead[] = (leadsRes.data || []) as RapportageLead[];
    if (leadsRes.error) {
      if (
        leadsRes.error.code === "42703" ||
        leadsRes.error.message?.includes("lander") ||
        leadsRes.error.message?.includes("campaign_name") ||
        leadsRes.error.message?.includes("ad_name")
      ) {
        const retry = await sb
          .from("leads")
          .select(
            "id, created_at, status, adviseur_id, utm_campaign, utm_content, postcode, plaats"
          );
        if (retry.error) {
          const retryBasic = await sb
            .from("leads")
            .select(
              "id, created_at, status, adviseur_id, utm_campaign, postcode, plaats"
            );
          if (retryBasic.error) throw retryBasic.error;
          leads = (retryBasic.data || []).map((l) => ({
            ...(l as RapportageLead),
            lander: null,
            campaign_name: null,
            ad_name: null,
            utm_content: null,
          }));
        } else {
          leads = (retry.data || []).map((l) => ({
            ...(l as RapportageLead),
            lander: null,
            campaign_name: null,
            ad_name: null,
          }));
        }
      } else {
        throw leadsRes.error;
      }
    }

    const projectenRaw = projectenRes.data || [];
    const projecten = projectenRaw.map((p) => {
      const lead = p.leads as { adviseur_id?: string | null } | null;
      return {
        id: p.id,
        lead_id: p.lead_id,
        offerte_id: p.offerte_id,
        created_at: p.created_at,
        projectkosten:
          p.projectkosten != null ? Number(p.projectkosten) : 0,
        adviseur_id: lead?.adviseur_id ?? null,
        installatie_at:
          (p as { installatie_at?: string | null }).installatie_at ?? null,
        installatie_voltooid_at:
          (p as { installatie_voltooid_at?: string | null })
            .installatie_voltooid_at ?? null,
        schouw_at: (p as { schouw_at?: string | null }).schouw_at ?? null,
        status: (p as { status?: string | null }).status ?? null,
        project_nummer:
          (p as { project_nummer?: string | null }).project_nummer ?? null,
        materiaal_checks:
          (p as { materiaal_checks?: Record<string, boolean | string> | null })
            .materiaal_checks ?? null,
        heeft_schouw_pdf: false,
        te_bestellen_ex_btw: 0,
      };
    });

    // Als projectkosten-kolom mist, PostgREST kan hele select falen
    let projectenSafe = projecten;
    if (
      projectenRes.error &&
      (projectenRes.error.message?.includes("projectkosten") ||
        projectenRes.error.message?.includes("installatie_at") ||
        projectenRes.error.message?.includes("installatie_voltooid_at") ||
        projectenRes.error.code === "42703")
    ) {
      const retry = await sb
        .from("projecten")
        .select("id, lead_id, offerte_id, created_at, leads(adviseur_id)");
      projectenSafe = (retry.data || []).map((p) => {
        const lead = p.leads as { adviseur_id?: string | null } | null;
        return {
          id: p.id,
          lead_id: p.lead_id,
          offerte_id: p.offerte_id,
          created_at: p.created_at,
          projectkosten: 0,
          adviseur_id: lead?.adviseur_id ?? null,
          installatie_at: null,
          installatie_voltooid_at: null,
          schouw_at: null,
          status: null,
          project_nummer: null,
          materiaal_checks: null,
          heeft_schouw_pdf: false,
          te_bestellen_ex_btw: 0,
        };
      });
    }

    let offertes = (offertesRes.data || []).map((o) => {
      const lead = o.leads as {
        adviseur_id?: string | null;
        naam?: string | null;
      } | null;
      const regels = (o.offerte_regels || []) as {
        id?: string | null;
        omschrijving?: string | null;
        aantal?: number | null;
        product_id?: string | null;
      }[];
      return {
        id: o.id,
        lead_id: o.lead_id,
        status: o.status,
        ondertekend_op: o.ondertekend_op,
        created_at: o.created_at,
        subtotaal_ex_btw: Number(o.subtotaal_ex_btw) || 0,
        btw_bedrag:
          (o as { btw_bedrag?: number | null }).btw_bedrag != null
            ? Number((o as { btw_bedrag?: number | null }).btw_bedrag)
            : null,
        totaal_inc_btw:
          (o as { totaal_inc_btw?: number | null }).totaal_inc_btw != null
            ? Number((o as { totaal_inc_btw?: number | null }).totaal_inc_btw)
            : null,
        financiering_voorbehoud: Boolean(
          (o as { financiering_voorbehoud?: boolean | null })
            .financiering_voorbehoud
        ),
        adviseur_id: lead?.adviseur_id ?? null,
        offerte_nummer:
          (o as { offerte_nummer?: string | null }).offerte_nummer ?? null,
        lead_naam: lead?.naam ?? null,
        regels,
      };
    });

    if (
      offertesRes.error &&
      (offertesRes.error.code === "42703" ||
        offertesRes.error.message?.includes("financiering_voorbehoud") ||
        offertesRes.error.message?.includes("btw_bedrag") ||
        offertesRes.error.message?.includes("totaal_inc_btw") ||
        offertesRes.error.message?.includes("offerte_nummer") ||
        offertesRes.error.message?.includes("product_id"))
    ) {
      const retry = await sb
        .from("offertes")
        .select(
          "id, lead_id, status, ondertekend_op, created_at, subtotaal_ex_btw, leads(adviseur_id, naam), offerte_regels(id, omschrijving, aantal)"
        )
        .eq("status", "ondertekend");
      if (retry.error) throw retry.error;
      offertes = (retry.data || []).map((o) => {
        const lead = o.leads as {
          adviseur_id?: string | null;
          naam?: string | null;
        } | null;
        const regels = (o.offerte_regels || []) as {
          id?: string | null;
          omschrijving?: string | null;
          aantal?: number | null;
          product_id?: string | null;
        }[];
        return {
          id: o.id,
          lead_id: o.lead_id,
          status: o.status,
          ondertekend_op: o.ondertekend_op,
          created_at: o.created_at,
          subtotaal_ex_btw: Number(o.subtotaal_ex_btw) || 0,
          btw_bedrag: null,
          totaal_inc_btw: null,
          financiering_voorbehoud: false,
          adviseur_id: lead?.adviseur_id ?? null,
          offerte_nummer: null,
          lead_naam: lead?.naam ?? null,
          regels,
        };
      });
    } else if (offertesRes.error) {
      throw offertesRes.error;
    }

    let facturen = (facturenRes.error ? [] : facturenRes.data || []).map(
      (f) => {
        const lead = f.leads as { adviseur_id?: string | null } | null;
        return {
          id: f.id,
          lead_id: f.lead_id,
          offerte_id:
            (f as { offerte_id?: string | null }).offerte_id ?? null,
          status: f.status,
          bedrag_ex_btw: Number(f.bedrag_ex_btw) || 0,
          btw_bedrag:
            (f as { btw_bedrag?: number | null }).btw_bedrag != null
              ? Number((f as { btw_bedrag?: number | null }).btw_bedrag)
              : null,
          bedrag_inc_btw:
            (f as { bedrag_inc_btw?: number | null }).bedrag_inc_btw != null
              ? Number((f as { bedrag_inc_btw?: number | null }).bedrag_inc_btw)
              : null,
          betaald_op: f.betaald_op as string | null,
          factuurdatum: f.factuurdatum as string,
          adviseur_id: lead?.adviseur_id ?? null,
          factuur_nummer:
            (f as { factuur_nummer?: string | null }).factuur_nummer ?? null,
          omschrijving:
            (f as { omschrijving?: string | null }).omschrijving ?? null,
          credit_van_factuur_id:
            (f as { credit_van_factuur_id?: string | null })
              .credit_van_factuur_id ?? null,
        };
      }
    );

    if (
      facturenRes.error &&
      (facturenRes.error.code === "42703" ||
        facturenRes.error.message?.includes("btw_bedrag") ||
        facturenRes.error.message?.includes("bedrag_inc_btw") ||
        facturenRes.error.message?.includes("offerte_id") ||
        facturenRes.error.message?.includes("factuur_nummer") ||
        facturenRes.error.message?.includes("omschrijving") ||
        facturenRes.error.message?.includes("credit_van_factuur_id"))
    ) {
      const retry = await sb
        .from("facturen")
        .select(
          "id, lead_id, status, bedrag_ex_btw, betaald_op, factuurdatum, leads(adviseur_id)"
        );
      if (!retry.error) {
        facturen = (retry.data || []).map((f) => {
          const lead = f.leads as { adviseur_id?: string | null } | null;
          return {
            id: f.id,
            lead_id: f.lead_id,
            offerte_id: null,
            status: f.status,
            bedrag_ex_btw: Number(f.bedrag_ex_btw) || 0,
            btw_bedrag: null,
            bedrag_inc_btw: null,
            betaald_op: f.betaald_op as string | null,
            factuurdatum: f.factuurdatum as string,
            adviseur_id: lead?.adviseur_id ?? null,
            factuur_nummer: null,
            omschrijving: null,
            credit_van_factuur_id: null,
          };
        });
      }
    }

    let afsprakenData: {
      id: string;
      lead_id: string;
      adviseur_id: string | null;
      start_at: string;
      created_at: string;
      status: string;
      soort?: string | null;
      ingepland_door_id?: string | null;
    }[] = (afsprakenRes.data || []) as {
      id: string;
      lead_id: string;
      adviseur_id: string | null;
      start_at: string;
      created_at: string;
      status: string;
      soort?: string | null;
      ingepland_door_id?: string | null;
    }[];
    if (afsprakenRes.error) {
      if (
        afsprakenRes.error.code === "42703" ||
        afsprakenRes.error.message?.includes("soort") ||
        afsprakenRes.error.message?.includes("ingepland_door_id")
      ) {
        const retry = await sb
          .from("afspraken")
          .select("id, lead_id, adviseur_id, start_at, created_at, status, soort");
        if (retry.error) {
          const retry2 = await sb
            .from("afspraken")
            .select("id, lead_id, adviseur_id, start_at, created_at, status");
          if (retry2.error) throw retry2.error;
          afsprakenData = (retry2.data || []) as typeof afsprakenData;
        } else {
          afsprakenData = (retry.data || []) as typeof afsprakenData;
        }
      } else {
        throw afsprakenRes.error;
      }
    }

    // Purchasing “Te bestellen”: schouw-PDF + te_kopen-regels (zelfde als /api/inkoop/orders)
    {
      const projectIds = projectenSafe.map((p) => p.id);
      const schouwPdfIds = new Set<string>();
      if (projectIds.length > 0) {
        const { data: fotos } = await sb
          .from("project_fotos")
          .select("project_id, storage_path, bestandsnaam, omschrijving")
          .in("project_id", projectIds);
        for (const f of fotos || []) {
          if (!isSchouwFormulier(f.omschrijving as string | null)) continue;
          const path = String(f.storage_path || "");
          const naam = (f.bestandsnaam as string | null) || "";
          const isPdf = /\.pdf$/i.test(naam) || /\.pdf$/i.test(path);
          if (!isPdf || !path) continue;
          schouwPdfIds.add(f.project_id as string);
        }
      }

      const mapProduct = (row: Record<string, unknown>): ProductInkoop => {
        const sku = (row.sku as string | null) || null;
        const defaults = defaultInkoopVoorSku(sku);
        const num = (v: unknown, fb = 0) => {
          const n = Number(v);
          return Number.isFinite(n) ? Math.round(n * 100) / 100 : fb;
        };
        return {
          id: row.id as string,
          sku,
          naam: String(row.naam || ""),
          omschrijving: (row.omschrijving as string | null) || null,
          prijs_ex_btw: num(row.prijs_ex_btw),
          btw_percentage: num(row.btw_percentage, 21),
          eenheid: (row.eenheid as string) || "stuk",
          actief: Boolean(row.actief),
          inkoop_batterij: num(row.inkoop_batterij, defaults.inkoop_batterij),
          inkoop_omvormer: num(row.inkoop_omvormer, defaults.inkoop_omvormer),
          inkoop_installatie: num(
            row.inkoop_installatie,
            defaults.inkoop_installatie
          ),
          inkoop_warmtefonds: num(
            row.inkoop_warmtefonds,
            defaults.inkoop_warmtefonds
          ),
        };
      };

      let producten: ProductInkoop[] = [];
      try {
        const withInkoop = await hasInkoopProductColumns(sb);
        const productSelect = (
          withInkoop ? PRODUCT_SELECT_INKOOP : PRODUCT_SELECT_BASE
        ) as typeof PRODUCT_SELECT_BASE;
        let { data: productenRows, error: productenErr } = await sb
          .from("producten")
          .select(productSelect)
          .eq("actief", true);
        if (productenErr && isMissingInkoopSchema(productenErr)) {
          markInkoopSchemaMissing({ columns: true });
          const retry = await sb
            .from("producten")
            .select(PRODUCT_SELECT_BASE)
            .eq("actief", true);
          productenRows = retry.data;
          productenErr = retry.error;
        }
        if (!productenErr) {
          producten = (productenRows || []).map((r) =>
            mapProduct(r as Record<string, unknown>)
          );
        }
      } catch {
        producten = [];
      }

      const offerteById = new Map(offertes.map((o) => [o.id, o]));
      projectenSafe = projectenSafe.map((p) => {
        const heeftPdf = schouwPdfIds.has(p.id);
        const off = p.offerte_id ? offerteById.get(p.offerte_id) : null;
        const regels = (off?.regels || []).map((r, i) => ({
          id: r.id || `${p.id}-${i}`,
          omschrijving: r.omschrijving || "Product",
          aantal: Math.max(0, Number(r.aantal) || 0),
          product_id: r.product_id ?? null,
        }));
        const checks = (p.materiaal_checks || {}) as MateriaalChecks;
        const items = buildInkoopChecklist(regels, producten, checks);
        const teBestellen = inkoopTeBestellenTotaalExBtw(items, checks);
        return {
          ...p,
          heeft_schouw_pdf: heeftPdf,
          te_bestellen_ex_btw: teBestellen,
        };
      });
    }

    const raw = {
      leads,
      afspraken: afsprakenData,
      offertes,
      projecten: projectenSafe,
      facturen,
    };

    const tree = buildRapportageTree(raw, adviseurId);
    const attribution = buildAttributionTree(raw, adviseurId);

    // Kaart: leads die in de gekozen periode binnenkwamen (+ hun afspraken/deals)
    const { start: geoStart } = amsDayBounds(geoResolved.startYmd);
    const { end: geoEnd } = amsDayBounds(geoResolved.endYmd);
    const geoLeads = leads.filter((l) =>
      inAmsterdamDayRange(l.created_at, geoStart, geoEnd)
    );
    const geo = buildGeoBreakdown({ ...raw, leads: geoLeads }, adviseurId);

    const kosten = (kostenRes.error ? [] : kostenRes.data || []).map((k) => ({
      datum: k.datum as string,
      soort: k.soort as "ad_spend" | "sales",
      bedrag: Number(k.bedrag) || 0,
      adviseur_id: (k.adviseur_id as string | null) ?? null,
    }));

    // Commissie-% + Tarik-id voor loonkosten
    let commissieMap: CommissieMap | undefined;
    let tarikId: string | null = null;
    {
      const { data: advRows } = await sb
        .from("adviseurs")
        .select("id, naam, commissie_pct");
      if (advRows) {
        commissieMap = new Map<string, number>();
        for (const row of advRows) {
          const pct = Number((row as Record<string, unknown>).commissie_pct) || 0;
          if (pct > 0) commissieMap.set(row.id as string, pct);
          const naam = String((row as { naam?: string }).naam || "")
            .trim()
            .toLowerCase();
          if (!tarikId && (naam === "tarik" || naam.startsWith("tarik "))) {
            tarikId = row.id as string;
          }
        }
      }
    }

    let beginsaldoCash: number | null = null;
    let btwReservering: number | null = null;
    {
      const { data: settings } = await sb
        .from("dashboard_instellingen")
        .select("beginsaldo_cash, btw_reservering")
        .limit(1)
        .maybeSingle();
      if (settings) {
        beginsaldoCash =
          settings.beginsaldo_cash != null
            ? Number(settings.beginsaldo_cash)
            : null;
        btwReservering =
          settings.btw_reservering != null
            ? Number(settings.btw_reservering)
            : null;
      }
    }

    const financial = buildFinancialDashboard(
      raw,
      kosten,
      adviseurId,
      financialRange,
      undefined,
      commissieMap,
      { beginsaldoCash, btwReservering, tarikId }
    );

    return NextResponse.json({
      tree,
      attribution,
      financial,
      geo,
      geoPeriod: geoResolved.period,
      geoPeriodLabel: geoResolved.label,
      geoRangeStartYmd: geoResolved.startYmd,
      geoRangeEndYmd: geoResolved.endYmd,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Rapportage laden mislukt") },
      { status: 500 }
    );
  }
}
