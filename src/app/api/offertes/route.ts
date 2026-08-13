import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

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

    const { data: offerte, error } = await sb
      .from("offertes")
      .insert({
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
      })
      .select("id, offerte_nummer, sign_token, totaal_inc_btw")
      .single();

    if (error || !offerte) {
      return NextResponse.json(
        { error: "Offerte aanmaken mislukt", detail: error?.message },
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

    const origin = req.nextUrl.origin;
    return NextResponse.json(
      {
        ok: true,
        ...offerte,
        sign_url: `${origin}/offerte/${offerte.sign_token}`,
      },
      { status: 201 }
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Onbekende fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
