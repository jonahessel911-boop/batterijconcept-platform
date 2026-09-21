/**
 * PATCH / DELETE /api/instroom/afspraken/[id]
 * Intern — geen e-mail.
 */

import { NextRequest, NextResponse } from "next/server";
import { fromZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { AMSTERDAM_TZ } from "@/lib/format";
import type { SollicitatieAfspraakSoort } from "@/types/database";

export const runtime = "nodejs";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

function parseSoort(v: unknown): SollicitatieAfspraakSoort | null {
  const s = pickStr(v);
  if (s === "fysiek" || s === "telefonisch") return s;
  return null;
}

function parseStartAt(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/Z$/i.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (m) {
    return fromZonedTime(
      new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4]),
        Number(m[5]),
        Number(m[6] || 0),
        0
      ),
      AMSTERDAM_TZ
    );
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const patch: {
      start_at?: string;
      soort?: SollicitatieAfspraakSoort;
      notitie?: string | null;
      updated_at: string;
    } = { updated_at: new Date().toISOString() };

    if ("start_at" in body) {
      const raw = pickStr(body.start_at);
      if (!raw) {
        return NextResponse.json({ error: "start_at ongeldig" }, { status: 400 });
      }
      const start = parseStartAt(raw);
      if (!start) {
        return NextResponse.json({ error: "start_at ongeldig" }, { status: 400 });
      }
      patch.start_at = start.toISOString();
    }
    if ("soort" in body) {
      const soort = parseSoort(body.soort);
      if (!soort) {
        return NextResponse.json({ error: "Ongeldige soort" }, { status: 400 });
      }
      patch.soort = soort;
    }
    if ("notitie" in body) patch.notitie = pickStr(body.notitie);

    const sb = getSupabaseAdmin();
    const { data, error } = await sb
      .from("sollicitatie_afspraken")
      .update(patch)
      .eq("id", id)
      .select("*, sollicitaties(id, naam, email, telefoon, functie, status)")
      .single();
    if (error) throw error;
    return NextResponse.json({ afspraak: data });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Opslaan mislukt") },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { error } = await sb
      .from("sollicitatie_afspraken")
      .delete()
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Verwijderen mislukt") },
      { status: 500 }
    );
  }
}
