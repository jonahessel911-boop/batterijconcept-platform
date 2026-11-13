/**
 * GET  /api/finance/betalingen — alle uitgaande betalingen
 * POST /api/finance/betalingen — goedkeuren (+ concept auto-uitbetalen)
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import {
  goedkeurEnBetaal,
  listFinanceBetalingen,
} from "@/lib/finance-uitbetalingen";
import type {
  FinanceBetaling,
  FinanceBron,
  FinanceCategorie,
} from "@/lib/finance-uitbetalingen-types";
import { normalizeRol } from "@/lib/rollen";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

async function requireFinanceAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session?.adviseurId) {
    return { error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }) };
  }
  const rol = normalizeRol(session.rol);
  if (rol !== "admin" && rol !== "sales_manager" && rol !== "backoffice") {
    return { error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  try {
    const auth = await requireFinanceAdmin();
    if ("error" in auth && auth.error) return auth.error;

    const sb = getSupabaseAdmin();
    const { betalingen, hint } = await listFinanceBetalingen(sb);
    const teGoedkeuren = betalingen.filter((b) => b.status === "te_goedkeuren");
    const totaalOpen = teGoedkeuren.reduce((s, b) => s + (b.bedrag_inc_btw || 0), 0);
    return NextResponse.json({
      betalingen,
      hint,
      summary: {
        te_goedkeuren: teGoedkeuren.length,
        totaal_open_inc: Math.round(totaalOpen * 100) / 100,
        betaald: betalingen.filter((b) => b.status === "betaald").length,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Finance laden mislukt") },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireFinanceAdmin();
    if ("error" in auth && auth.error) return auth.error;
    const session = auth.session!;

    const body = (await req.json().catch(() => ({}))) as {
      categorie?: FinanceCategorie;
      bron?: FinanceBron;
      bron_id?: string;
      begunstigde?: string;
      iban?: string | null;
      omschrijving?: string;
      referentie?: string | null;
      bedrag_ex_btw?: number | null;
      bedrag_inc_btw?: number;
      auto_betaal?: boolean;
      /** Of uit bestaande lijst: virtual id of tracked id + velden */
      betaling?: Partial<FinanceBetaling>;
    };

    const b = body.betaling || body;
    const bron = (b.bron || body.bron || "").trim() as FinanceBron;
    const bronId = String(b.bron_id || body.bron_id || "").trim();
    const begunstigde = String(b.begunstigde || body.begunstigde || "").trim();
    const bedrag = Number(b.bedrag_inc_btw ?? body.bedrag_inc_btw ?? 0);
    const categorie = (b.categorie ||
      body.categorie ||
      "overig") as FinanceCategorie;

    if (!bron || !bronId || !begunstigde) {
      return NextResponse.json(
        { error: "bron, bron_id en begunstigde verplicht" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const actie = await goedkeurEnBetaal(sb, {
      ownerId: session.adviseurId,
      autoBetaal: body.auto_betaal !== false,
      betaling: {
        categorie,
        bron,
        bron_id: bronId,
        begunstigde,
        iban: (b.iban ?? body.iban ?? null) as string | null,
        omschrijving: String(b.omschrijving || body.omschrijving || ""),
        referentie: (b.referentie ?? body.referentie ?? null) as string | null,
        bedrag_ex_btw:
          b.bedrag_ex_btw != null
            ? Number(b.bedrag_ex_btw)
            : body.bedrag_ex_btw != null
              ? Number(body.bedrag_ex_btw)
              : null,
        bedrag_inc_btw: bedrag,
      },
    });

    return NextResponse.json({
      betaling: actie,
      message: actie.status === "betaald"
        ? "Goedgekeurd en als betaald geboekt (concept auto-uitbetaling)."
        : "Goedgekeurd — klaar voor uitbetaling.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Goedkeuren mislukt") },
      { status: 500 }
    );
  }
}
