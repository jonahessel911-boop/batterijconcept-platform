import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { magSalesSturing, normalizeRol } from "@/lib/rollen";
import { buildAdviseurDekking } from "@/lib/adviseur-dekking";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { AMSTERDAM_TZ } from "@/lib/format";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/rapportage/adviseur-dekking?jaar=&maand=
 * Adviseurs op de kaart + leads binnen ~1u rijden per maand.
 */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  if (!magSalesSturing(normalizeRol(session.rol))) {
    return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const now = new Date();
  const nowY = Number(formatInTimeZone(now, AMSTERDAM_TZ, "yyyy"));
  const nowM = Number(formatInTimeZone(now, AMSTERDAM_TZ, "M"));
  const jaar = Math.min(
    2100,
    Math.max(2020, Number(sp.get("jaar")) || nowY)
  );
  const maand = Math.min(12, Math.max(1, Number(sp.get("maand")) || nowM));

  const startIso = fromZonedTime(
    new Date(jaar, maand - 1, 1, 0, 0, 0, 0),
    AMSTERDAM_TZ
  ).toISOString();
  const endExclusive = fromZonedTime(
    new Date(jaar, maand, 1, 0, 0, 0, 0),
    AMSTERDAM_TZ
  ).toISOString();

  try {
    const sb = getSupabaseAdmin();
    const [{ data: adviseurs, error: advErr }, { data: leads, error: leadErr }] =
      await Promise.all([
        sb
          .from("adviseurs")
          .select("id, naam, email, rol, actief, start_adres")
          .eq("actief", true)
          .order("naam"),
        sb
          .from("leads")
          .select(
            "id, created_at, postcode, plaats, straat, huisnummer, toevoeging"
          )
          .gte("created_at", startIso)
          .lt("created_at", endExclusive)
          .limit(5000),
      ]);

    if (advErr) {
      return NextResponse.json(
        { error: "Adviseurs laden mislukt", detail: advErr.message },
        { status: 500 }
      );
    }
    if (leadErr) {
      return NextResponse.json(
        { error: "Leads laden mislukt", detail: leadErr.message },
        { status: 500 }
      );
    }

    const dekking = await buildAdviseurDekking({
      adviseurs: adviseurs || [],
      leads: leads || [],
      jaar,
      maand,
    });

    return NextResponse.json(dekking);
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Dekking berekenen mislukt") },
      { status: 500 }
    );
  }
}
