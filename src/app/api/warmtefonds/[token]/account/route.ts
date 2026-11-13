import { NextRequest, NextResponse } from "next/server";
import { hashPassword, verifyPassword } from "@/lib/auth-password";
import { errMessage } from "@/lib/errors";
import { leesEdergyTariefVoorOperator } from "@/lib/edergy-tarief";
import { resolveWarmtefondsOperator } from "@/lib/warmtefonds-portal";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

/** GET — account + tarief van deze WF-persoon. */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }
    const tarief = await leesEdergyTariefVoorOperator(operator.tarief_inc);
    return NextResponse.json({
      operator: {
        id: operator.id,
        naam: operator.naam,
        email: operator.email,
        telefoon: operator.telefoon,
        tarief_inc: operator.tarief_inc ?? null,
      },
      tarief: {
        per_aanvraag_inc: tarief.perAanvraagInc,
        per_aanvraag_excl: tarief.perAanvraagExcl,
        per_aanvraag_btw: tarief.perAanvraagBtw,
        eigen: operator.tarief_inc != null && Number(operator.tarief_inc) > 0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Fout") },
      { status: 500 }
    );
  }
}

/** PATCH — eigen wachtwoord wijzigen. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  const { token } = await ctx.params;
  let body: {
    huidig_wachtwoord?: string;
    nieuw_wachtwoord?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const huidig = String(body.huidig_wachtwoord || "");
  const nieuw = String(body.nieuw_wachtwoord || "");
  if (!huidig || !nieuw) {
    return NextResponse.json(
      { error: "Huidig en nieuw wachtwoord zijn verplicht" },
      { status: 400 }
    );
  }
  if (nieuw.length < 8) {
    return NextResponse.json(
      { error: "Nieuw wachtwoord moet minstens 8 tekens zijn" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const operator = await resolveWarmtefondsOperator(sb, token);
    if (!operator) {
      return NextResponse.json(
        { error: "Portaal niet gevonden" },
        { status: 404 }
      );
    }

    const { data: row, error: readErr } = await sb
      .from("warmtefonds_operators")
      .select("id, password_hash")
      .eq("id", operator.id)
      .maybeSingle();
    if (readErr) {
      if (
        readErr.code === "42703" ||
        readErr.message?.includes("password_hash")
      ) {
        return NextResponse.json(
          {
            error:
              "Wachtwoord-kolom ontbreekt — draai migrate-warmtefonds-operator-accounts.sql",
          },
          { status: 400 }
        );
      }
      throw readErr;
    }
    if (!row?.password_hash) {
      return NextResponse.json(
        {
          error:
            "Nog geen wachtwoord ingesteld. Vraag Batterijconcept om inloggegevens.",
        },
        { status: 400 }
      );
    }
    if (!verifyPassword(huidig, String(row.password_hash))) {
      return NextResponse.json(
        { error: "Huidig wachtwoord is onjuist" },
        { status: 400 }
      );
    }

    const { error: updErr } = await sb
      .from("warmtefonds_operators")
      .update({ password_hash: hashPassword(nieuw) })
      .eq("id", operator.id);
    if (updErr) throw updErr;

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Wachtwoord wijzigen mislukt") },
      { status: 500 }
    );
  }
}
