import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { errMessage } from "@/lib/errors";
import { requireRecruitmentSession } from "@/lib/auth-require-recruitment";

export const runtime = "nodejs";

function pickStr(v: unknown) {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed || null;
}

/** Zet of wis vacature-koppeling voor een Meta BANEN-campagne. */
export async function PATCH(req: NextRequest) {
  const auth = await requireRecruitmentSession();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const campaignId = pickStr(body.campaign_id);
    if (!campaignId) {
      return NextResponse.json(
        { error: "campaign_id is verplicht" },
        { status: 400 }
      );
    }

    const campaignName = pickStr(body.campaign_name);
    const vacatureId = pickStr(body.vacature_id);
    const sb = getSupabaseAdmin();

    if (!vacatureId) {
      const { error } = await sb
        .from("recruitment_campagne_koppelingen")
        .delete()
        .eq("campaign_id", campaignId);
      if (error) {
        if (error.code === "42P01") {
          return NextResponse.json(
            {
              error:
                "Voer eerst supabase/migrate-recruitment-campagne-koppelingen.sql uit.",
            },
            { status: 400 }
          );
        }
        throw error;
      }
      return NextResponse.json({
        ok: true,
        campaign_id: campaignId,
        vacature_id: null,
      });
    }

    const { data, error } = await sb
      .from("recruitment_campagne_koppelingen")
      .upsert(
        {
          campaign_id: campaignId,
          campaign_name: campaignName,
          vacature_id: vacatureId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "campaign_id" }
      )
      .select("campaign_id, campaign_name, vacature_id")
      .single();

    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          {
            error:
              "Voer eerst supabase/migrate-recruitment-campagne-koppelingen.sql uit.",
          },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ ok: true, koppeling: data });
  } catch (e) {
    return NextResponse.json({ error: errMessage(e) }, { status: 500 });
  }
}
