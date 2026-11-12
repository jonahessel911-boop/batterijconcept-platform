import { NextRequest, NextResponse } from "next/server";
import { errMessage } from "@/lib/errors";
import {
  edergyBedragenVanInc,
  leesEdergyTariefVoorOperator,
} from "@/lib/edergy-tarief";
import { resolveWarmtefondsOperator } from "@/lib/warmtefonds-portal";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** GET — account + tarief van deze WF-persoon. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }
    const tarief = await leesEdergyTariefVoorOperator(operator.tarief_inc);
    return NextResponse.json({
      operator: {
        id: operator.id,
        naam: operator.naam,
        email: operator.email,
        telefoon: operator.telefoon,
        tarief_inc: operator.tarief_inc ?? null,
      },
      tarief: {
        per_aanvraag_inc: tarief.perAanvraagInc,
        per_aanvraag_excl: tarief.perAanvraagExcl,
        per_aanvraag_btw: tarief.perAanvraagBtw,
        eigen: operator.tarief_inc != null && Number(operator.tarief_inc) > 0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH — eigen vergoeding per aanvraag opslaan. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  let body: { tarief_inc?: number | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    let tariefInc: number | null = null;
    if (body.tarief_inc !== undefined && body.tarief_inc !== null) {
      const n = Number(body.tarief_inc);
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json(
          { error: "Vul een geldig bedrag in (incl. btw)" },
          { status: 400 }
        );
      }
      tariefInc = Math.round(n * 100) / 100;
    }

    const { data, error } = await sb
      .from("warmtefonds_operators")
      .update({ tarief_inc: tariefInc })
      .eq("id", operator.id)
      .select("id, naam, email, telefoon, tarief_inc")
      .single();
    if (error) {
      if (error.code === "42703" || error.message?.includes("tarief_inc")) {
        return NextResponse.json(
          {
            error:
              "Kolom tarief_inc ontbreekt — draai migrate-warmtefonds-operator-tarief.sql",
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const bedragen = await leesEdergyTariefVoorOperator(
      data?.tarief_inc ?? tariefInc
    );
    return NextResponse.json({
      operator: data,
      tarief: {
        per_aanvraag_inc: bedragen.perAanvraagInc,
        per_aanvraag_excl: bedragen.perAanvraagExcl,
        per_aanvraag_btw: bedragen.perAanvraagBtw,
        eigen: tariefInc != null,
      },
      preview: edergyBedragenVanInc(tariefInc ?? bedragen.perAanvraagInc),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}
