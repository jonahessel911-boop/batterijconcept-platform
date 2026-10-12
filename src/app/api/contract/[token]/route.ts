import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import type { ZzpContractFields } from "@/lib/pdf-zzp-overeenkomst";
import { buildZzpOvereenkomstPdf } from "@/lib/pdf-zzp-overeenkomst";
import { signedContractUrl } from "@/lib/relatie-contract";

export const runtime = "nodejs";

/**
 * GET /api/contract/[token]
 * Publieke data voor ondertekenpagina (of ?pdf=1 preview zonder adviseur-handtekening).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  if (!token || token.length < 16) {
    return NextResponse.json({ error: "Ongeldige link" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("adviseurs")
      .select(
        "id, naam, email, contract_sign_status, contract_sign_fields, contract_sent_at, contract_signed_at, contract_storage_path, contract_bestandsnaam"
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
    if (!data) {
      return NextResponse.json({ error: "Link niet gevonden" }, { status: 404 });
    }

    const wantPdf = req.nextUrl.searchParams.get("pdf") === "1";
    if (wantPdf) {
      if (data.contract_sign_status === "ondertekend" && data.contract_storage_path) {
        const url = await signedContractUrl(sb, data.contract_storage_path);
        if (url) {
          return NextResponse.redirect(url);
        }
      }
      const fields = (data.contract_sign_fields || {}) as ZzpContractFields;
      const pdf = await buildZzpOvereenkomstPdf({ fields });
      return new NextResponse(Buffer.from(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'inline; filename="samenwerkingsovereenkomst.pdf"',
        },
      });
    }

    return NextResponse.json({
      naam: data.naam,
      email: data.email,
      status: data.contract_sign_status || "concept",
      fields: (data.contract_sign_fields || {}) as ZzpContractFields,
      sent_at: data.contract_sent_at,
      signed_at: data.contract_signed_at,
      bestandsnaam: data.contract_bestandsnaam,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}
