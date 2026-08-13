import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildSignedOffertePdf } from "@/lib/pdf-offerte";
import { adresRegel } from "@/lib/format";
import { sendEmail } from "@/lib/email/postmark";
import { offerteOndertekendEmail } from "@/lib/email/templates";
import { ensureProjectForOfferte } from "@/lib/ensure-project";
import { ensureBtwDraftFactuur } from "@/lib/ensure-btw-factuur";

export const runtime = "nodejs";

type Body = {
  naam: string;
  handtekening: string;
  waarden_akkoord: boolean;
};

/**
 * POST /api/offertes/[id]/sign
 * Ondertekent offerte, slaat handtekening op, genereert PDF, mailt klant.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const token = req.nextUrl.searchParams.get("token");

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.naam?.trim()) {
    return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
  }
  if (!body.handtekening?.startsWith("data:image")) {
    return NextResponse.json(
      { error: "Geldige handtekening is verplicht" },
      { status: 400 }
    );
  }
  if (!body.waarden_akkoord) {
    return NextResponse.json(
      { error: "Je moet akkoord gaan met onze waarden" },
      { status: 400 }
    );
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Supabase service role niet geconfigureerd" },
      { status: 500 }
    );
  }

  const ondertekendOp = new Date();
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;

  try {
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from("offertes")
      .select(
        `*, leads(naam, email, lead_number, postcode, huisnummer, toevoeging, straat, plaats), offerte_regels(*)`
      );

    if (token) {
      query = query.eq("sign_token", token);
    } else {
      query = query.eq("id", id);
    }

    const { data: offerte, error } = await query.single();
    if (error || !offerte) {
      return NextResponse.json({ error: "Offerte niet gevonden" }, { status: 404 });
    }

    if (offerte.status === "ondertekend") {
      return NextResponse.json(
        { error: "Deze offerte is al ondertekend" },
        { status: 409 }
      );
    }

    const regels = (offerte.offerte_regels || []).sort(
      (a: { sort_order: number }, b: { sort_order: number }) =>
        a.sort_order - b.sort_order
    );

    const pdfBlob = await buildSignedOffertePdf({
      offerte,
      regels,
      sign: {
        naam: body.naam.trim(),
        handtekeningDataUrl: body.handtekening,
        ondertekendOp,
      },
      adres: offerte.leads ? adresRegel(offerte.leads) : undefined,
    });

    const pdfBytes = Buffer.from(await pdfBlob.arrayBuffer());
    const filename = `${offerte.offerte_nummer}-ondertekend.pdf`;
    const path = `${offerte.lead_id}/${filename}`;

    const { error: uploadErr } = await supabase.storage
      .from("offertes-signed")
      .upload(path, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadErr) {
      console.error("PDF upload:", uploadErr);
    }

    const { error: updateErr } = await supabase
      .from("offertes")
      .update({
        status: "ondertekend",
        ondertekend_naam: body.naam.trim(),
        ondertekend_handtekening: body.handtekening,
        ondertekend_op: ondertekendOp.toISOString(),
        ondertekend_ip: ip,
        waarden_akkoord: true,
        signed_pdf_path: uploadErr ? null : path,
      })
      .eq("id", offerte.id);

    if (updateErr) {
      return NextResponse.json(
        { error: "Opslaan mislukt", detail: updateErr.message },
        { status: 500 }
      );
    }

    await supabase
      .from("leads")
      .update({ status: "deal" })
      .eq("id", offerte.lead_id);

    const klantNaam = body.naam.trim() || offerte.leads?.naam || "klant";

    // Project starten in status Schouw inplannen
    let projectMeta: {
      id: string;
      project_nummer: string;
      created: boolean;
    } | null = null;
    try {
      projectMeta = await ensureProjectForOfferte(supabase, {
        offerteId: offerte.id,
        leadId: offerte.lead_id,
        offerteNummer: offerte.offerte_nummer,
        titel: offerte.titel,
        klantNaam: offerte.leads?.naam || klantNaam,
      });
    } catch (projErr) {
      console.error("Project na ondertekening:", projErr);
    }

    // Concept BTW-factuur (draft, niet mailen)
    let factuurMeta: {
      id: string;
      factuur_nummer: string;
      created: boolean;
    } | null = null;
    try {
      factuurMeta = await ensureBtwDraftFactuur(supabase, {
        offerteId: offerte.id,
        leadId: offerte.lead_id,
        projectId: projectMeta?.id || null,
        offerteNummer: offerte.offerte_nummer,
        btwBedrag: Number(offerte.btw_bedrag) || 0,
        subtotaalExBtw: Number(offerte.subtotaal_ex_btw) || 0,
      });
    } catch (facErr) {
      console.error("BTW-factuur na ondertekening:", facErr);
    }

    const klantEmail = offerte.leads?.email as string | null | undefined;
    if (klantEmail) {
      try {
        const html = offerteOndertekendEmail({
          naam: klantNaam,
          offerteNummer: offerte.offerte_nummer,
          ondertekendOp,
        });
        const sent = await sendEmail({
          to: klantEmail,
          subject: `Ondertekende offerte ${offerte.offerte_nummer}`,
          html,
          tag: "offerte-ondertekend",
          attachments: [
            {
              name: filename,
              contentType: "application/pdf",
              content: pdfBytes,
            },
          ],
        });
        if (!sent.ok) {
          console.error("Offerte-ondertekend mail:", sent.error);
        }
      } catch (mailErr) {
        console.error("Offerte-ondertekend mail:", mailErr);
      }
    }

    // JSON i.p.v. raw PDF — voorkomt hangende blob-download in de browser
    return NextResponse.json({
      ok: true,
      offerte_nummer: offerte.offerte_nummer,
      filename,
      pdf_base64: pdfBytes.toString("base64"),
      project_id: projectMeta?.id ?? null,
      project_nummer: projectMeta?.project_nummer ?? null,
      factuur_id: factuurMeta?.id ?? null,
      factuur_nummer: factuurMeta?.factuur_nummer ?? null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onbekende fout";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
