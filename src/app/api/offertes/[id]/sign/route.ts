import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildSignedOffertePdf } from "@/lib/pdf-offerte";
import { adresRegel } from "@/lib/format";
import { sendEmail } from "@/lib/email/postmark";
import { replyToForLeadAdviseur } from "@/lib/email/adviseur-reply-to";
import {
  offerteOndertekendEmail,
  orderGetekendInternEmail,
} from "@/lib/email/templates";
import { DEFAULT_INSTALLATIE_STANDAARD, PRODUCT_SELECT_INKOOP } from "@/lib/inkoop";
import { hardwareKostenVoorRegelsMetProducten } from "@/lib/project-kosten";
import { commissiePctToFraction } from "@/lib/netto-boord";
// Project + aanbetalingsfactuur pas na “Actie afronden” (niet bij ondertekenen)

export const runtime = "nodejs";

/** Interne ping bij iedere getekende order. */
const ORDER_GETEKEND_NOTIFY_TO =
  process.env.ORDER_GETEKEND_NOTIFY_EMAIL?.trim() ||
  "jonahessel911@gmail.com";

type Body = {
  naam: string;
  handtekening: string;
  voorwaarden_akkoord: boolean;
  correspondentie_akkoord: boolean;
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
  if (!body.voorwaarden_akkoord || !body.correspondentie_akkoord) {
    return NextResponse.json(
      {
        error:
          "Je moet akkoord gaan met de algemene voorwaarden en correspondentie",
      },
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
        `*, leads(naam, email, telefoon, lead_number, postcode, huisnummer, toevoeging, straat, plaats), offerte_regels(*)`
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
        actie_required: true,
        backoffice_afgerond_at: null,
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

    const { queueLeadMetaCapi } = await import("@/lib/meta-capi");
    queueLeadMetaCapi(offerte.lead_id);

    const klantNaam = body.naam.trim() || offerte.leads?.naam || "klant";

    // Geen aanbetalingsfactuur-concept bij ondertekenen — pas bij
    // “Actie afronden” / doorzetten naar backoffice (juiste aanbetaling).

    // Concept commissiefactuur voor de adviseur (€250 excl. + btw)
    try {
      const { ensureAdviseurOrderCommissieConcept } = await import(
        "@/lib/netto-creditfactuur"
      );
      await ensureAdviseurOrderCommissieConcept(supabase, {
        leadId: offerte.lead_id,
        offerteId: offerte.id,
        offerteNummer: offerte.offerte_nummer,
      });
    } catch (cfErr) {
      console.error("Adviseur commissie-concept na ondertekening:", cfErr);
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
          replyTo: await replyToForLeadAdviseur(
            supabase,
            offerte.lead_id as string
          ),
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

    // Interne ping: adviseur + bedrag ex + bruto marge
    try {
      const { data: leadRow } = await supabase
        .from("leads")
        .select("adviseur_id, naam, adviseurs!adviseur_id(naam, commissie_pct)")
        .eq("id", offerte.lead_id)
        .maybeSingle();
      const advJoin = leadRow?.adviseurs;
      const adv = Array.isArray(advJoin) ? advJoin[0] : advJoin;
      const adviseurNaam =
        (adv as { naam?: string | null } | null)?.naam?.trim() || "Onbekend";
      const commissiePct =
        (adv as { commissie_pct?: number | null } | null)?.commissie_pct ??
        null;

      let producten: Parameters<
        typeof hardwareKostenVoorRegelsMetProducten
      >[1] = [];
      const { data: prodRows, error: prodErr } = await supabase
        .from("producten")
        .select(PRODUCT_SELECT_INKOOP)
        .eq("actief", true);
      if (!prodErr && prodRows?.length) {
        producten = prodRows as typeof producten;
      }

      const bedragExBtw = Number(offerte.subtotaal_ex_btw) || 0;
      const inkoop = hardwareKostenVoorRegelsMetProducten(
        regels,
        producten
      ).totaal;
      let installatie = DEFAULT_INSTALLATIE_STANDAARD;
      const { data: inst } = await supabase
        .from("dashboard_instellingen")
        .select("standaard_installatie")
        .eq("actief", true)
        .limit(1)
        .maybeSingle();
      const standaard = Number(
        (inst as { standaard_installatie?: number | null } | null)
          ?.standaard_installatie
      );
      if (standaard > 0) installatie = standaard;
      const salesCommissie =
        bedragExBtw * commissiePctToFraction(commissiePct);
      const brutoMarge =
        Math.round(
          (bedragExBtw - inkoop - installatie - salesCommissie) * 100
        ) / 100;

      const internHtml = orderGetekendInternEmail({
        offerteNummer: offerte.offerte_nummer,
        klantNaam: leadRow?.naam || klantNaam,
        adviseurNaam,
        bedragExBtw,
        brutoMarge,
        ondertekendOp,
      });
      const internSent = await sendEmail({
        to: ORDER_GETEKEND_NOTIFY_TO,
        subject: `Order getekend · ${offerte.offerte_nummer} · ${adviseurNaam}`,
        html: internHtml,
        tag: "order-getekend-intern",
      });
      if (!internSent.ok) {
        console.error("Order-getekend intern mail:", internSent.error);
      }
    } catch (internErr) {
      console.error("Order-getekend intern mail:", internErr);
    }

    // JSON i.p.v. raw PDF — voorkomt hangende blob-download in de browser
    return NextResponse.json({
      ok: true,
      offerte_nummer: offerte.offerte_nummer,
      filename,
      pdf_base64: pdfBytes.toString("base64"),
      project_id: null,
      project_nummer: null,
      factuur_id: null,
      factuur_nummer: null,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onbekende fout";
    console.error(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
