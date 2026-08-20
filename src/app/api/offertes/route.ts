import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

type RegelInput = {
  product_id?: string;
  omschrijving: string;
  aantal?: number;
  prijs_ex_btw: number;
  btw_percentage?: number;
};

type Body = {
  lead_id: string;
  titel?: string;
  intro_tekst?: string;
  geldig_dagen?: number;
  financiering_voorbehoud?: boolean;
  installatie_partner_id?: string | null;
  regels: RegelInput[];
};

/**
 * POST /api/offertes
 * Maakt een offerte + regels voor een lead_id.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.lead_id || !Array.isArray(body.regels) || body.regels.length === 0) {
    return NextResponse.json(
      { error: "lead_id en minstens 1 regel zijn verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: offerteNr, error: numErr } = await sb.rpc(
      "generate_offerte_nummer"
    );
    if (numErr || !offerteNr) {
      return NextResponse.json(
        { error: "Kon offernummer niet genereren", detail: numErr?.message },
        { status: 500 }
      );
    }

    let subtotaal = 0;
    let btw = 0;
    const prepared = body.regels.map((r, i) => {
      const aantal = Number(r.aantal ?? 1);
      const prijs = Number(r.prijs_ex_btw);
      const pct = Number(r.btw_percentage ?? 21);
      const line = aantal * prijs;
      subtotaal += line;
      btw += Math.round(line * pct) / 100;
      return {
        omschrijving: r.omschrijving,
        product_id: r.product_id || null,
        aantal,
        prijs_ex_btw: prijs,
        btw_percentage: pct,
        sort_order: i,
      };
    });

    const geldigDagen = body.geldig_dagen ?? 30;
    const geldigTot = new Date();
    geldigTot.setDate(geldigTot.getDate() + geldigDagen);

    const row: Record<string, unknown> = {
      lead_id: body.lead_id,
      offerte_nummer: offerteNr,
      status: "verzonden",
      titel: body.titel || "Offerte thuisbatterij",
      intro_tekst:
        body.intro_tekst ||
        "Hierbij onze offerte voor jouw thuisbatterij, afgestemd op jouw situatie.",
      subtotaal_ex_btw: Math.round(subtotaal * 100) / 100,
      btw_bedrag: Math.round(btw * 100) / 100,
      totaal_inc_btw: Math.round((subtotaal + btw) * 100) / 100,
      geldig_tot: geldigTot.toISOString().slice(0, 10),
      financiering_voorbehoud: Boolean(body.financiering_voorbehoud),
    };

    if (body.installatie_partner_id) {
      row.installatie_partner_id = body.installatie_partner_id;
    }

    let insert = await sb
      .from("offertes")
      .insert(row)
      .select(
        "id, offerte_nummer, sign_token, titel, intro_tekst, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, geldig_tot, financiering_voorbehoud, installatie_partner_id"
      )
      .single();

    if (
      insert.error &&
      (insert.error.message?.includes("financiering_voorbehoud") ||
        insert.error.message?.includes("installatie_partner_id") ||
        insert.error.code === "42703")
    ) {
      const missingPartner = insert.error.message?.includes(
        "installatie_partner_id"
      );
      const missingFin = insert.error.message?.includes(
        "financiering_voorbehoud"
      );
      if (missingPartner) delete row.installatie_partner_id;
      if (missingFin) delete row.financiering_voorbehoud;
      insert = await sb
        .from("offertes")
        .insert(row)
        .select(
          "id, offerte_nummer, sign_token, titel, intro_tekst, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw, geldig_tot"
        )
        .single();
    }

    const offerte = insert.data;
    if (insert.error || !offerte) {
      return NextResponse.json(
        { error: "Offerte aanmaken mislukt", detail: insert.error?.message },
        { status: 500 }
      );
    }

    const { error: regelsErr } = await sb.from("offerte_regels").insert(
      prepared.map((r) => ({ ...r, offerte_id: offerte.id }))
    );

    if (regelsErr) {
      return NextResponse.json(
        { error: "Regels opslaan mislukt", detail: regelsErr.message },
        { status: 500 }
      );
    }

    await sb.from("leads").update({ status: "afspraak" }).eq("id", body.lead_id);

    const { appBaseUrl } = await import("@/lib/email/postmark");
    const signUrl = `${appBaseUrl()}/offerte/${offerte.sign_token}`;

    try {
      const { data: lead } = await sb
        .from("leads")
        .select(
          "naam, email, telefoon, postcode, huisnummer, toevoeging, straat, plaats"
        )
        .eq("id", body.lead_id)
        .single();

      if (lead?.email) {
        const { data: regels } = await sb
          .from("offerte_regels")
          .select("*")
          .eq("offerte_id", offerte.id)
          .order("sort_order");

        const { buildOffertePdf } = await import("@/lib/pdf-offerte");
        const { adresRegel } = await import("@/lib/format");
        const { sendEmail } = await import("@/lib/email/postmark");
        const { offerteVerstuurdEmail } = await import(
          "@/lib/email/templates"
        );

        const fullOfferte = {
          ...offerte,
          financiering_voorbehoud:
            "financiering_voorbehoud" in offerte
              ? Boolean(
                  (offerte as { financiering_voorbehoud?: boolean })
                    .financiering_voorbehoud
                )
              : Boolean(body.financiering_voorbehoud),
          leads: {
            naam: lead.naam,
            email: lead.email,
            telefoon: lead.telefoon,
            lead_number: "",
            postcode: lead.postcode,
            huisnummer: lead.huisnummer,
            toevoeging: lead.toevoeging,
            straat: lead.straat,
            plaats: lead.plaats,
          },
        };

        const pdfBlob = await buildOffertePdf({
          offerte: fullOfferte as never,
          regels: (regels || []) as never,
          adres: adresRegel(lead),
        });
        const pdfBytes = Buffer.from(await pdfBlob.arrayBuffer());

        await sendEmail({
          to: lead.email,
          subject: `Offerte ${offerte.offerte_nummer} voor ${lead.naam}`,
          html: offerteVerstuurdEmail({
            naam: lead.naam,
            offerteNummer: offerte.offerte_nummer,
            signUrl,
          }),
          tag: "offerte-verstuurd",
          attachments: [
            {
              name: `${offerte.offerte_nummer}.pdf`,
              contentType: "application/pdf",
              content: pdfBytes,
            },
          ],
        });
      }
    } catch (mailErr) {
      console.error("Offerte mail:", mailErr);
    }

    return NextResponse.json(
      {
        ok: true,
        ...offerte,
        sign_url: signUrl,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Onbekende fout") },
      { status: 500 }
    );
  }
}
