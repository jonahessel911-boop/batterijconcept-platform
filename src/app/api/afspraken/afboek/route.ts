import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import {
  isSaleUitkomst,
  soortVoorVervolgUitkomst,
  uitkomstVereistVervolgPunt,
} from "@/lib/afspraak-soort";
import { planAfspraak } from "@/lib/plan-afspraak";
import { leadStatusLabel } from "@/lib/labels";
import { logLeadEvent } from "@/lib/lead-events";
import { queueLeadMetaCapi } from "@/lib/meta-capi";
import type { LeadStatus } from "@/types/database";

export const runtime = "nodejs";

/**
 * POST /api/afspraken/afboek
 * Rond een afspraak af: optioneel eerst vervolg plannen, daarna uitkomst + voltooid.
 * Service-role — voorkomt browser-RLS/volgorde-bugs bij telefonisch vervolg.
 */
export async function POST(req: NextRequest) {
  let body: {
    afspraak_id?: string;
    uitkomst?: string;
    notitie?: string;
    /** Amsterdam-lokaal `YYYY-MM-DDTHH:mm` of ISO */
    vervolg_at?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const afspraakId = body.afspraak_id?.trim();
  const uitkomst = (body.uitkomst || "").trim() as LeadStatus | "";
  const noteText = (body.notitie || "").trim();

  if (!afspraakId) {
    return NextResponse.json(
      { error: "afspraak_id is verplicht" },
      { status: 400 }
    );
  }
  if (!uitkomst) {
    return NextResponse.json({ error: "Kies een uitkomst" }, { status: 400 });
  }

  const isSale = isSaleUitkomst(uitkomst);
  if (isSale) {
    return NextResponse.json(
      { error: "Sale-afboeking loopt via backoffice-formulier" },
      { status: 400 }
    );
  }

  const needsVervolg = uitkomstVereistVervolgPunt(uitkomst);
  if (!noteText) {
    return NextResponse.json({ error: "Vul een notitie in" }, { status: 400 });
  }
  if (needsVervolg && !body.vervolg_at?.trim()) {
    return NextResponse.json(
      { error: "Kies datum en tijd voor het vervolg" },
      { status: 400 }
    );
  }

  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session?.adviseurId) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }

    const sb = getSupabaseAdmin();
    const { data: current, error: curErr } = await sb
      .from("afspraken")
      .select("id, lead_id, adviseur_id, status, soort, start_at")
      .eq("id", afspraakId)
      .maybeSingle();

    if (curErr || !current) {
      return NextResponse.json(
        { error: "Afspraak niet gevonden" },
        { status: 404 }
      );
    }
    if (current.status === "geannuleerd") {
      return NextResponse.json(
        { error: "Geannuleerde afspraak kan niet worden afgeboekt" },
        { status: 409 }
      );
    }
    if (!current.adviseur_id) {
      return NextResponse.json(
        { error: "Geen adviseur op deze afspraak" },
        { status: 400 }
      );
    }

    // 1) Vervolg eerst — bij falen blijft huidige afspraak open om opnieuw te proberen
    let nieuwVervolg: unknown = null;
    if (needsVervolg && body.vervolg_at) {
      const plan = await planAfspraak(sb, {
        lead_id: current.lead_id,
        adviseur_id: current.adviseur_id,
        start_at: body.vervolg_at.trim(),
        notities: noteText,
        soort: soortVoorVervolgUitkomst(uitkomst),
        ingepland_door_id: session.adviseurId,
      });
      if (!plan.ok) {
        return NextResponse.json(
          {
            error: plan.error || "Vervolg plannen mislukt",
            detail: plan.detail,
          },
          { status: plan.status }
        );
      }
      nieuwVervolg = plan.afspraak;
    }

    // 2) Lead-uitkomst
    const { error: leadErr } = await sb
      .from("leads")
      .update({ status: uitkomst })
      .eq("id", current.lead_id);
    if (leadErr) {
      return NextResponse.json(
        { error: "Leadstatus bijwerken mislukt", detail: leadErr.message },
        { status: 500 }
      );
    }

    // 3) Afspraak afronden
    const { error: afspraakErr } = await sb
      .from("afspraken")
      .update({ status: "voltooid" })
      .eq("id", current.id);
    if (afspraakErr) {
      return NextResponse.json(
        { error: "Afspraak afronden mislukt", detail: afspraakErr.message },
        { status: 500 }
      );
    }

    if (!needsVervolg) {
      const { data: leadRow } = await sb
        .from("leads")
        .select("notities")
        .eq("id", current.lead_id)
        .maybeSingle();
      const stamp = new Date().toLocaleString("nl-NL", {
        timeZone: "Europe/Amsterdam",
      });
      const line = `[${stamp}] Uitkomst afspraak: ${leadStatusLabel[uitkomst] || uitkomst} — ${noteText}`;
      const prev = (leadRow?.notities || "").trim();
      await sb
        .from("leads")
        .update({ notities: prev ? `${prev}\n${line}` : line })
        .eq("id", current.lead_id);
    }

    queueLeadMetaCapi(current.lead_id);
    await logLeadEvent({
      leadId: current.lead_id,
      soort: "status",
      titel: `Status → ${leadStatusLabel[uitkomst] || uitkomst}`,
      detail: needsVervolg
        ? "Via afboek + vervolg gepland"
        : "Via afboek (eindstatus)",
    });

    return NextResponse.json({
      ok: true,
      uitkomst,
      afspraak_id: current.id,
      vervolg: nieuwVervolg,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Fout";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
