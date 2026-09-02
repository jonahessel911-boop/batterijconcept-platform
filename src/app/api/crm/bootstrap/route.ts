import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";

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
    const [l, a, o, p, f, sCount] = await Promise.all([
      sb.from("leads").select("*").order("created_at", { ascending: false }),
      sb
        .from("afspraken")
        .select(
          "id, start_at, end_at, status, adviseur_id, lead_id, soort, notities"
        )
        .order("start_at", { ascending: true }),
      sb
        .from("offertes")
        .select(
          "*, leads(naam, email, lead_number, postcode, huisnummer, plaats), installatie_partners(id, naam)"
        )
        .order("created_at", { ascending: false }),
      sb
        .from("projecten")
        .select(
          "*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), installatie_partners(id, naam), offertes(id, offerte_nummer, financiering_voorbehoud, aanbetaling_te_innen_inc, ondertekend_op)"
        )
        .order("created_at", { ascending: false }),
      sb
        .from("facturen")
        .select(
          "*, leads(naam, email, telefoon, lead_number), offertes(id, offerte_nummer)"
        )
        .order("created_at", { ascending: false }),
      sb.from("sollicitaties").select("id", { count: "exact", head: true }),
    ]);

    const firstErr = l.error || a.error || o.error || p.error || f.error;
    if (firstErr) throw firstErr;

    return NextResponse.json({
      leads: l.data || [],
      afspraken: a.data || [],
      offertes: o.data || [],
      projecten: p.data || [],
      facturen: f.data || [],
      instroomCount: sCount.count || 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Kon data niet laden") },
      { status: 500 }
    );
  }
}
