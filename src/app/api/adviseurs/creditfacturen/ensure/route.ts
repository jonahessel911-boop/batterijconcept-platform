import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import {
  consolidateOpenSalesWeekCreditfacturen,
  stripAllHoldSalesFromOpenSalesCreditfacturen,
} from "@/lib/netto-creditfactuur";
import { ensureBelEnOpsUitbetalingConcepten } from "@/lib/callcenter-uitbetalingen";
import {
  isBelcommissieCreditfactuur,
  isOpsCommissieCreditfactuur,
} from "@/lib/callcenter-creditfactuur";
import { isUitgeslotenVanSalesCommissie } from "@/lib/rollen";

export const runtime = "nodejs";

function isCallcenterOfOpsCreditfactuur(f: {
  notities?: string | null;
  factuur_nummer?: string | null;
}): boolean {
  return isBelcommissieCreditfactuur(f) || isOpsCommissieCreditfactuur(f);
}

/**
 * POST /api/adviseurs/creditfacturen/ensure
 * Achtergrondwerk na snelle GET: HOLD strip, week-consolidatie,
 * bel-/opsconcepten, annuleren uitgesloten sales-CF's.
 */
export async function POST() {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();

    const { data: openFacs } = await sb
      .from("adviseur_creditfacturen")
      .select(
        "id, status, notities, factuur_nummer, adviseurs!adviseur_id(naam, rol)"
      )
      .in("status", ["concept", "verzonden", "goedgekeurd"])
      .limit(200);

    let geannuleerd = 0;
    const teAnnuleren = (openFacs || []).filter((f) => {
      if (isCallcenterOfOpsCreditfactuur(f)) return false;
      const adv = f.adviseurs as
        | { naam?: string | null; rol?: string | null }
        | { naam?: string | null; rol?: string | null }[]
        | null;
      const a = Array.isArray(adv) ? adv[0] : adv;
      return Boolean(a && isUitgeslotenVanSalesCommissie(a));
    });
    if (teAnnuleren.length > 0) {
      const { error } = await sb
        .from("adviseur_creditfacturen")
        .update({ status: "geannuleerd" })
        .in(
          "id",
          teAnnuleren.map((f) => f.id)
        );
      if (!error) geannuleerd = teAnnuleren.length;
    }

    await stripAllHoldSalesFromOpenSalesCreditfacturen(sb);
    await consolidateOpenSalesWeekCreditfacturen(sb);
    const belOps = await ensureBelEnOpsUitbetalingConcepten(sb);

    return NextResponse.json({
      ok: true,
      geannuleerd,
      bel_ops: belOps ?? null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Ensure mislukt") },
      { status: 500 }
    );
  }
}
