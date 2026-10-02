import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { RECRUITMENT_TRAINING_LOCATIE } from "@/lib/sollicitatie";

export const runtime = "nodejs";

const SELECT =
  "*, dagen:training_moment_dagen(*)";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t || null;
}

function pickDate(v: unknown): string | null {
  const s = pickStr(v);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function pickTime(v: unknown): string | null {
  const s = pickStr(v);
  if (!s) return null;
  // HH:MM or HH:MM:SS
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  return s.length === 5 ? `${s}:00` : s;
}

type DagInput = {
  dag_nummer: number;
  datum: string;
  start_tijd: string;
  eind_tijd: string;
  planning: string;
};

function parseDagen(raw: unknown): DagInput[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Voeg minstens één trainingsdag toe" };
  }
  const out: DagInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { error: `Dag ${i + 1} is ongeldig` };
    }
    const r = row as Record<string, unknown>;
    const datum = pickDate(r.datum);
    const start = pickTime(r.start_tijd);
    const eind = pickTime(r.eind_tijd);
    const planning = pickStr(r.planning) || "";
    if (!datum || !start || !eind) {
      return {
        error: `Dag ${i + 1}: vul datum, start- en eindtijd in`,
      };
    }
    out.push({
      dag_nummer: i + 1,
      datum,
      start_tijd: start,
      eind_tijd: eind,
      planning,
    });
  }
  return out;
}

/** GET /api/instroom/trainingen */
export async function GET() {
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("training_momenten")
      .select(SELECT)
      .order("periode_van", { ascending: true });

    if (error) {
      if (error.code === "42P01" || error.message?.includes("training_momenten")) {
        return NextResponse.json({
          trainingen: [],
          error:
            "Voer supabase/migrate-training-momenten.sql uit in Supabase.",
        });
      }
      throw error;
    }

    const trainingen = (data || []).map((t) => ({
      ...t,
      dagen: [...((t.dagen as unknown[]) || [])].sort(
        (a, b) =>
          ((a as { dag_nummer?: number }).dag_nummer || 0) -
          ((b as { dag_nummer?: number }).dag_nummer || 0)
      ),
    }));

    return NextResponse.json({ trainingen });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

/** POST /api/instroom/trainingen */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  const naam = pickStr(body.naam);
  const inhoud = pickStr(body.inhoud);
  const adres = pickStr(body.adres) || RECRUITMENT_TRAINING_LOCATIE;
  const dagen = parseDagen(body.dagen);
  if ("error" in dagen) {
    return NextResponse.json({ error: dagen.error }, { status: 400 });
  }
  if (!naam) {
    return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
  }
  if (!inhoud) {
    return NextResponse.json(
      { error: "Beschrijf wat jullie tijdens de training doen" },
      { status: 400 }
    );
  }

  const periodeVan =
    pickDate(body.periode_van) ||
    dagen.reduce(
      (min, d) => (d.datum < min ? d.datum : min),
      dagen[0].datum
    );
  const periodeTot =
    pickDate(body.periode_tot) ||
    dagen.reduce(
      (max, d) => (d.datum > max ? d.datum : max),
      dagen[0].datum
    );

  try {
    const sb = getSupabaseAdmin();
    const { data: moment, error } = await sb
      .from("training_momenten")
      .insert({
        naam,
        periode_van: periodeVan,
        periode_tot: periodeTot,
        adres,
        inhoud,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Voer supabase/migrate-training-momenten.sql uit in Supabase.",
          },
          { status: 400 }
        );
      }
      throw error;
    }

    const { data: dagenRows, error: dagenErr } = await sb
      .from("training_moment_dagen")
      .insert(
        dagen.map((d) => ({
          training_moment_id: moment.id,
          dag_nummer: d.dag_nummer,
          datum: d.datum,
          start_tijd: d.start_tijd,
          eind_tijd: d.eind_tijd,
          planning: d.planning,
        }))
      )
      .select("*")
      .order("dag_nummer", { ascending: true });

    if (dagenErr) throw dagenErr;

    return NextResponse.json({
      training: { ...moment, dagen: dagenRows || [] },
    });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Aanmaken mislukt") },
      { status: 500 }
    );
  }
}
