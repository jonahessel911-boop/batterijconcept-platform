import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth-session";
import { errMessage } from "@/lib/errors";
import { normalizeRol } from "@/lib/rollen";
import type {
  AdviseurKosten,
  AdviseurKostenSoort,
  AdviseurKostenStatus,
} from "@/types/database";

export const runtime = "nodejs";

const SOORTEN: AdviseurKostenSoort[] = ["voorschot", "kosten", "correctie"];
const STATUSSEN: AdviseurKostenStatus[] = [
  "open",
  "ingedekt",
  "geannuleerd",
];

async function requireAdmin() {
  const jar = await cookies();
  const session = await verifySessionToken(jar.get(COOKIE_NAME)?.value);
  if (!session) {
    return { error: NextResponse.json({ error: "Niet ingelogd" }, { status: 401 }) };
  }
  const rol = normalizeRol(session.rol);
  if (rol !== "admin" && rol !== "backoffice") {
    return {
      error: NextResponse.json({ error: "Geen toegang" }, { status: 403 }),
    };
  }
  return { session };
}

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error?.message) return false;
  return (
    error.code === "42P01" ||
    /adviseur_kosten/i.test(error.message) ||
    /schema cache/i.test(error.message)
  );
}

function missingTableResponse() {
  return NextResponse.json(
    {
      error:
        "Tabel adviseur_kosten ontbreekt. Voer supabase/migrate-adviseur-kosten.sql uit in Supabase.",
    },
    { status: 503 }
  );
}

/**
 * GET /api/adviseurs/kosten?adviseur_id=&status=open|ingedekt|geannuleerd|all
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth && auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const adviseurId = searchParams.get("adviseur_id")?.trim() || null;
  const statusRaw = (searchParams.get("status") || "open").trim();
  const status =
    statusRaw === "all"
      ? null
      : STATUSSEN.includes(statusRaw as AdviseurKostenStatus)
        ? (statusRaw as AdviseurKostenStatus)
        : "open";

  try {
    const sb = getSupabaseAdmin();
    let q = sb
      .from("adviseur_kosten")
      .select("*")
      .order("kosten_datum", { ascending: false })
      .order("created_at", { ascending: false });
    if (adviseurId) q = q.eq("adviseur_id", adviseurId);
    if (status) q = q.eq("status", status);

    const { data, error } = await q;
    if (error) {
      if (isMissingTable(error)) return missingTableResponse();
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []) as AdviseurKosten[];
    const ids = [...new Set(rows.map((r) => r.adviseur_id))];
    const cfIds = [
      ...new Set(
        rows.map((r) => r.creditfactuur_id).filter((id): id is string => !!id)
      ),
    ];

    const naamById = new Map<string, string>();
    if (ids.length > 0) {
      const { data: advs } = await sb
        .from("adviseurs")
        .select("id, naam")
        .in("id", ids);
      for (const a of advs || []) {
        naamById.set(a.id as string, (a.naam as string) || "");
      }
    }

    const nummerById = new Map<string, string>();
    if (cfIds.length > 0) {
      const { data: cfs } = await sb
        .from("adviseur_creditfacturen")
        .select("id, factuur_nummer")
        .in("id", cfIds);
      for (const f of cfs || []) {
        nummerById.set(f.id as string, (f.factuur_nummer as string) || "");
      }
    }

    const kosten = rows.map((r) => ({
      ...r,
      bedrag_ex_btw: Number(r.bedrag_ex_btw) || 0,
      adviseur_naam: naamById.get(r.adviseur_id) || null,
      factuur_nummer: r.creditfactuur_id
        ? nummerById.get(r.creditfactuur_id) || null
        : null,
    }));

    return NextResponse.json({ kosten });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

/**
 * POST /api/adviseurs/kosten
 * { adviseur_id, omschrijving, bedrag_ex_btw, soort?, kosten_datum?, notities? }
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth && auth.error) return auth.error;

  let body: {
    adviseur_id?: string;
    omschrijving?: string;
    bedrag_ex_btw?: number | string;
    soort?: string;
    kosten_datum?: string;
    notities?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const adviseurId = body.adviseur_id?.trim();
  const omschrijving = body.omschrijving?.trim();
  const bedrag = Number(
    String(body.bedrag_ex_btw ?? "")
      .replace(",", ".")
      .trim()
  );
  const soort = (body.soort?.trim() || "voorschot") as AdviseurKostenSoort;
  const kostenDatum = body.kosten_datum?.trim() || null;
  const notities = body.notities?.trim() || null;

  if (!adviseurId) {
    return NextResponse.json(
      { error: "adviseur_id is verplicht" },
      { status: 400 }
    );
  }
  if (!omschrijving) {
    return NextResponse.json(
      { error: "omschrijving is verplicht" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(bedrag) || bedrag <= 0) {
    return NextResponse.json(
      { error: "bedrag_ex_btw moet groter dan 0 zijn" },
      { status: 400 }
    );
  }
  if (!SOORTEN.includes(soort)) {
    return NextResponse.json({ error: "Ongeldig soort" }, { status: 400 });
  }
  if (kostenDatum && !/^\d{4}-\d{2}-\d{2}$/.test(kostenDatum)) {
    return NextResponse.json(
      { error: "kosten_datum moet yyyy-mm-dd zijn" },
      { status: 400 }
    );
  }

  try {
    const sb = getSupabaseAdmin();
    const { data: adv, error: advErr } = await sb
      .from("adviseurs")
      .select("id, naam")
      .eq("id", adviseurId)
      .maybeSingle();
    if (advErr || !adv) {
      return NextResponse.json(
        { error: advErr?.message || "Medewerker niet gevonden" },
        { status: 404 }
      );
    }

    const insert: Record<string, unknown> = {
      adviseur_id: adviseurId,
      soort,
      omschrijving,
      bedrag_ex_btw: Math.round(bedrag * 100) / 100,
      status: "open",
      aangemaakt_door: auth.session?.adviseurId || null,
      notities,
    };
    if (kostenDatum) insert.kosten_datum = kostenDatum;

    const { data, error } = await sb
      .from("adviseur_kosten")
      .insert(insert)
      .select("*")
      .single();
    if (error) {
      if (isMissingTable(error)) return missingTableResponse();
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      kosten: {
        ...(data as AdviseurKosten),
        bedrag_ex_btw: Number((data as AdviseurKosten).bedrag_ex_btw) || 0,
        adviseur_naam: (adv.naam as string) || null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/adviseurs/kosten
 * - Annuleren: { id, status: "geannuleerd" }
 * - Heropenen: { id, status: "open" } (alleen als niet gekoppeld of na ontkoppelen)
 * - Inboeken op factuur: { ids: string[], creditfactuur_id } → markeert open als ingedekt
 * - Bewerken open: { id, omschrijving?, bedrag_ex_btw?, soort?, kosten_datum?, notities? }
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth && auth.error) return auth.error;

  let body: {
    id?: string;
    ids?: string[];
    status?: AdviseurKostenStatus;
    creditfactuur_id?: string | null;
    omschrijving?: string;
    bedrag_ex_btw?: number | string;
    soort?: string;
    kosten_datum?: string;
    notities?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();

    // Bulk: open kosten koppelen aan creditfactuur (ingedekt)
    if (Array.isArray(body.ids) && body.creditfactuur_id) {
      const ids = body.ids.map((id) => String(id).trim()).filter(Boolean);
      const cfId = body.creditfactuur_id.trim();
      if (ids.length === 0) {
        return NextResponse.json({ error: "ids is verplicht" }, { status: 400 });
      }

      const { data: cf, error: cfErr } = await sb
        .from("adviseur_creditfacturen")
        .select("id, adviseur_id, status")
        .eq("id", cfId)
        .maybeSingle();
      if (cfErr || !cf) {
        return NextResponse.json(
          { error: cfErr?.message || "Creditfactuur niet gevonden" },
          { status: 404 }
        );
      }

      const { data: openRows, error: openErr } = await sb
        .from("adviseur_kosten")
        .select("*")
        .in("id", ids)
        .eq("status", "open")
        .eq("adviseur_id", cf.adviseur_id);
      if (openErr) {
        if (isMissingTable(openErr)) return missingTableResponse();
        return NextResponse.json({ error: openErr.message }, { status: 500 });
      }
      if (!openRows || openRows.length === 0) {
        return NextResponse.json(
          { error: "Geen open kosten gevonden voor deze medewerker" },
          { status: 400 }
        );
      }

      const now = new Date().toISOString();
      const { data: updated, error: updErr } = await sb
        .from("adviseur_kosten")
        .update({
          status: "ingedekt",
          creditfactuur_id: cfId,
          ingedekt_op: now,
          updated_at: now,
        })
        .in(
          "id",
          openRows.map((r) => r.id as string)
        )
        .select("*");
      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
      return NextResponse.json({
        kosten: (updated || []).map((r) => ({
          ...r,
          bedrag_ex_btw: Number(r.bedrag_ex_btw) || 0,
        })),
      });
    }

    if (!body.id) {
      return NextResponse.json({ error: "id is verplicht" }, { status: 400 });
    }

    const { data: current, error: curErr } = await sb
      .from("adviseur_kosten")
      .select("*")
      .eq("id", body.id)
      .maybeSingle();
    if (curErr) {
      if (isMissingTable(curErr)) return missingTableResponse();
      return NextResponse.json({ error: curErr.message }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json({ error: "Kostenpost niet gevonden" }, { status: 404 });
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.status === "geannuleerd") {
      if (current.status === "ingedekt") {
        return NextResponse.json(
          {
            error:
              "Ingedekte kosten kun je niet annuleren. Haal de aftrek van de factuur af of heropen eerst.",
          },
          { status: 400 }
        );
      }
      patch.status = "geannuleerd";
      patch.creditfactuur_id = null;
      patch.ingedekt_op = null;
    } else if (body.status === "open") {
      patch.status = "open";
      patch.creditfactuur_id = null;
      patch.ingedekt_op = null;
    } else if (body.status != null) {
      return NextResponse.json({ error: "Ongeldige status" }, { status: 400 });
    }

    if (current.status === "open" || body.status === "open") {
      if (body.omschrijving != null) {
        const o = body.omschrijving.trim();
        if (!o) {
          return NextResponse.json(
            { error: "omschrijving mag niet leeg zijn" },
            { status: 400 }
          );
        }
        patch.omschrijving = o;
      }
      if (body.bedrag_ex_btw != null && body.bedrag_ex_btw !== "") {
        const bedrag = Number(String(body.bedrag_ex_btw).replace(",", "."));
        if (!Number.isFinite(bedrag) || bedrag <= 0) {
          return NextResponse.json(
            { error: "bedrag_ex_btw moet groter dan 0 zijn" },
            { status: 400 }
          );
        }
        patch.bedrag_ex_btw = Math.round(bedrag * 100) / 100;
      }
      if (body.soort != null) {
        const soort = body.soort.trim() as AdviseurKostenSoort;
        if (!SOORTEN.includes(soort)) {
          return NextResponse.json({ error: "Ongeldig soort" }, { status: 400 });
        }
        patch.soort = soort;
      }
      if (body.kosten_datum != null) {
        const d = body.kosten_datum.trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          return NextResponse.json(
            { error: "kosten_datum moet yyyy-mm-dd zijn" },
            { status: 400 }
          );
        }
        patch.kosten_datum = d;
      }
      if (body.notities !== undefined) {
        patch.notities = body.notities?.trim() || null;
      }
    }

    const { data, error } = await sb
      .from("adviseur_kosten")
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

    return NextResponse.json({
      kosten: {
        ...(data as AdviseurKosten),
        bedrag_ex_btw: Number((data as AdviseurKosten).bedrag_ex_btw) || 0,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Bijwerken mislukt") },
      { status: 500 }
    );
  }
}
