import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requirePartnerPortal } from "@/lib/installatie-portal";
import {
  aggregateForecast,
  buildWeeksUntil,
  FORECAST_WEEKEN_NA_ONDERTEKENING,
} from "@/lib/installatie-verwachting";

export const runtime = "nodejs";

function nextJan1(from = new Date()) {
  const y = from.getFullYear();
  const thisYear = new Date(Date.UTC(y, 0, 1));
  if (from.getTime() < thisYear.getTime()) return thisYear;
  return new Date(Date.UTC(y + 1, 0, 1));
}

/** GET — partner pipeline: verkochte orders per week/regio (definitief vs concept) */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const partner = await requirePartnerPortal(token, req);
    if (!partner) {
      return NextResponse.json(
        { error: "Geen toegang — alleen beheerders zien de pipeline." },
        { status: 403 }
      );
    }

    const now = new Date();
    const jan1 = nextJan1(now);
    const weeks = buildWeeksUntil(jan1, now);
    const fromIso = weeks[0] ? weeks[0].key : now.toISOString();
    const toIso = jan1.toISOString();

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, status, installatie_at, created_at, leads(postcode, plaats, straat, huisnummer, toevoeging), offertes(ondertekend_op)"
      )
      .eq("installatie_partner_id", partner.id)
      .not(
        "status",
        "in",
        "(annulering,hold_sales_actie,installatie_voltooid,afgerond,review_gevraagd)"
      );

    if (error) throw error;

    let teamgenoten: {
      id?: string;
      actief?: boolean | null;
      kan_installatie?: boolean | null;
      regios?: unknown;
    }[] = [];

    const tg = await sb
      .from("installatie_partner_teamgenoten")
      .select("id, actief, kan_installatie, regios")
      .eq("partner_id", partner.id);

    if (!tg.error && tg.data) {
      teamgenoten = tg.data;
    } else if (tg.error) {
      const soft = await sb
        .from("installatie_partner_teamgenoten")
        .select("id, actief, kan_installatie")
        .eq("partner_id", partner.id);
      if (!soft.error && soft.data) teamgenoten = soft.data;
    }

    let koppels: {
      actief?: boolean | null;
      monteur_1_id?: string | null;
      monteur_2_id?: string | null;
      monteur_1?: {
        id?: string;
        actief?: boolean | null;
        kan_installatie?: boolean | null;
        regios?: unknown;
      } | null;
      monteur_2?: {
        id?: string;
        actief?: boolean | null;
        kan_installatie?: boolean | null;
        regios?: unknown;
      } | null;
    }[] = [];

    const kp = await sb
      .from("installatie_partner_koppels")
      .select(
        "actief, monteur_1_id, monteur_2_id, monteur_1:installatie_partner_teamgenoten!monteur_1_id(id, actief, kan_installatie, regios), monteur_2:installatie_partner_teamgenoten!monteur_2_id(id, actief, kan_installatie, regios)"
      )
      .eq("partner_id", partner.id);

    if (!kp.error && kp.data) {
      koppels = kp.data as typeof koppels;
    }

    const agg = aggregateForecast(data || [], weeks, now, teamgenoten, koppels);

    return NextResponse.json({
      partner: { id: partner.id, naam: partner.naam },
      from: fromIso,
      to: toIso,
      weeks,
      regel: `Definitief = geplande installatiedatum · Concept = verkocht, nog ≈ ${FORECAST_WEEKEN_NA_ONDERTEKENING} weken na tekenen.`,
      ...agg,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Pipeline laden mislukt") },
      { status: 500 }
    );
  }
}
