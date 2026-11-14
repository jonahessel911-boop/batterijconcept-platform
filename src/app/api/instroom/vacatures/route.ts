import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { RECRUITMENT_ROL_OPTIONS } from "@/lib/recruitment-rollen";
import { ensureStandardVacatures } from "@/lib/ensure-standard-vacatures";
import { parseRecruitmentForm } from "@/lib/recruitment-form";
import type {
  RecruitmentVacature,
  RecruitmentVacatureStatus,
} from "@/types/database";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

function parseStatus(v: unknown): RecruitmentVacatureStatus {
  return v === "dicht" ? "dicht" : "open";
}

function parseRol(v: unknown): string {
  const raw = pickStr(v) || "overig";
  if ((RECRUITMENT_ROL_OPTIONS as string[]).includes(raw)) return raw;
  return raw;
}

export async function GET() {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const sb = getSupabaseAdmin();
    try {
      const vacatures = await ensureStandardVacatures(sb);
      return NextResponse.json({ vacatures });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-recruitment-vacatures.sql uit.",
            vacatures: [],
          },
          { status: 400 }
        );
      }
      throw error;
    }
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const titel = pickStr(body.titel);
    if (!titel) {
      return NextResponse.json({ error: "Titel is verplicht" }, { status: 400 });
    }

    const sb = getSupabaseAdmin();
    const form = parseRecruitmentForm(body.form);
    const row: Record<string, unknown> = {
      titel,
      rol: parseRol(body.rol),
      status: parseStatus(body.status),
      korte_omschrijving: pickStr(body.korte_omschrijving),
      lander_url: pickStr(body.lander_url),
      sort_order:
        typeof body.sort_order === "number" && Number.isFinite(body.sort_order)
          ? Math.round(body.sort_order)
          : 0,
      updated_at: new Date().toISOString(),
    };
    if (form) row.form = form;

    let { data, error } = await sb
      .from("recruitment_vacatures")
      .insert(row)
      .select("*")
      .single();

    if (
      error &&
      (error.message?.includes("form") || error.code === "42703")
    ) {
      delete row.form;
      ({ data, error } = await sb
        .from("recruitment_vacatures")
        .insert(row)
        .select("*")
        .single());
    }

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-recruitment-vacatures.sql uit.",
          },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ vacature: data as RecruitmentVacature });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
