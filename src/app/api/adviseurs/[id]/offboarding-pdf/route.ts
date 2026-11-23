import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { magNietGelopenAdviseur, normalizeRol } from "@/lib/rollen";
import { RELATIE_CONTRACT_BUCKET } from "@/lib/relatie-contract";
import { buildOffboardingPdf } from "@/lib/pdf-offboarding";
import { errMessage } from "@/lib/errors";
import {
  isProjectGeannuleerd,
  isProjectHoldSales,
} from "@/lib/backoffice-acties";
import { normalizeProjectStatus } from "@/lib/labels";
import {
  commissieVerwacht,
  orderCommissiePctVanOfferte,
  resolveOrderCommissiePct,
} from "@/lib/netto-boord";

export const runtime = "nodejs";

function safeName(s: string): string {
  return s.replace(/[^\w.\- àáâäèéêëìíîïòóôöùúûüç]+/gi, " ").trim() || "adviseur";
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session?.adviseurId) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }

  const sb = getSupabaseAdmin();
  const { data: me } = await sb
    .from("adviseurs")
    .select("rol")
    .eq("id", session.adviseurId)
    .maybeSingle();
  const rol = normalizeRol(me?.rol || session.rol);
  if (!magNietGelopenAdviseur(rol)) {
    return NextResponse.json(
      { error: "Alleen backoffice of admin" },
      { status: 403 }
    );
  }

  let body: { ingangsdatum?: string; slotdatum?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const ingangsdatum = (body.ingangsdatum || "").trim();
  const slotdatum = (body.slotdatum || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ingangsdatum) || !/^\d{4}-\d{2}-\d{2}$/.test(slotdatum)) {
    return NextResponse.json(
      { error: "Vul ingangsdatum en slotdatum in (jjjj-mm-dd)." },
      { status: 400 }
    );
  }

  try {
    const { data: adv, error: advErr } = await sb
      .from("adviseurs")
      .select(
        "id, naam, email, telefoon, bedrijfsnaam, kvk_nummer, factuur_adres, factuur_postcode, factuur_plaats, commissie_pct, contract_storage_path, contract_sign_fields, contract_signed_at, contract_uploaded_at"
      )
      .eq("id", id)
      .maybeSingle();
    if (advErr || !adv) {
      return NextResponse.json(
        { error: "Adviseur niet gevonden" },
        { status: 404 }
      );
    }

    const offSelectFull =
      "id, offerte_nummer, ondertekend_op, subtotaal_ex_btw, totaal_inc_btw, status, commissie_pct, notities, leads!inner(naam, plaats, adviseur_id)";
    const offSelectCore =
      "id, offerte_nummer, ondertekend_op, subtotaal_ex_btw, totaal_inc_btw, status, notities, leads!inner(naam, plaats, adviseur_id)";
    let offRes = await sb
      .from("offertes")
      .select(offSelectFull)
      .eq("leads.adviseur_id", id)
      .eq("status", "ondertekend")
      .order("ondertekend_op", { ascending: true });
    if (
      offRes.error &&
      (offRes.error.code === "42703" ||
        offRes.error.message?.includes("commissie_pct"))
    ) {
      offRes = await sb
        .from("offertes")
        .select(offSelectCore)
        .eq("leads.adviseur_id", id)
        .eq("status", "ondertekend")
        .order("ondertekend_op", { ascending: true });
    }
    const offertes = offRes.data || [];
    const offerteIds = offertes
      .map((o) => String(o.id || ""))
      .filter(Boolean);

    const projectByOfferte = new Map<string, { status?: string | null }>();
    if (offerteIds.length) {
      const { data: projecten } = await sb
        .from("projecten")
        .select("offerte_id, status")
        .in("offerte_id", offerteIds);
      for (const p of projecten || []) {
        const oid = String(p.offerte_id || "");
        if (!oid) continue;
        const prev = projectByOfferte.get(oid);
        if (
          !prev ||
          normalizeProjectStatus(p.status) === "annulering" ||
          normalizeProjectStatus(prev.status) !== "annulering"
        ) {
          projectByOfferte.set(oid, p);
        }
      }
    }

    const adviseurPct =
      adv.commissie_pct != null && Number.isFinite(Number(adv.commissie_pct))
        ? Number(adv.commissie_pct)
        : null;

    const orders = offertes
      .filter((o) => {
        const project = projectByOfferte.get(String(o.id || ""));
        if (!project) return true;
        return !(
          isProjectGeannuleerd(project) || isProjectHoldSales(project)
        );
      })
      .map((o) => {
        const lead = o.leads as
          | { naam?: string | null; plaats?: string | null }
          | { naam?: string | null; plaats?: string | null }[]
          | null;
        const L = Array.isArray(lead) ? lead[0] : lead;
        let bedragEx = Number(o.subtotaal_ex_btw) || 0;
        if (!(bedragEx > 0) && Number(o.totaal_inc_btw) > 0) {
          bedragEx =
            Math.round((Number(o.totaal_inc_btw) / 1.21) * 100) / 100;
        }
        const orderPct = orderCommissiePctVanOfferte({
          id: o.id,
          commissie_pct: (o as { commissie_pct?: number | null }).commissie_pct,
          notities: o.notities,
        });
        const pct = resolveOrderCommissiePct(orderPct, adviseurPct);
        const commissieEx = commissieVerwacht(bedragEx, pct);
        return {
          offerteNummer: String(o.offerte_nummer || ""),
          klantNaam: L?.naam || "Klant",
          plaats: L?.plaats || null,
          ondertekendOp: o.ondertekend_op || null,
          bedragEx,
          commissieEx,
        };
      });
    const totaleCommissieEx = Math.round(
      orders.reduce((s, o) => s + o.commissieEx, 0) * 100
    ) / 100;

    let nietGelopen: {
      startAt: string;
      klantNaam: string;
      plaats: string | null;
    }[] = [];
    const ng = await sb
      .from("afspraken")
      .select(
        "start_at, leads(naam, plaats)"
      )
      .eq("adviseur_id", id)
      .eq("niet_gelopen_door_adviseur", true)
      .order("start_at", { ascending: true });
    if (!ng.error) {
      nietGelopen = (ng.data || []).map((a) => {
        const lead = a.leads as
          | { naam?: string | null; plaats?: string | null }
          | { naam?: string | null; plaats?: string | null }[]
          | null;
        const L = Array.isArray(lead) ? lead[0] : lead;
        return {
          startAt: String(a.start_at),
          klantNaam: L?.naam || "Klant",
          plaats: L?.plaats || null,
        };
      });
    }

    let overeenkomstBytes: Uint8Array | null = null;
    const path = adv.contract_storage_path as string | null;
    if (path) {
      const { data: file } = await sb.storage
        .from(RELATIE_CONTRACT_BUCKET)
        .download(path);
      if (file) {
        overeenkomstBytes = new Uint8Array(await file.arrayBuffer());
      }
    }

    const postcodePlaats = [adv.factuur_postcode, adv.factuur_plaats]
      .filter(Boolean)
      .join(" ");

    const bytes = await buildOffboardingPdf({
      adviseurNaam: adv.naam,
      bedrijfsnaam: adv.bedrijfsnaam || null,
      email: adv.email || null,
      telefoon: adv.telefoon || null,
      adres: adv.factuur_adres || null,
      postcodePlaats: postcodePlaats || null,
      kvk: adv.kvk_nummer || null,
      ingangsdatum,
      slotdatum,
      overeenkomstIngangsdatum:
        (
          adv.contract_sign_fields as { ingangsdatum?: string | null } | null
        )?.ingangsdatum?.trim() || null,
      contractGetekendOp:
        adv.contract_signed_at || adv.contract_uploaded_at || null,
      orders,
      nietGelopen,
      totaleCommissieEx,
      overeenkomstBytes,
    });

    const filename = `Offboarding ${safeName(adv.naam)}${
      adv.bedrijfsnaam ? ` - ${safeName(adv.bedrijfsnaam)}` : ""
    }.pdf`;

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "PDF maken mislukt") },
      { status: 500 }
    );
  }
}
