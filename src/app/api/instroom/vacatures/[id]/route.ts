import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { RECRUITMENT_ROL_OPTIONS } from "@/lib/recruitment-rollen";
import { isStandardVacatureTitel } from "@/lib/ensure-standard-vacatures";
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

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    const sb = getSupabaseAdmin();
    const { data: current, error: curErr } = await sb
      .from("recruitment_vacatures")
      .select("id, titel, status")
      .eq("id", id)
      .maybeSingle();
    if (curErr) {
      if (curErr.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-recruitment-vacatures.sql uit.",
          },
          { status: 400 }
        );
      }
      throw curErr;
    }
    if (!current) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }

    const isStandard = isStandardVacatureTitel(current.titel as string);

    if ("titel" in body) {
      const titel = pickStr(body.titel);
      if (!titel) {
        return NextResponse.json(
          { error: "Titel mag niet leeg zijn" },
          { status: 400 }
        );
      }
      if (isStandard && titel !== current.titel) {
        return NextResponse.json(
          { error: "Titel van standaardvacature kan niet worden gewijzigd" },
          { status: 400 }
        );
      }
      patch.titel = titel;
    }
    if ("rol" in body) {
      const raw = pickStr(body.rol) || "overig";
      patch.rol = (RECRUITMENT_ROL_OPTIONS as string[]).includes(raw)
        ? raw
        : raw;
    }
    if ("status" in body) {
      const status: RecruitmentVacatureStatus =
        body.status === "dicht" ? "dicht" : "open";
      patch.status = status;
    }
    if ("korte_omschrijving" in body) {
      patch.korte_omschrijving = pickStr(body.korte_omschrijving);
    }
    if ("lander_url" in body) {
      patch.lander_url = pickStr(body.lander_url);
    }
    if ("form" in body) {
      const form = parseRecruitmentForm(body.form);
      if (!form) {
        return NextResponse.json(
          { error: "Ongeldig formulier (minimaal 1 vraag)" },
          { status: 400 }
        );
      }
      patch.form = form;
    }
    if ("sort_order" in body && typeof body.sort_order === "number") {
      patch.sort_order = Math.round(body.sort_order);
    }

    let { data, error } = await sb
      .from("recruitment_vacatures")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();

    if (
      error &&
      (error.message?.includes("form") || error.code === "42703")
    ) {
      return NextResponse.json(
        {
          error:
            "Voer supabase/migrate-recruitment-vacature-form.sql uit in Supabase.",
          detail: error.message,
        },
        { status: 400 }
      );
    }

    if (error) {
      if (error.code === "PGRST116") {
        return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
      }
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

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await ctx.params;
  try {
    const sb = getSupabaseAdmin();
    const { data: current, error: curErr } = await sb
      .from("recruitment_vacatures")
      .select("id, titel")
      .eq("id", id)
      .maybeSingle();
    if (curErr) {
      if (curErr.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-recruitment-vacatures.sql uit.",
          },
          { status: 400 }
        );
      }
      throw curErr;
    }
    if (!current) {
      return NextResponse.json({ error: "Niet gevonden" }, { status: 404 });
    }
    if (isStandardVacatureTitel(current.titel as string)) {
      return NextResponse.json(
        { error: "Standaardvacature kan niet worden verwijderd" },
        { status: 400 }
      );
    }

    const { error } = await sb
      .from("recruitment_vacatures")
      .delete()
      .eq("id", id);

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

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
