import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";

export type SalesLeaderboardKind = "sale" | "netto";

export type SalesLeaderboardSale = {
  id: string;
  kind: SalesLeaderboardKind;
  offerte_nummer: string | null;
  adviseur_naam: string;
  klant_naam: string | null;
  bedrag_inc: number;
  /** Moment van de event (tekenen of installatie uitgevoerd). */
  event_at: string;
};

type LeadJoin = {
  naam?: string | null;
  adviseur_id?: string | null;
  adviseurs?:
    | { id: string; naam: string }
    | { id: string; naam: string }[]
    | null;
};

function pickLead(raw: LeadJoin | LeadJoin[] | null | undefined): LeadJoin | null {
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] || null : raw;
}

function adviseurNaam(lead: LeadJoin | null): string {
  const advRaw = lead?.adviseurs;
  const adv = Array.isArray(advRaw) ? advRaw[0] : advRaw;
  return adv?.naam || "Onbekend";
}

function offerteBedrag(
  offertes:
    | {
        offerte_nummer?: string | null;
        totaal_inc_btw?: number | null;
      }
    | {
        offerte_nummer?: string | null;
        totaal_inc_btw?: number | null;
      }[]
    | null
    | undefined
): { nummer: string | null; bedrag: number } {
  const o = Array.isArray(offertes) ? offertes[0] : offertes;
  return {
    nummer: o?.offerte_nummer || null,
    bedrag: Number(o?.totaal_inc_btw) || 0,
  };
}

/**
 * GET /api/sales-leaderboard?since=ISO
 * - sale: offerte ondertekend
 * - netto: installatie uitgevoerd (installatie_voltooid_at)
 */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const rol = normalizeRol(session.rol);
  if (rol !== "admin") {
    return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
  }

  const sinceRaw = req.nextUrl.searchParams.get("since")?.trim() || "";
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const sinceOk = since && !Number.isNaN(since.getTime()) ? since : null;

  try {
    const sb = getSupabaseAdmin();

    let offertesQ = sb
      .from("offertes")
      .select(
        "id, offerte_nummer, status, totaal_inc_btw, ondertekend_op, leads(naam, adviseur_id, adviseurs!adviseur_id(id, naam))"
      )
      .eq("status", "ondertekend")
      .not("ondertekend_op", "is", null)
      .order("ondertekend_op", { ascending: false })
      .limit(40);

    if (sinceOk) {
      offertesQ = offertesQ.gt("ondertekend_op", sinceOk.toISOString());
    }

    let nettoQ = sb
      .from("projecten")
      .select(
        "id, project_nummer, status, installatie_voltooid_at, offerte_id, leads(naam, adviseur_id, adviseurs!adviseur_id(id, naam)), offertes(id, offerte_nummer, totaal_inc_btw)"
      )
      .not("installatie_voltooid_at", "is", null)
      .order("installatie_voltooid_at", { ascending: false })
      .limit(40);

    if (sinceOk) {
      nettoQ = nettoQ.gt("installatie_voltooid_at", sinceOk.toISOString());
    }

    const [offertesRes, nettoRes] = await Promise.all([offertesQ, nettoQ]);

    if (offertesRes.error) {
      return NextResponse.json(
        { error: "Sales laden mislukt", detail: offertesRes.error.message },
        { status: 500 }
      );
    }

    // Kolom nog niet gemigreerd → alleen signed sales, geen harde fail
    const nettoMissingCol =
      nettoRes.error &&
      (nettoRes.error.message?.includes("installatie_voltooid_at") ||
        nettoRes.error.code === "42703");

    if (nettoRes.error && !nettoMissingCol) {
      return NextResponse.json(
        { error: "Netto sales laden mislukt", detail: nettoRes.error.message },
        { status: 500 }
      );
    }

    const sales: SalesLeaderboardSale[] = [];

    for (const row of offertesRes.data || []) {
      const lead = pickLead(row.leads as LeadJoin | LeadJoin[] | null);
      sales.push({
        id: `sale:${row.id as string}`,
        kind: "sale",
        offerte_nummer: (row.offerte_nummer as string) || null,
        adviseur_naam: adviseurNaam(lead),
        klant_naam: lead?.naam || null,
        bedrag_inc: Number(row.totaal_inc_btw) || 0,
        event_at: row.ondertekend_op as string,
      });
    }

    if (!nettoMissingCol) {
      for (const row of nettoRes.data || []) {
        const lead = pickLead(row.leads as LeadJoin | LeadJoin[] | null);
        const off = offerteBedrag(
          row.offertes as
            | {
                offerte_nummer?: string | null;
                totaal_inc_btw?: number | null;
              }
            | {
                offerte_nummer?: string | null;
                totaal_inc_btw?: number | null;
              }[]
            | null
        );
        sales.push({
          id: `netto:${row.id as string}`,
          kind: "netto",
          offerte_nummer: off.nummer,
          adviseur_naam: adviseurNaam(lead),
          klant_naam: lead?.naam || null,
          bedrag_inc: off.bedrag,
          event_at: row.installatie_voltooid_at as string,
        });
      }
    }

    sales.sort((a, b) => b.event_at.localeCompare(a.event_at));

    return NextResponse.json({
      sales,
      server_time: new Date().toISOString(),
      netto_enabled: !nettoMissingCol,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
