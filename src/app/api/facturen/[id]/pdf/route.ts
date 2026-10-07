import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildFactuurPdf } from "@/lib/pdf-factuur";
import { sendEmail } from "@/lib/email/postmark";
import { factuurVerzondenEmail } from "@/lib/email/templates";
import { formatDateShort, formatEuro } from "@/lib/format";
import { errMessage } from "@/lib/errors";
import {
  COMPANY_ACCOUNT_NAME,
  COMPANY_IBAN_DISPLAY,
  amsterdamDatePlusDays,
  factuurBetaaltermijnDagen,
} from "@/lib/factuur-betaling";
import { companyInfo } from "@/lib/pdf-brand";
import { selectFactuurById } from "@/lib/factuur-query";

export const runtime = "nodejs";

async function loadFactuur(id: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await selectFactuurById(sb, id);
  if (error || !data) return null;

  let offerte = null;
  if (data.offerte_id) {
    const { data: o } = await sb
      .from("offertes")
      .select("offerte_nummer, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw")
      .eq("id", data.offerte_id)
      .maybeSingle();
    offerte = o;
  }

  return { ...data, offertes: offerte };
}

/** GET /api/facturen/[id]/pdf — download PDF (ook concept) */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const factuur = await loadFactuur(id);
    if (!factuur) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    const offerte = factuur.offertes as {
      offerte_nummer: string;
      subtotaal_ex_btw: number;
      btw_bedrag: number;
      totaal_inc_btw: number;
    } | null;

    const creditVanRaw = factuur.credit_van as
      | { id: string; factuur_nummer: string }
      | { id: string; factuur_nummer: string }[]
      | null;
    const creditVan = Array.isArray(creditVanRaw)
      ? creditVanRaw[0]
      : creditVanRaw;
    const isCredit = Boolean(factuur.credit_van_factuur_id);
    const creditVanNummer = creditVan?.factuur_nummer || null;

    const blob = await buildFactuurPdf({
      factuur,
      lead: factuur.leads,
      offerte,
      creditVanNummer,
    });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const filename = `${isCredit ? "credit-" : ""}${factuur.factuur_nummer}${
      factuur.status === "concept" ? "-concept" : ""
    }.pdf`;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "PDF mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/facturen/[id]/pdf
 * { action: 'send' } — mail PDF naar klant en zet status op verzonden
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty ok */
  }

  if (body.action !== "send") {
    return NextResponse.json(
      { error: "Gebruik action: 'send' om te mailen" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const factuur = await loadFactuur(id);
    if (!factuur) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    const {
      isRestantFactuurOmschrijving,
      magWarmtefondsRestantFactuur,
    } = await import("@/lib/aanbetaling");
    const { resolveFinancieringStatus } = await import(
      "@/lib/financiering-status"
    );
    const isRestant = isRestantFactuurOmschrijving(factuur.omschrijving);

    if (isRestant && factuur.project_id) {
      const { data: project } = await sb
        .from("projecten")
        .select(
          "id, status, financiering_status, offertes(financiering_voorbehoud)"
        )
        .eq("id", factuur.project_id)
        .maybeSingle();
      const offJoin = project?.offertes as
        | { financiering_voorbehoud?: boolean | null }
        | { financiering_voorbehoud?: boolean | null }[]
        | null
        | undefined;
      const off = Array.isArray(offJoin) ? offJoin[0] : offJoin;
      const isWf = Boolean(off?.financiering_voorbehoud);
      const fs = project ? resolveFinancieringStatus(project) : null;
      if (isWf && fs !== "afgewezen" && !magWarmtefondsRestantFactuur(fs)) {
        return NextResponse.json(
          {
            error:
              "Restantfactuur Warmtefonds pas versturen na goedkeuring van de aanvraag",
            code: "wf_niet_goedgekeurd",
          },
          { status: 409 }
        );
      }
    }

    const email = factuur.leads?.email as string | null | undefined;
    if (!email) {
      return NextResponse.json(
        { error: "Lead heeft geen e-mailadres" },
        { status: 400 }
      );
    }

    const offerte = factuur.offertes as {
      offerte_nummer: string;
      subtotaal_ex_btw: number;
      btw_bedrag: number;
      totaal_inc_btw: number;
    } | null;

    const creditVanRaw = factuur.credit_van as
      | { id: string; factuur_nummer: string }
      | { id: string; factuur_nummer: string }[]
      | null;
    const creditVan = Array.isArray(creditVanRaw)
      ? creditVanRaw[0]
      : creditVanRaw;
    const isCredit = Boolean(factuur.credit_van_factuur_id);
    const creditVanNummer = creditVan?.factuur_nummer || null;

    const betaaltermijnDagen = factuurBetaaltermijnDagen({
      factuurdatum: factuur.factuurdatum,
      vervaldatum: factuur.vervaldatum,
    });
    const vervaldatum = amsterdamDatePlusDays(new Date(), betaaltermijnDagen);
    const factuurVoorPdf = {
      ...factuur,
      status: "verzonden" as const,
      vervaldatum,
    };

    const blob = await buildFactuurPdf({
      factuur: factuurVoorPdf,
      lead: factuur.leads,
      offerte,
      creditVanNummer,
    });
    const pdfBytes = Buffer.from(await blob.arrayBuffer());
    const filename = `${isCredit ? "credit-" : ""}${factuur.factuur_nummer}.pdf`;

    let trackUrl: string | null = null;
    try {
      const offerteId = factuur.offerte_id as string | null;
      if (offerteId) {
        const { ensureOfferteTrackToken } = await import(
          "@/lib/ensure-track-token"
        );
        const { data: offTrack } = await sb
          .from("offertes")
          .select("id, track_token")
          .eq("id", offerteId)
          .maybeSingle();
        if (offTrack?.id) {
          const trackToken = await ensureOfferteTrackToken(
            sb,
            offTrack.id,
            offTrack.track_token
          );
          if (trackToken) {
            const { appBaseUrl } = await import("@/lib/email/postmark");
            trackUrl = `${appBaseUrl()}/track/${trackToken}`;
          }
        }
      }
    } catch {
      /* track optioneel */
    }

    const co = companyInfo();
    const html = factuurVerzondenEmail({
      naam: factuur.leads?.naam || "klant",
      factuurNummer: factuur.factuur_nummer,
      bedrag: formatEuro(factuur.bedrag_inc_btw),
      vervaldatum: isCredit ? null : formatDateShort(vervaldatum),
      iban: isCredit ? null : co.iban || COMPANY_IBAN_DISPLAY,
      accountName: co.accountName || COMPANY_ACCOUNT_NAME,
      betalingskenmerk: offerte?.offerte_nummer || factuur.factuur_nummer,
      isCredit,
      creditVanNummer,
      trackUrl,
    });

    const sent = await sendEmail({
      to: email,
      subject: isCredit
        ? `Creditfactuur ${factuur.factuur_nummer}${
            creditVanNummer ? ` (${creditVanNummer})` : ""
          } — Batterijconcept`
        : `Factuur ${factuur.factuur_nummer} — Batterijconcept`,
      html,
      tag: isCredit ? "creditfactuur-verzonden" : "factuur-verzonden",
      attachments: [
        {
          name: filename,
          contentType: "application/pdf",
          content: pdfBytes,
        },
      ],
    });

    if (!sent.ok) {
      return NextResponse.json(
        { error: sent.error || "Mail versturen mislukt" },
        { status: 500 }
      );
    }

    const { data: updated, error: upErr } = await sb
      .from("facturen")
      .update({
        status: "verzonden",
        factuurdatum: amsterdamDatePlusDays(new Date(), 0),
        vervaldatum,
      })
      .eq("id", id)
      .select("*, leads(naam, email, telefoon, lead_number)")
      .single();

    if (upErr) {
      console.error("Factuur status update:", upErr);
    }

    const updatedWithCredit = updated
      ? {
          ...updated,
          credit_van: Array.isArray(factuur.credit_van)
            ? factuur.credit_van[0]
            : factuur.credit_van,
          credit_van_factuur_id: factuur.credit_van_factuur_id,
        }
      : updated;

    // Credit: oorspronkelijke openstaande factuur vervalt (klant hoeft die niet meer te betalen)
    if (isCredit && factuur.credit_van_factuur_id) {
      await sb
        .from("facturen")
        .update({ status: "vervallen" })
        .eq("id", factuur.credit_van_factuur_id)
        .in("status", ["verzonden", "deels_betaald"]);
    }

    // Alleen bij echte restantfactuur → orderstatus restfactuur_verstuurd
    if (!isCredit && isRestant && factuur.project_id) {
      await sb
        .from("projecten")
        .update({ status: "restfactuur_verstuurd" })
        .eq("id", factuur.project_id)
        .in("status", [
          "schouwweek_inplannen",
          "aanbetaling_verstuurd",
          "aanbetaling_betaald",
          "warmtefonds_afspraak_ingepland",
          "warmtefonds_aangevraagd",
          "warmtefonds_in_behandeling",
          "warmtefonds_goedgekeurd",
          "schouwdag_ingepland",
          "schouw_voltooid",
          "restfactuur_verstuurd",
          // legacy
          "schouwweek_gepland",
          "schouw_aanbetaling",
          "schouw_in_afwachting",
          "schouw_inplannen",
          "schouw_gepland",
          "btw_factuur_eruit",
        ]);
    }

    const leadId = factuur.lead_id as string | null | undefined;
    if (leadId) {
      const { logLeadEvent } = await import("@/lib/lead-events");
      const { isAanbetalingFactuurOmschrijving } = await import(
        "@/lib/aanbetaling"
      );
      const nr = factuur.factuur_nummer || id.slice(0, 8);
      const bedrag = Number(factuur.bedrag_inc_btw || 0);
      const isAanb = isAanbetalingFactuurOmschrijving(factuur.omschrijving);
      const soortLabel = isCredit
        ? "Creditfactuur"
        : isAanb
          ? "Aanbetalingsfactuur"
          : "Factuur";
      await logLeadEvent({
        leadId,
        soort: "factuur",
        titel: `${soortLabel} ${nr} verstuurd`,
        detail: [
          `Naar ${email}`,
          bedrag > 0 ? `${formatEuro(bedrag)} incl. btw` : null,
          factuur.omschrijving,
        ]
          .filter(Boolean)
          .join(" · "),
        meta: {
          factuur_id: id,
          factuur_nummer: nr,
          message_id: sent.messageId,
          is_credit: isCredit,
          is_aanbetaling: isAanb,
        },
      });

      if (isCredit && factuur.credit_van_factuur_id) {
        await logLeadEvent({
          leadId,
          soort: "factuur",
          titel: `Oorspronkelijke factuur vervallen (credit ${nr})`,
          detail: creditVanNummer
            ? `Was: ${creditVanNummer}`
            : null,
          meta: {
            factuur_id: factuur.credit_van_factuur_id,
            credit_factuur_id: id,
          },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      factuur: updatedWithCredit,
      messageId: sent.messageId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verzenden mislukt") },
      { status: 500 }
    );
  }
}
