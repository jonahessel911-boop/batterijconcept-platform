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

/** GET /api/instroom/trainingen/[id] */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("training_momenten")
      .select(SELECT)
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    const dagen = [...((data.dagen as unknown[]) || [])].sort(
      (a, b) =>
        ((a as { dag_nummer?: number }).dag_nummer || 0) -
        ((b as { dag_nummer?: number }).dag_nummer || 0)
    );
    return NextResponse.json({ training: { ...data, dagen } });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Laden mislukt") },
      { status: 500 }
    );
  }
}

/** PATCH /api/instroom/trainingen/[id] */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige JSON" }, { status: 400 });
  }

  try {
    const sb = getSupabaseAdmin();
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if ("naam" in body) {
      const naam = pickStr(body.naam);
      if (!naam) {
        return NextResponse.json({ error: "Naam is verplicht" }, { status: 400 });
      }
      patch.naam = naam;
    }
    if ("inhoud" in body) {
      const inhoud = pickStr(body.inhoud);
      if (!inhoud) {
        return NextResponse.json(
          { error: "Inhoud is verplicht" },
          { status: 400 }
        );
      }
      patch.inhoud = inhoud;
    }
    if ("adres" in body) {
      patch.adres = pickStr(body.adres) || RECRUITMENT_TRAINING_LOCATIE;
    }
    if ("periode_van" in body) {
      const d = pickDate(body.periode_van);
      if (!d) {
        return NextResponse.json(
          { error: "Ongeldige periode_van" },
          { status: 400 }
        );
      }
      patch.periode_van = d;
    }
    if ("periode_tot" in body) {
      const d = pickDate(body.periode_tot);
      if (!d) {
        return NextResponse.json(
          { error: "Ongeldige periode_tot" },
          { status: 400 }
        );
      }
      patch.periode_tot = d;
    }

    if ("dagen" in body) {
      const dagen = parseDagen(body.dagen);
      if ("error" in dagen) {
        return NextResponse.json({ error: dagen.error }, { status: 400 });
      }
      if (!("periode_van" in patch)) {
        patch.periode_van = dagen.reduce(
          (min, d) => (d.datum < min ? d.datum : min),
          dagen[0].datum
        );
      }
      if (!("periode_tot" in patch)) {
        patch.periode_tot = dagen.reduce(
          (max, d) => (d.datum > max ? d.datum : max),
          dagen[0].datum
        );
      }

      await sb
        .from("training_moment_dagen")
        .delete()
        .eq("training_moment_id", id);

      const { error: dagenErr } = await sb.from("training_moment_dagen").insert(
        dagen.map((d) => ({
          training_moment_id: id,
          dag_nummer: d.dag_nummer,
          datum: d.datum,
          start_tijd: d.start_tijd,
          eind_tijd: d.eind_tijd,
          planning: d.planning,
        }))
      );
      if (dagenErr) throw dagenErr;
    }

    const { data, error } = await sb
      .from("training_momenten")
      .update(patch)
      .eq("id", id)
      .select(SELECT)
      .single();
    if (error) throw error;

    const dagen = [...((data.dagen as unknown[]) || [])].sort(
      (a, b) =>
        ((a as { dag_nummer?: number }).dag_nummer || 0) -
        ((b as { dag_nummer?: number }).dag_nummer || 0)
    );
    return NextResponse.json({ training: { ...data, dagen } });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}

/** DELETE /api/instroom/trainingen/[id] */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb.from("training_momenten").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}
