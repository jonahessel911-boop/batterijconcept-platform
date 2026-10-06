import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import {
  computeCreditInvoiceAmount,
  creditWeekByYearWeek,
  creditWeekFromDate,
  filterEligibleAanbetalingen,
  formatCreditFactuurNummerWeek,
  previousCreditWeek,
  VERKOPER_AANBETALING_FEE,
} from "@/lib/adviseur-creditfactuur";
import {
  RELATIE_FACTUUR_BETAALTERMIJN_DAGEN,
  bedragenMetBtw,
} from "@/lib/pdf-relatie-factuur";
import { verstuurAdviseurCreditfactuur } from "@/lib/creditfactuur-verstuur";
import { dayKeyAmsterdam } from "@/lib/planning-window";
import { ensureAdviseurOrderCommissieConcept } from "@/lib/netto-creditfactuur";

export const runtime = "nodejs";

/**
 * GET /api/adviseurs/creditfacturen?adviseur_id=&jaar=&week=
 * Zonder adviseur_id: overzicht alle creditfacturen (admin).
 * Met adviseur_id: lijst + openstaande aanbetalingen voor een week.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const adviseurId = p.get("adviseur_id");

  if (!adviseurId) {
    try {
      const sb = getSupabaseAdmin();
      const weekInfo = previousCreditWeek();
      const { data: facturen, error: facErr } = await sb
        .from("adviseur_creditfacturen")
        .select(
          "*, adviseurs!adviseur_id(id, naam, bedrijfsnaam, kvk_nummer, iban)"
        )
        .order("week_jaar", { ascending: false })
        .order("week_nummer", { ascending: false })
        .limit(200);

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

      const { data: salesAdviseurs } = await sb
        .from("adviseurs")
        .select(
          "id, naam, actief, rol, bedrijfsnaam, kvk_nummer, iban, commissie_pct, max_factuur_bedrag"
        )
        .eq("actief", true)
        .order("naam");

      const adviseurs = (salesAdviseurs || []).filter((a) => {
        const rol = (a.rol || "adviseur") as string;
        return rol === "adviseur" || rol === "admin";
      });

      return NextResponse.json({
        week: weekInfo,
        fee_per_aanbetaling: VERKOPER_AANBETALING_FEE,
        facturen: facturen || [],
        adviseurs,
      });
    } catch (e) {
      return NextResponse.json(
        { error: errMessage(e, "Laden mislukt") },
        { status: 500 }
      );
    }
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

    const existingWeek =
      (facturen || []).find(
        (f) =>
          f.week_jaar === weekInfo.jaar &&
          f.week_nummer === weekInfo.week &&
          f.status === "concept"
      ) ||
      (facturen || []).find(
        (f) =>
          f.week_jaar === weekInfo.jaar &&
          f.week_nummer === weekInfo.week &&
          f.status !== "geannuleerd"
      ) ||
      null;

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
 * Maak creditfactuur-concept.
 * Body:
 * - { offerte_id } → commissie tranche A (€250) voor die deal
 * - { adviseur_id, bedrag_ex_btw, omschrijving?, offerte_id? } → handmatig
 * - { adviseur_id, jaar?, week? } → uit openstaande aanbetalingen in de week
 */
export async function POST(req: NextRequest) {
  let body: {
    adviseur_id?: string;
    offerte_id?: string;
    jaar?: number;
    week?: number;
    mark_paid?: boolean;
    status?: string;
    bedrag_ex_btw?: number;
    omschrijving?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const weekInfo =
    body.jaar && body.week
      ? creditWeekByYearWeek(body.jaar, body.week)
      : previousCreditWeek();

  const manualBedrag =
    body.bedrag_ex_btw != null ? Number(body.bedrag_ex_btw) : null;
  const useManual =
    manualBedrag != null && Number.isFinite(manualBedrag) && manualBedrag > 0;

  try {
    const sb = getSupabaseAdmin();

    // Vanuit deal: standaard tranche A-concept (€250) tenzij handmatig bedrag meegegeven
    if (body.offerte_id && !useManual) {
      const { data: offerte, error: offErr } = await sb
        .from("offertes")
        .select("id, offerte_nummer, lead_id, status")
        .eq("id", body.offerte_id)
        .maybeSingle();
      if (offErr || !offerte) {
        return NextResponse.json(
          { error: "Offerte / deal niet gevonden" },
          { status: 404 }
        );
      }
      if (!offerte.lead_id) {
        return NextResponse.json(
          { error: "Deal heeft geen lead" },
          { status: 400 }
        );
      }
      const { data: project } = await sb
        .from("projecten")
        .select("project_nummer")
        .eq("offerte_id", offerte.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const result = await ensureAdviseurOrderCommissieConcept(sb, {
        leadId: offerte.lead_id as string,
        offerteId: offerte.id as string,
        offerteNummer: (offerte.offerte_nummer as string) || offerte.id,
        projectNummer: (project?.project_nummer as string | null) || null,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error || "Aanmaken mislukt" },
          { status: 500 }
        );
      }
      if (result.skipped === "geen_adviseur") {
        return NextResponse.json(
          { error: "Deal heeft geen adviseur — wijs eerst een adviseur toe." },
          { status: 400 }
        );
      }
      if (result.skipped === "zzp_gegevens_incompleet") {
        return NextResponse.json(
          {
            error:
              "Vul eerst ZZP-gegevens in bij de adviseur: bedrijfsnaam, KvK en IBAN.",
          },
          { status: 400 }
        );
      }

      const { data: factuur } = result.creditfactuur_id
        ? await sb
            .from("adviseur_creditfacturen")
            .select("*")
            .eq("id", result.creditfactuur_id)
            .maybeSingle()
        : { data: null };

      return NextResponse.json(
        {
          factuur,
          created: Boolean(result.created),
          skipped: result.skipped || null,
          vanuit_deal: true,
          mail_sent: false,
        },
        { status: result.created ? 201 : 200 }
      );
    }

    if (!body.adviseur_id) {
      return NextResponse.json(
        { error: "adviseur_id is verplicht (of kies een deal via offerte_id)" },
        { status: 400 }
      );
    }

    const { data: adviseur, error: advErr } = await sb
      .from("adviseurs")
      .select(
        "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban, max_factuur_bedrag"
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
    if (!adviseur.email?.trim()) {
      return NextResponse.json(
        { error: "Vul eerst een e-mailadres in bij de adviseur." },
        { status: 400 }
      );
    }

    // Handmatig + optioneel gekoppeld aan deal
    let dealTag: string | null = null;
    let dealLabel: string | null = null;
    if (body.offerte_id && useManual) {
      const { data: offerte } = await sb
        .from("offertes")
        .select("id, offerte_nummer, lead_id, leads(naam)")
        .eq("id", body.offerte_id)
        .maybeSingle();
      if (offerte?.offerte_nummer) {
        dealTag = `ref_offerte:${offerte.offerte_nummer}`;
        const leadRaw = offerte.leads as
          | { naam?: string }
          | { naam?: string }[]
          | null;
        const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
        dealLabel = [
          `Offerte ${offerte.offerte_nummer}`,
          lead?.naam ? `Klant ${lead.naam}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
      }
    }

    const { data: leads } = await sb
      .from("leads")
      .select("id, naam")
      .eq("adviseur_id", body.adviseur_id);
    const leadIds = (leads || []).map((l) => l.id);
    const leadNaam = new Map((leads || []).map((l) => [l.id, l.naam as string]));

    let paidFac: {
      id: string;
      factuur_nummer: string;
      lead_id: string;
      offerte_id: string | null;
      status: string;
      omschrijving: string | null;
      betaald_op: string | null;
      offertes:
        | { offerte_nummer?: string }
        | { offerte_nummer?: string }[]
        | null;
    }[] = [];
    let projectByLead = new Map<string, string>();
    let projectByOfferte = new Map<string, string>();
    let eligible: ReturnType<typeof filterEligibleAanbetalingen> = [];

    if (leadIds.length > 0 && !useManual) {
      const { data: paid } = await sb
        .from("facturen")
        .select(
          "id, factuur_nummer, lead_id, offerte_id, status, omschrijving, betaald_op, offertes(offerte_nummer)"
        )
        .in("lead_id", leadIds)
        .eq("status", "betaald")
        .gte("betaald_op", weekInfo.van)
        .lte("betaald_op", weekInfo.tot);
      paidFac = (paid || []) as typeof paidFac;

      const { data: already } = await sb
        .from("adviseur_creditfactuur_regels")
        .select("factuur_id");
      const alreadySet = new Set((already || []).map((r) => r.factuur_id));

      const { data: projects } = await sb
        .from("projecten")
        .select("project_nummer, lead_id, offerte_id")
        .in("lead_id", leadIds);
      projectByLead = new Map<string, string>();
      projectByOfferte = new Map<string, string>();
      for (const p of projects || []) {
        if (p.lead_id) projectByLead.set(p.lead_id as string, p.project_nummer);
        if (p.offerte_id)
          projectByOfferte.set(p.offerte_id as string, p.project_nummer);
      }

      eligible = filterEligibleAanbetalingen(
        paidFac.map((f) => {
          const off = f.offertes;
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

    const amounts = {
      bedrag: 0,
      capped: false,
      maxToegepast: null as number | null,
    };
    let regels = eligible;

    if (useManual) {
      amounts.bedrag = Math.round(manualBedrag! * 100) / 100;
      regels = [];
    } else if (eligible.length === 0) {
      return NextResponse.json(
        {
          error: `Geen nieuwe betaalde aanbetalingen in week ${weekInfo.week}. Vul een bedrag in om een handmatig concept te maken.`,
          week: weekInfo,
        },
        { status: 400 }
      );
    } else {
      const computed = computeCreditInvoiceAmount({
        aantal: eligible.length,
        maxBedrag: adviseur.max_factuur_bedrag as number | null,
      });
      amounts.bedrag = computed.bedrag;
      amounts.capped = computed.capped;
      amounts.maxToegepast = computed.maxToegepast;
      if (amounts.capped) {
        const maxCount = Math.floor(amounts.bedrag / VERKOPER_AANBETALING_FEE);
        regels = eligible.slice(0, Math.max(1, maxCount));
        const recalc = computeCreditInvoiceAmount({
          aantal: regels.length,
          maxBedrag: adviseur.max_factuur_bedrag as number | null,
        });
        amounts.bedrag = recalc.bedrag;
        amounts.capped = regels.length < eligible.length;
        amounts.maxToegepast = adviseur.max_factuur_bedrag as number | null;
      }
    }

    const { count } = await sb
      .from("adviseur_creditfacturen")
      .select("id", { count: "exact", head: true })
      .eq("week_jaar", weekInfo.jaar)
      .eq("week_nummer", weekInfo.week);

    const factuurNummer = formatCreditFactuurNummerWeek(
      weekInfo.jaar,
      weekInfo.week,
      (count || 0) + 1
    );

    const status = body.mark_paid ? "betaald" : "concept";
    const omschrijving = body.omschrijving?.trim() || null;
    const withBtw = bedragenMetBtw(amounts.bedrag);

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
        aantal_aanbetalingen: useManual ? 0 : regels.length,
        bedrag_ex_btw: withBtw.bedrag_ex_btw,
        btw_bedrag: withBtw.btw_bedrag,
        bedrag_inc_btw: withBtw.bedrag_inc_btw,
        max_bedrag_toegepast: amounts.capped ? amounts.maxToegepast : null,
        factuurdatum: weekInfo.betaalMaandag,
        betaald_op: body.mark_paid ? weekInfo.betaalMaandag : null,
        notities: [
          dealTag,
          omschrijving,
          dealLabel,
          `Factuur van ${adviseur.bedrijfsnaam} aan Batterijconcept.`,
          `Week ${weekInfo.week} (${weekInfo.van} t/m ${weekInfo.tot}).`,
          useManual
            ? "Handmatig concept."
            : `€${VERKOPER_AANBETALING_FEE} excl. btw per betaalde klant-aanbetaling.`,
          `Betaaltermijn ${RELATIE_FACTUUR_BETAALTERMIJN_DAGEN} dagen.`,
          `BTW 21%.`,
          `KvK ${adviseur.kvk_nummer}, IBAN ${adviseur.iban}.`,
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

    if (!useManual && regels.length > 0) {
      const paidFacById = new Map(paidFac.map((f) => [f.id as string, f]));

      const regelRows = regels.map((r) => {
        const fac = paidFacById.get(r.factuur_id);
        const project_nummer =
          (fac?.offerte_id &&
            projectByOfferte.get(fac.offerte_id as string)) ||
          (r.lead_id && projectByLead.get(r.lead_id)) ||
          null;
        const parts = [
          "Commissie aanbetaling",
          r.lead_naam || null,
          `klantfactuur ${r.factuur_nummer}`,
          `betaald ${r.betaald_op}`,
          r.offerte_nummer ? `Offerte ${r.offerte_nummer}` : null,
          project_nummer ? `Project ${project_nummer}` : null,
        ].filter(Boolean);
        return {
          creditfactuur_id: created.id,
          factuur_id: r.factuur_id,
          lead_id: r.lead_id,
          bedrag: VERKOPER_AANBETALING_FEE,
          omschrijving: parts.join(" · "),
        };
      });

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
    }

    return NextResponse.json(
      {
        factuur: created,
        week: weekInfo,
        regels_count: useManual ? 0 : regels.length,
        skipped_by_cap: useManual ? 0 : eligible.length - regels.length,
        mail_sent: false,
        handmatig: useManual,
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
 * status=verzonden → mail + PDF naar adviseur
 */
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string;
    status?:
      | "concept"
      | "verzonden"
      | "goedgekeurd"
      | "betaald"
      | "geannuleerd";
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

    if (body.status === "verzonden") {
      const result = await verstuurAdviseurCreditfactuur(sb, body.id);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }
      return NextResponse.json({
        factuur: result.factuur,
        mail_sent: result.mail_sent,
      });
    }

    const patch: Record<string, unknown> = { status: body.status };
    if (body.status === "betaald") {
      patch.betaald_op = body.betaald_op || dayKeyAmsterdam(new Date());
    }
    if (body.status === "goedgekeurd") {
      patch.goedgekeurd_op = new Date().toISOString();
    }
    if (body.status === "geannuleerd" || body.status === "concept") {
      patch.betaald_op = null;
      if (body.status === "concept") {
        patch.verzonden_op = null;
        patch.goedgekeurd_op = null;
      }
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
