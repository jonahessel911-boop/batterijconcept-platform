import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import { remapLegacyProjectStatus } from "@/lib/project-status-config";
import { isOrderVolledigBetaald } from "@/lib/aanbetaling";
import { isSchouwFormulier } from "@/lib/project-documenten";
import {
  formatProjectSchouwWeek,
  isSchouwdagDefinitief,
} from "@/lib/schouw-week";
import {
  buildInkoopChecklist,
  inkoopChecklistTotaalExBtw,
  INKOOP_LEVERANCIER,
  orderInkoopSamenvatting,
  resolveInkoopRegelStatus,
  type InkoopRegelStatus,
  type MateriaalChecks,
} from "@/lib/project-inkoop-checklist";
import {
  defaultInkoopVoorSku,
  type ProductInkoop,
} from "@/lib/inkoop";

export const runtime = "nodejs";

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
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) return { error: "Niet ingelogd", status: 401 as const };
  const rol = normalizeRol(session.rol);
  const mag =
    rol === "admin" ||
    rol === "backoffice" ||
    isAdminEmail(session.email) ||
    isAdminAdviseur({ naam: session.naam, email: session.email });
  if (!mag) {
    return { error: "Geen toegang", status: 403 as const };
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

    const { data: projecten, error: pErr } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, status, titel, leveradres, materiaal_checks, offerte_id, lead_id, schouw_at, schouw_jaar, schouw_week, installatie_at, updated_at, created_at, leads(naam, lead_number, postcode, huisnummer, toevoeging, straat, plaats), offertes(id, offerte_nummer, subtotaal_ex_btw, totaal_inc_btw)"
      )
      .order("updated_at", { ascending: false })
      .limit(400);

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

    const paidCandidates = candidates.filter((p) => {
      const projectId = p.id as string;
      const offerteId = (p.offerte_id as string | null) || null;
      const leadId = (p.lead_id as string | null) || null;
      const off = p.offertes as
        | { totaal_inc_btw?: number | null }
        | null
        | undefined;
      const orderIncBtw = Number(off?.totaal_inc_btw) || 0;

      const leadFacs = (leadId ? facturenByLead.get(leadId) : null) || [];
      const related = leadFacs.filter(
        (f) =>
          f.project_id === projectId ||
          (offerteId && f.offerte_id === offerteId) ||
          f.project_id == null
      );

      return isOrderVolledigBetaald({
        facturen: related,
        orderIncBtw,
      });
    });

    const offerteIds = [
      ...new Set(
        paidCandidates
          .map((p) => p.offerte_id as string | null)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    let productenQuery = await sb
      .from("producten")
      .select(
        "id, sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief, inkoop_batterij, inkoop_omvormer, inkoop_installatie, inkoop_warmtefonds"
      )
      .eq("actief", true);

    if (
      productenQuery.error &&
      (productenQuery.error.code === "42703" ||
        productenQuery.error.message?.includes("inkoop_"))
    ) {
      productenQuery = (await sb
        .from("producten")
        .select(
          "id, sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief"
        )
        .eq("actief", true)) as typeof productenQuery;
    }
    if (productenQuery.error) throw productenQuery.error;

    const regelsRes = offerteIds.length
      ? await sb
          .from("offerte_regels")
          .select("id, offerte_id, omschrijving, aantal, product_id")
          .in("offerte_id", offerteIds)
      : { data: [] as Record<string, unknown>[], error: null };

    if (regelsRes.error) throw regelsRes.error;

    const paidIds = paidCandidates.map((p) => p.id as string);
    const fotosRes = paidIds.length
      ? await sb
          .from("project_fotos")
          .select("id, project_id, storage_path, bestandsnaam, omschrijving, created_at")
          .in("project_id", paidIds)
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

    const producten = (productenQuery.data || []).map((r) =>
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

    const built = paidCandidates.map((p) => {
      const status = remapLegacyProjectStatus(String(p.status || ""));
      const offerteId = (p.offerte_id as string | null) || null;
      const regels = offerteId
        ? regelsByOfferte.get(offerteId) || []
        : [];
      const items = buildInkoopChecklist(regels, producten);
      const checks = (p.materiaal_checks || {}) as MateriaalChecks;
      const summary = orderInkoopSamenvatting(items, checks);
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
        inkoop_totaal_ex_btw: inkoopChecklistTotaalExBtw(items),
        schouw: {
          kind: schouwKind,
          at: dagDefinitief ? schouwProj.schouw_at : null,
          week_label: weekLabel,
          formulier_url: formulierUrl,
          formulier_naam: foto?.bestandsnaam || null,
        },
        installatie_at: (p.installatie_at as string | null) || null,
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

    return NextResponse.json({
      leverancier: INKOOP_LEVERANCIER,
      orders,
      counts: {
        te_kopen: orders.filter((o) => o.summary.overall === "te_kopen").length,
        deels: orders.filter((o) => o.summary.overall === "deels").length,
        besteld: orders.filter((o) => o.summary.overall === "besteld").length,
        geleverd: orders.filter((o) => o.summary.overall === "geleverd").length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}
