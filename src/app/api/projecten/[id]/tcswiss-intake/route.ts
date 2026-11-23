import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { logLeadEvent } from "@/lib/lead-events";
import {
  tcSwissConfigured,
  tcSwissLeadIntake,
  tcSwissLeadsZoeken,
  tcSwissNotitieToevoegen,
} from "@/lib/tcswiss";
import {
  parseTcSwissIntakeStored,
  regelsZijnWarmtepomp,
  serializeTcSwissIntakeStored,
  splitNaamVoorTcSwiss,
  TCSWISS_INTAKE_CHECK_KEY,
  type TcSwissIntakeStored,
} from "@/lib/tcswiss-intake";

export const runtime = "nodejs";

type OfferteRegelRow = {
  omschrijving?: string | null;
  product_id?: string | null;
};

type WpRegel = {
  sku: string | null;
  naam: string | null;
  omschrijving?: string | null;
};

async function loadOfferteRegelsMetSku(
  sb: ReturnType<typeof getSupabaseAdmin>,
  offerteId: string
): Promise<WpRegel[]> {
  const { data: regels, error } = await sb
    .from("offerte_regels")
    .select("omschrijving, product_id")
    .eq("offerte_id", offerteId);
  if (error || !regels?.length) return [];

  const productIds = [
    ...new Set(
      (regels as OfferteRegelRow[])
        .map((r) => r.product_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const skuByProduct = new Map<string, { sku: string | null; naam: string | null }>();
  if (productIds.length > 0) {
    const { data: producten } = await sb
      .from("producten")
      .select("id, sku, naam")
      .in("id", productIds);
    for (const p of producten || []) {
      skuByProduct.set(p.id as string, {
        sku: (p.sku as string | null) || null,
        naam: (p.naam as string | null) || null,
      });
    }
  }

  return (regels as OfferteRegelRow[]).map((r) => {
    const prod = r.product_id ? skuByProduct.get(r.product_id) : null;
    return {
      sku: prod?.sku || null,
      naam: prod?.naam || null,
      omschrijving: r.omschrijving,
    };
  });
}

async function sessionOk(): Promise<boolean> {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  return Boolean(session);
}

async function offerteHeeftWarmtepomp(
  sb: ReturnType<typeof getSupabaseAdmin>,
  offerteId: string | null | undefined
): Promise<boolean> {
  if (!offerteId) return false;
  const regels = await loadOfferteRegelsMetSku(sb, offerteId);
  return regelsZijnWarmtepomp(regels);
}

function euroPlain(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(Number(n))) return null;
  return String(Math.round(Number(n) * 100) / 100);
}

function storedFromChecks(
  checks: Record<string, boolean | string> | null | undefined
): TcSwissIntakeStored | null {
  return parseTcSwissIntakeStored(checks);
}

/**
 * GET /api/projecten/[id]/tcswiss-intake
 * Of dit een warmtepomp-order is en of die al naar TC Swiss is gestuurd.
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await sessionOk())) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: project, error } = await sb
      .from("projecten")
      .select("id, offerte_id, materiaal_checks")
      .eq("id", id)
      .single();
    if (error || !project) {
      return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
    }

    const stored = storedFromChecks(
      project.materiaal_checks as Record<string, boolean | string> | null
    );
    const applicable =
      Boolean(stored) ||
      (await offerteHeeftWarmtepomp(sb, project.offerte_id as string | null));

    const refresh = new URL(req.url).searchParams.get("refresh") === "1";
    let lookup: {
      ok: boolean;
      error?: string;
      leads: unknown[];
    } | null = null;
    if (refresh && stored) {
      try {
        const found = await tcSwissLeadsZoeken({
          lead: stored.lead,
          zoek: stored.lead ? null : stored.externId,
        });
        lookup = { ok: found.ok, leads: found.leads };
      } catch (e) {
        lookup = {
          ok: false,
          error: errMessage(e, "Ophalen bij TC Swiss mislukt"),
          leads: [],
        };
      }
    }

    return NextResponse.json({
      applicable,
      configured: tcSwissConfigured(),
      sent: Boolean(stored),
      sentAt: stored?.at || null,
      tcswissLead: stored?.lead || null,
      externId: stored?.externId || null,
      duplicate: stored?.duplicate || false,
      lookup,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "TC Swiss-status laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projecten/[id]/tcswiss-intake
 * Schiet de getekende warmtepomp-order in bij TC Swiss (RelayPro lead_intake).
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  if (!(await sessionOk())) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    let { data: project, error } = await sb
      .from("projecten")
      .select(
        "id, offerte_id, lead_id, project_nummer, materiaal_checks, betaalwijze, financiering_status, schouw_at, schouw_jaar, schouw_week, schouw_notities, notities, backoffice_notitie, leads(id, naam, email, telefoon, postcode, huisnummer, toevoeging, straat, plaats, notities, adviseur_id, adviseurs!adviseur_id(id, naam))"
      )
      .eq("id", id)
      .single();
    if (error) {
      const retry = await sb
        .from("projecten")
        .select(
          "id, offerte_id, lead_id, project_nummer, materiaal_checks, betaalwijze, financiering_status, schouw_at, schouw_jaar, schouw_week, schouw_notities, notities, backoffice_notitie, leads(id, naam, email, telefoon, postcode, huisnummer, toevoeging, straat, plaats, notities, adviseur_id)"
        )
        .eq("id", id)
        .single();
      project = retry.data as typeof project;
      error = retry.error;
    }
    if (error || !project) {
      return NextResponse.json({ error: "Project niet gevonden" }, { status: 404 });
    }

    const checks = (project.materiaal_checks || {}) as Record<
      string,
      boolean | string
    >;
    const stored = storedFromChecks(checks);
    if (stored) {
      return NextResponse.json({
        ok: true,
        alreadySent: true,
        duplicate: stored.duplicate,
        lead: stored.lead,
        externId: stored.externId,
        sentAt: stored.at,
        materiaal_checks: checks,
      });
    }

    const applicable = await offerteHeeftWarmtepomp(
      sb,
      project.offerte_id as string | null
    );
    if (!applicable) {
      return NextResponse.json(
        { error: "Dit is geen warmtepomp-order" },
        { status: 400 }
      );
    }

    if (!tcSwissConfigured()) {
      return NextResponse.json(
        {
          error:
            "TC Swiss is niet geconfigureerd (TCSWISS_RELAYPRO_TOKEN ontbreekt)",
        },
        { status: 503 }
      );
    }

    const leadRaw = project.leads as
      | {
          id?: string;
          naam?: string | null;
          email?: string | null;
          telefoon?: string | null;
          postcode?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          straat?: string | null;
          plaats?: string | null;
          notities?: string | null;
          adviseur_id?: string | null;
          adviseurs?:
            | { id?: string; naam?: string | null }
            | { id?: string; naam?: string | null }[]
            | null;
        }
      | {
          id?: string;
          naam?: string | null;
          email?: string | null;
          telefoon?: string | null;
          postcode?: string | null;
          huisnummer?: string | null;
          toevoeging?: string | null;
          straat?: string | null;
          plaats?: string | null;
          notities?: string | null;
          adviseur_id?: string | null;
          adviseurs?:
            | { id?: string; naam?: string | null }
            | { id?: string; naam?: string | null }[]
            | null;
        }[]
      | null;
    const lead = Array.isArray(leadRaw) ? leadRaw[0] : leadRaw;
    if (!lead) {
      return NextResponse.json(
        { error: "Geen lead gekoppeld aan dit project" },
        { status: 400 }
      );
    }

    const { firstName, lastName } = splitNaamVoorTcSwiss(lead.naam);
    const huisnummer = [lead.huisnummer, lead.toevoeging]
      .map((s) => (s || "").trim())
      .filter(Boolean)
      .join(" ");
    const externId = String(lead.id || project.lead_id || "").trim();
    if (!externId) {
      return NextResponse.json(
        { error: "Lead-id ontbreekt — kan niet inschieten" },
        { status: 400 }
      );
    }

    const offerteId = (project.offerte_id as string | null) || null;
    const [regels, offerteRow] = await Promise.all([
      offerteId ? loadOfferteRegelsMetSku(sb, offerteId) : Promise.resolve([]),
      offerteId
        ? sb
            .from("offertes")
            .select(
              "id, offerte_nummer, titel, intro_tekst, notities, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw"
            )
            .eq("id", offerteId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const offerte = offerteRow.data as {
      offerte_nummer?: string | null;
      titel?: string | null;
      intro_tekst?: string | null;
      notities?: string | null;
      subtotaal_ex_btw?: number | null;
      btw_bedrag?: number | null;
      totaal_inc_btw?: number | null;
    } | null;

    const wpRegels = regels.filter((r) => regelsZijnWarmtepomp([r]));
    const sku = [...new Set(wpRegels.map((r) => r.sku).filter(Boolean))].join(
      ", "
    );
    const warmtepompType = [
      ...new Set(
        wpRegels
          .map((r) => (r.naam || r.omschrijving || "").trim())
          .filter(Boolean)
      ),
    ].join(", ");

    const advRaw = lead.adviseurs;
    const adviseur = Array.isArray(advRaw) ? advRaw[0] : advRaw;
    let adviseurNaam = (adviseur?.naam || "").trim();
    if (!adviseurNaam && lead.adviseur_id) {
      const { data: advRow } = await sb
        .from("adviseurs")
        .select("naam")
        .eq("id", lead.adviseur_id)
        .maybeSingle();
      adviseurNaam = String(advRow?.naam || "").trim();
    }

    const notities = [
      String(lead.notities || "").trim(),
      String(project.notities || "").trim(),
      String(project.backoffice_notitie || "").trim(),
      String(offerte?.notities || "").trim(),
    ]
      .filter(Boolean)
      .join("\n---\n");

    const extra = {
      project_nummer: String(project.project_nummer || "").trim() || null,
      warmtepomp_type: warmtepompType || null,
      sku: sku || null,
      offerte_nummer: String(offerte?.offerte_nummer || "").trim() || null,
      bedrag_inc: euroPlain(offerte?.totaal_inc_btw),
      adviseur: adviseurNaam || null,
    };

    const notitieRegels = [
      extra.project_nummer && `Project: ${extra.project_nummer}`,
      extra.warmtepomp_type && `Warmtepomp: ${extra.warmtepomp_type}`,
      extra.offerte_nummer && `Offerte: ${extra.offerte_nummer}`,
      extra.sku && `SKU: ${extra.sku}`,
      extra.bedrag_inc && `Totaal inc. btw: € ${extra.bedrag_inc}`,
      extra.adviseur && `Adviseur: ${extra.adviseur}`,
      notities && `Notities:\n${notities}`,
    ].filter(Boolean);
    const notitie = notitieRegels.join("\n");

    const result = await tcSwissLeadIntake({
      externId,
      lastName,
      firstName,
      email: lead.email,
      tel: lead.telefoon,
      postcode: lead.postcode,
      plaats: lead.plaats,
      straat: lead.straat,
      huisnummer: huisnummer || null,
      extra,
      notitie,
    });
    if (result.lead && notitie) {
      await tcSwissNotitieToevoegen({ lead: result.lead, tekst: notitie }).catch(
        (e) => console.error("TC Swiss notitie:", e)
      );
    }

    const nextStored: TcSwissIntakeStored = {
      at: new Date().toISOString(),
      lead: result.lead,
      externId: result.externId,
      duplicate: result.duplicate,
    };
    const nextChecks = {
      ...checks,
      [TCSWISS_INTAKE_CHECK_KEY]: serializeTcSwissIntakeStored(nextStored),
    };

    const { error: updErr } = await sb
      .from("projecten")
      .update({ materiaal_checks: nextChecks, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updErr) throw updErr;

    if (project.lead_id) {
      await logLeadEvent({
        leadId: String(project.lead_id),
        soort: "overig",
        titel: result.duplicate
          ? "TC Swiss · al bekend (opnieuw ingeschoten)"
          : "TC Swiss · order ingeschoten",
        detail: result.lead
          ? `RelayPro-lead ${result.lead}`
          : `extern_id ${result.externId}`,
        meta: {
          project_id: id,
          project_nummer: project.project_nummer || null,
          tcswiss_lead: result.lead,
          extern_id: result.externId,
          duplicate: result.duplicate,
        },
      });
    }

    return NextResponse.json({
      ok: result.ok,
      alreadySent: false,
      duplicate: result.duplicate,
      lead: result.lead,
      externId: result.externId,
      sentAt: nextStored.at,
      materiaal_checks: nextChecks,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Inschieten bij TC Swiss mislukt") },
      { status: 500 }
    );
  }
}
