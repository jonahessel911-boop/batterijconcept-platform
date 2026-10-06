import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";

export type SalesLeaderboardSale = {
  id: string;
  offerte_nummer: string | null;
  adviseur_naam: string;
  klant_naam: string | null;
  bedrag_inc: number;
  ondertekend_op: string;
};

/**
 * GET /api/sales-leaderboard?since=ISO
 * Recente ondertekende offertes (sales) voor het leaderboard.
 */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const rol = normalizeRol(session.rol);
  if (rol !== "admin" && rol !== "adviseur" && rol !== "backoffice") {
    return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  }

  const sinceRaw = req.nextUrl.searchParams.get("since")?.trim() || "";
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const sinceOk = since && !Number.isNaN(since.getTime()) ? since : null;

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("offertes")
      .select(
        "id, offerte_nummer, status, totaal_inc_btw, ondertekend_op, leads(naam, adviseur_id, adviseurs!adviseur_id(id, naam))"
      )
      .eq("status", "ondertekend")
      .not("ondertekend_op", "is", null)
      .order("ondertekend_op", { ascending: false })
      .limit(40);

    if (sinceOk) {
      q = q.gt("ondertekend_op", sinceOk.toISOString());
    }

    const { data, error } = await q;
    if (error) {
      return NextResponse.json(
        { error: "Sales laden mislukt", detail: error.message },
        { status: 500 }
      );
    }

    const sales: SalesLeaderboardSale[] = (data || []).map((row) => {
      const leadRaw = row.leads as
        | {
            naam?: string | null;
            adviseur_id?: string | null;
            adviseurs?:
              | { id: string; naam: string }
              | { id: string; naam: string }[]
              | null;
          }
        | {
            naam?: string | null;
            adviseur_id?: string | null;
            adviseurs?:
              | { id: string; naam: string }
              | { id: string; naam: string }[]
              | null;
          }[]
        | null;
      const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
      const advRaw = lead?.adviseurs;
      const adv = Array.isArray(advRaw) ? advRaw[0] : advRaw;
      return {
        id: row.id as string,
        offerte_nummer: (row.offerte_nummer as string) || null,
        adviseur_naam: adv?.naam || "Onbekend",
        klant_naam: lead?.naam || null,
        bedrag_inc: Number(row.totaal_inc_btw) || 0,
        ondertekend_op: row.ondertekend_op as string,
      };
    });

    return NextResponse.json({
      sales,
      server_time: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
