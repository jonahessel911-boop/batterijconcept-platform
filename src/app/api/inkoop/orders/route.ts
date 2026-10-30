import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { remapLegacyProjectStatus } from "@/lib/project-status-config";
import { orderBetalingProgress } from "@/lib/aanbetaling";
import { isSchouwFormulier } from "@/lib/project-documenten";
import { AMSTERDAM_TZ } from "@/lib/format";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
} from "@/lib/schouw-week";
import {
  buildInkoopChecklist,
  inkoopBesteldTotaalExBtw,
  inkoopChecklistTotaalExBtw,
  inkoopTeBestellenTotaalExBtw,
  INKOOP_LEVERANCIER,
  orderInkoopSamenvatting,
  resolveInkoopRegelStatus,
  type InkoopLeverancierStatus,
  type InkoopRegelStatus,
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
import { resolveMateriaalLeverdatum } from "@/lib/materiaal-leverdatum";
import {
  resolveInkoopLeverancierBetaaldOp,
  resolveInkoopLeverancierStatus,
} from "@/lib/inkoop-leverancier-betaling";

export const runtime = "nodejs";

/** Horizon voor WF-omzetkaart op Purchasing. */
const WF_FORECAST_DAYS = 35; // 5 weken

function firstJoin<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

function isWarmtefondsRow(p: {
  betaalwijze?: string | null;
  leads?:
    | { status?: string | null }
    | { status?: string | null }[]
    | null;
  offertes?:
    | { financiering_voorbehoud?: boolean | null }
    | { financiering_voorbehoud?: boolean | null }[]
    | null;
}): boolean {
  const lead = firstJoin(p.leads);
  const off = firstJoin(p.offertes);
  const leadStatus = lead?.status || null;
  if (leadStatus === "sale_eigen_middelen") return false;
  if (leadStatus === "sale_financiering") return true;
  if (p.betaalwijze === "eigen_middelen") return false;
  if (p.betaalwijze === "warmtefonds") return true;
  return Boolean(off?.financiering_voorbehoud);
}


/**
 * Kandidaten voor Purchasing.
 * Harde poort: volledig betaald offertebedrag.
 * Schouwformulier is niet verplicht.
 */
const CANDIDATE_STATUSES = new Set([
  "aanbetaling_betaald",
  "schouwdag_ingepland",
  "schouw_voltooid",
  "restfactuur_verstuurd",
  "restfactuur_betaald",
  "materiaal_besteld",
  "installatie_ingepland",
  "installatie_voltooid",
  "review_gevraagd",
  "afgerond",
  "service",
]);

function mapProduct(row: Record<string, unknown>): ProductInkoop {
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
}

async function requirePurchasingAccess() {
  const jar = await cookies();
  const raw = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!raw) return { error: "Niet ingelogd", status: 401 as const };
  const { resolveLiveSession } = await import("@/lib/auth-require-admin");
  const session = await resolveLiveSession(raw);
  const mag =
    session.rol === "admin" ||
    session.rol === "backoffice" ||
    isAdminEmail(session.email) ||
    isAdminAdviseur({ naam: session.naam, email: session.email });
  if (!mag) {
    return {
      error: `Geen toegang (rol: ${session.rol})`,
      status: 403 as const,
    };
  }
  return { session };
}

/**
 * GET /api/inkoop/orders
 * Orders klaar voor / bezig met inkoop bij Apex Power Supplies.
 */
export async function GET(_req: NextRequest) {
  const auth = await requirePurchasingAccess();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = getSupabaseAdmin();

    type ProjRow = Record<string, unknown> & {
      id: string;
      status?: string | null;
      lead_id?: string | null;
      materiaal_leverdatum?: string | null;
      inkoop_leverancier_status?: string | null;
      inkoop_leverancier_betaald_op?: string | null;
    };
    let projecten: ProjRow[] | null = null;
    let pErr: { message?: string; code?: string } | null = null;

    const selectFull =
      "id, project_nummer, status, titel, leveradres, materiaal_checks, materiaal_leverdatum, inkoop_leverancier_status, inkoop_leverancier_betaald_op, offerte_id, lead_id, betaalwijze, schouw_at, schouw_jaar, schouw_week, installatie_at, updated_at, created_at, leads(naam, lead_number, status, postcode, huisnummer, toevoeging, straat, plaats), offertes(id, offerte_nummer, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud)";
    const selectNoLev =
      "id, project_nummer, status, titel, leveradres, materiaal_checks, materiaal_leverdatum, offerte_id, lead_id, betaalwijze, schouw_at, schouw_jaar, schouw_week, installatie_at, updated_at, created_at, leads(naam, lead_number, status, postcode, huisnummer, toevoeging, straat, plaats), offertes(id, offerte_nummer, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud)";
    const selectMinimal =
      "id, project_nummer, status, titel, leveradres, materiaal_checks, offerte_id, lead_id, betaalwijze, schouw_at, schouw_jaar, schouw_week, installatie_at, updated_at, created_at, leads(naam, lead_number, status, postcode, huisnummer, toevoeging, straat, plaats), offertes(id, offerte_nummer, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud)";
    const selectWfForecast =
      "id, project_nummer, status, betaalwijze, offerte_id, installatie_at, materiaal_checks, leads(status), offertes(id, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud)";

    {
      const first = await sb
        .from("projecten")
        .select(selectFull)
        .order("updated_at", { ascending: false })
        .limit(400);
      if (
        first.error &&
        (first.error.code === "42703" ||
          first.error.message?.includes("inkoop_leverancier") ||
          first.error.message?.includes("materiaal_leverdatum"))
      ) {
        const mid = await sb
          .from("projecten")
          .select(selectNoLev)
          .order("updated_at", { ascending: false })
          .limit(400);
        if (
          mid.error &&
          (mid.error.code === "42703" ||
            mid.error.message?.includes("materiaal_leverdatum"))
        ) {
          const retry = await sb
            .from("projecten")
            .select(selectMinimal)
            .order("updated_at", { ascending: false })
            .limit(400);
          projecten = (retry.data || []) as ProjRow[];
          pErr = retry.error;
        } else {
          projecten = (mid.data || []) as ProjRow[];
          pErr = mid.error;
        }
      } else {
        projecten = (first.data || []) as ProjRow[];
        pErr = first.error;
      }
    }

    if (pErr) throw pErr;

    const candidates = (projecten || []).filter((p) => {
      const status = remapLegacyProjectStatus(String(p.status || ""));
      return CANDIDATE_STATUSES.has(status);
    });

    const candidateLeadIds = [
      ...new Set(
        candidates
          .map((p) => p.lead_id as string | null)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    const facturenRes = candidateLeadIds.length
      ? await sb
          .from("facturen")
          .select(
            "id, status, bedrag_inc_btw, omschrijving, credit_van_factuur_id, project_id, offerte_id, lead_id"
          )
          .in("lead_id", candidateLeadIds)
      : {
          data: [] as {
            id: string;
            status: string;
            bedrag_inc_btw: number | null;
            omschrijving: string | null;
            credit_van_factuur_id: string | null;
            project_id: string | null;
            offerte_id: string | null;
            lead_id: string | null;
          }[],
          error: null,
        };

    if (facturenRes.error) throw facturenRes.error;

    const facturenByLead = new Map<string, typeof facturenRes.data>();
    for (const f of facturenRes.data || []) {
      const lid = f.lead_id as string | null;
      if (!lid) continue;
      const list = facturenByLead.get(lid) || [];
      list.push(f);
      facturenByLead.set(lid, list);
    }

    function relatedFacturen(p: (typeof candidates)[number]) {
      const projectId = p.id as string;
      const offerteId = (p.offerte_id as string | null) || null;
      const leadId = (p.lead_id as string | null) || null;
      const leadFacs = (leadId ? facturenByLead.get(leadId) : null) || [];
      return leadFacs.filter(
        (f) =>
          f.project_id === projectId ||
          (offerteId && f.offerte_id === offerteId) ||
          f.project_id == null
      );
    }

    function betalingVoor(p: (typeof candidates)[number]) {
      const off = p.offertes as
        | { totaal_inc_btw?: number | null }
        | null
        | undefined;
      return orderBetalingProgress({
        facturen: relatedFacturen(p),
        orderIncBtw: Number(off?.totaal_inc_btw) || 0,
      });
    }

    // Pipeline: ook deels/niet betaald (voortgangsbalk).
    // Te bestellen blijft: volledig betaald + schouw PDF (client-side desk).
    const visibleCandidates = candidates.filter((p) => {
      const betaling = betalingVoor(p);
      if (betaling.volledig || betaling.betaaldInc > 0) return true;
      // Nog niets betaald maar wel factuur open / status in pipeline → toch tonen
      return relatedFacturen(p).length > 0 || betaling.orderInc > 0;
    });

    const offerteIds = [
      ...new Set(
        visibleCandidates
          .map((p) => p.offerte_id as string | null)
          .filter((id): id is string => Boolean(id))
      ),
    ];

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
    if (productenErr) throw productenErr;

    const regelsRes = offerteIds.length
      ? await sb
          .from("offerte_regels")
          .select("id, offerte_id, omschrijving, aantal, product_id")
          .in("offerte_id", offerteIds)
      : { data: [] as Record<string, unknown>[], error: null };

    if (regelsRes.error) throw regelsRes.error;

    const visibleIds = visibleCandidates.map((p) => p.id as string);
    const fotosRes = visibleIds.length
      ? await sb
          .from("project_fotos")
          .select("id, project_id, storage_path, bestandsnaam, omschrijving, created_at")
          .in("project_id", visibleIds)
      : { data: [] as Record<string, unknown>[], error: null };
    if (fotosRes.error) throw fotosRes.error;

    const schouwFotoByProject = new Map<
      string,
      {
        storage_path: string;
        bestandsnaam: string | null;
      }
    >();
    const schouwPaths: string[] = [];
    for (const f of fotosRes.data || []) {
      if (!isSchouwFormulier(f.omschrijving as string | null)) continue;
      const path = String(f.storage_path || "");
      const naam = (f.bestandsnaam as string | null) || "";
      // Alleen PDF-schouwrapport telt als "schouw gedaan" voor inkoop
      const isPdf = /\.pdf$/i.test(naam) || /\.pdf$/i.test(path);
      if (!isPdf || !path) continue;
      const projectId = f.project_id as string;
      if (schouwFotoByProject.has(projectId)) continue;
      schouwFotoByProject.set(projectId, {
        storage_path: path,
        bestandsnaam: naam || "schouwformulier.pdf",
      });
      schouwPaths.push(path);
    }
    const schouwUrlByPath = new Map<string, string>();
    if (schouwPaths.length > 0) {
      const { data: signed } = await sb.storage
        .from("project-fotos")
        .createSignedUrls(schouwPaths, 60 * 60 * 6);
      for (const item of signed || []) {
        if (item.path && item.signedUrl) {
          schouwUrlByPath.set(item.path, item.signedUrl);
        }
      }
    }

    const producten = (productenRows || []).map((r) =>
      mapProduct(r as Record<string, unknown>)
    );
    const regelsByOfferte = new Map<
      string,
      {
        id: string;
        omschrijving: string;
        aantal: number;
        product_id?: string | null;
      }[]
    >();
    for (const r of regelsRes.data || []) {
      const oid = r.offerte_id as string;
      const list = regelsByOfferte.get(oid) || [];
      list.push({
        id: r.id as string,
        omschrijving: String(r.omschrijving || ""),
        aantal: Number(r.aantal) || 1,
        product_id: (r.product_id as string | null) || null,
      });
      regelsByOfferte.set(oid, list);
    }

    const built = visibleCandidates.map((p) => {
      const status = remapLegacyProjectStatus(String(p.status || ""));
      const offerteId = (p.offerte_id as string | null) || null;
      const regels = offerteId
        ? regelsByOfferte.get(offerteId) || []
        : [];
      const checks = (p.materiaal_checks || {}) as MateriaalChecks;
      const items = buildInkoopChecklist(regels, producten, checks);
      const summary = orderInkoopSamenvatting(items, checks);
      const betaling = betalingVoor(p);
      const lead = p.leads as
        | {
            naam?: string | null;
            lead_number?: string | null;
            postcode?: string | null;
            huisnummer?: string | null;
            toevoeging?: string | null;
            straat?: string | null;
            plaats?: string | null;
          }
        | null
        | undefined;
      const off = p.offertes as
        | {
            id?: string;
            offerte_nummer?: string | null;
            subtotaal_ex_btw?: number | null;
            totaal_inc_btw?: number | null;
          }
        | null
        | undefined;

      const adresParts = [
        [lead?.straat, lead?.huisnummer, lead?.toevoeging]
          .filter(Boolean)
          .join(" "),
        [lead?.postcode, lead?.plaats].filter(Boolean).join(" "),
      ].filter(Boolean);

      const schouwProj = {
        schouw_at: (p.schouw_at as string | null) || null,
        schouw_jaar: (p.schouw_jaar as number | null) ?? null,
        schouw_week: (p.schouw_week as number | null) ?? null,
      };
      const dagDefinitief = isSchouwdagDefinitief(schouwProj);
      const foto = schouwFotoByProject.get(p.id as string);
      const formulierUrl = foto
        ? schouwUrlByPath.get(foto.storage_path) || null
        : null;
      const weekLabel = formatProjectSchouwWeek(schouwProj);
      // Schouw gedaan = PDF-schouwrapport aanwezig (niet op status)
      const schouwKind: "voltooid" | "dag" | "week" | "niet" = foto
        ? "voltooid"
        : dagDefinitief
          ? "dag"
          : weekLabel
            ? "week"
            : "niet";

      const levStatus: InkoopLeverancierStatus = resolveInkoopLeverancierStatus({
        inkoop_leverancier_status: p.inkoop_leverancier_status,
        materiaal_checks:
          (p.materiaal_checks as Record<string, unknown> | null) || null,
      });
      const levBetaaldOp = resolveInkoopLeverancierBetaaldOp({
        inkoop_leverancier_betaald_op: p.inkoop_leverancier_betaald_op,
        materiaal_checks:
          (p.materiaal_checks as Record<string, unknown> | null) || null,
      });
      const teBestellenEx = inkoopTeBestellenTotaalExBtw(items, checks);
      const besteldEx = inkoopBesteldTotaalExBtw(items, checks);

      return {
        id: p.id as string,
        project_nummer: p.project_nummer as string | null,
        status,
        titel: p.titel as string | null,
        leveradres: (p.leveradres as string | null) || adresParts.join(", ") || null,
        leverancier: INKOOP_LEVERANCIER,
        klant: lead?.naam || "—",
        lead_number: lead?.lead_number || null,
        offerte_nummer: off?.offerte_nummer || null,
        updated_at: p.updated_at as string,
        inkoop_totaal_ex_btw: inkoopChecklistTotaalExBtw(items, checks),
        te_bestellen_ex_btw: teBestellenEx,
        besteld_ex_btw: besteldEx,
        inkoop_extra_notities: (() => {
          const raw = checks.__inkoop_extra_notities;
          return typeof raw === "string" && raw.trim() ? raw.trim() : null;
        })(),
        inkoop_leverancier_status: levStatus,
        inkoop_leverancier_betaald_op: levBetaaldOp,
        klant_betaling: {
          pct: betaling.pct,
          betaald_inc: betaling.betaaldInc,
          order_inc: betaling.orderInc,
          volledig: betaling.volledig,
        },
        schouw: {
          kind: schouwKind,
          at: dagDefinitief ? schouwProj.schouw_at : null,
          week_label: weekLabel,
          formulier_url: formulierUrl,
          formulier_naam: foto?.bestandsnaam || null,
        },
        installatie_at: (p.installatie_at as string | null) || null,
        materiaal_leverdatum: resolveMateriaalLeverdatum({
          materiaal_leverdatum:
            ((p as { materiaal_leverdatum?: string | null })
              .materiaal_leverdatum as string | null) || null,
          materiaal_checks:
            (p.materiaal_checks as Record<string, unknown> | null) || null,
        }),
        summary,
        items: items.map((item) => {
          const lineStatus: InkoopRegelStatus = resolveInkoopRegelStatus(
            item,
            checks
          );
          return {
            key: item.key,
            label: item.label,
            sku: item.sku,
            aantal: item.aantal,
            inkoop_ex_btw: item.inkoopExBtw,
            status: lineStatus,
            notitie: item.notitie || null,
          };
        }),
      };
    });

    const orders = built;

    // Eerst open inkoop, binnen die groep: schouw klaar → dag → week → niet
    const rank = (s: InkoopRegelStatus | "deels") => {
      if (s === "te_kopen") return 0;
      if (s === "deels") return 1;
      if (s === "besteld") return 2;
      return 3;
    };
    const schouwRank = (k: "voltooid" | "dag" | "week" | "niet") => {
      if (k === "voltooid") return 0;
      if (k === "dag") return 1;
      if (k === "week") return 2;
      return 3;
    };
    orders.sort((a, b) => {
      const d = rank(a.summary.overall) - rank(b.summary.overall);
      if (d !== 0) return d;
      const s = schouwRank(a.schouw.kind) - schouwRank(b.schouw.kind);
      if (s !== 0) return s;
      // Dichtstbijzijnde schouwdag eerst
      if (a.schouw.at && b.schouw.at) {
        return a.schouw.at.localeCompare(b.schouw.at);
      }
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    });

    let teBestellenEuro = 0;
    let opKredietEuro = 0;
    let opKredietCount = 0;
    let betaaldEuro = 0;
    let betaaldCount = 0;
    for (const o of orders) {
      teBestellenEuro += o.te_bestellen_ex_btw;
      if (o.inkoop_leverancier_status === "op_krediet") {
        opKredietEuro += o.besteld_ex_btw;
        opKredietCount += 1;
      } else if (o.inkoop_leverancier_status === "betaald") {
        betaaldEuro += o.besteld_ex_btw;
        betaaldCount += 1;
      }
    }

    // —— WF-forecast: alle WF-orders met installatie binnen 5 weken ——
    const now = new Date();
    const vanYmd = formatInTimeZone(now, AMSTERDAM_TZ, "yyyy-MM-dd");
    const totYmd = formatInTimeZone(
      addDays(now, WF_FORECAST_DAYS - 1),
      AMSTERDAM_TZ,
      "yyyy-MM-dd"
    );
    const vanIso = fromZonedTime(
      (() => {
        const [y, m, d] = vanYmd.split("-").map(Number);
        return new Date(y, m - 1, d, 0, 0, 0, 0);
      })(),
      AMSTERDAM_TZ
    ).toISOString();
    const totEndIso = fromZonedTime(
      (() => {
        const [y, m, d] = totYmd.split("-").map(Number);
        return new Date(y, m - 1, d, 23, 59, 59, 999);
      })(),
      AMSTERDAM_TZ
    ).toISOString();

    let wfOmzetEx = 0;
    let wfOmzetInc = 0;
    let wfInkoopEx = 0;
    let wfInkoopTeBestellen = 0;
    let wfInkoopBesteld = 0;
    let wfCount = 0;

    {
      const wfRes = await sb
        .from("projecten")
        .select(selectWfForecast)
        .not("installatie_at", "is", null)
        .gte("installatie_at", vanIso)
        .lte("installatie_at", totEndIso)
        .neq("status", "geannuleerd")
        .limit(500);

      // Fallback zonder betaalwijze-kolom
      let wfRows = (wfRes.data || []) as Record<string, unknown>[];
      if (
        wfRes.error &&
        (wfRes.error.code === "42703" ||
          wfRes.error.message?.includes("betaalwijze"))
      ) {
        const retry = await sb
          .from("projecten")
          .select(
            "id, project_nummer, status, offerte_id, installatie_at, materiaal_checks, leads(status), offertes(id, subtotaal_ex_btw, totaal_inc_btw, financiering_voorbehoud)"
          )
          .not("installatie_at", "is", null)
          .gte("installatie_at", vanIso)
          .lte("installatie_at", totEndIso)
          .neq("status", "geannuleerd")
          .limit(500);
        if (retry.error) throw retry.error;
        wfRows = (retry.data || []) as Record<string, unknown>[];
      } else if (wfRes.error) {
        throw wfRes.error;
      }

      const wfOfferteIds = [
        ...new Set(
          wfRows
            .map((p) => p.offerte_id as string | null)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      const missingOfferteIds = wfOfferteIds.filter(
        (id) => !regelsByOfferte.has(id)
      );
      if (missingOfferteIds.length > 0) {
        const extraRegels = await sb
          .from("offerte_regels")
          .select("id, offerte_id, omschrijving, aantal, product_id")
          .in("offerte_id", missingOfferteIds);
        if (extraRegels.error) throw extraRegels.error;
        for (const r of extraRegels.data || []) {
          const oid = r.offerte_id as string;
          const list = regelsByOfferte.get(oid) || [];
          list.push({
            id: r.id as string,
            omschrijving: String(r.omschrijving || ""),
            aantal: Number(r.aantal) || 1,
            product_id: (r.product_id as string | null) || null,
          });
          regelsByOfferte.set(oid, list);
        }
      }

      for (const raw of wfRows) {
        const p = raw as {
          id: string;
          status?: string | null;
          betaalwijze?: string | null;
          offerte_id?: string | null;
          materiaal_checks?: MateriaalChecks | null;
          leads?:
            | { status?: string | null }
            | { status?: string | null }[]
            | null;
          offertes?:
            | {
                subtotaal_ex_btw?: number | null;
                totaal_inc_btw?: number | null;
                financiering_voorbehoud?: boolean | null;
              }
            | {
                subtotaal_ex_btw?: number | null;
                totaal_inc_btw?: number | null;
                financiering_voorbehoud?: boolean | null;
              }[]
            | null;
        };
        if (!isWarmtefondsRow(p)) continue;
        const rawStatus = String(p.status || "");
        if (rawStatus === "geannuleerd" || rawStatus === "afgerond") continue;
        const status = remapLegacyProjectStatus(rawStatus);
        if (status === "afgerond") continue;

        const off = firstJoin(p.offertes);
        const offerteId = (p.offerte_id as string | null) || null;
        const regels = offerteId
          ? regelsByOfferte.get(offerteId) || []
          : [];
        const checks = (p.materiaal_checks || {}) as MateriaalChecks;
        const items = buildInkoopChecklist(regels, producten, checks);

        wfCount += 1;
        wfOmzetEx += Number(off?.subtotaal_ex_btw) || 0;
        wfOmzetInc += Number(off?.totaal_inc_btw) || 0;
        wfInkoopEx += inkoopChecklistTotaalExBtw(items, checks);
        wfInkoopTeBestellen += inkoopTeBestellenTotaalExBtw(items, checks);
        wfInkoopBesteld += inkoopBesteldTotaalExBtw(items, checks);
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return NextResponse.json({
      leverancier: INKOOP_LEVERANCIER,
      orders,
      totals: {
        te_bestellen_ex_btw: round2(teBestellenEuro),
        op_krediet_ex_btw: round2(opKredietEuro),
        op_krediet_count: opKredietCount,
        betaald_ex_btw: round2(betaaldEuro),
        betaald_count: betaaldCount,
      },
      wf_forecast_5w: {
        horizon_days: WF_FORECAST_DAYS,
        van: vanYmd,
        tot: totYmd,
        orders: wfCount,
        omzet_ex_btw: round2(wfOmzetEx),
        omzet_inc_btw: round2(wfOmzetInc),
        inkoop_ex_btw: round2(wfInkoopEx),
        inkoop_te_bestellen_ex_btw: round2(wfInkoopTeBestellen),
        inkoop_besteld_ex_btw: round2(wfInkoopBesteld),
      },
      counts: {
        te_kopen: orders.filter((o) => o.summary.overall === "te_kopen").length,
        deels: orders.filter((o) => o.summary.overall === "deels").length,
        besteld: orders.filter((o) => o.summary.overall === "besteld").length,
        geleverd: orders.filter((o) => o.summary.overall === "geleverd").length,
        op_krediet: opKredietCount,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}
