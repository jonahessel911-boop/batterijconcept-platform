import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { magNietGelopenAdviseur, normalizeRol } from "@/lib/rollen";
import { logLeadEvent } from "@/lib/lead-events";
import { errMessage } from "@/lib/errors";

export const runtime = "nodejs";

async function requireMarker() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session?.adviseurId) {
    return { error: "Niet ingelogd", status: 401 as const };
  }
  const sb = getSupabaseAdmin();
  const { data } = await sb
    .from("adviseurs")
    .select("rol")
    .eq("id", session.adviseurId)
    .maybeSingle();
  const rol = normalizeRol(data?.rol || session.rol);
  if (!magNietGelopenAdviseur(rol)) {
    return { error: "Alleen backoffice of admin", status: 403 as const };
  }
  return { sb, session, rol };
}

function isMissingColumn(error: { message?: string; code?: string } | null) {
  if (!error?.message) return false;
  return (
    error.code === "42703" ||
    error.message.includes("niet_gelopen_door_adviseur")
  );
}

/** GET ?adviseur_ids=a,b — aantallen per adviseur (all-time).
 *  ?items=1 — lijst (alleen admin/backoffice). */
export async function GET(req: NextRequest) {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session?.adviseurId) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  const sb = getSupabaseAdmin();
  const wantItems = req.nextUrl.searchParams.get("items") === "1";
  if (wantItems) {
    const { data: me } = await sb
      .from("adviseurs")
      .select("rol")
      .eq("id", session.adviseurId)
      .maybeSingle();
    if (!magNietGelopenAdviseur(me?.rol || session.rol)) {
      return NextResponse.json(
        { error: "Alleen backoffice of admin" },
        { status: 403 }
      );
    }
  }

  const ids = (req.nextUrl.searchParams.get("adviseur_ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    let q = sb
      .from("afspraken")
      .select(
        wantItems
          ? "id, adviseur_id, start_at, lead_id, leads(naam, plaats)"
          : "id, adviseur_id"
      )
      .eq("niet_gelopen_door_adviseur", true)
      .order("start_at", { ascending: true });
    if (ids.length) q = q.in("adviseur_id", ids);
    const { data, error } = await q;
    if (error) {
      if (isMissingColumn(error)) {
        return NextResponse.json({
          counts: {},
          items: [],
          hint: "Voer supabase/migrate-afspraak-niet-gelopen-adviseur.sql uit.",
        });
      }
      throw error;
    }
    const counts: Record<string, number> = {};
    const items: {
      id: string;
      adviseur_id: string;
      start_at: string;
      lead_id: string | null;
      klant_naam: string;
      plaats: string | null;
    }[] = [];
    for (const row of data || []) {
      const r = row as {
        id?: string;
        adviseur_id?: string | null;
        start_at?: string;
        lead_id?: string | null;
        leads?:
          | { naam?: string | null; plaats?: string | null }
          | { naam?: string | null; plaats?: string | null }[]
          | null;
      };
      const aid = String(r.adviseur_id || "");
      if (!aid) continue;
      counts[aid] = (counts[aid] || 0) + 1;
      if (wantItems) {
        const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
        items.push({
          id: String(r.id || ""),
          adviseur_id: aid,
          start_at: String(r.start_at || ""),
          lead_id: r.lead_id || null,
          klant_naam: lead?.naam || "Klant",
          plaats: lead?.plaats || null,
        });
      }
    }
    return NextResponse.json(wantItems ? { counts, items } : { counts });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

/** POST { afspraak_id } — markeer niet gelopen door adviseur. */
export async function POST(req: NextRequest) {
  const auth = await requireMarker();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { afspraak_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const afspraakId = body.afspraak_id?.trim();
  if (!afspraakId) {
    return NextResponse.json(
      { error: "afspraak_id is verplicht" },
      { status: 400 }
    );
  }

  try {
    const { data: current, error: curErr } = await auth.sb
      .from("afspraken")
      .select(
        "id, lead_id, adviseur_id, status, soort, start_at, niet_gelopen_door_adviseur"
      )
      .eq("id", afspraakId)
      .maybeSingle();

    if (curErr) {
      if (isMissingColumn(curErr)) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-afspraak-niet-gelopen-adviseur.sql uit in Supabase.",
          },
          { status: 503 }
        );
      }
      throw curErr;
    }
    if (!current) {
      return NextResponse.json(
        { error: "Afspraak niet gevonden" },
        { status: 404 }
      );
    }
    if (current.status === "geannuleerd") {
      return NextResponse.json(
        { error: "Geannuleerde afspraak kan niet worden gemarkeerd" },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      niet_gelopen_door_adviseur: true,
      niet_gelopen_door_adviseur_at: now,
      niet_gelopen_door_adviseur_door: auth.session.adviseurId,
    };
    if (current.status !== "voltooid") {
      patch.status = "voltooid";
    }

    const { data: updated, error: updErr } = await auth.sb
      .from("afspraken")
      .update(patch)
      .eq("id", current.id)
      .select(
        "*, leads(naam, email, telefoon, lead_number, notities, postcode, huisnummer, toevoeging, straat, plaats, status), adviseurs!adviseur_id(naam, email)"
      )
      .maybeSingle();

    if (updErr) {
      if (isMissingColumn(updErr)) {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-afspraak-niet-gelopen-adviseur.sql uit in Supabase.",
          },
          { status: 503 }
        );
      }
      throw updErr;
    }

    if (current.lead_id) {
      await logLeadEvent({
        leadId: current.lead_id,
        soort: "status",
        titel: "Niet gelopen door adviseur",
        detail:
          "Afspraak gemarkeerd voor boeteclausule 3.3 (€100 per uitgevallen afspraak).",
        meta: {
          afspraak_id: current.id,
          adviseur_id: auth.session.adviseurId,
          adviseur_naam: auth.session.naam,
          bron: "niet_gelopen_adviseur",
        },
      });
    }

    return NextResponse.json({ ok: true, afspraak: updated });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}
