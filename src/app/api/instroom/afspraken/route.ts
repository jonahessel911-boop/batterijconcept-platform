/**
 * GET /api/instroom/afspraken — interne recruitment-agenda
 * POST — gesprek inplannen (+ bevestigingsmail naar kandidaat indien e-mail bekend)
 */

import { NextRequest, NextResponse } from "next/server";
import { fromZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { AMSTERDAM_TZ } from "@/lib/format";
import { sendEmail } from "@/lib/email/postmark";
import { sollicitatieGesprekBevestigingEmail } from "@/lib/email/templates";
import { RECRUITMENT_GESPREK_LOCATIE } from "@/lib/sollicitatie";
import type { SollicitatieAfspraakSoort } from "@/types/database";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

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
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

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
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const sollicitatieId = pickStr(body.sollicitatie_id);
    const startRaw = pickStr(body.start_at);
    const endRaw = pickStr(body.end_at);
    const interviewerId = pickStr(body.interviewer_id);
    const soort = parseSoort(body.soort) || "telefonisch";
    const notitie = pickStr(body.notitie);
    const locatie =
      soort === "fysiek"
        ? pickStr(body.locatie) || RECRUITMENT_GESPREK_LOCATIE
        : null;
    const duurMinRaw = Number(body.duur_min);
    const duurMin =
      Number.isFinite(duurMinRaw) && duurMinRaw > 0 ? duurMinRaw : 30;

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
    const end =
      (endRaw ? parseStartAt(endRaw) : null) ||
      new Date(start.getTime() + duurMin * 60_000);

    const sb = getSupabaseAdmin();

    const { data: sol, error: solErr } = await sb
      .from("sollicitaties")
      .select("id, status, naam, email, functie")
      .eq("id", sollicitatieId)
      .maybeSingle();
    if (solErr) throw solErr;
    if (!sol) {
      return NextResponse.json(
        { error: "Kandidaat niet gevonden" },
        { status: 404 }
      );
    }

    const insertBase = {
      sollicitatie_id: sollicitatieId,
      start_at: start.toISOString(),
      soort,
      notitie,
      ...(locatie ? { locatie } : {}),
    };

    let data: Record<string, unknown> | null = null;
    let error: { code?: string; message?: string } | null = null;

    {
      const full = await sb
        .from("sollicitatie_afspraken")
        .insert({
          ...insertBase,
          end_at: end.toISOString(),
          interviewer_id: interviewerId,
        })
        .select("*, sollicitaties(id, naam, email, telefoon, functie, status)")
        .single();
      data = full.data as Record<string, unknown> | null;
      error = full.error;
    }

    if (
      error &&
      (error.code === "42703" ||
        error.message?.includes("locatie") ||
        error.message?.includes("interviewer_id") ||
        error.message?.includes("end_at"))
    ) {
      const { locatie: _loc, ...withoutLocatie } = insertBase;
      const softPayload =
        error.message?.includes("locatie") || error.code === "42703"
          ? withoutLocatie
          : insertBase;
      const softInsert =
        error.message?.includes("interviewer_id") ||
        error.message?.includes("end_at")
          ? softPayload
          : {
              ...softPayload,
              end_at: end.toISOString(),
              interviewer_id: interviewerId,
            };
      const soft = await sb
        .from("sollicitatie_afspraken")
        .insert(softInsert as typeof insertBase)
        .select("*, sollicitaties(id, naam, email, telefoon, functie, status)")
        .single();
      data = soft.data as Record<string, unknown> | null;
      error = soft.error;
      if (
        error &&
        (error.code === "42703" ||
          error.message?.includes("interviewer_id") ||
          error.message?.includes("end_at"))
      ) {
        const bare = await sb
          .from("sollicitatie_afspraken")
          .insert(withoutLocatie)
          .select(
            "*, sollicitaties(id, naam, email, telefoon, functie, status)"
          )
          .single();
        data = bare.data as Record<string, unknown> | null;
        error = bare.error;
      }
    }

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

    // Kanban: zet op "Gesprek gepland" (niet terugzetten vanuit beoordeling/aangenomen)
    const { canAutoPromoteToGesprekGepland, normalizeSollicitatieStatus } =
      await import("@/lib/sollicitatie");
    if (
      canAutoPromoteToGesprekGepland(
        normalizeSollicitatieStatus(sol.status as string)
      )
    ) {
      await sb
        .from("sollicitaties")
        .update({
          status: "gesprek_gepland",
          updated_at: new Date().toISOString(),
        })
        .eq("id", sollicitatieId);
    }

    let mailSent = false;
    let mailError: string | null = null;
    const to = sol.email?.trim() || null;
    if (to) {
      try {
        let interviewerNaam: string | null = null;
        if (interviewerId) {
          const { data: adv } = await sb
            .from("adviseurs")
            .select("naam")
            .eq("id", interviewerId)
            .maybeSingle();
          interviewerNaam = (adv?.naam as string | null) || null;
        }
        const html = sollicitatieGesprekBevestigingEmail({
          naam: sol.naam,
          startAt: start,
          soort,
          functie: sol.functie,
          interviewerNaam,
          duurMin,
          locatie,
        });
        const sent = await sendEmail({
          to,
          subject:
            soort === "fysiek"
              ? "Bevestiging gesprek bij Batterijconcept"
              : "Bevestiging telefonisch gesprek Batterijconcept",
          html,
          tag: "sollicitatie-gesprek-bevestiging",
        });
        if (sent.ok) {
          mailSent = true;
        } else {
          mailError = sent.error || "Mail versturen mislukt";
          console.error("Sollicitatie bevestigingsmail:", mailError);
        }
      } catch (e) {
        mailError = errMessage(e, "Mail versturen mislukt");
        console.error("Sollicitatie bevestigingsmail:", e);
      }
    }

    return NextResponse.json(
      {
        afspraak: data,
        mail_sent: mailSent,
        mail_skipped: !to,
        mail_error: mailError,
      },
      { status: 201 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: errMessage(e, "Afspraak aanmaken mislukt") },
      { status: 500 }
    );
  }
}
