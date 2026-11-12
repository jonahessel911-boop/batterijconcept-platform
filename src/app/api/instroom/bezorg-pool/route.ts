import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { geocodeAddress } from "@/lib/travel-time";
import {
  buildInkoopChecklist,
  orderInkoopSamenvatting,
  type MateriaalChecks,
} from "@/lib/project-inkoop-checklist";
import {
  PRODUCT_SELECT_BASE,
  PRODUCT_SELECT_INKOOP,
  defaultInkoopVoorSku,
  hasInkoopProductColumns,
  type ProductInkoop,
} from "@/lib/inkoop";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

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

async function geocodeNl(
  adres: string
): Promise<{ lat: number; lng: number } | null> {
  const t = adres.trim();
  if (!t) return null;
  const point = await geocodeAddress(
    /nederland|netherlands/i.test(t) ? t : `${t}, Nederland`
  );
  if (!point) return null;
  const lat = Number(point.lat);
  const lng = Number(point.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Pool = Purchasing desk "Geleverd" (materiaal binnen) die nog niet
 * via een bezorg-route-stop zijn afgeleverd bij de klant.
 */
export async function GET() {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: deliveredStops } = await sb
      .from("bezorg_route_stops")
      .select("project_id")
      .not("geleverd_at", "is", null);

    const alreadyDelivered = new Set(
      (deliveredStops || []).map((r) => r.project_id as string)
    );

    const useInkoopCols = await hasInkoopProductColumns(sb);
    const productSelect = useInkoopCols
      ? PRODUCT_SELECT_INKOOP
      : PRODUCT_SELECT_BASE;

    const [projRes, productenRes] = await Promise.all([
      sb
        .from("projecten")
        .select(
          "id, project_nummer, titel, status, materiaal_checks, offerte_id, leads(naam, postcode, huisnummer, toevoeging, straat, plaats)"
        )
        .not("materiaal_checks", "is", null)
        .order("updated_at", { ascending: false })
        .limit(400),
      sb.from("producten").select(productSelect).eq("actief", true),
    ]);

    if (projRes.error) throw projRes.error;

    const producten = ((productenRes.data || []) as unknown as Record<
      string,
      unknown
    >[]).map((r) => mapProduct(r));

    const offerteIds = [
      ...new Set(
        (projRes.data || [])
          .map((p) => p.offerte_id as string | null)
          .filter(Boolean) as string[]
      ),
    ];

    const regelsByOfferte = new Map<
      string,
      {
        id: string;
        omschrijving: string;
        aantal: number;
        product_id?: string | null;
      }[]
    >();

    if (offerteIds.length) {
      const { data: regels } = await sb
        .from("offerte_regels")
        .select("id, offerte_id, omschrijving, aantal, product_id")
        .in("offerte_id", offerteIds);
      for (const r of regels || []) {
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

    type PoolItem = {
      project_id: string;
      project_nummer: string | null;
      klant_naam: string;
      adres: string;
      lat: number | null;
      lng: number | null;
      batterij_label: string;
    };

    const candidates: Omit<PoolItem, "lat" | "lng">[] = [];

    for (const p of projRes.data || []) {
      const id = p.id as string;
      if (alreadyDelivered.has(id)) continue;

      const checks = (p.materiaal_checks || {}) as MateriaalChecks;
      const offerteId = (p.offerte_id as string | null) || null;
      const regels = offerteId ? regelsByOfferte.get(offerteId) || [] : [];
      const items = buildInkoopChecklist(regels, producten, checks);
      if (items.length === 0) continue;
      const summary = orderInkoopSamenvatting(items, checks);
      if (summary.overall !== "geleverd") continue;

      const leadRaw = p.leads as
        | {
            naam?: string | null;
            postcode?: string | null;
            huisnummer?: string | null;
            toevoeging?: string | null;
            straat?: string | null;
            plaats?: string | null;
          }
        | {
            naam?: string | null;
            postcode?: string | null;
            huisnummer?: string | null;
            toevoeging?: string | null;
            straat?: string | null;
            plaats?: string | null;
          }[]
        | null;
      const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
      const line1 = [lead?.straat, lead?.huisnummer, lead?.toevoeging]
        .filter(Boolean)
        .join(" ")
        .trim();
      const line2 = [lead?.postcode, lead?.plaats].filter(Boolean).join(" ");
      const adres = [line1, line2].filter(Boolean).join(", ");
      if (!adres) continue;

      const batterij = items.find((i) =>
        /batterij/i.test(`${i.label} ${i.key}`)
      );
      candidates.push({
        project_id: id,
        project_nummer: (p.project_nummer as string | null) || null,
        klant_naam: lead?.naam || (p.titel as string) || "Onbekend",
        adres,
        batterij_label: batterij?.label || "Batterij (geleverd)",
      });
    }

    // Geocode max 40 voor snelle pool
    const pool: PoolItem[] = [];
    for (const c of candidates.slice(0, 40)) {
      const pt = await geocodeNl(c.adres);
      pool.push({
        ...c,
        lat: pt?.lat ?? null,
        lng: pt?.lng ?? null,
      });
    }

    return NextResponse.json({
      items: pool,
      total_geleverd: candidates.length,
      draft: true,
    });
  } catch (e) {
    const msg = errMessage(e);
    if (
      msg.includes("bezorg_route_stops") ||
      msg.includes("schema cache") ||
      msg.includes("does not exist")
    ) {
      return NextResponse.json({
        items: [],
        total_geleverd: 0,
        draft: true,
        warning:
          "Voer supabase/migrate-bezorg-routes.sql uit om routes op te slaan.",
      });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
