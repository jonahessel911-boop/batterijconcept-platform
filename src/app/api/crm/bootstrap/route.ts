import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

export const runtime = "nodejs";

/**
 * GET /api/crm/bootstrap — alle CRM-data via service role (ingelogde sessie).
 * Voorkomt lege schermen door RLS/anon-key issues in de browser.
 */
export async function GET() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  try {
    const sb = getSupabaseAdmin();
    const [leads, afspraken, offertes, projecten, facturen, sCount] =
      await Promise.all([
        fetchAllRows((from, to) =>
          sb
            .from("leads")
            .select("*")
            .order("created_at", { ascending: false })
            .range(from, to)
        ),
        fetchAllRows((from, to) =>
          sb
            .from("afspraken")
            .select(
              "id, start_at, end_at, status, adviseur_id, lead_id, soort, notities"
            )
            .order("start_at", { ascending: true })
            .range(from, to)
        ),
        fetchAllRows((from, to) =>
          sb
            .from("offertes")
            .select(
              "*, leads(naam, email, lead_number, postcode, huisnummer, plaats), installatie_partners(id, naam)"
            )
            .order("created_at", { ascending: false })
            .range(from, to)
        ),
        fetchAllRows((from, to) =>
          sb
            .from("projecten")
            .select(
              "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats, status, adviseur_id, adviseurs!adviseur_id(id, naam)), installatie_partners(id, naam), verantwoordelijke:adviseurs!verantwoordelijke_id(id, naam, email), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, ondertekend_op)"
            )
            .order("created_at", { ascending: false })
            .range(from, to)
        ),
        fetchAllRows((from, to) =>
          sb
            .from("facturen")
            .select(
              "*, leads(naam, email, telefoon, lead_number), offertes(id, offerte_nummer)"
            )
            .order("created_at", { ascending: false })
            .range(from, to)
        ),
        sb.from("sollicitaties").select("id", { count: "exact", head: true }),
      ]);

    return NextResponse.json({
      leads,
      afspraken,
      offertes,
      projecten,
      facturen,
      instroomCount: sCount.count || 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Kon data niet laden") },
      { status: 500 }
    );
  }
}
