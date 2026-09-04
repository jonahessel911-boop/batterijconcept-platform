import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  DEFAULT_INSTALLATIE_STANDAARD,
  DEFAULT_WARMTEFONDS_AANVRAAG,
  defaultInkoopVoorSku,
  type InkoopInstellingen,
  type ProductInkoop,
} from "@/lib/inkoop";

export const runtime = "nodejs";

const PRODUCT_SELECT =
  "id, sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief, inkoop_batterij, inkoop_omvormer, inkoop_installatie, inkoop_warmtefonds";

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : fallback;
}

function mapProduct(row: Record<string, unknown>): ProductInkoop {
  const sku = (row.sku as string | null) || null;
  const defaults = defaultInkoopVoorSku(sku);
  return {
    id: row.id as string,
    sku,
    naam: row.naam as string,
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

async function loadInstellingen(
  sb: ReturnType<typeof getSupabaseAdmin>
): Promise<InkoopInstellingen> {
  const { data, error } = await sb
    .from("inkoop_instellingen")
    .select("installatie_standaard, warmtefonds_aanvraag")
    .eq("id", 1)
    .maybeSingle();

  if (error || !data) {
    return {
      installatie_standaard: DEFAULT_INSTALLATIE_STANDAARD,
      warmtefonds_aanvraag: DEFAULT_WARMTEFONDS_AANVRAAG,
    };
  }
  return {
    installatie_standaard: num(
      data.installatie_standaard,
      DEFAULT_INSTALLATIE_STANDAARD
    ),
    warmtefonds_aanvraag: num(
      data.warmtefonds_aanvraag,
      DEFAULT_WARMTEFONDS_AANVRAAG
    ),
  };
}

/** GET /api/inkoop — instellingen + producten met inkoop */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const instellingen = await loadInstellingen(sb);

    let { data, error } = await sb
      .from("producten")
      .select(PRODUCT_SELECT)
      .order("sku", { ascending: true });

    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("inkoop_"))
    ) {
      const retry = await sb
        .from("producten")
        .select(
          "id, sku, naam, omschrijving, prijs_ex_btw, btw_percentage, eenheid, actief"
        )
        .order("sku", { ascending: true });
      if (retry.error) throw retry.error;
      data = (retry.data || []).map((p) => {
        const d = defaultInkoopVoorSku(p.sku);
        return { ...p, ...d };
      }) as typeof data;
      error = null;
    }

    if (error) throw error;

    const producten = (data || []).map((r) =>
      mapProduct(r as Record<string, unknown>)
    );

    return NextResponse.json({
      instellingen,
      producten,
      migrationHint:
        producten.some(
          (p) =>
            p.inkoop_batterij === 0 &&
            p.sku?.startsWith("AE-G3")
        )
          ? "Run supabase/migrate-inkoop.sql voor standaard inkoopprijzen"
          : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

type PatchBody = {
  instellingen?: Partial<InkoopInstellingen>;
  producten?: {
    id: string;
    prijs_ex_btw?: number;
    inkoop_batterij?: number;
    inkoop_omvormer?: number;
    inkoop_installatie?: number;
    inkoop_warmtefonds?: number;
    actief?: boolean;
  }[];
};

/** PATCH /api/inkoop — globale defaults en/of productregels bijwerken */
export async function PATCH(req: NextRequest) {
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    if (body.instellingen) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.instellingen.installatie_standaard != null) {
        patch.installatie_standaard = num(
          body.instellingen.installatie_standaard,
          DEFAULT_INSTALLATIE_STANDAARD
        );
      }
      if (body.instellingen.warmtefonds_aanvraag != null) {
        patch.warmtefonds_aanvraag = num(
          body.instellingen.warmtefonds_aanvraag,
          DEFAULT_WARMTEFONDS_AANVRAAG
        );
      }
      const { error } = await sb
        .from("inkoop_instellingen")
        .upsert({ id: 1, ...patch });
      if (error) {
        if (error.code === "42P01" || error.message?.includes("inkoop_instellingen")) {
          return NextResponse.json(
            {
              error:
                "Tabel ontbreekt — voer supabase/migrate-inkoop.sql uit in Supabase",
            },
            { status: 400 }
          );
        }
        throw error;
      }
    }

    if (body.producten?.length) {
      for (const p of body.producten) {
        if (!p.id) continue;
        const patch: Record<string, unknown> = {};
        if (p.prijs_ex_btw != null) patch.prijs_ex_btw = num(p.prijs_ex_btw);
        if (p.inkoop_batterij != null)
          patch.inkoop_batterij = num(p.inkoop_batterij);
        if (p.inkoop_omvormer != null)
          patch.inkoop_omvormer = num(p.inkoop_omvormer);
        if (p.inkoop_installatie != null)
          patch.inkoop_installatie = num(p.inkoop_installatie);
        if (p.inkoop_warmtefonds != null)
          patch.inkoop_warmtefonds = num(p.inkoop_warmtefonds);
        if (p.actief != null) patch.actief = Boolean(p.actief);
        if (Object.keys(patch).length === 0) continue;

        const { error } = await sb
          .from("producten")
          .update(patch)
          .eq("id", p.id);
        if (error) {
          if (
            error.code === "42703" ||
            error.message?.includes("inkoop_")
          ) {
            return NextResponse.json(
              {
                error:
                  "Inkoop-kolommen ontbreken — voer supabase/migrate-inkoop.sql uit",
              },
              { status: 400 }
            );
          }
          throw error;
        }
      }
    }

    // Herlaad
    const instellingen = await loadInstellingen(sb);
    const { data, error } = await sb
      .from("producten")
      .select(PRODUCT_SELECT)
      .order("sku", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      instellingen,
      producten: (data || []).map((r) =>
        mapProduct(r as Record<string, unknown>)
      ),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}
