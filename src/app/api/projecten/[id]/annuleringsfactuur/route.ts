import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { splitIncToExBtw } from "@/lib/aanbetaling";
import {
  AV_ANNULERING_ARTIKEL,
  AV_ANNULERING_PCT,
  annuleringAfrekening,
} from "@/lib/av-annulering";
import { formatEuro } from "@/lib/format";
import {
  COMPANY_IBAN_DISPLAY,
  FACTUUR_BETAALTERMIJN_DAGEN,
  amsterdamDatePlusDays,
} from "@/lib/factuur-betaling";
import { syncAutoTakenVoorProject } from "@/lib/sync-auto-taken";

export const runtime = "nodejs";

/**
 * POST /api/projecten/[id]/annuleringsfactuur
 * Maakt concept-annuleringsfactuur (20% AV), zet project op annulering,
 * markeert keuze-controle afgerond. Optioneel: ?send=1 stuurt PDF-mail.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const send =
      req.nextUrl.searchParams.get("send") === "1" ||
      req.nextUrl.searchParams.get("send") === "true";

    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select(
        "id, lead_id, offerte_id, project_nummer, status, offertes(id, offerte_nummer, totaal_inc_btw)"
      )
      .eq("id", id)
      .single();

    if (error || !project) {
      return NextResponse.json(
        { error: "Project niet gevonden" },
        { status: 404 }
      );
    }

    const offRaw = project.offertes as
      | { id?: string; offerte_nummer?: string | null; totaal_inc_btw?: number | null }
      | { id?: string; offerte_nummer?: string | null; totaal_inc_btw?: number | null }[]
      | null;
    const off = Array.isArray(offRaw) ? offRaw[0] : offRaw;
    const orderInc = Number(off?.totaal_inc_btw);
    if (!Number.isFinite(orderInc) || orderInc <= 0) {
      return NextResponse.json(
        { error: "Geen orderbedrag op de offerte — kan annuleringskosten niet berekenen" },
        { status: 400 }
      );
    }

    const { data: alleFacturen, error: facErr } = await sb
      .from("facturen")
      .select(
        "id, factuur_nummer, status, omschrijving, bedrag_inc_btw, credit_van_factuur_id"
      )
      .eq("project_id", id);
    if (facErr) {
      return NextResponse.json(
        { error: facErr.message || "Facturen laden mislukt" },
        { status: 500 }
      );
    }

    const bestaande = (alleFacturen || []).filter(
      (f) =>
        !f.credit_van_factuur_id &&
        f.status !== "vervallen" &&
        /annuleringskosten/i.test(f.omschrijving || "")
    );
    if (bestaande.length) {
      return NextResponse.json(
        {
          error: `Er is al een annuleringsfactuur (${bestaande[0]!.factuur_nummer})`,
          factuur: bestaande[0],
        },
        { status: 409 }
      );
    }

    const afrekening = annuleringAfrekening({
      orderIncBtw: orderInc,
      facturen: alleFacturen || [],
    });
    if (afrekening.kostenInc <= 0) {
      return NextResponse.json(
        { error: "Annuleringsbedrag is € 0" },
        { status: 400 }
      );
    }

    // Alleen factureren wat nog openstaat ná verrekening met al betaald.
    if (afrekening.richting !== "bijbetalen" || afrekening.saldoInc <= 0) {
      const nowIso = new Date().toISOString();
      await sb
        .from("projecten")
        .update({
          status: "annulering",
          schouw_at: null,
          schouw_jaar: null,
          schouw_week: null,
          installatie_at: null,
          service_at: null,
          materiaal_leverdatum: null,
          annulering_keuze_gecontroleerd_at: nowIso,
          hold_sales_deadline_at: null,
        })
        .eq("id", id);
      await syncAutoTakenVoorProject(sb, id, "annulering");
      return NextResponse.json({
        ok: true,
        factuur: null,
        sent: false,
        sendError: null,
        project_status: "annulering",
        afrekening,
        message:
          afrekening.richting === "terugbetalen"
            ? `Geen annuleringsfactuur — klant heeft te veel betaald; terugbetalen ${formatEuro(Math.abs(afrekening.saldoInc))}.`
            : "Geen annuleringsfactuur — al betaald dekt de 20% annuleringskosten.",
      });
    }

    const bedragInc = afrekening.saldoInc;
    const split = splitIncToExBtw(bedragInc);
    const pct = Math.round(AV_ANNULERING_PCT * 100);
    // PDF toont deze omschrijving als factuurregel.
    const omschrijving = [
      `Annuleringskosten ${pct}% (art. ${AV_ANNULERING_ARTIKEL} AV)`,
      `over order ${formatEuro(afrekening.orderInc)}`,
      afrekening.alBetaaldInc > 0
        ? `minus ${formatEuro(afrekening.alBetaaldInc)} reeds betaald`
        : null,
      project.project_nummer || null,
    ]
      .filter(Boolean)
      .join(" · ");
    const vandaag = amsterdamDatePlusDays(new Date(), 0);
    const vervaldatum = amsterdamDatePlusDays(
      new Date(),
      FACTUUR_BETAALTERMIJN_DAGEN
    );

    const { data: nummer, error: numErr } = await sb.rpc(
      "generate_factuur_nummer"
    );
    if (numErr || !nummer) {
      return NextResponse.json(
        {
          error: "Kon geen factuurnummer genereren",
          detail: numErr?.message,
        },
        { status: 500 }
      );
    }

    const ref =
      off?.offerte_nummer || project.project_nummer || String(nummer);
    const notities = [
      `Annuleringsfactuur · ${project.project_nummer || ""}`,
      `Order incl. btw: ${formatEuro(afrekening.orderInc)}`,
      `Annuleringskosten ${pct}%: ${formatEuro(afrekening.kostenInc)}`,
      `Reeds betaald: ${formatEuro(afrekening.alBetaaldInc)}`,
      `Nog te betalen: ${formatEuro(bedragInc)}`,
      `Betaal op ${COMPANY_IBAN_DISPLAY} t.n.v. BatterijConcept o.v.v. ${ref}.`,
    ].join("\n");
    const { data: factuur, error: fErr } = await sb
      .from("facturen")
      .insert({
        project_id: project.id,
        lead_id: project.lead_id,
        offerte_id: project.offerte_id || off?.id || null,
        factuur_nummer: nummer as string,
        status: "concept",
        omschrijving,
        bedrag_ex_btw: split.ex,
        btw_bedrag: split.btw,
        bedrag_inc_btw: split.inc,
        factuurdatum: vandaag,
        vervaldatum,
        notities,
      })
      .select("id, factuur_nummer, status, bedrag_inc_btw, omschrijving")
      .single();

    if (fErr || !factuur) {
      return NextResponse.json(
        { error: fErr?.message || "Factuur maken mislukt" },
        { status: 500 }
      );
    }

    const nowIso = new Date().toISOString();
    await sb
      .from("projecten")
      .update({
        status: "annulering",
        schouw_at: null,
        schouw_jaar: null,
        schouw_week: null,
        installatie_at: null,
        service_at: null,
        materiaal_leverdatum: null,
        annulering_keuze_gecontroleerd_at: nowIso,
        hold_sales_deadline_at: null,
      })
      .eq("id", id);

    await syncAutoTakenVoorProject(sb, id, "annulering");

    let sent = false;
    let sendError: string | null = null;
    if (send) {
      try {
        const origin = req.nextUrl.origin;
        const pdfRes = await fetch(`${origin}/api/facturen/${factuur.id}/pdf`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: req.headers.get("cookie") || "",
          },
          body: JSON.stringify({ action: "send" }),
        });
        if (!pdfRes.ok) {
          const data = (await pdfRes.json().catch(() => ({}))) as {
            error?: string;
          };
          sendError = data.error || "Factuurmail versturen mislukt";
        } else {
          sent = true;
        }
      } catch (e) {
        sendError = errMessage(e, "Factuurmail versturen mislukt");
      }
    }

    return NextResponse.json({
      ok: true,
      factuur,
      sent,
      sendError,
      project_status: "annulering",
      afrekening,
      message: `Annuleringsfactuur ${factuur.factuur_nummer} voor ${formatEuro(bedragInc)} (20% minus al betaald).`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Annuleringsfactuur mislukt") },
      { status: 500 }
    );
  }
}
