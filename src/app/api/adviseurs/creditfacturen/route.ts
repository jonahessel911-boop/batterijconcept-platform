import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  computeCreditInvoiceAmount,
  creditWeekByYearWeek,
  creditWeekFromDate,
  filterEligibleAanbetalingen,
  formatCreditFactuurNummer,
  previousCreditWeek,
  VERKOPER_AANBETALING_FEE,
} from "@/lib/adviseur-creditfactuur";

export const runtime = "nodejs";

/**
 * GET /api/adviseurs/creditfacturen?adviseur_id=&jaar=&week=
 * Lijst creditfacturen + openstaande aanbetalingen voor een week.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const adviseurId = p.get("adviseur_id");
  if (!adviseurId) {
    return NextResponse.json({ error: "adviseur_id is verplicht" }, { status: 400 });
  }

  const jaar = p.get("jaar") ? Number(p.get("jaar")) : null;
  const week = p.get("week") ? Number(p.get("week")) : null;
  const weekInfo =
    jaar && week
      ? creditWeekByYearWeek(jaar, week)
      : previousCreditWeek();

  try {
    const sb = getSupabaseAdmin();

    const { data: adviseur, error: advErr } = await sb
      .from("adviseurs")
      .select(
        "id, naam, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban, max_factuur_bedrag, commissie_pct"
      )
      .eq("id", adviseurId)
      .single();

    if (advErr || !adviseur) {
      if (advErr?.message?.includes("bedrijfsnaam") || advErr?.code === "42703") {
        return NextResponse.json(
          { error: "Voer supabase/migrate-adviseur-creditfacturen.sql uit" },
          { status: 503 }
        );
      }
      return NextResponse.json({ error: "Adviseur niet gevonden" }, { status: 404 });
    }

    const { data: facturen, error: facErr } = await sb
      .from("adviseur_creditfacturen")
      .select("*")
      .eq("adviseur_id", adviseurId)
      .order("week_jaar", { ascending: false })
      .order("week_nummer", { ascending: false })
      .limit(52);

    if (facErr) {
      if (
        facErr.code === "42703" ||
        facErr.message?.includes("adviseur_creditfacturen")
      ) {
        return NextResponse.json(
          { error: "Voer supabase/migrate-adviseur-creditfacturen.sql uit" },
          { status: 503 }
        );
      }
      throw facErr;
    }

    // Aanbetalingsfacturen van leads van deze adviseur in de week
    const { data: leads } = await sb
      .from("leads")
      .select("id, naam")
      .eq("adviseur_id", adviseurId);

    const leadIds = (leads || []).map((l) => l.id);
    const leadNaam = new Map((leads || []).map((l) => [l.id, l.naam as string]));

    let eligible: ReturnType<typeof filterEligibleAanbetalingen> = [];
    if (leadIds.length > 0) {
      const { data: paidFac } = await sb
        .from("facturen")
        .select(
          "id, factuur_nummer, lead_id, status, omschrijving, betaald_op, offertes(offerte_nummer)"
        )
        .in("lead_id", leadIds)
        .eq("status", "betaald")
        .gte("betaald_op", weekInfo.van)
        .lte("betaald_op", weekInfo.tot);

      const { data: already } = await sb
        .from("adviseur_creditfactuur_regels")
        .select("factuur_id");
      const alreadySet = new Set((already || []).map((r) => r.factuur_id));

      eligible = filterEligibleAanbetalingen(
        (paidFac || []).map((f) => {
          const off = f.offertes as
            | { offerte_nummer?: string }
            | { offerte_nummer?: string }[]
            | null;
          const offerte_nummer = Array.isArray(off)
            ? off[0]?.offerte_nummer
            : off?.offerte_nummer;
          return {
            id: f.id,
            factuur_nummer: f.factuur_nummer,
            lead_id: f.lead_id,
            status: f.status,
            omschrijving: f.omschrijving,
            betaald_op: f.betaald_op,
            lead_naam: leadNaam.get(f.lead_id) || null,
            offerte_nummer: offerte_nummer || null,
            already_invoiced: alreadySet.has(f.id),
          };
        })
      );
    }

    const amounts = computeCreditInvoiceAmount({
      aantal: eligible.length,
      maxBedrag: adviseur.max_factuur_bedrag as number | null,
    });

    const existingWeek = (facturen || []).find(
      (f) =>
        f.week_jaar === weekInfo.jaar && f.week_nummer === weekInfo.week
    );

    return NextResponse.json({
      adviseur,
      week: weekInfo,
      fee_per_aanbetaling: VERKOPER_AANBETALING_FEE,
      eligible,
      preview: {
        aantal: eligible.length,
        bruto: amounts.bruto,
        bedrag: amounts.bedrag,
        capped: amounts.capped,
        max_toegepast: amounts.maxToegepast,
      },
      existing: existingWeek || null,
      facturen: facturen || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/adviseurs/creditfacturen
 * Maak creditfactuur voor een week (default: vorige week).
 * Body: { adviseur_id, jaar?, week?, mark_paid? }
 */
export async function POST(req: NextRequest) {
  let body: {
    adviseur_id?: string;
    jaar?: number;
    week?: number;
    mark_paid?: boolean;
    status?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.adviseur_id) {
    return NextResponse.json({ error: "adviseur_id is verplicht" }, { status: 400 });
  }

  const weekInfo =
    body.jaar && body.week
      ? creditWeekByYearWeek(body.jaar, body.week)
      : previousCreditWeek();

  try {
    const sb = getSupabaseAdmin();

    const { data: adviseur, error: advErr } = await sb
      .from("adviseurs")
      .select(
        "id, naam, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban, max_factuur_bedrag"
      )
      .eq("id", body.adviseur_id)
      .single();

    if (advErr || !adviseur) {
      return NextResponse.json(
        {
          error:
            advErr?.message?.includes("bedrijfsnaam") || advErr?.code === "42703"
              ? "Voer supabase/migrate-adviseur-creditfacturen.sql uit"
              : "Adviseur niet gevonden",
        },
        { status: advErr?.code === "42703" ? 503 : 404 }
      );
    }

    if (!adviseur.bedrijfsnaam || !adviseur.kvk_nummer || !adviseur.iban) {
      return NextResponse.json(
        {
          error:
            "Vul eerst ZZP-gegevens in: bedrijfsnaam, KvK-nummer en IBAN.",
        },
        { status: 400 }
      );
    }

    const { data: existing } = await sb
      .from("adviseur_creditfacturen")
      .select("id, factuur_nummer, status")
      .eq("adviseur_id", body.adviseur_id)
      .eq("week_jaar", weekInfo.jaar)
      .eq("week_nummer", weekInfo.week)
      .maybeSingle();

    if (existing && existing.status !== "geannuleerd") {
      return NextResponse.json(
        {
          error: `Er bestaat al een creditfactuur voor week ${weekInfo.week}: ${existing.factuur_nummer}`,
          existing,
        },
        { status: 409 }
      );
    }

    const { data: leads } = await sb
      .from("leads")
      .select("id, naam")
      .eq("adviseur_id", body.adviseur_id);
    const leadIds = (leads || []).map((l) => l.id);
    const leadNaam = new Map((leads || []).map((l) => [l.id, l.naam as string]));

    if (leadIds.length === 0) {
      return NextResponse.json(
        { error: "Geen leads gekoppeld aan deze adviseur" },
        { status: 400 }
      );
    }

    const { data: paidFac } = await sb
      .from("facturen")
      .select(
        "id, factuur_nummer, lead_id, status, omschrijving, betaald_op, offertes(offerte_nummer)"
      )
      .in("lead_id", leadIds)
      .eq("status", "betaald")
      .gte("betaald_op", weekInfo.van)
      .lte("betaald_op", weekInfo.tot);

    const { data: already } = await sb
      .from("adviseur_creditfactuur_regels")
      .select("factuur_id");
    const alreadySet = new Set((already || []).map((r) => r.factuur_id));

    const eligible = filterEligibleAanbetalingen(
      (paidFac || []).map((f) => {
        const off = f.offertes as
          | { offerte_nummer?: string }
          | { offerte_nummer?: string }[]
          | null;
        const offerte_nummer = Array.isArray(off)
          ? off[0]?.offerte_nummer
          : off?.offerte_nummer;
        return {
          id: f.id,
          factuur_nummer: f.factuur_nummer,
          lead_id: f.lead_id,
          status: f.status,
          omschrijving: f.omschrijving,
          betaald_op: f.betaald_op,
          lead_naam: leadNaam.get(f.lead_id) || null,
          offerte_nummer: offerte_nummer || null,
          already_invoiced: alreadySet.has(f.id),
        };
      })
    );

    if (eligible.length === 0) {
      return NextResponse.json(
        {
          error: `Geen nieuwe betaalde aanbetalingen in week ${weekInfo.week} (${weekInfo.van} t/m ${weekInfo.tot})`,
          week: weekInfo,
        },
        { status: 400 }
      );
    }

    const amounts = computeCreditInvoiceAmount({
      aantal: eligible.length,
      maxBedrag: adviseur.max_factuur_bedrag as number | null,
    });

    // Als max limiet: neem zoveel regels als in het bedrag passen (€250/stuk)
    let regels = eligible;
    if (amounts.capped) {
      const maxCount = Math.floor(amounts.bedrag / VERKOPER_AANBETALING_FEE);
      regels = eligible.slice(0, Math.max(1, maxCount));
      // herbereken exact
      const recalc = computeCreditInvoiceAmount({
        aantal: regels.length,
        maxBedrag: adviseur.max_factuur_bedrag as number | null,
      });
      amounts.bedrag = recalc.bedrag;
      amounts.capped = regels.length < eligible.length;
      amounts.maxToegepast = adviseur.max_factuur_bedrag as number | null;
    }

    const { count } = await sb
      .from("adviseur_creditfacturen")
      .select("id", { count: "exact", head: true })
      .eq("week_jaar", weekInfo.jaar)
      .eq("week_nummer", weekInfo.week);

    const factuurNummer = formatCreditFactuurNummer(
      weekInfo.jaar,
      weekInfo.week,
      (count || 0) + 1
    );

    const today = creditWeekFromDate().van; // any ams date ok — use factuurdatum = betaalmaandag
    const status = body.mark_paid ? "betaald" : "concept";

    const { data: created, error: insErr } = await sb
      .from("adviseur_creditfacturen")
      .insert({
        adviseur_id: body.adviseur_id,
        factuur_nummer: factuurNummer,
        status,
        week_jaar: weekInfo.jaar,
        week_nummer: weekInfo.week,
        periode_van: weekInfo.van,
        periode_tot: weekInfo.tot,
        aantal_aanbetalingen: regels.length,
        bedrag_ex_btw: amounts.bedrag,
        btw_bedrag: 0,
        bedrag_inc_btw: amounts.bedrag,
        max_bedrag_toegepast: amounts.capped ? amounts.maxToegepast : null,
        factuurdatum: weekInfo.betaalMaandag,
        betaald_op: body.mark_paid ? weekInfo.betaalMaandag : null,
        notities: [
          `Creditfactuur verkoper — week ${weekInfo.week} (${weekInfo.van} t/m ${weekInfo.tot}).`,
          `€${VERKOPER_AANBETALING_FEE} per betaalde klant-aanbetaling.`,
          `BTW verlegd (ZZP B2B).`,
          `Bedrijf: ${adviseur.bedrijfsnaam}, KvK ${adviseur.kvk_nummer}, IBAN ${adviseur.iban}.`,
          amounts.capped
            ? `Let op: bedrag begrensd door max factuurbedrag (€${amounts.maxToegepast}).`
            : null,
        ]
          .filter(Boolean)
          .join(" "),
      })
      .select("*")
      .single();

    if (insErr || !created) {
      return NextResponse.json(
        { error: insErr?.message || "Aanmaken mislukt" },
        { status: 500 }
      );
    }

    const regelRows = regels.map((r) => ({
      creditfactuur_id: created.id,
      factuur_id: r.factuur_id,
      lead_id: r.lead_id,
      bedrag: VERKOPER_AANBETALING_FEE,
      omschrijving: `Aanbetaling ${r.factuur_nummer}${
        r.offerte_nummer ? ` (${r.offerte_nummer})` : ""
      } — ${r.lead_naam || "klant"} — betaald ${r.betaald_op}`,
    }));

    const { error: regelsErr } = await sb
      .from("adviseur_creditfactuur_regels")
      .insert(regelRows);

    if (regelsErr) {
      await sb.from("adviseur_creditfacturen").delete().eq("id", created.id);
      return NextResponse.json(
        { error: regelsErr.message || "Regels opslaan mislukt" },
        { status: 500 }
      );
    }

    void today;

    return NextResponse.json(
      {
        factuur: created,
        week: weekInfo,
        regels_count: regels.length,
        skipped_by_cap: eligible.length - regels.length,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Aanmaken mislukt") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/adviseurs/creditfacturen
 * Status wijzigen: { id, status, betaald_op? }
 */
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string;
    status?: "concept" | "goedgekeurd" | "betaald" | "geannuleerd";
    betaald_op?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.id || !body.status) {
    return NextResponse.json(
      { error: "id en status zijn verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const patch: Record<string, unknown> = { status: body.status };
    if (body.status === "betaald") {
      patch.betaald_op =
        body.betaald_op || creditWeekFromDate().van;
    }
    if (body.status === "geannuleerd" || body.status === "concept") {
      patch.betaald_op = null;
    }

    const { data, error } = await sb
      .from("adviseur_creditfacturen")
      .update(patch)
      .eq("id", body.id)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Bijwerken mislukt" },
        { status: 500 }
      );
    }

    return NextResponse.json({ factuur: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Bijwerken mislukt") },
      { status: 500 }
    );
  }
}
