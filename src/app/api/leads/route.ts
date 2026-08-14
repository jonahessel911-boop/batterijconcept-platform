import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAdminAdviseurId } from "@/lib/admin-adviseur";
import { enrichAddressFields } from "@/lib/postcode";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

/** POST /api/leads — handmatig lead toevoegen vanuit CRM */
export async function POST(req: NextRequest) {
  let body: {
    naam?: string;
    email?: string;
    telefoon?: string;
    postcode?: string;
    huisnummer?: string;
    straat?: string;
    plaats?: string;
    adviseur_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const naam = body.naam?.trim();
  if (!naam) {
    return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    const { data: leadNumber, error: numErr } = await sb.rpc(
      "generate_lead_number"
    );
    if (numErr || !leadNumber) {
      return NextResponse.json(
        { error: "Kon leadnummer niet genereren", detail: numErr?.message },
        { status: 500 }
      );
    }

    const postcode = body.postcode?.trim() || null;
    const huisnummer = body.huisnummer?.trim() || null;
    const enriched = await enrichAddressFields({
      postcode,
      huisnummer,
      straat: body.straat?.trim() || null,
      plaats: body.plaats?.trim() || null,
    });

    const base = {
      lead_number: leadNumber as string,
      naam,
      email: body.email?.trim() || null,
      telefoon: body.telefoon?.trim() || null,
      postcode,
      huisnummer,
      straat: enriched.straat,
      plaats: enriched.plaats,
      bron: "crm",
      status: "nieuw" as const,
      prioriteit: "normaal" as const,
    };

    const adviseurId =
      body.adviseur_id || (await getAdminAdviseurId(sb)) || null;

    let insert = await sb
      .from("leads")
      .insert({
        ...base,
        ...(adviseurId ? { adviseur_id: adviseurId } : {}),
      })
      .select("*")
      .single();

    if (
      insert.error &&
      (insert.error.message?.includes("adviseur_id") ||
        insert.error.code === "42703")
    ) {
      insert = await sb.from("leads").insert(base).select("*").single();
    }

    if (insert.error || !insert.data) {
      return NextResponse.json(
        {
          error: "Lead opslaan mislukt",
          detail: insert.error?.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ lead: insert.data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}
