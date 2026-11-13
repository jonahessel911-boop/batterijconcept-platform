import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import {
  WARMTEPOMP_CATALOGUS,
  WARMTEPOMP_MERK,
  WARMTEPOMP_OPSLAAG_INCL,
  warmtepompSku,
  warmtepompSkusVoorAdviseur,
  warmtepompVerkoopExcl,
  warmtepompVerkoopIncl,
} from "@/lib/warmtepomp-producten";

export const runtime = "nodejs";

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session?.adviseurId) {
    return { error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }) };
  }
  if (normalizeRol(session.rol) !== "admin") {
    return {
      error: NextResponse.json(
        { error: "Alleen admin zet producten aan" },
        { status: 403 }
      ),
    };
  }
  return { session };
}

/** GET /api/adviseurs/warmtepompen?adviseur_id= */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const adviseurId = req.nextUrl.searchParams.get("adviseur_id")?.trim() || "";
    if (!adviseurId) {
      return NextResponse.json({ error: "adviseur_id is verplicht" }, { status: 400 });
    }
    const sb = getSupabaseAdmin();
    const skus = warmtepompSkusVoorAdviseur(adviseurId);
    const { data, error } = await sb
      .from("producten")
      .select("sku, actief")
      .in("sku", skus);
    if (error) throw error;
    const actief = (data || []).filter((row) => row.actief !== false).length;
    return NextResponse.json({
      aan: actief === skus.length,
      aantal: actief,
      producten: WARMTEPOMP_CATALOGUS.map((item) => ({
        naam: item.naam,
        inkoopExcl: item.inkoopExcl,
        verkoopIncl: warmtepompVerkoopIncl(item.adviesIncl),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Warmtepompen laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/adviseurs/warmtepompen
 * { adviseur_id, aan }
 * Zet alleen de TC Swiss-warmtepompen aan of uit voor díe adviseur.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    let body: { adviseur_id?: string; aan?: boolean };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
    }
    const adviseurId = body.adviseur_id?.trim() || "";
    if (!adviseurId || typeof body.aan !== "boolean") {
      return NextResponse.json(
        { error: "adviseur_id en aan zijn verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: adviseur, error: advErr } = await sb
      .from("adviseurs")
      .select("id, naam, rol")
      .eq("id", adviseurId)
      .maybeSingle();
    if (advErr || !adviseur) {
      return NextResponse.json({ error: "Adviseur niet gevonden" }, { status: 404 });
    }
    if (normalizeRol(adviseur.rol) !== "adviseur") {
      return NextResponse.json(
        { error: "Warmtepompen zet je alleen aan bij een adviseur" },
        { status: 400 }
      );
    }

    const skus = warmtepompSkusVoorAdviseur(adviseurId);

    if (!body.aan) {
      const { error } = await sb
        .from("producten")
        .update({ actief: false })
        .in("sku", skus);
      if (error) throw error;
      return NextResponse.json({
        aan: false,
        aantal: 0,
        message: `Warmtepompen uit voor ${adviseur.naam}. Andere accounts zijn niet aangepast.`,
      });
    }

    const rows = WARMTEPOMP_CATALOGUS.map((item) => ({
      sku: warmtepompSku(adviseurId, item.code),
      naam: item.naam,
      omschrijving: `Merk ${WARMTEPOMP_MERK}. Verkoopprijs €${warmtepompVerkoopIncl(item.adviesIncl).toLocaleString("nl-NL")} incl. btw (adviesprijs + €${WARMTEPOMP_OPSLAAG_INCL.toLocaleString("nl-NL")}; €-marge ≈ 9,3 kWh-batterij).`,
      prijs_ex_btw: warmtepompVerkoopExcl(item.adviesIncl),
      btw_percentage: 21,
      eenheid: "stuk",
      actief: true,
      inkoop_batterij: item.inkoopExcl,
      inkoop_omvormer: 0,
      inkoop_installatie: 0,
      inkoop_warmtefonds: 0,
    }));

    let { error } = await sb.from("producten").upsert(rows, { onConflict: "sku" });
    if (error && /inkoop_/i.test(error.message || "")) {
      const zonderInkoop = rows.map(
        ({
          inkoop_batterij: _b,
          inkoop_omvormer: _o,
          inkoop_installatie: _i,
          inkoop_warmtefonds: _w,
          ...rest
        }) => rest
      );
      const retry = await sb.from("producten").upsert(zonderInkoop, { onConflict: "sku" });
      error = retry.error;
    }
    if (error) throw error;

    return NextResponse.json({
      aan: true,
      aantal: rows.length,
      message: `${rows.length} warmtepompen van ${WARMTEPOMP_MERK} staan nu alleen bij ${adviseur.naam}.`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Warmtepompen opslaan mislukt") },
      { status: 500 }
    );
  }
}
