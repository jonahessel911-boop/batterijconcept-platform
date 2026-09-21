/**
 * GET /api/instroom/afspraken — interne recruitment-agenda
 * POST — gesprek inplannen (geen e-mail naar kandidaat)
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

/** ISO of Amsterdam-lokaal YYYY-MM-DDTHH:mm */
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
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const day = Number(m[3]);
    const h = Number(m[4]);
    const min = Number(m[5]);
    const sec = Number(m[6] || 0);
    return fromZonedTime(new Date(y, mo - 1, day, h, min, sec, 0), AMSTERDAM_TZ);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const from = pickStr(sp.get("from"));
    const to = pickStr(sp.get("to"));
    const sollicitatieId = pickStr(sp.get("sollicitatie_id"));

    const sb = getSupabaseAdmin();
    let q = sb
      .from("sollicitatie_afspraken")
      .select(
        "*, sollicitaties(id, naam, email, telefoon, functie, status)"
      )
      .order("start_at", { ascending: true });

    if (sollicitatieId) q = q.eq("sollicitatie_id", sollicitatieId);
    if (from) q = q.gte("start_at", new Date(from).toISOString());
    if (to) q = q.lte("start_at", new Date(to).toISOString());

    const { data, error } = await q;
    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-recruitment-agenda.sql uit in Supabase.",
          },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ afspraken: data || [] });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Agenda laden mislukt") },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const sollicitatieId = pickStr(body.sollicitatie_id);
    const startRaw = pickStr(body.start_at);
    const soort = parseSoort(body.soort) || "telefonisch";
    const notitie = pickStr(body.notitie);

    if (!sollicitatieId || !startRaw) {
      return NextResponse.json(
        { error: "sollicitatie_id en start_at zijn verplicht" },
        { status: 400 }
      );
    }

    const start = parseStartAt(startRaw);
    if (!start) {
      return NextResponse.json({ error: "Ongeldige start_at" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();

    const { data: sol, error: solErr } = await sb
      .from("sollicitaties")
      .select("id, status")
      .eq("id", sollicitatieId)
      .maybeSingle();
    if (solErr) throw solErr;
    if (!sol) {
      return NextResponse.json(
        { error: "Kandidaat niet gevonden" },
        { status: 404 }
      );
    }

    const { data, error } = await sb
      .from("sollicitatie_afspraken")
      .insert({
        sollicitatie_id: sollicitatieId,
        start_at: start.toISOString(),
        soort,
        notitie,
      })
      .select("*, sollicitaties(id, naam, email, telefoon, functie, status)")
      .single();

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-recruitment-agenda.sql uit in Supabase.",
          },
          { status: 400 }
        );
      }
      throw error;
    }

    // Kanban: zet op "Gesprek gepland" (geen mail)
    if (sol.status !== "aangenomen" && sol.status !== "diskwalificatie") {
      await sb
        .from("sollicitaties")
        .update({ status: "gesprek_gepland", updated_at: new Date().toISOString() })
        .eq("id", sollicitatieId);
    }

    return NextResponse.json({ afspraak: data }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Afspraak aanmaken mislukt") },
      { status: 500 }
    );
  }
}
