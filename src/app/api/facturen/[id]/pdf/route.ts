import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildFactuurPdf } from "@/lib/pdf-factuur";
import { sendEmail } from "@/lib/email/postmark";
import { factuurVerzondenEmail } from "@/lib/email/templates";
import { formatDateShort, formatEuro } from "@/lib/format";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

async function loadFactuur(id: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("facturen")
    .select(
      "*, leads(naam, email, telefoon, lead_number, straat, huisnummer, toevoeging, postcode, plaats)"
    )
    .eq("id", id)
    .single();
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

    const blob = await buildFactuurPdf({
      factuur,
      lead: factuur.leads,
      offerte,
    });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const filename = `${factuur.factuur_nummer}${
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

    const blob = await buildFactuurPdf({
      factuur: { ...factuur, status: "verzonden" },
      lead: factuur.leads,
      offerte,
    });
    const pdfBytes = Buffer.from(await blob.arrayBuffer());
    const filename = `${factuur.factuur_nummer}.pdf`;

    const html = factuurVerzondenEmail({
      naam: factuur.leads?.naam || "klant",
      factuurNummer: factuur.factuur_nummer,
      bedrag: formatEuro(factuur.bedrag_inc_btw),
      vervaldatum: factuur.vervaldatum
        ? formatDateShort(factuur.vervaldatum)
        : null,
    });

    const sent = await sendEmail({
      to: email,
      subject: `Factuur ${factuur.factuur_nummer} — Batterijconcept`,
      html,
      tag: "factuur-verzonden",
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
      .update({ status: "verzonden" })
      .eq("id", id)
      .select("*, leads(naam, lead_number)")
      .single();

    if (upErr) {
      console.error("Factuur status update:", upErr);
    }

    // Projectstatus → BTW factuur eruit (als gekoppeld)
    if (factuur.project_id) {
      await sb
        .from("projecten")
        .update({ status: "btw_factuur_eruit" })
        .eq("id", factuur.project_id)
        .in("status", ["schouw_inplannen", "btw_factuur_eruit"]);
    }

    return NextResponse.json({
      ok: true,
      factuur: updated,
      messageId: sent.messageId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verzenden mislukt") },
      { status: 500 }
    );
  }
}
