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
  FACTUUR_BETAALTERMIJN_DAGEN,
  amsterdamDatePlusDays,
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

    const vervaldatum = amsterdamDatePlusDays(
      new Date(),
      FACTUUR_BETAALTERMIJN_DAGEN
    );
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

    // Projectstatus → restfactuur verstuurd (niet bij credit)
    if (!isCredit && factuur.project_id) {
      await sb
        .from("projecten")
        .update({ status: "restfactuur_verstuurd" })
        .eq("id", factuur.project_id)
        .in("status", [
          "schouw_aanbetaling",
          "aanbetaling_betaald",
          "schouw_in_afwachting",
          "schouw_voltooid",
          "restfactuur_verstuurd",
          // legacy
          "schouw_inplannen",
          "schouw_gepland",
          "btw_factuur_eruit",
        ]);
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
