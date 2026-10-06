import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminAdviseur, isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";
import {
  creditWeekByYearWeek,
  previousCreditWeek,
} from "@/lib/adviseur-creditfactuur";
import { formatPartnerCreditFactuurNummer } from "@/lib/pdf-partner-creditfactuur";
import {
  RELATIE_FACTUUR_BETAALTERMIJN_DAGEN,
  bedragenMetBtw,
} from "@/lib/pdf-relatie-factuur";
import { verstuurPartnerCreditfactuur } from "@/lib/creditfactuur-verstuur";
import { dayKeyAmsterdam } from "@/lib/planning-window";

export const runtime = "nodejs";

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) return { error: "Niet ingelogd", status: 401 as const };
  const rol = normalizeRol(session.rol);
  const mag =
    rol === "admin" ||
    isAdminEmail(session.email) ||
    isAdminAdviseur({ naam: session.naam, email: session.email });
  if (!mag) {
    return { error: "Alleen admin", status: 403 as const };
  }
  return { session };
}

/**
 * GET /api/partners/creditfacturen?partner_id=
 * Zonder partner_id: overzicht alle partner-creditfacturen.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const partnerId = req.nextUrl.searchParams.get("partner_id");

  try {
    const sb = getSupabaseAdmin();

    if (!partnerId) {
      const { data: facturen, error } = await sb
        .from("partner_creditfacturen")
        .select(
          "*, installatie_partners!partner_id(id, naam, bedrijfsnaam, kvk_nummer, iban)"
        )
        .order("factuurdatum", { ascending: false })
        .limit(200);

      if (error) {
        if (
          error.code === "42703" ||
          error.message?.includes("partner_creditfacturen")
        ) {
          return NextResponse.json(
            {
              error:
                "Voer supabase/migrate-partner-creditfacturen.sql uit in Supabase",
            },
            { status: 503 }
          );
        }
        throw error;
      }

      const { data: partners } = await sb
        .from("installatie_partners")
        .select(
          "id, naam, actief, bedrijfsnaam, kvk_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
        )
        .eq("actief", true)
        .order("naam");

      return NextResponse.json({
        week: previousCreditWeek(),
        facturen: facturen || [],
        partners: partners || [],
      });
    }

    const { data: partner, error: pErr } = await sb
      .from("installatie_partners")
      .select(
        "id, naam, bedrijfsnaam, kvk_nummer, btw_nummer, factuur_adres, factuur_postcode, factuur_plaats, iban"
      )
      .eq("id", partnerId)
      .maybeSingle();

    if (pErr || !partner) {
      return NextResponse.json(
        { error: "Partner niet gevonden" },
        { status: 404 }
      );
    }

    const { data: facturen, error: facErr } = await sb
      .from("partner_creditfacturen")
      .select("*")
      .eq("partner_id", partnerId)
      .order("factuurdatum", { ascending: false })
      .limit(100);

    if (facErr) {
      if (
        facErr.code === "42703" ||
        facErr.message?.includes("partner_creditfacturen")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-partner-creditfacturen.sql uit in Supabase",
          },
          { status: 503 }
        );
      }
      throw facErr;
    }

    return NextResponse.json({
      partner,
      week: previousCreditWeek(),
      facturen: facturen || [],
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/partners/creditfacturen
 * Body: { partner_id, bedrag_ex_btw, omschrijving?, jaar?, week?, notities? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    partner_id?: string;
    bedrag_ex_btw?: number;
    omschrijving?: string;
    offerte_nummer?: string;
    project_nummer?: string;
    jaar?: number;
    week?: number;
    notities?: string;
    mark_paid?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.partner_id) {
    return NextResponse.json(
      { error: "partner_id is verplicht" },
      { status: 400 }
    );
  }
  const bedrag = Number(body.bedrag_ex_btw);
  if (!Number.isFinite(bedrag) || bedrag <= 0) {
    return NextResponse.json(
      { error: "bedrag_ex_btw moet groter dan 0 zijn" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: partner, error: pErr } = await sb
      .from("installatie_partners")
      .select(
        "id, naam, email, bedrijfsnaam, kvk_nummer, btw_nummer, iban, factuur_adres, factuur_postcode, factuur_plaats"
      )
      .eq("id", body.partner_id)
      .maybeSingle();

    if (pErr || !partner) {
      return NextResponse.json(
        { error: "Partner niet gevonden" },
        { status: 404 }
      );
    }

    if (!partner.bedrijfsnaam || !partner.kvk_nummer || !partner.iban) {
      return NextResponse.json(
        {
          error:
            "Vul eerst KvK-gegevens in bij Instellingen: bedrijfsnaam, KvK en IBAN.",
        },
        { status: 400 }
      );
    }
    if (!partner.email?.trim()) {
      return NextResponse.json(
        { error: "Vul eerst een e-mailadres in bij de installatiepartner." },
        { status: 400 }
      );
    }

    const weekInfo =
      body.jaar && body.week
        ? creditWeekByYearWeek(body.jaar, body.week)
        : previousCreditWeek();

    const jaar = weekInfo.jaar;
    const { count } = await sb
      .from("partner_creditfacturen")
      .select("id", { count: "exact", head: true })
      .gte("factuurdatum", `${jaar}-01-01`)
      .lte("factuurdatum", `${jaar}-12-31`);

    const factuurNummer = formatPartnerCreditFactuurNummer(
      jaar,
      (count || 0) + 1
    );
    const bedragRounded = Math.round(bedrag * 100) / 100;
    const withBtw = bedragenMetBtw(bedragRounded);
    const status = body.mark_paid ? "betaald" : "concept";
    const offerte_nummer = body.offerte_nummer?.trim() || null;
    const project_nummer = body.project_nummer?.trim() || null;
    const omschrijving =
      body.omschrijving?.trim() ||
      `Installatiewerkzaamheden week ${weekInfo.week} (${weekInfo.van} t/m ${weekInfo.tot})`;

    const { data: created, error: insErr } = await sb
      .from("partner_creditfacturen")
      .insert({
        partner_id: body.partner_id,
        factuur_nummer: factuurNummer,
        status,
        week_jaar: weekInfo.jaar,
        week_nummer: weekInfo.week,
        periode_van: weekInfo.van,
        periode_tot: weekInfo.tot,
        omschrijving,
        offerte_nummer,
        project_nummer,
        bedrag_ex_btw: withBtw.bedrag_ex_btw,
        btw_bedrag: withBtw.btw_bedrag,
        bedrag_inc_btw: withBtw.bedrag_inc_btw,
        factuurdatum: weekInfo.betaalMaandag,
        betaald_op: body.mark_paid ? weekInfo.betaalMaandag : null,
        notities: [
          body.notities?.trim() || null,
          `Factuur van ${partner.bedrijfsnaam} aan Batterijconcept.`,
          `Betaaltermijn ${RELATIE_FACTUUR_BETAALTERMIJN_DAGEN} dagen.`,
          `BTW 21%. KvK ${partner.kvk_nummer}, IBAN ${partner.iban}.`,
        ]
          .filter(Boolean)
          .join(" "),
      })
      .select("*")
      .single();

    if (insErr || !created) {
      if (
        insErr?.code === "42703" ||
        insErr?.message?.includes("partner_creditfacturen")
      ) {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-partner-creditfacturen.sql (en migrate-partner-creditfacturen-refs.sql) uit in Supabase",
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: insErr?.message || "Aanmaken mislukt" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        factuur: created,
        mail_sent: false,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Aanmaken mislukt") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/partners/creditfacturen
 * Body: { id, status }
 * status=verzonden → mail + PDF naar partner
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { id?: string; status?: string; betaald_op?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  if (!body.id) {
    return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
  }

  const allowed = [
    "concept",
    "verzonden",
    "goedgekeurd",
    "betaald",
    "geannuleerd",
  ] as const;
  if (
    body.status &&
    !allowed.includes(body.status as (typeof allowed)[number])
  ) {
    return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    if (body.status === "verzonden") {
      const result = await verstuurPartnerCreditfactuur(sb, body.id);
      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }
      return NextResponse.json({
        factuur: result.factuur,
        mail_sent: result.mail_sent,
      });
    }

    const patch: Record<string, unknown> = {};
    if (body.status) patch.status = body.status;
    if (body.status === "betaald") {
      patch.betaald_op = body.betaald_op || dayKeyAmsterdam(new Date());
    }
    if (body.status === "goedgekeurd") {
      patch.goedgekeurd_op = new Date().toISOString();
    }
    if (body.status === "geannuleerd" || body.status === "concept") {
      patch.betaald_op = null;
      if (body.status === "concept") {
        patch.verzonden_op = null;
        patch.goedgekeurd_op = null;
      }
    }

    const { data, error } = await sb
      .from("partner_creditfacturen")
      .update(patch)
      .eq("id", body.id)
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Bijwerken mislukt" },
        { status: 500 }
      );
    }
    return NextResponse.json({ factuur: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Bijwerken mislukt") },
      { status: 500 }
    );
  }
}
