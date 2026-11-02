import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { buildFactuurPdf } from "@/lib/pdf-factuur";
import { sendEmail } from "@/lib/email/postmark";
import { factuurWarmtefondsAanbetalingHerinneringEmail } from "@/lib/email/templates";
import { verstuurFactuurNaarKlant } from "@/lib/factuur-versturen";
import { formatDateShort, formatEuro } from "@/lib/format";
import { errMessage } from "@/lib/errors";
import {
  COMPANY_ACCOUNT_NAME,
  COMPANY_IBAN_DISPLAY,
} from "@/lib/factuur-betaling";
import { companyInfo } from "@/lib/pdf-brand";
import { selectFactuurById } from "@/lib/factuur-query";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { isAdminEmail } from "@/lib/admin-adviseur";
import { normalizeRol } from "@/lib/rollen";

export const runtime = "nodejs";

/** Klantfactuur-PDF: admin/backoffice. Adviseur ziet tijdlijn zonder download. */
async function requireFactuurPdfAccess() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return {
      error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }),
    };
  }
  const rol = normalizeRol(session.rol);
  const ok =
    rol === "admin" ||
    rol === "backoffice" ||
    isAdminEmail(session.email);
  if (!ok) {
    return {
      error: NextResponse.json(
        { error: "Geen toegang tot klantfacturen." },
        { status: 403 }
      ),
    };
  }
  return { session };
}

async function loadFactuur(id: string) {
  const sb = getSupabaseAdmin();
  const { data, error } = await selectFactuurById(sb, id);
  if (error || !data) return null;

  let offerte = null;
  if (data.offerte_id) {
    const { data: o } = await sb
      .from("offertes")
      .select("offerte_nummer, subtotaal_ex_btw, btw_bedrag, totaal_inc_btw")
      .eq("id", data.offerte_id)
      .maybeSingle();
    offerte = o;
  }

  return { ...data, offertes: offerte };
}

/** GET /api/facturen/[id]/pdf — download PDF (ook concept). ?inline=1 = in browser tonen. */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireFactuurPdfAccess();
  if (auth.error) return auth.error;

  const { id } = await ctx.params;
  const inline = req.nextUrl.searchParams.get("inline") === "1";
  try {
    const factuur = await loadFactuur(id);
    if (!factuur) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    const offerte = factuur.offertes as {
      offerte_nummer: string;
      subtotaal_ex_btw: number;
      btw_bedrag: number;
      totaal_inc_btw: number;
    } | null;

    const creditVanRaw = factuur.credit_van as
      | { id: string; factuur_nummer: string }
      | { id: string; factuur_nummer: string }[]
      | null;
    const creditVan = Array.isArray(creditVanRaw)
      ? creditVanRaw[0]
      : creditVanRaw;
    const isCredit = Boolean(factuur.credit_van_factuur_id);
    const creditVanNummer = creditVan?.factuur_nummer || null;

    const blob = await buildFactuurPdf({
      factuur,
      lead: factuur.leads,
      offerte,
      creditVanNummer,
    });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const filename = `${isCredit ? "credit-" : ""}${factuur.factuur_nummer}${
      factuur.status === "concept" ? "-concept" : ""
    }.pdf`;

    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "PDF mislukt") },
      { status: 500 }
    );
  }
}

type LoadedFactuur = NonNullable<Awaited<ReturnType<typeof loadFactuur>>>;

/** Vriendelijke herinnering: openstaande aanbetaling vóór Warmtefonds-aanvraag. */
async function sendWarmtefondsAanbetalingHerinnering(
  sb: ReturnType<typeof getSupabaseAdmin>,
  id: string,
  factuur: LoadedFactuur
) {
  const { isAanbetalingFactuurOmschrijving } = await import(
    "@/lib/aanbetaling"
  );
  const { isWarmtefondsProject } = await import("@/lib/backoffice-acties");

  if (factuur.credit_van_factuur_id) {
    return NextResponse.json(
      { error: "Herinnering is niet bedoeld voor creditfacturen" },
      { status: 400 }
    );
  }
  if (!isAanbetalingFactuurOmschrijving(factuur.omschrijving)) {
    return NextResponse.json(
      { error: "Herinnering alleen voor aanbetalingsfacturen" },
      { status: 400 }
    );
  }
  if (factuur.status !== "verzonden" && factuur.status !== "deels_betaald") {
    return NextResponse.json(
      {
        error:
          "Herinnering alleen bij verzonden of deels betaalde aanbetaling",
      },
      { status: 400 }
    );
  }

  let project: {
    id: string;
    project_nummer?: string | null;
    betaalwijze?: string | null;
    warmtefonds_aangevraagd_at?: string | null;
    leads?: { status?: string | null } | { status?: string | null }[] | null;
    offertes?:
      | { financiering_voorbehoud?: boolean | null }
      | { financiering_voorbehoud?: boolean | null }[]
      | null;
  } | null = null;

  if (factuur.project_id) {
    const { data } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, betaalwijze, warmtefonds_aangevraagd_at, leads(status), offertes(financiering_voorbehoud)"
      )
      .eq("id", factuur.project_id)
      .maybeSingle();
    project = data;
  } else if (factuur.offerte_id) {
    const { data } = await sb
      .from("projecten")
      .select(
        "id, project_nummer, betaalwijze, warmtefonds_aangevraagd_at, leads(status), offertes(financiering_voorbehoud)"
      )
      .eq("offerte_id", factuur.offerte_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    project = data;
  }

  if (!project || !isWarmtefondsProject(project as never)) {
    return NextResponse.json(
      {
        error:
          "Herinnering alleen bij Warmtefonds-route (aanbetaling vóór aanvraag)",
      },
      { status: 400 }
    );
  }

  const email = factuur.leads?.email as string | null | undefined;
  if (!email) {
    return NextResponse.json(
      { error: "Lead heeft geen e-mailadres" },
      { status: 400 }
    );
  }

  const offerte = factuur.offertes as {
    offerte_nummer: string;
    subtotaal_ex_btw: number;
    btw_bedrag: number;
    totaal_inc_btw: number;
  } | null;

  const blob = await buildFactuurPdf({
    factuur,
    lead: factuur.leads,
    offerte,
  });
  const pdfBytes = Buffer.from(await blob.arrayBuffer());
  const filename = `${factuur.factuur_nummer}.pdf`;

  let trackUrl: string | null = null;
  try {
    const offerteId = factuur.offerte_id as string | null;
    if (offerteId) {
      const { ensureOfferteTrackToken } = await import(
        "@/lib/ensure-track-token"
      );
      const { data: offTrack } = await sb
        .from("offertes")
        .select("id, track_token")
        .eq("id", offerteId)
        .maybeSingle();
      if (offTrack?.id) {
        const trackToken = await ensureOfferteTrackToken(
          sb,
          offTrack.id,
          offTrack.track_token
        );
        if (trackToken) {
          const { appBaseUrl } = await import("@/lib/email/postmark");
          trackUrl = `${appBaseUrl()}/track/${trackToken}`;
        }
      }
    }
  } catch {
    /* track optioneel */
  }

  const co = companyInfo();
  const html = factuurWarmtefondsAanbetalingHerinneringEmail({
    naam: factuur.leads?.naam || "klant",
    factuurNummer: factuur.factuur_nummer,
    bedrag: formatEuro(factuur.bedrag_inc_btw),
    vervaldatum: factuur.vervaldatum
      ? formatDateShort(factuur.vervaldatum)
      : null,
    iban: co.iban || COMPANY_IBAN_DISPLAY,
    accountName: co.accountName || COMPANY_ACCOUNT_NAME,
    betalingskenmerk: offerte?.offerte_nummer || factuur.factuur_nummer,
    projectNummer: project.project_nummer || null,
    trackUrl,
  });

  const sent = await sendEmail({
    to: email,
    subject: `Herinnering aanbetaling ${factuur.factuur_nummer} — Warmtefonds`,
    html,
    tag: "factuur-wf-aanbetaling-herinnering",
    attachments: [
      {
        name: filename,
        contentType: "application/pdf",
        content: pdfBytes,
      },
    ],
  });

  if (!sent.ok) {
    return NextResponse.json(
      { error: sent.error || "Mail versturen mislukt" },
      { status: 500 }
    );
  }

  const leadId = factuur.lead_id as string | null | undefined;
  if (leadId) {
    const { logLeadEvent } = await import("@/lib/lead-events");
    const nr = factuur.factuur_nummer || id.slice(0, 8);
    const bedrag = Number(factuur.bedrag_inc_btw || 0);
    await logLeadEvent({
      leadId,
      soort: "factuur",
      titel: `Herinnering aanbetaling ${nr} verstuurd`,
      detail: [
        `Naar ${email}`,
        bedrag > 0 ? `${formatEuro(bedrag)} incl. btw` : null,
        "Warmtefonds — aanbetaling nodig vóór aanvraag",
      ]
        .filter(Boolean)
        .join(" · "),
      meta: {
        factuur_id: id,
        factuur_nummer: nr,
        message_id: sent.messageId,
        is_aanbetaling: true,
        is_herinnering: true,
        warmtefonds: true,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    reminder: true,
    messageId: sent.messageId,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireFactuurPdfAccess();
  if (auth.error) return auth.error;

  const { id } = await ctx.params;
  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    /* empty ok */
  }

  if (body.action !== "send" && body.action !== "send_reminder") {
    return NextResponse.json(
      {
        error:
          "Gebruik action: 'send' of 'send_reminder' om te mailen",
      },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const factuur = await loadFactuur(id);
    if (!factuur) {
      return NextResponse.json({ error: "Factuur niet gevonden" }, { status: 404 });
    }

    if (body.action === "send_reminder") {
      return await sendWarmtefondsAanbetalingHerinnering(sb, id, factuur);
    }

    const sent = await verstuurFactuurNaarKlant(id);
    if (!sent.ok) {
      return NextResponse.json({ error: sent.error }, { status: sent.status });
    }
    return NextResponse.json({
      ok: true,
      factuur: sent.factuur,
      messageId: sent.messageId,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verzenden mislukt") },
      { status: 500 }
    );
  }
}
