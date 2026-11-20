import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { normalizeRol } from "@/lib/rollen";
import { errMessage } from "@/lib/errors";
import { isSimonBeller } from "@/lib/ops-namen";
import { parseInboxTerugbelSuggestie } from "@/lib/inbox-terugbel";
import { planAfspraak } from "@/lib/plan-afspraak";
import { logLeadEvent } from "@/lib/lead-events";

export const runtime = "nodejs";

/**
 * POST /api/inbox/terugbel
 * Maakt een interne terugbel-afspraak (soort bel) voor Simon.
 */
export async function POST(req: NextRequest) {
  try {
    const jar = await cookies();
    const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
    if (!session) {
      return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    }
    const rol = normalizeRol(session.rol);
    if (rol !== "admin" && rol !== "backoffice") {
      return NextResponse.json({ error: "Geen toegang" }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as {
      lead_id?: string;
      start_at?: string | null;
      notitie?: string | null;
      subject?: string | null;
      body_text?: string | null;
      ai_summary?: string | null;
    };
    const leadId = (body.lead_id || "").trim();
    if (!leadId) {
      return NextResponse.json(
        { error: "Koppel eerst een lead" },
        { status: 400 }
      );
    }

    const parsed = parseInboxTerugbelSuggestie({
      subject: body.subject,
      bodyText: body.body_text,
      aiSummary: body.ai_summary,
    });
    const startAt = (body.start_at || parsed?.startAt || "").trim();
    if (!startAt) {
      return NextResponse.json(
        { error: "Geen terugbelmoment herkend" },
        { status: 400 }
      );
    }

    const sb = getSupabaseAdmin();
    const { data: adviseurs, error: advErr } = await sb
      .from("adviseurs")
      .select("id, naam, rol, actief")
      .eq("actief", true);
    if (advErr) throw advErr;
    const rows = adviseurs || [];
    const simon =
      rows.find((a) => isSimonBeller(a) && normalizeRol(a.rol) === "beller") ||
      rows.find((a) => isSimonBeller(a)) ||
      rows.find((a) => normalizeRol(a.rol) === "beller");
    if (!simon?.id) {
      return NextResponse.json(
        { error: "Geen beller (Simon) gevonden" },
        { status: 500 }
      );
    }

    const note =
      (body.notitie || "").trim() ||
      parsed?.hint ||
      "Terugbelverzoek via inbox";

    const result = await planAfspraak(sb, {
      lead_id: leadId,
      adviseur_id: simon.id,
      start_at: startAt,
      notities: `Via inbox: ${note}`.slice(0, 500),
      soort: "bel",
      ingepland_door_id: session.adviseurId || null,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, detail: result.detail },
        { status: result.status }
      );
    }

    await sb
      .from("leads")
      .update({
        terugbellen: true,
        terugbel_notitie: note.slice(0, 400),
        beller_id: simon.id,
      })
      .eq("id", leadId);

    await logLeadEvent({
      leadId,
      soort: "terugbel",
      titel: "Terugbelverzoek via inbox",
      detail: `${note} · ${simon.naam} · ${startAt.replace("T", " ").slice(0, 16)}`,
      meta: {
        bron: "inbox",
        adviseur_id: simon.id,
        start_at: startAt,
      },
    });

    return NextResponse.json({
      ok: true,
      afspraak: result.afspraak,
      beller: { id: simon.id, naam: simon.naam },
      start_at: startAt,
      label: parsed?.label || null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Terugbelverzoek mislukt") },
      { status: 500 }
    );
  }
}
