import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import { appBaseUrl, sendEmail } from "@/lib/email/postmark";
import { zzpContractTeOndertekenenEmail } from "@/lib/email/templates";
import type { ZzpContractFields } from "@/lib/pdf-zzp-overeenkomst";
import {
  fieldsFromAdviseur,
  newContractSignToken,
} from "@/lib/zzp-contract-sign";

export const runtime = "nodejs";

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) return { error: "Niet ingelogd", status: 401 as const };
  const sb = getSupabaseAdmin();
  const { data: adv } = await sb
    .from("adviseurs")
    .select("rol, naam, email")
    .eq("id", session.adviseurId)
    .maybeSingle();
  const email = adv?.email ?? session.email;
  const naam = adv?.naam || session.naam;
  const rol = normalizeRol(adv?.rol || session.rol);
  const mag =
    rol === "admin" ||
    isAdminEmail(email) ||
    isAdminAdviseur({ naam, email });
  if (!mag) return { error: "Alleen admin", status: 403 as const };
  return { sb, session };
}

type Body = {
  fields?: ZzpContractFields;
  send_email?: boolean;
};

/**
 * POST /api/relaties/adviseur/[id]/contract/send
 * Slaat invulvelden + BC-handtekening op en stuurt ondertekenlink.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const { data: row, error } = await auth.sb
      .from("adviseurs")
      .select(
        "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban, contract_sign_token, contract_sign_status"
      )
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (
        error.code === "42703" ||
        error.message?.includes("contract_sign_token")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-zzp-contract-sign.sql uit in Supabase",
          },
          { status: 503 }
        );
      }
      throw error;
    }
    if (!row) {
      return NextResponse.json({ error: "Adviseur niet gevonden" }, { status: 404 });
    }

    const defaults = fieldsFromAdviseur(row);
    const fields: ZzpContractFields = {
      ...defaults,
      ...(body.fields || {}),
      bc_naam: body.fields?.bc_naam?.trim() || "BatterijConcept",
      bc_email: body.fields?.bc_email?.trim() || "info@batterijconcept.nl",
      // Geen BC-handtekening / plaats-datum — alleen adviseur tekent
      bc_plaats_datum: "",
      // KvK / btw niet verplicht — leeg laten op de PDF
      adv_kvk: body.fields?.adv_kvk?.trim() || "",
      adv_btw: body.fields?.adv_btw?.trim() || "",
    };

    if (!fields.ingangsdatum?.trim()) {
      return NextResponse.json(
        { error: "Ingangsdatum is verplicht" },
        { status: 400 }
      );
    }
    if (!fields.adv_naam_onderneming?.trim()) {
      return NextResponse.json(
        { error: "Bedrijfsnaam is verplicht" },
        { status: 400 }
      );
    }
    if (!fields.adv_ondertekenaar?.trim()) {
      return NextResponse.json(
        { error: "Contactpersoon is verplicht" },
        { status: 400 }
      );
    }
    if (!fields.adv_kvk?.trim()) {
      return NextResponse.json(
        { error: "KvK-nummer is verplicht" },
        { status: 400 }
      );
    }
    if (!fields.adv_adres?.trim() || !fields.adv_postcode_plaats?.trim()) {
      return NextResponse.json(
        { error: "Adres (via postcode + huisnummer) is verplicht" },
        { status: 400 }
      );
    }
    if (!fields.adv_iban?.trim()) {
      return NextResponse.json({ error: "IBAN is verplicht" }, { status: 400 });
    }

    const toEmail = fields.adv_email?.trim() || row.email;
    if (!toEmail) {
      return NextResponse.json(
        { error: "E-mailadres ontbreekt" },
        { status: 400 }
      );
    }

    if (!fields.adv_handelsnaam?.trim()) {
      fields.adv_handelsnaam = fields.adv_naam_onderneming;
    }

    const token =
      (row.contract_sign_token as string | null) || newContractSignToken();
    const sentAt = new Date().toISOString();

    const { error: updErr } = await auth.sb
      .from("adviseurs")
      .update({
        contract_sign_token: token,
        contract_sign_status: "verzonden",
        contract_sign_fields: fields,
        // Geen BC-handtekening nodig — partijgegevens staan bovenaan in de PDF
        contract_bc_handtekening: null,
        contract_sent_at: sentAt,
        contract_signed_at: null,
      })
      .eq("id", id);

    if (updErr) {
      if (
        updErr.code === "42703" ||
        updErr.message?.includes("contract_sign_token")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-zzp-contract-sign.sql uit in Supabase",
          },
          { status: 503 }
        );
      }
      throw updErr;
    }

    const signUrl = `${appBaseUrl()}/contract/${token}`;
    let mail: { ok: boolean; error?: string } = { ok: true };
    if (body.send_email !== false) {
      mail = await sendEmail({
        to: toEmail,
        subject: "Samenwerkingsovereenkomst ondertekenen — BatterijConcept",
        html: zzpContractTeOndertekenenEmail({
          naam: row.naam || "Adviseur",
          signUrl,
        }),
        tag: "zzp-contract-te-ondertekenen",
      });
    }

    return NextResponse.json({
      ok: true,
      sign_url: signUrl,
      contract_sign_status: "verzonden",
      contract_sent_at: sentAt,
      mail,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Versturen mislukt") },
      { status: 500 }
    );
  }
}
