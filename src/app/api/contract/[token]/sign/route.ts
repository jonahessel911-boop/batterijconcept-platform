import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { sendEmail } from "@/lib/email/postmark";
import { zzpContractOndertekendEmail } from "@/lib/email/templates";
import {
  buildZzpOvereenkomstPdf,
  type ZzpContractFields,
} from "@/lib/pdf-zzp-overeenkomst";
import { storeSignedZzpContract } from "@/lib/zzp-contract-sign";

export const runtime = "nodejs";

type Body = {
  handtekening: string;
  akkoord: boolean;
};

/**
 * POST /api/contract/[token]/sign
 * Adviseur zet alleen handtekening; gegevens komen uit prefilled fields.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Ongeldige link" }, { status: 400 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.akkoord) {
    return NextResponse.json(
      { error: "Je moet akkoord gaan met de overeenkomst" },
      { status: 400 }
    );
  }
  if (!body.handtekening?.startsWith("data:image")) {
    return NextResponse.json(
      { error: "Geldige handtekening is verplicht" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: row, error } = await sb
      .from("adviseurs")
      .select(
        "id, naam, email, contract_sign_status, contract_sign_fields"
      )
      .eq("contract_sign_token", token)
      .maybeSingle();

    if (error) {
      if (
        error.code === "42703" ||
        error.message?.includes("contract_sign_token")
      ) {
        return NextResponse.json(
          {
            error:
              "Contract-ondertekening is nog niet geactiveerd. Neem contact op met BatterijConcept.",
          },
          { status: 503 }
        );
      }
      throw error;
    }
    if (!row) {
      return NextResponse.json({ error: "Link niet gevonden" }, { status: 404 });
    }
    if (row.contract_sign_status === "ondertekend") {
      return NextResponse.json(
        { error: "Deze overeenkomst is al ondertekend" },
        { status: 409 }
      );
    }

    const fields = {
      ...((row.contract_sign_fields || {}) as ZzpContractFields),
    };
    const todayNl = new Date().toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Amsterdam",
    });
    if (!fields.adv_plaats_datum?.trim()) {
      fields.adv_plaats_datum = todayNl;
    }

    const pdf = await buildZzpOvereenkomstPdf({
      fields: { ...fields, bc_plaats_datum: "" },
      signatures: {
        adv_handtekening: body.handtekening,
      },
    });

    const naamFile = (row.naam || "adviseur")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .slice(0, 40);
    const bestandsnaam = `Samenwerkingsovereenkomst-${naamFile}-ondertekend.pdf`;

    const stored = await storeSignedZzpContract(
      sb,
      row.id,
      pdf,
      bestandsnaam
    );
    if ("error" in stored) {
      return NextResponse.json({ error: stored.error }, { status: 500 });
    }

    await sb
      .from("adviseurs")
      .update({
        contract_sign_fields: fields,
      })
      .eq("id", row.id);

    const to = fields.adv_email?.trim() || row.email || null;
    let mail: { ok: boolean; error?: string } | undefined;
    if (to) {
      mail = await sendEmail({
        to,
        subject: "Overeenkomst ondertekend — BatterijConcept",
        html: zzpContractOndertekendEmail({
          naam: row.naam || fields.adv_ondertekenaar || "Adviseur",
        }),
        tag: "zzp-contract-ondertekend",
        attachments: [
          {
            name: bestandsnaam,
            content: Buffer.from(pdf),
            contentType: "application/pdf",
          },
        ],
      });
    }

    return NextResponse.json({
      ok: true,
      signed_at: stored.uploaded_at,
      bestandsnaam,
      mail,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Ondertekenen mislukt") },
      { status: 500 }
    );
  }
}
